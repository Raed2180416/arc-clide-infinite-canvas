import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKER_PATH = fileURLToPath(new URL('./tree-sitter-policy-worker.mjs', import.meta.url))

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`)
  return value
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256`)
  return value
}

function installedRuntimeMetadata() {
  const modulePath = fileURLToPath(import.meta.resolve('web-tree-sitter'))
  let cursor = path.dirname(modulePath)
  while (cursor !== path.dirname(cursor)) {
    try {
      const metadata = JSON.parse(readFileSync(path.join(cursor, 'package.json'), 'utf8'))
      if (metadata.name === 'web-tree-sitter') return { version: metadata.version, license: metadata.license }
    } catch {}
    cursor = path.dirname(cursor)
  }
  throw new Error('web-tree-sitter package metadata is unavailable')
}

function resolveArtifact(policyRoot, repositoryRoot, descriptor, label) {
  const declaredPath = nonempty(descriptor.path, `${label}.path`)
  const absolute = declaredPath.startsWith('repo:')
    ? realpathSync(path.resolve(repositoryRoot, declaredPath.slice('repo:'.length)))
    : realpathSync(path.resolve(policyRoot, declaredPath))
  if (declaredPath.startsWith('repo:')) {
    const relative = path.relative(repositoryRoot, absolute)
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${label}.path escapes the repository`)
    }
  }
  const bytes = readFileSync(absolute)
  const observedSha256 = sha256(bytes)
  if (observedSha256 !== digest(descriptor.sha256, `${label}.sha256`)) {
    throw new Error(`${label} bytes do not match their declared SHA-256`)
  }
  return { absolute, bytes: bytes.length, sha256: observedSha256 }
}

export function compileTreeSitterPolicyBatch({ policyPath, repository, files }) {
  if (!policyPath) {
    return {
      byPath: {},
      source: { state: 'not-requested', authority: 'none', languages: [] },
      supportedLanguages: new Set(),
    }
  }
  const absolutePolicyPath = realpathSync(policyPath)
  const repositoryRoot = realpathSync(repository)
  const policyBytes = readFileSync(absolutePolicyPath)
  const policy = JSON.parse(policyBytes.toString('utf8'))
  exactObject(policy, ['schemaVersion', 'runtime', 'languages'], 'tree-sitter policy')
  if (!['arc-atlas-tree-sitter-policy-v1', 'arc-atlas-tree-sitter-policy-v2'].includes(policy.schemaVersion)) {
    throw new Error('tree-sitter policy schemaVersion is unsupported')
  }
  const sourceSitePolicy = policy.schemaVersion === 'arc-atlas-tree-sitter-policy-v2'
  exactObject(policy.runtime, ['package', 'version', 'license'], 'tree-sitter policy runtime')
  if (policy.runtime.package !== 'web-tree-sitter') throw new Error('tree-sitter policy runtime package must be web-tree-sitter')
  const installed = installedRuntimeMetadata()
  if (policy.runtime.version !== installed.version || policy.runtime.license !== installed.license) {
    throw new Error('tree-sitter policy runtime identity does not match the installed runtime')
  }
  if (!Array.isArray(policy.languages) || policy.languages.length === 0) throw new Error('tree-sitter policy languages must be nonempty')

  const policyRoot = path.dirname(absolutePolicyPath)
  const seenLanguages = new Set()
  const seenExtensions = new Set()
  const compiledLanguages = policy.languages.map((entry, index) => {
    const label = `tree-sitter policy languages[${index}]`
    exactObject(entry, sourceSitePolicy
      ? ['language', 'extensions', 'grammar', 'query', 'sourceSiteQuery', 'semanticCeiling']
      : ['language', 'extensions', 'grammar', 'query', 'semanticCeiling'], label)
    const language = nonempty(entry.language, `${label}.language`)
    if (seenLanguages.has(language)) throw new Error(`tree-sitter policy repeats language ${language}`)
    seenLanguages.add(language)
    if (entry.semanticCeiling !== 'syntax') throw new Error(`${label}.semanticCeiling must be syntax`)
    if (!Array.isArray(entry.extensions) || entry.extensions.length === 0) throw new Error(`${label}.extensions must be nonempty`)
    const extensions = entry.extensions.map((extension, extensionIndex) => {
      const normalized = nonempty(extension, `${label}.extensions[${extensionIndex}]`).toLowerCase()
      if (!/^\.[a-z0-9_+-]+$/.test(normalized)) throw new Error(`${label}.extensions contains an invalid extension`)
      if (seenExtensions.has(normalized)) throw new Error(`tree-sitter policy repeats extension ${normalized}`)
      seenExtensions.add(normalized)
      return normalized
    })
    exactObject(entry.grammar, ['path', 'sha256', 'upstream', 'version', 'license'], `${label}.grammar`)
    nonempty(entry.grammar.upstream, `${label}.grammar.upstream`)
    nonempty(entry.grammar.version, `${label}.grammar.version`)
    nonempty(entry.grammar.license, `${label}.grammar.license`)
    exactObject(entry.query, ['path', 'sha256'], `${label}.query`)
    const grammar = resolveArtifact(policyRoot, repositoryRoot, entry.grammar, `${label}.grammar`)
    const query = resolveArtifact(policyRoot, repositoryRoot, entry.query, `${label}.query`)
    if (sourceSitePolicy) exactObject(entry.sourceSiteQuery, ['path', 'sha256'], `${label}.sourceSiteQuery`)
    const sourceSiteQuery = sourceSitePolicy
      ? resolveArtifact(policyRoot, repositoryRoot, entry.sourceSiteQuery, `${label}.sourceSiteQuery`)
      : null
    return {
      language,
      extensions,
      semanticCeiling: 'syntax',
      grammar: { ...entry.grammar, ...grammar },
      query: { ...entry.query, ...query },
      sourceSiteQuery: sourceSiteQuery ? { ...entry.sourceSiteQuery, ...sourceSiteQuery } : null,
    }
  })

  const eligible = files
    .filter(file => seenLanguages.has(file.language))
    .map(file => ({ path: file.path, absolute: file.absolute, language: file.language }))
  const raw = execFileSync(process.execPath, [WORKER_PATH], {
    input: JSON.stringify({ files: eligible, languages: compiledLanguages }),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  const observed = JSON.parse(raw)
  if (!observed || observed.schemaVersion !== 'arc-atlas-tree-sitter-observation-v1' || typeof observed.byPath !== 'object') {
    throw new Error('tree-sitter worker returned an invalid observation')
  }
  return {
    byPath: observed.byPath,
    supportedLanguages: seenLanguages,
    source: {
      state: 'observed',
      authority: 'hash-pinned-tree-sitter-syntax-only',
      policy: { path: absolutePolicyPath, sha256: sha256(policyBytes) },
      runtime: { ...policy.runtime },
      languages: compiledLanguages.map(entry => ({
        language: entry.language,
        extensions: entry.extensions,
        semanticCeiling: entry.semanticCeiling,
        grammarSha256: entry.grammar.sha256,
        grammarBytes: entry.grammar.bytes,
        grammarVersion: entry.grammar.version,
        grammarLicense: entry.grammar.license,
        grammarUpstream: entry.grammar.upstream,
        querySha256: entry.query.sha256,
        queryBytes: entry.query.bytes,
        sourceSiteQuerySha256: entry.sourceSiteQuery?.sha256 || null,
        sourceSiteQueryBytes: entry.sourceSiteQuery?.bytes || 0,
      })),
      filesObserved: eligible.length,
    },
  }
}
