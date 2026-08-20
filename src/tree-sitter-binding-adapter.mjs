import { createHash } from 'node:crypto'

const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const PYTHON_EXTENSIONS = new Set(['.py', '.pyi'])

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function callableReferenceSite(reference) {
  return reference.roles?.some(role => ['call', 'construct'].includes(role))
    || ['call-site', 'construction-site'].includes(reference.kind)
}

export function compileTreeSitterBindingObservations({ files, symbols, referenceSites }) {
  // Tree-sitter covers every non-JS/TS/Python code language. Its symbols and
  // source sites are already in memory, so this pass resolves call sites to
  // same-file declarations by exact name without a subprocess.
  const treeSitterPaths = new Set(files
    .filter(file => file.fileClass === 'regular'
      && !JAVASCRIPT_EXTENSIONS.has(pathExt(file.path))
      && !PYTHON_EXTENSIONS.has(pathExt(file.path)))
    .map(file => file.path))
  const treeSitterReferences = referenceSites.filter(reference => treeSitterPaths.has(reference.path) && callableReferenceSite(reference))
  const treeSitterSymbols = symbols.filter(symbol => symbol.derivation?.adapter === 'tree-sitter-policy-v1')
  if (treeSitterReferences.length === 0) {
    return {
      schemaVersion: 'arc-atlas-tree-sitter-binding-observation-v1',
      source: { state: 'not-applicable', authority: 'none', compilerPackage: 'tree-sitter', compilerVersion: 'policy-v1' },
      observations: [],
      externalEntities: [],
    }
  }
  // Index tree-sitter declarations by (path, name).
  const byName = new Map()
  for (const symbol of treeSitterSymbols) {
    const key = `${symbol.path}\0${symbol.name}`
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(symbol)
  }
  const observations = []
  const external = new Map()
  for (const reference of treeSitterReferences) {
    const rid = reference.id
    const rsha = reference.sourceSha256
    const pathValue = reference.path
    const spelling = reference.spelling || ''
    let target = null
    if (spelling) {
      // Try the last dotted segment as the simple name (module.func -> func).
      const simpleName = spelling.split('.').at(-1)
      const candidates = byName.get(`${pathValue}\0${simpleName}`) || []
      if (candidates.length === 1) target = candidates[0]
    }
    if (target) {
      observations.push({
        referenceSiteId: rid,
        referenceSourceSha256: rsha,
        state: 'resolved-internal-compiler-binding',
        targetId: target.id,
        reason: 'tree-sitter-resolved-to-current-exact-parser-entity',
      })
      continue
    }
    const extId = `external-tree-sitter-symbol:${sha256(`${pathValue}\0${spelling}\0${rsha}`)}`
    if (!external.has(extId)) {
      external.set(extId, {
        id: extId,
        kind: 'external-tree-sitter-symbol',
        name: spelling,
        declarationFile: '<tree-sitter-external>',
        declarationFileSha256: sha256('<tree-sitter-external>'),
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 },
        declarationSha256: sha256(spelling),
        authority: 'tree-sitter-external-symbol-observation-outside-repository',
      })
    }
    observations.push({
      referenceSiteId: rid,
      referenceSourceSha256: rsha,
      state: 'resolved-external-compiler-binding',
      targetId: extId,
      reason: 'tree-sitter-resolved-to-content-addressed-external-symbol',
    })
  }
  return {
    schemaVersion: 'arc-atlas-tree-sitter-binding-observation-v1',
    source: {
      state: 'observed',
      authority: 'tree-sitter-binding-observation-under-explicit-atlas-config',
      compilerPackage: 'tree-sitter',
      compilerVersion: 'policy-v1',
      inputFiles: new Set(treeSitterReferences.map(reference => reference.path)).size,
      referenceSites: treeSitterReferences.length,
      occurrenceIdentity: 'path-kind-start-end-source-sha256-v1',
      inputFileSetSha256: sha256(canonicalJson(treeSitterReferences.map(reference => ({ path: reference.path, sourceSha256: reference.sourceSha256 })))),
      workerInputDenominator: {
        files: treeSitterPaths.size,
        symbols: treeSitterSymbols.length,
        referenceSites: treeSitterReferences.length,
      },
    },
    observations: observations.sort((left, right) => left.referenceSiteId.localeCompare(right.referenceSiteId)),
    externalEntities: [...external.values()].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function pathExt(value) {
  const index = value.lastIndexOf('.')
  return index === -1 ? '' : value.slice(index).toLowerCase()
}