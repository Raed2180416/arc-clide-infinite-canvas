import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.py', '.pyi', '.rs', '.sh', '.bash',
  '.go', '.java', '.rb', '.ex', '.exs', '.cs', '.scala', '.lua', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.swift', '.kt', '.kts', '.php', '.r', '.dart', '.vue', '.svelte', '.sql',
])

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '')
}

function relativeIfInside(root, candidate) {
  const relative = path.relative(root, candidate)
  if (!relative || relative === '.') return ''
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return normalizeRelative(relative)
}

function ignoredPaths(repository) {
  return execFileSync('git', [
    '-C', repository,
    'ls-files', '-z', '--others', '--ignored', '--exclude-standard',
  ], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizeRelative)
}

function ignoreRules(repository, paths) {
  if (paths.length === 0) return new Map()
  const input = Buffer.from(`${paths.join('\0')}\0`)
  const output = execFileSync('git', [
    '-C', repository,
    'check-ignore', '-z', '-v', '--no-index', '--stdin',
  ], { input, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
  const fields = output.toString('utf8').split('\0')
  const rules = new Map()
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [sourcePath, line, pattern, ignoredPath] = fields.slice(index, index + 4)
    if (!ignoredPath) continue
    rules.set(normalizeRelative(ignoredPath), {
      sourcePath: normalizeRelative(sourcePath),
      line: Number(line),
      pattern,
    })
  }
  return rules
}

function loadPolicies(policyPath) {
  if (!policyPath) return { path: null, sha256: null, policies: [] }
  const absolute = path.resolve(policyPath)
  const bytes = readFileSync(absolute)
  const value = JSON.parse(bytes.toString('utf8'))
  if (value.schemaVersion !== 'arc-atlas-scope-policy-ledger-v1' || !Array.isArray(value.policies)) throw new Error('scope policy ledger has an unsupported or invalid schema')
  const ids = new Set()
  for (const policy of value.policies) {
    if (!policy.id || ids.has(policy.id) || !policy.classification || !policy.rationale || !policy.match || (!policy.match.ignorePattern && !policy.match.pathPrefix)) throw new Error('scope policy ledger contains an invalid or duplicate policy')
    ids.add(policy.id)
  }
  return { path: absolute, sha256: sha256(bytes), policies: value.policies }
}

function policyMatches(policy, relative, ignoreRule) {
  if (policy.match.pathPrefix && relative !== policy.match.pathPrefix && !relative.startsWith(`${policy.match.pathPrefix.replace(/\/$/, '')}/`)) return false
  if (policy.match.ignorePattern && ignoreRule?.pattern !== policy.match.ignorePattern) return false
  if (policy.match.ignoreSourcePath && ignoreRule?.sourcePath !== policy.match.ignoreSourcePath) return false
  if (policy.match.ignoreSourcePathSuffix && !ignoreRule?.sourcePath?.endsWith(policy.match.ignoreSourcePathSuffix)) return false
  return true
}

export function compileRepositoryScope({ repository, output, policyPath = null }) {
  const policyLedger = loadPolicies(policyPath)
  const excludedOutput = relativeIfInside(repository, output)
  const paths = ignoredPaths(repository)
    .filter(relative => !excludedOutput || (relative !== excludedOutput && !relative.startsWith(`${excludedOutput}/`)))
    .sort((left, right) => left.localeCompare(right))
  const rules = ignoreRules(repository, paths)
  const usedPolicyIds = new Set()
  const entries = paths.map(relative => {
    const absolute = path.join(repository, relative)
    const stat = existsSync(absolute) ? lstatSync(absolute) : null
    const extension = path.extname(relative).toLowerCase()
    const ignoreRule = rules.get(relative) || null
    const matches = policyLedger.policies.filter(policy => policyMatches(policy, relative, ignoreRule))
    if (matches.length > 1) throw new Error(`ignored path matches multiple scope policies: ${relative}`)
    const reviewedPolicy = matches[0] || null
    if (reviewedPolicy) usedPolicyIds.add(reviewedPolicy.id)
    return {
      id: `ignored:${sha256(relative)}`,
      path: relative,
      pathBytesBase64: Buffer.from(relative).toString('base64'),
      topLevel: relative.split('/', 1)[0],
      fileClass: !stat ? 'missing'
        : stat.isSymbolicLink() ? 'symlink'
          : stat.isFile() ? 'regular'
            : 'non-regular',
      bytes: stat?.size ?? null,
      codeLike: CODE_EXTENSIONS.has(extension),
      ignoreRule,
      contentRead: false,
      policy: {
        status: reviewedPolicy ? 'source-addressed-reviewed' : 'review-required',
        classification: reviewedPolicy?.classification || null,
        rationale: reviewedPolicy?.rationale || null,
        contentPolicy: reviewedPolicy?.contentPolicy || null,
        sourceRefs: reviewedPolicy ? [{ path: policyLedger.path, sha256: policyLedger.sha256, policyId: reviewedPolicy.id }] : [],
      },
    }
  })
  const byTopLevel = Object.fromEntries([...new Set(entries.map(entry => entry.topLevel))]
    .sort()
    .map(topLevel => [topLevel, entries.filter(entry => entry.topLevel === topLevel).length]))
  const body = {
    schemaVersion: 'arc-atlas-repository-scope-v1',
    authority: 'read-only-derived-projection',
    repositoryRoot: repository,
    ignored: {
      total: entries.length,
      codeLike: entries.filter(entry => entry.codeLike).length,
      policyReviewed: entries.filter(entry => entry.policy.status === 'source-addressed-reviewed').length,
      reviewRequired: entries.filter(entry => entry.policy.status === 'review-required').length,
      byTopLevel,
      entries,
    },
    safety: {
      ignoredContentRead: false,
      statement: 'Ignored paths and ignore rules are inventoried; ignored file contents are not read by this adapter.',
    },
    policyLedger: {
      state: policyPath ? 'observed' : 'not-requested',
      path: policyLedger.path,
      sha256: policyLedger.sha256,
      policies: policyLedger.policies.length,
      usedPolicies: usedPolicyIds.size,
      unusedPolicyIds: policyLedger.policies.map(policy => policy.id).filter(id => !usedPolicyIds.has(id)).sort(),
    },
  }
  return { ...body, scopeSha256: sha256(JSON.stringify(body)) }
}
