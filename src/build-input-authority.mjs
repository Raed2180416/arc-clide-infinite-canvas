import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { compileRepositoryScope } from './repository-scope.mjs'

const PROFILE_SCHEMA = 'arc-atlas-build-profile-v2'
const BASIS_SCHEMA = 'arc-atlas-build-basis-v2'
const FRESHNESS_SCHEMA = 'arc-atlas-freshness-receipt-v1'
const REQUIRED_INPUT_ROLES = [
  'codeGraph',
  'ontology',
  'componentReviews',
  'transcript',
  'scopePolicy',
  'documentPolicy',
  'languageParserPolicy',
]

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareCodePoints).map(key => [key, canonicalValue(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function domainHash(domain, value) {
  return sha256(Buffer.from(canonicalJson({ domain, value }), 'utf8'))
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const actual = Object.keys(value).sort(compareCodePoints)
  const expected = [...keys].sort(compareCodePoints)
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`)
  return value
}

function safeRelative(value, label) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`${label} must be a safe relative path`)
  }
  return normalized
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function relativeIfInside(root, candidate) {
  const relative = path.relative(root, candidate)
  if (relative === '') return ''
  return inside(root, candidate) ? relative.split(path.sep).join('/') : null
}

function parseJsonWithoutDuplicateKeys(bytes, label) {
  const source = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes)
  let offset = 0
  const whitespace = () => {
    while (offset < source.length && /\s/.test(source[offset])) offset += 1
  }
  const parseString = () => {
    const start = offset
    if (source[offset] !== '"') throw new Error(`${label} contains invalid JSON at byte ${offset}`)
    offset += 1
    while (offset < source.length) {
      if (source[offset] === '\\') {
        offset += 2
        continue
      }
      if (source[offset] === '"') {
        offset += 1
        try { return JSON.parse(source.slice(start, offset)) } catch { throw new Error(`${label} contains an invalid JSON string`) }
      }
      offset += 1
    }
    throw new Error(`${label} contains an unterminated JSON string`)
  }
  const parseValue = () => {
    whitespace()
    const token = source[offset]
    if (token === '{') {
      offset += 1
      whitespace()
      const keys = new Set()
      if (source[offset] === '}') { offset += 1; return }
      while (offset < source.length) {
        whitespace()
        const key = parseString()
        if (keys.has(key)) throw new Error(`${label} contains a duplicate JSON object key: ${key}`)
        keys.add(key)
        whitespace()
        if (source[offset] !== ':') throw new Error(`${label} contains invalid JSON at byte ${offset}`)
        offset += 1
        parseValue()
        whitespace()
        if (source[offset] === '}') { offset += 1; return }
        if (source[offset] !== ',') throw new Error(`${label} contains invalid JSON at byte ${offset}`)
        offset += 1
      }
      throw new Error(`${label} contains an unterminated JSON object`)
    }
    if (token === '[') {
      offset += 1
      whitespace()
      if (source[offset] === ']') { offset += 1; return }
      while (offset < source.length) {
        parseValue()
        whitespace()
        if (source[offset] === ']') { offset += 1; return }
        if (source[offset] !== ',') throw new Error(`${label} contains invalid JSON at byte ${offset}`)
        offset += 1
      }
      throw new Error(`${label} contains an unterminated JSON array`)
    }
    if (token === '"') { parseString(); return }
    const remainder = source.slice(offset)
    const primitive = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(remainder)
    if (!primitive) throw new Error(`${label} contains invalid JSON at byte ${offset}`)
    offset += primitive[0].length
  }
  parseValue()
  whitespace()
  if (offset !== source.length) throw new Error(`${label} contains trailing JSON bytes`)
  try { return JSON.parse(source) } catch (error) { throw new Error(`${label} is invalid JSON: ${error.message}`) }
}

function rawFileDescriptor(absolute, logicalLocator = null) {
  const bytes = readFileSync(absolute)
  return {
    logicalLocator,
    bytes: bytes.length,
    sha256: sha256(bytes),
  }
}

function resolveLocator(locator, { builderRoot, repositoryRoot, label, directory = false }) {
  exactObject(locator, ['root', 'path'], label)
  if (!['absolute', 'atlas-project', 'source-repository'].includes(locator.root)) throw new Error(`${label}.root is unsupported`)
  const declaredPath = locator.root === 'absolute'
    ? path.resolve(nonempty(locator.path, `${label}.path`))
    : safeRelative(locator.path, `${label}.path`)
  const root = locator.root === 'atlas-project' ? builderRoot : repositoryRoot
  const candidate = locator.root === 'absolute' ? declaredPath : path.resolve(root, declaredPath)
  let absolute
  try { absolute = realpathSync(candidate) } catch { throw new Error(`${label} does not resolve`) }
  if (locator.root !== 'absolute' && !inside(root, absolute)) throw new Error(`${label}.path escapes its declared root`)
  const stat = lstatSync(absolute)
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`${label} must resolve to a current ${directory ? 'directory' : 'regular file'}`)
  return absolute
}

function isNotUsed(value, label) {
  if (value?.state !== 'not-used') return false
  exactObject(value, ['state'], label)
  return true
}

function validateOptionalLocator(value, context, label) {
  if (isNotUsed(value, label)) return { state: 'not-used', path: null, locator: value }
  return { state: 'configured', path: resolveLocator(value, { ...context, label }), locator: value }
}

function samePhysicalPath(left, right) {
  if (left == null || right == null) return left == null && right == null
  return realpathSync(left) === realpathSync(right)
}

function assertSuppliedPath(supplied, expected, label) {
  if (supplied == null) return
  if (!samePhysicalPath(supplied, expected)) throw new Error(`caller ${label} override does not match the closed build profile`)
}

export function compileAtlasBuildProfileV2({
  profilePath,
  builderRoot,
  repositoryOverride = null,
  supplied = {},
}) {
  if (!profilePath) throw new Error('atlas build requires a closed arc-atlas-build-profile-v2')
  const builder = realpathSync(builderRoot)
  const absoluteProfile = realpathSync(profilePath)
  const profileBytes = readFileSync(absoluteProfile)
  const profile = parseJsonWithoutDuplicateKeys(profileBytes, 'atlas build profile')
  exactObject(profile, ['schemaVersion', 'profileId', 'sourceRepository', 'inputs'], 'atlas build profile')
  if (profile.schemaVersion !== PROFILE_SCHEMA) throw new Error(`atlas build profile schemaVersion must be ${PROFILE_SCHEMA}`)
  nonempty(profile.profileId, 'atlas build profile.profileId')
  exactObject(profile.sourceRepository, ['locator', 'inventory'], 'atlas build profile.sourceRepository')
  if (profile.sourceRepository.inventory !== 'git-ls-files-cached-others-exclude-standard-v1') {
    throw new Error('atlas build profile source inventory strategy is unsupported')
  }
  exactObject(profile.sourceRepository.locator, ['root', 'path'], 'atlas build profile.sourceRepository.locator')
  if (profile.sourceRepository.locator.root !== 'absolute') throw new Error('atlas build profile source repository locator must use the absolute root')
  const repositoryRoot = resolveLocator(profile.sourceRepository.locator, {
    builderRoot: builder,
    repositoryRoot: builder,
    label: 'atlas build profile.sourceRepository.locator',
    directory: true,
  })
  if (repositoryOverride && realpathSync(repositoryOverride) !== repositoryRoot) {
    throw new Error('caller source repository override does not match the closed build profile')
  }
  exactObject(profile.inputs, REQUIRED_INPUT_ROLES, 'atlas build profile.inputs')
  const context = { builderRoot: builder, repositoryRoot }

  let codeGraph
  if (isNotUsed(profile.inputs.codeGraph, 'atlas build profile.inputs.codeGraph')) {
    codeGraph = { state: 'not-used', databasePath: null, project: null }
  } else {
    exactObject(profile.inputs.codeGraph, ['database', 'project', 'snapshot'], 'atlas build profile.inputs.codeGraph')
    if (profile.inputs.codeGraph.snapshot !== 'sqlite-main-wal-shm-v1') throw new Error('atlas build profile code graph snapshot strategy is unsupported')
    codeGraph = {
      state: 'configured',
      databasePath: resolveLocator(profile.inputs.codeGraph.database, { ...context, label: 'atlas build profile.inputs.codeGraph.database' }),
      project: nonempty(profile.inputs.codeGraph.project, 'atlas build profile.inputs.codeGraph.project'),
    }
  }
  const ontology = validateOptionalLocator(profile.inputs.ontology, context, 'atlas build profile.inputs.ontology')
  if (!Array.isArray(profile.inputs.componentReviews)) throw new Error('atlas build profile.inputs.componentReviews must be an array')
  const componentReviewPaths = profile.inputs.componentReviews.map((locator, index) => resolveLocator(locator, {
    ...context,
    label: `atlas build profile.inputs.componentReviews[${index}]`,
  }))
  if (new Set(componentReviewPaths).size !== componentReviewPaths.length) throw new Error('atlas build profile repeats a component review locator')

  let transcript
  if (isNotUsed(profile.inputs.transcript, 'atlas build profile.inputs.transcript')) {
    transcript = { state: 'not-used', sourcePath: null, reviewPath: null, threadId: null }
  } else {
    exactObject(profile.inputs.transcript, ['source', 'review', 'threadId'], 'atlas build profile.inputs.transcript')
    transcript = {
      state: 'configured',
      sourcePath: resolveLocator(profile.inputs.transcript.source, { ...context, label: 'atlas build profile.inputs.transcript.source' }),
      reviewPath: resolveLocator(profile.inputs.transcript.review, { ...context, label: 'atlas build profile.inputs.transcript.review' }),
      threadId: nonempty(profile.inputs.transcript.threadId, 'atlas build profile.inputs.transcript.threadId'),
    }
  }
  const scopePolicy = validateOptionalLocator(profile.inputs.scopePolicy, context, 'atlas build profile.inputs.scopePolicy')
  const documentPolicy = validateOptionalLocator(profile.inputs.documentPolicy, context, 'atlas build profile.inputs.documentPolicy')
  const languageParserPolicy = validateOptionalLocator(profile.inputs.languageParserPolicy, context, 'atlas build profile.inputs.languageParserPolicy')

  assertSuppliedPath(supplied.graphDbPath, codeGraph.databasePath, 'code graph database')
  if (supplied.graphProject != null && supplied.graphProject !== codeGraph.project) throw new Error('caller code graph project override does not match the closed build profile')
  assertSuppliedPath(supplied.ontologyPath, ontology.path, 'ontology')
  if (supplied.componentReviewPaths?.length) {
    const observed = supplied.componentReviewPaths.map(value => realpathSync(value))
    if (canonicalJson(observed) !== canonicalJson(componentReviewPaths)) throw new Error('caller component review override does not match the closed build profile')
  }
  assertSuppliedPath(supplied.transcriptPath, transcript.sourcePath, 'transcript source')
  assertSuppliedPath(supplied.transcriptReviewPath, transcript.reviewPath, 'transcript review')
  assertSuppliedPath(supplied.scopePolicyPath, scopePolicy.path, 'scope policy')
  assertSuppliedPath(supplied.documentPolicyPath, documentPolicy.path, 'document policy')
  assertSuppliedPath(supplied.languageParserPolicyPath, languageParserPolicy.path, 'language parser policy')

  return {
    schemaVersion: PROFILE_SCHEMA,
    profile,
    profilePath: absoluteProfile,
    descriptor: { path: absoluteProfile, ...rawFileDescriptor(absoluteProfile, { root: 'absolute', path: absoluteProfile }) },
    builderRoot: builder,
    repositoryRoot,
    resolved: {
      repositoryRoot,
      graphDbPath: codeGraph.databasePath,
      graphProject: codeGraph.project,
      ontologyPath: ontology.path,
      componentReviewPaths,
      transcriptPath: transcript.sourcePath,
      transcriptReviewPath: transcript.reviewPath,
      transcriptThreadId: transcript.threadId,
      scopePolicyPath: scopePolicy.path,
      documentPolicyPath: documentPolicy.path,
      languageParserPolicyPath: languageParserPolicy.path,
    },
  }
}

function runGit(repository, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', repository, ...args], { encoding, maxBuffer: 512 * 1024 * 1024 })
}

function visibleInventory(repository, outputRoot) {
  const output = path.resolve(outputRoot)
  const excludedOutput = relativeIfInside(repository, output)
  const raw = runGit(repository, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], 'buffer')
  const paths = raw.toString('utf8').split('\0').filter(Boolean)
    .map(value => value.split(path.sep).join('/').replace(/^\.\//, ''))
    .filter(relative => !excludedOutput || (relative !== excludedOutput && !relative.startsWith(`${excludedOutput}/`)))
    .sort(compareCodePoints)
  const entries = paths.map(relative => {
    const absolute = path.join(repository, relative)
    if (!existsSync(absolute)) return { path: relative, fileClass: 'missing', bytes: 0, sha256: null }
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolute)
      return { path: relative, fileClass: 'symlink', bytes: Buffer.byteLength(target), sha256: sha256(target), symlinkTarget: target }
    }
    if (!stat.isFile()) return { path: relative, fileClass: 'non-regular', bytes: stat.size, sha256: sha256(`${relative}\0non-regular`) }
    const bytes = readFileSync(absolute)
    return { path: relative, fileClass: 'regular', bytes: bytes.length, sha256: sha256(bytes) }
  })
  return {
    count: entries.length,
    sha256: domainHash('arc-atlas-source-inventory-v1', entries),
    entries,
  }
}

function gitObservation(repository, outputRoot) {
  const head = runGit(repository, ['rev-parse', 'HEAD']).trim()
  let branch = null
  try { branch = runGit(repository, ['symbolic-ref', '--short', 'HEAD']).trim() } catch {}
  const excludedOutput = relativeIfInside(repository, path.resolve(outputRoot))
  const args = ['status', '--porcelain=v1', '--untracked-files=normal']
  if (excludedOutput) args.push('--', '.', `:(exclude,top)${excludedOutput}`, `:(exclude,top)${excludedOutput}/**`)
  const status = runGit(repository, args)
  return { head, branch, dirty: Boolean(status.trim()), statusSha256: sha256(status) }
}

function walkRegularFiles(root, relative = '') {
  const rows = []
  const absolute = path.join(root, relative)
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((left, right) => compareCodePoints(left.name, right.name))) {
    const child = path.posix.join(relative.split(path.sep).join('/'), entry.name)
    const childAbsolute = path.join(root, child)
    if (entry.isDirectory()) rows.push(...walkRegularFiles(root, child))
    else if (entry.isFile()) rows.push({ path: child, ...rawFileDescriptor(childAbsolute) })
    else if (entry.isSymbolicLink()) {
      const target = readlinkSync(childAbsolute)
      rows.push({ path: child, fileClass: 'symlink', bytes: Buffer.byteLength(target), sha256: sha256(target), target })
    }
  }
  return rows
}

function packageRoot(packageName) {
  const entry = fileURLToPath(import.meta.resolve(packageName))
  let cursor = path.dirname(entry)
  while (cursor !== path.dirname(cursor)) {
    try {
      const metadata = JSON.parse(readFileSync(path.join(cursor, 'package.json'), 'utf8'))
      if (metadata.name === packageName) return cursor
    } catch {}
    cursor = path.dirname(cursor)
  }
  throw new Error(`installed package root is unavailable: ${packageName}`)
}

function executableDescriptor(command, versionArgs) {
  const observed = execFileSync('which', [command], { encoding: 'utf8' }).trim()
  const absolute = realpathSync(observed)
  return {
    path: absolute,
    ...rawFileDescriptor(absolute),
    version: execFileSync(absolute, versionArgs, { encoding: 'utf8' }).trim(),
  }
}

function builderObservation(builderRoot) {
  const files = []
  for (const directory of ['bin', 'src']) files.push(...walkRegularFiles(path.join(builderRoot, directory)).map(file => ({ ...file, path: `${directory}/${file.path}` })))
  for (const relative of ['package.json', 'package-lock.json']) files.push({ path: relative, ...rawFileDescriptor(path.join(builderRoot, relative)) })
  files.sort((left, right) => compareCodePoints(left.path, right.path))
  const dependencies = ['typescript', 'web-tree-sitter'].map(name => {
    const root = packageRoot(name)
    const packageFiles = walkRegularFiles(root)
    return {
      name,
      root,
      files: packageFiles,
      sha256: domainHash('arc-atlas-builder-dependency-v1', { name, files: packageFiles }),
    }
  })
  const nodeExecutable = realpathSync(process.execPath)
  const runtime = {
    node: {
      executable: { path: nodeExecutable, ...rawFileDescriptor(nodeExecutable) },
      version: process.version,
      versions: Object.fromEntries(['v8', 'icu', 'sqlite', 'tz', 'unicode'].map(key => [key, process.versions[key] || null])),
    },
    python: executableDescriptor('python3', ['--version']),
    git: executableDescriptor('git', ['--version']),
    platform: process.platform,
    architecture: process.arch,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    collation: Intl.Collator().resolvedOptions(),
    timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  }
  const source = {
    files,
    sha256: domainHash('arc-atlas-builder-source-v1', files),
  }
  return {
    source,
    runtime,
    dependencies,
    sha256: domainHash('arc-atlas-builder-v2', { source, runtime, dependencies }),
  }
}

function captureConfiguredFile(absolute, locator) {
  if (!absolute) return { state: 'not-used' }
  return { state: 'observed', path: absolute, ...rawFileDescriptor(absolute, locator) }
}

function sqlitePartDescriptor(absolute) {
  if (!existsSync(absolute)) return { state: 'absent', path: absolute }
  return { state: 'observed', path: absolute, ...rawFileDescriptor(absolute) }
}

function codeGraphObservation(authority) {
  const databasePath = authority.resolved.graphDbPath
  if (!databasePath) return { state: 'not-used' }
  const project = authority.resolved.graphProject
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const projectRow = db.prepare('SELECT * FROM projects WHERE name = ?').get(project)
    if (!projectRow) throw new Error(`code graph project not found: ${project}`)
    const nodes = db.prepare(`
      SELECT id, label, name, qualified_name, file_path, start_line, end_line, properties
      FROM nodes WHERE project = ? AND label IN ('Function', 'Method') ORDER BY id
    `).all(project)
    const edges = db.prepare(`
      SELECT id, source_id, target_id, type, properties
      FROM edges WHERE project = ? ORDER BY id
    `).all(project)
    const hasFileHashes = Boolean(db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'file_hashes'").get())
    const fileHashes = hasFileHashes
      ? db.prepare('SELECT rel_path, sha256, size FROM file_hashes WHERE project = ? ORDER BY rel_path').all(project)
      : []
    const queryBasis = { projectRow, nodes, edges, fileHashes }
    const bundle = {
      main: sqlitePartDescriptor(databasePath),
      wal: sqlitePartDescriptor(`${databasePath}-wal`),
      shm: sqlitePartDescriptor(`${databasePath}-shm`),
    }
    return {
      state: 'observed',
      project,
      sqliteBundle: bundle,
      queryRows: { nodes: nodes.length, edges: edges.length, fileHashes: fileHashes.length },
      queryBasisSha256: domainHash('arc-atlas-sqlite-query-basis-v1', queryBasis),
      sha256: domainHash('arc-atlas-sqlite-input-v1', { project, bundle, queryBasisSha256: domainHash('arc-atlas-sqlite-query-basis-v1', queryBasis) }),
    }
  } finally {
    db.close()
  }
}

function parserPolicyObservation(authority) {
  const policyPath = authority.resolved.languageParserPolicyPath
  if (!policyPath) return { state: 'not-used' }
  const policyDescriptor = captureConfiguredFile(policyPath, authority.profile.inputs.languageParserPolicy)
  const policy = parseJsonWithoutDuplicateKeys(readFileSync(policyPath), 'language parser policy')
  if (!Array.isArray(policy.languages)) throw new Error('language parser policy languages must be an array')
  const root = path.dirname(policyPath)
  const artifacts = []
  for (const [index, language] of policy.languages.entries()) {
    for (const role of ['grammar', 'query', ...(language.sourceSiteQuery ? ['sourceSiteQuery'] : [])]) {
      const descriptor = language[role]
      if (!descriptor?.path) throw new Error(`language parser policy languages[${index}].${role} has no path`)
      const absolute = descriptor.path.startsWith('repo:')
        ? realpathSync(path.resolve(authority.repositoryRoot, descriptor.path.slice('repo:'.length)))
        : realpathSync(path.resolve(root, descriptor.path))
      const observed = rawFileDescriptor(absolute)
      if (descriptor.sha256 !== observed.sha256) throw new Error(`language parser policy artifact drifted: ${descriptor.path}`)
      artifacts.push({ language: language.language, role, declaredPath: descriptor.path, path: absolute, ...observed })
    }
  }
  artifacts.sort((left, right) => compareCodePoints(`${left.language}\0${left.role}\0${left.path}`, `${right.language}\0${right.role}\0${right.path}`))
  return {
    state: 'observed',
    policy: policyDescriptor,
    resolvedArtifacts: artifacts,
    sha256: domainHash('arc-atlas-parser-policy-input-v1', { policy: policyDescriptor, resolvedArtifacts: artifacts }),
  }
}

function inputObservation(authority) {
  const transcript = authority.resolved.transcriptPath
    ? {
      state: 'observed',
      source: {
        ...captureConfiguredFile(authority.resolved.transcriptPath, authority.profile.inputs.transcript.source),
        lineCount: readFileSync(authority.resolved.transcriptPath, 'utf8').split('\n').length - 1,
      },
      review: captureConfiguredFile(authority.resolved.transcriptReviewPath, authority.profile.inputs.transcript.review),
      threadId: authority.resolved.transcriptThreadId,
    }
    : { state: 'not-used' }
  return {
    codeGraph: codeGraphObservation(authority),
    ontology: captureConfiguredFile(authority.resolved.ontologyPath, authority.profile.inputs.ontology),
    componentReviews: authority.resolved.componentReviewPaths.map((reviewPath, index) => captureConfiguredFile(reviewPath, authority.profile.inputs.componentReviews[index])),
    transcript,
    scopePolicy: captureConfiguredFile(authority.resolved.scopePolicyPath, authority.profile.inputs.scopePolicy),
    documentPolicy: captureConfiguredFile(authority.resolved.documentPolicyPath, authority.profile.inputs.documentPolicy),
    parserPolicy: parserPolicyObservation(authority),
  }
}

export function captureAtlasBuildBasisV2({ authority, outputRoot }) {
  if (authority?.schemaVersion !== PROFILE_SCHEMA) throw new Error('capture requires one compiled arc-atlas-build-profile-v2 authority')
  const profile = { path: authority.profilePath, ...rawFileDescriptor(authority.profilePath, { root: 'absolute', path: authority.profilePath }) }
  const scope = compileRepositoryScope({
    repository: authority.repositoryRoot,
    output: path.resolve(outputRoot),
    policyPath: authority.resolved.scopePolicyPath,
  })
  const source = {
    git: gitObservation(authority.repositoryRoot, outputRoot),
    visibleInventory: visibleInventory(authority.repositoryRoot, outputRoot),
    scope: {
      scopeSha256: scope.scopeSha256,
      ignoredInventorySha256: domainHash('arc-atlas-ignored-inventory-v1', scope.ignored.entries),
      ignored: scope.ignored.total,
    },
  }
  const inputs = inputObservation(authority)
  const builder = builderObservation(authority.builderRoot)
  const body = { profile, source, inputs, builder }
  return {
    ...body,
    captureSha256: domainHash('arc-atlas-build-capture-v2', body),
  }
}

export function finalizeAtlasBuildBasisV2({ capture, derived }) {
  if (!capture?.captureSha256) throw new Error('finalize requires a captured build basis')
  if (!derived || typeof derived !== 'object' || Array.isArray(derived)) throw new Error('build basis derived observations must be an object')
  const body = {
    schemaVersion: BASIS_SCHEMA,
    profile: capture.profile,
    source: capture.source,
    inputs: capture.inputs,
    builder: capture.builder,
    derived: canonicalValue(derived),
    captureSha256: capture.captureSha256,
  }
  return { ...body, basisSha256: domainHash('arc-atlas-build-basis-v2', body) }
}

function changedCheck(id, expected, observed, reason = 'input-bytes-changed', nextAction = 'review-change-and-rebuild-atlas') {
  const same = canonicalJson(expected) === canonicalJson(observed)
  return {
    id,
    required: true,
    expected,
    observed,
    status: same ? 'pass' : 'changed',
    reason: same ? 'exact-build-basis-domain-still-matches' : reason,
    nextAction: same ? null : nextAction,
  }
}

function descriptorSummary(value) {
  if (!value || value.state === 'not-used') return value
  return { bytes: value.bytes, sha256: value.sha256 }
}

export function verifyAtlasBuildBasisCurrentV2(basis, { authority, outputRoot }) {
  const checkedAt = new Date().toISOString()
  if (!basis || basis.schemaVersion !== BASIS_SCHEMA) {
    return {
      schemaVersion: FRESHNESS_SCHEMA,
      snapshotSha256: null,
      profileSha256: basis?.profile?.sha256 || null,
      checkedAt,
      state: 'historical-only',
      checks: [],
      blockers: ['snapshot-has-no-arc-atlas-build-basis-v2'],
    }
  }
  const { basisSha256, ...body } = basis
  if (domainHash('arc-atlas-build-basis-v2', body) !== basisSha256) {
    return {
      schemaVersion: FRESHNESS_SCHEMA,
      snapshotSha256: null,
      profileSha256: basis.profile?.sha256 || null,
      checkedAt,
      state: 'unverifiable',
      checks: [],
      blockers: ['build-basis-self-digest-mismatch'],
    }
  }
  let current
  try { current = captureAtlasBuildBasisV2({ authority, outputRoot }) } catch (error) {
    return {
      schemaVersion: FRESHNESS_SCHEMA,
      snapshotSha256: null,
      profileSha256: basis.profile?.sha256 || null,
      checkedAt,
      state: 'unverifiable',
      checks: [{ id: 'capture-current-basis', required: true, expected: 'readable', observed: error.message, status: 'unverifiable', reason: 'current-build-basis-could-not-be-captured', nextAction: 'restore-required-input-and-reverify' }],
      blockers: ['current-build-basis-could-not-be-captured'],
    }
  }
  const checks = [
    changedCheck('profile', descriptorSummary(basis.profile), descriptorSummary(current.profile)),
    changedCheck('source:git', basis.source.git, current.source.git, 'source-git-state-changed'),
    changedCheck('source:visible-inventory', { count: basis.source.visibleInventory.count, sha256: basis.source.visibleInventory.sha256 }, { count: current.source.visibleInventory.count, sha256: current.source.visibleInventory.sha256 }, 'source-visible-inventory-changed'),
    changedCheck('source:scope', basis.source.scope, current.source.scope, 'source-scope-changed'),
    changedCheck('input:code-graph', { sha256: basis.inputs.codeGraph.sha256 || null, state: basis.inputs.codeGraph.state }, { sha256: current.inputs.codeGraph.sha256 || null, state: current.inputs.codeGraph.state }),
    changedCheck('input:ontology', descriptorSummary(basis.inputs.ontology), descriptorSummary(current.inputs.ontology)),
    changedCheck('input:component-reviews', basis.inputs.componentReviews.map(descriptorSummary), current.inputs.componentReviews.map(descriptorSummary)),
    changedCheck('input:scope-policy', descriptorSummary(basis.inputs.scopePolicy), descriptorSummary(current.inputs.scopePolicy)),
    changedCheck('input:document-policy', descriptorSummary(basis.inputs.documentPolicy), descriptorSummary(current.inputs.documentPolicy)),
    changedCheck('input:parser-policy', { state: basis.inputs.parserPolicy.state, sha256: basis.inputs.parserPolicy.sha256 || null }, { state: current.inputs.parserPolicy.state, sha256: current.inputs.parserPolicy.sha256 || null }),
    changedCheck('builder', { sha256: basis.builder.sha256 }, { sha256: current.builder.sha256 }, 'builder-source-runtime-or-dependency-changed'),
  ]
  if (basis.inputs.transcript.state === 'not-used' || current.inputs.transcript.state === 'not-used') {
    checks.push(changedCheck('input:transcript', basis.inputs.transcript, current.inputs.transcript))
  } else {
    const expected = basis.inputs.transcript.source
    const observed = current.inputs.transcript.source
    let reason = 'input-bytes-changed'
    if (observed.bytes > expected.bytes) {
      const prefix = readFileSync(authority.resolved.transcriptPath).subarray(0, expected.bytes)
      if (sha256(prefix) === expected.sha256) reason = 'append-only-unreviewed'
    }
    checks.push(changedCheck('input:transcript-source', descriptorSummary(expected), descriptorSummary(observed), reason, 'review-new-transcript-cutoff-and-rebuild'))
    checks.push(changedCheck('input:transcript-review', descriptorSummary(basis.inputs.transcript.review), descriptorSummary(current.inputs.transcript.review)))
    checks.push(changedCheck('input:transcript-thread', basis.inputs.transcript.threadId, current.inputs.transcript.threadId))
  }
  const blockers = checks.filter(check => check.status !== 'pass').map(check => `${check.id}:${check.reason}`)
  return {
    schemaVersion: FRESHNESS_SCHEMA,
    snapshotSha256: null,
    profileSha256: basis.profile.sha256,
    checkedAt,
    state: blockers.length ? 'stale' : 'current-at-verified-at',
    checks,
    blockers,
  }
}

export function observeAtlasSnapshotFreshnessV1({ snapshotRoot, manifest, builderRoot }) {
  const snapshot = realpathSync(snapshotRoot)
  const unavailable = ({ status = 'historical-only', buildBasisSha256 = null, requiredEvidence = 'exact-builder-repository-and-semantic-input-descriptors' } = {}) => ({
    schemaVersion: 'arc-atlas-build-input-freshness-v1',
    authority: 'none',
    buildBasisSha256,
    status,
    staleCount: null,
    checks: [],
    nextReview: {
      action: 'rebuild-with-closed-build-input-manifest',
      target: 'atlas build --build-inputs <profile.json>',
      basisSha256: manifest?.build?.basisSha256 ?? null,
      requiredEvidence,
    },
  })
  const provenanceArtifacts = ['data/build-basis.json', 'data/build-inputs.json']
  const declaredArtifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : null
  const physicalProvenancePresent = provenanceArtifacts.some(relative => existsSync(path.join(snapshot, relative)))
  const declaredProvenancePresent = declaredArtifacts?.some(artifact => provenanceArtifacts.includes(artifact?.path)) || false
  if (!physicalProvenancePresent && !declaredProvenancePresent) return unavailable()
  if (!declaredArtifacts) {
    return unavailable({
      status: 'unverifiable',
      requiredEvidence: 'snapshot build provenance artifacts must be declared in the exact manifest artifact set',
    })
  }
  const openedProvenance = new Map()
  for (const relative of provenanceArtifacts) {
    const descriptors = declaredArtifacts.filter(artifact => artifact?.path === relative)
    if (descriptors.length !== 1) {
      return unavailable({
        status: 'unverifiable',
        requiredEvidence: 'snapshot build provenance artifacts must be declared exactly once in the manifest artifact set',
      })
    }
    const descriptor = descriptors[0]
    const absolute = path.join(snapshot, relative)
    if (!existsSync(absolute)) {
      return unavailable({
        status: 'unverifiable',
        requiredEvidence: `declared snapshot build provenance artifact is missing: ${relative}`,
      })
    }
    let physical
    try {
      const real = realpathSync(absolute)
      if (!inside(snapshot, real)) throw new Error('artifact escapes snapshot root')
      physical = readFileSync(real)
    } catch (error) {
      return unavailable({
        status: 'unverifiable',
        requiredEvidence: `declared snapshot build provenance artifact is unreadable: ${relative}: ${error.message}`,
      })
    }
    if (!Number.isInteger(descriptor.bytes) || !/^[a-f0-9]{64}$/.test(descriptor.sha256 || '')
      || descriptor.bytes !== physical.length || descriptor.sha256 !== sha256(physical)) {
      return unavailable({
        status: 'unverifiable',
        requiredEvidence: `declared snapshot build provenance artifact digest does not match bytes: ${relative}`,
      })
    }
    openedProvenance.set(relative, physical)
  }

  let basis
  let inputs
  try {
    basis = parseJsonWithoutDuplicateKeys(openedProvenance.get('data/build-basis.json'), 'atlas snapshot build basis')
    inputs = parseJsonWithoutDuplicateKeys(openedProvenance.get('data/build-inputs.json'), 'atlas snapshot build inputs')
  } catch (error) {
    return unavailable({ status: 'unverifiable', requiredEvidence: `snapshot-build-input-artifact-is-invalid: ${error.message}` })
  }
  if (basis?.state === 'not-configured' && inputs?.state === 'not-configured') return unavailable()
  const profilePath = inputs?.profile?.path || null
  if (basis?.schemaVersion !== BASIS_SCHEMA || !basis.basisSha256 || !profilePath || !manifest?.snapshot?.repositoryRoot) {
    return unavailable({
      status: 'unverifiable',
      buildBasisSha256: basis?.basisSha256 ?? null,
      requiredEvidence: 'snapshot-claims-build-input-provenance-but-does-not-provide-a-closed-basis-profile-and-repository-root',
    })
  }
  if (inputs?.schemaVersion !== 'arc-atlas-build-inputs-summary-v1'
    || inputs.basisSha256 !== basis.basisSha256
    || manifest.build?.basisSha256 !== basis.basisSha256
    || manifest.build?.buildInputSha256 !== basis.basisSha256
    || manifest.snapshot?.basisSha256 !== basis.basisSha256
    || manifest.build?.builderSourceSha256 !== basis.builder?.source?.sha256
    || manifest.sources?.buildInputs?.state !== 'observed'
    || manifest.sources.buildInputs.basisSha256 !== basis.basisSha256
    || manifest.sources.buildInputs.profileSha256 !== basis.profile?.sha256
    || manifest.sources.buildInputs.builderSha256 !== basis.builder?.sha256
    || manifest.gates?.buildInputProvenance?.status !== 'pass') {
    return unavailable({
      status: 'unverifiable',
      buildBasisSha256: basis.basisSha256,
      requiredEvidence: 'snapshot manifest, declared build provenance artifacts, source summary, and build-input gate must cross-bind one exact basis',
    })
  }
  if (!existsSync(profilePath)) {
    return unavailable({
      status: 'unverifiable',
      buildBasisSha256: basis.basisSha256,
      requiredEvidence: `configured-build-profile-is-unavailable: ${profilePath}`,
    })
  }
  try {
    const authority = compileAtlasBuildProfileV2({
      profilePath,
      builderRoot,
      repositoryOverride: manifest.snapshot.repositoryRoot,
    })
    const freshness = verifyAtlasBuildBasisCurrentV2(basis, { authority, outputRoot: snapshot })
    return {
      schemaVersion: 'arc-atlas-build-input-freshness-v1',
      authority: 'derived-from-current-build-basis',
      buildBasisSha256: basis.basisSha256,
      status: freshness.state,
      staleCount: freshness.checks.filter(check => check.status !== 'pass').length,
      checks: freshness.checks,
      nextReview: {
        action: 'rebuild-with-closed-build-input-manifest',
        target: 'atlas build --build-inputs <profile.json>',
        basisSha256: basis.basisSha256,
        requiredEvidence: 'exact-builder-repository-and-semantic-input-descriptors',
      },
    }
  } catch (error) {
    return unavailable({
      status: 'unverifiable',
      buildBasisSha256: basis.basisSha256,
      requiredEvidence: `build-basis-could-not-be-verified: ${error.message}`,
    })
  }
}

export const ATLAS_BUILD_PROFILE_SCHEMA_V2 = PROFILE_SCHEMA
export const ATLAS_BUILD_BASIS_SCHEMA_V2 = BASIS_SCHEMA
