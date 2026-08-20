import { createHash } from 'node:crypto'

const EXACT_PARSER_ADAPTERS = new Set(['typescript-ast', 'python-ast', 'tree-sitter-policy-v1'])
const CODE_LANGUAGES = new Set(['JavaScript', 'TypeScript', 'Python', 'Rust', 'Bash', 'Go', 'Java', 'Ruby', 'Elixir', 'C#', 'Scala', 'Lua', 'C', 'C++', 'PHP', 'CodeQL'])
const DEPENDENCY_ROLES = new Set(['static-import', 'from-import', 're-export-from', 'dynamic-import', 'require', 'require-resolve', 'include', 'use', 'module-declaration', 'source'])
const CORPUS_SEQUENCE_FIELDS = [
  'relationships',
  'referenceSites',
  'advisoryRelationships',
  'externalEntities',
  'bindingSources',
]
const MODULE_ISSUED_REFERENCE_SITE_DENOMINATORS = new WeakSet()

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

function canonicalSequenceCommitment(field, values) {
  const digest = createHash('sha256')
  digest.update('arc-atlas-canonical-sequence-sha256-v1\0')
  digest.update(field)
  digest.update('\0')
  for (const value of values) {
    const bytes = Buffer.from(canonicalJson(value))
    const length = Buffer.allocUnsafe(8)
    length.writeBigUInt64BE(BigInt(bytes.length))
    digest.update(length)
    digest.update(bytes)
  }
  return {
    schemaVersion: 'arc-atlas-canonical-sequence-commitment-v1',
    field,
    count: values.length,
    sha256: digest.digest('hex'),
  }
}

function withCorpusDigest(input) {
  const body = { ...input }
  delete body.corpusSha256
  delete body.digestSchemaVersion
  delete body.sequenceCommitments
  const sequenceCommitments = Object.fromEntries(CORPUS_SEQUENCE_FIELDS.map(field => {
    const values = body[field] || []
    if (!Array.isArray(values)) throw new Error(`relationship corpus ${field} must be an array`)
    return [field, canonicalSequenceCommitment(field, values)]
  }))
  const metadata = Object.fromEntries(Object.entries(body).filter(([field]) => !CORPUS_SEQUENCE_FIELDS.includes(field)))
  const digestProjection = {
    schemaVersion: 'arc-atlas-relationship-corpus-digest-v1',
    metadata,
    sequenceCommitments,
  }
  return {
    ...body,
    digestSchemaVersion: digestProjection.schemaVersion,
    sequenceCommitments,
    corpusSha256: sha256(canonicalJson(digestProjection)),
  }
}

function comparePoint(left, right) {
  return left.line - right.line || left.column - right.column
}

function spanContains(parent, child) {
  return comparePoint(parent.start, child.start) <= 0
    && comparePoint(parent.end, child.end) >= 0
    && (comparePoint(parent.start, child.start) < 0 || comparePoint(parent.end, child.end) > 0)
}

function spanSize(symbol) {
  return (symbol.end.line - symbol.start.line) * 1_000_000 + symbol.end.column - symbol.start.column
}

function exactParserEntity(symbol) {
  return EXACT_PARSER_ADAPTERS.has(symbol.derivation?.adapter)
}

function declarationRelationship(file, symbol) {
  return {
    id: `relationship:${sha256(`declares\0${file.id}\0${symbol.id}`)}`,
    kind: 'declares',
    source: file.id,
    target: symbol.id,
    observation: {
      path: symbol.path,
      start: symbol.start,
      end: symbol.end,
      bodySha256: symbol.bodySha256,
      parserAdapter: symbol.derivation.adapter,
      authority: 'exact-parser-source-span',
    },
  }
}

function lexicalRelationship(parent, child) {
  return {
    id: `relationship:${sha256(`lexically-contains\0${parent.id}\0${child.id}`)}`,
    kind: 'lexically-contains',
    source: parent.id,
    target: child.id,
    observation: {
      path: child.path,
      parentBodySha256: parent.bodySha256,
      childBodySha256: child.bodySha256,
      authority: 'exact-parser-source-span-containment',
    },
  }
}

function referenceSite(file, containingSymbol, site) {
  const identity = canonicalJson({
    sourceFileId: file.id,
    path: site.path,
    syntaxKind: site.syntaxKind,
    start: site.start,
    end: site.end,
    sourceSha256: site.sourceSha256,
    roles: site.roles,
    literalSpecifier: site.literalSpecifier,
  })
  const id = `reference-site:${sha256(identity)}`
  const callable = site.roles.some(role => ['call', 'construct'].includes(role))
  const dependency = site.roles.some(role => DEPENDENCY_ROLES.has(role))
  const callableBinding = callable ? {
    state: 'unresolved-syntax-spelling-only',
    targetId: null,
    reason: 'no-compiler-or-runtime-callable-binding-observation-was-supplied',
    authority: 'none',
  } : null
  const moduleBinding = dependency ? {
    state: site.specifierState === 'nonliteral' ? 'unresolved-dynamic-specifier' : 'unresolved-module-specifier-no-resolver',
    targets: [],
    cardinality: 'zero-observed-targets',
    reason: site.specifierState === 'nonliteral'
      ? 'source-site-module-specifier-is-not-one-static-literal'
      : 'no-config-bound-module-resolution-observation-was-supplied',
    authority: 'none',
  } : null
  return {
    id,
    kind: site.roles.includes('construct') ? 'construction-site' : callable ? 'call-site' : 'dependency-site',
    sourceFileId: file.id,
    containingSymbolId: containingSymbol?.id || null,
    sourceSymbolId: containingSymbol?.id || null,
    path: site.path,
    language: site.language,
    roles: site.roles,
    spelling: site.spelling,
    literalSpecifier: site.literalSpecifier,
    specifierState: site.specifierState,
    syntaxKind: site.syntaxKind,
    start: site.start,
    end: site.end,
    sourceSha256: site.sourceSha256,
    parser: {
      adapter: site.parserAdapter,
      authority: site.authority,
      policy: site.parserPolicy || null,
    },
    bindings: { callable: callableBinding, module: moduleBinding },
    resolution: callableBinding,
  }
}

function sourceSiteRelationship(ownerId, reference) {
  return {
    id: `relationship:${sha256(`contains-source-site\0${ownerId}\0${reference.id}`)}`,
    kind: 'contains-source-site',
    source: ownerId,
    target: reference.id,
    observation: {
      path: reference.path,
      sourceSha256: reference.sourceSha256,
      authority: 'exact-whole-file-parser-source-site',
    },
  }
}

function callableReferenceSite(reference) {
  return reference.roles.some(role => ['call', 'construct'].includes(role))
}

export function compileExactReferenceSites({ files, symbols, sourceSites }) {
  if (!Array.isArray(files) || !Array.isArray(symbols) || !Array.isArray(sourceSites)) {
    throw new Error('reference-site inputs must be arrays')
  }
  const fileByPath = new Map(files.map(file => [file.path, file]))
  const exactSymbols = symbols.filter(symbol => exactParserEntity(symbol) && symbol.declaration?.callable === true)
  const symbolsByPath = new Map()
  for (const symbol of exactSymbols) {
    if (!symbolsByPath.has(symbol.path)) symbolsByPath.set(symbol.path, [])
    symbolsByPath.get(symbol.path).push(symbol)
  }
  for (const values of symbolsByPath.values()) values.sort((left, right) => spanSize(left) - spanSize(right) || left.id.localeCompare(right.id))
  const identities = new Set()
  const referenceSites = sourceSites.map(site => {
    const file = fileByPath.get(site.path)
    if (!file || file.fileClass !== 'regular') throw new Error(`source site has no current regular file: ${site.path}`)
    if (!Array.isArray(site.roles) || site.roles.length === 0 || site.roles.some(role => typeof role !== 'string' || !role)) {
      throw new Error(`source site has invalid semantic roles: ${site.path}`)
    }
    if (typeof site.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(site.sourceSha256)) {
      throw new Error(`source site lacks an exact source digest: ${site.path}`)
    }
    const containingSymbol = (symbolsByPath.get(site.path) || []).find(symbol => spanContains(symbol, site)) || null
    const reference = referenceSite(file, containingSymbol, site)
    if (identities.has(reference.id)) throw new Error(`whole-file parser repeated one exact source-site identity: ${reference.id}`)
    identities.add(reference.id)
    return reference
  })
  referenceSites.sort((left, right) => left.path.localeCompare(right.path)
    || comparePoint(left.start, right.start)
    || left.id.localeCompare(right.id))
  MODULE_ISSUED_REFERENCE_SITE_DENOMINATORS.add(referenceSites)
  return referenceSites
}

export function compileExactRelationshipCorpus({ files, symbols, advisoryEdges = [], referenceSites: suppliedReferenceSites = null }) {
  if (!Array.isArray(files) || !Array.isArray(symbols) || !Array.isArray(advisoryEdges)) {
    throw new Error('relationship corpus inputs must be arrays')
  }
  const fileByPath = new Map(files.map(file => [file.path, file]))
  const exactSymbols = symbols.filter(exactParserEntity)
  const byPath = new Map()
  for (const symbol of exactSymbols) {
    const file = fileByPath.get(symbol.path)
    if (!file) throw new Error(`exact parser entity has no current file: ${symbol.path}`)
    if (symbol.operationalBehavior?.status !== 'exact-parser-derived') {
      throw new Error(`exact parser entity lacks operational syntax facts: ${symbol.qualifiedName}`)
    }
    if (!byPath.has(symbol.path)) byPath.set(symbol.path, [])
    byPath.get(symbol.path).push(symbol)
  }

  const relationships = exactSymbols.map(symbol => declarationRelationship(fileByPath.get(symbol.path), symbol))
  let lexicalContainmentRelationships = 0
  for (const fileSymbols of byPath.values()) {
    const sorted = [...fileSymbols].sort((left, right) => spanSize(left) - spanSize(right) || left.id.localeCompare(right.id))
    for (const child of sorted) {
      const parent = sorted.find(candidate => candidate.id !== child.id && spanContains(candidate, child))
      if (!parent) continue
      relationships.push(lexicalRelationship(parent, child))
      lexicalContainmentRelationships += 1
    }
  }

  if (suppliedReferenceSites && !MODULE_ISSUED_REFERENCE_SITE_DENOMINATORS.has(suppliedReferenceSites)) {
    throw new Error('relationship corpus requires a module-issued exact reference-site denominator')
  }
  if (!suppliedReferenceSites) {
    throw new Error('relationship corpus requires a module-issued exact reference-site denominator')
  }
  const referenceSites = suppliedReferenceSites
  const callableReferenceSites = referenceSites.filter(callableReferenceSite)
  const dependencyReferenceSites = referenceSites.filter(reference => reference.roles.some(role => DEPENDENCY_ROLES.has(role)))
  const uniqueSourceCallSpans = new Set(callableReferenceSites.map(reference => canonicalJson({
    path: reference.path,
    kind: reference.kind,
    start: reference.start,
    end: reference.end,
    sourceSha256: reference.sourceSha256,
  }))).size
  for (const reference of referenceSites) {
    const ownerId = reference.containingSymbolId || reference.sourceFileId
    relationships.push(sourceSiteRelationship(ownerId, reference))
  }

  const eligibleFiles = files.filter(file => file.fileClass === 'regular' && CODE_LANGUAGES.has(file.language))
  const completeCoverage = new Set(['full-language-ast-v1', 'hash-pinned-relationship-query-v1'])
  const callCoverageIncomplete = eligibleFiles.filter(file => !completeCoverage.has(file.sourceSiteCoverage?.callSites))
  const dependencyCoverageIncomplete = eligibleFiles.filter(file => !completeCoverage.has(file.sourceSiteCoverage?.dependencySites))
  const coverageErrors = eligibleFiles.filter(file => ['parser-error', 'missing'].includes(file.sourceSiteCoverage?.callSites)
    || ['parser-error', 'missing'].includes(file.sourceSiteCoverage?.dependencySites))

  relationships.sort((left, right) => left.kind.localeCompare(right.kind) || left.source.localeCompare(right.source) || left.target.localeCompare(right.target))
  const body = {
    schemaVersion: 'arc-atlas-relationship-corpus-v2',
    authority: 'exact-syntax-observations-with-explicit-resolution-ceiling',
    denominators: {
      exactParserEntities: exactSymbols.length,
      declarationRelationships: exactSymbols.length,
      lexicalContainmentRelationships,
      sourceSites: referenceSites.length,
      callSites: callableReferenceSites.length,
      topLevelCallSites: callableReferenceSites.filter(reference => reference.containingSymbolId === null).length,
      dependencySites: dependencyReferenceSites.length,
      uniqueSourceCallSpans,
      contextualDuplicateReferenceOccurrences: callableReferenceSites.length - uniqueSourceCallSpans,
      resolvedCallSites: 0,
      unresolvedCallSites: callableReferenceSites.length,
      advisoryRelationships: advisoryEdges.length,
      sourceSiteCoverage: {
        eligibleFiles: eligibleFiles.length,
        callComplete: eligibleFiles.length - callCoverageIncomplete.length,
        callIncomplete: callCoverageIncomplete.length,
        dependencyComplete: eligibleFiles.length - dependencyCoverageIncomplete.length,
        dependencyIncomplete: dependencyCoverageIncomplete.length,
        errors: coverageErrors.length,
      },
    },
    relationships,
    referenceSites,
    advisoryRelationships: advisoryEdges.map(edge => ({
      ...edge,
      authority: 'advisory-code-graph-not-exact-relationship-truth',
    })),
    gates: {
      observation: {
        status: coverageErrors.length > 0 ? 'fail'
          : callCoverageIncomplete.length > 0 || dependencyCoverageIncomplete.length > 0 ? 'partial'
            : relationships.filter(relation => relation.kind === 'declares').length === exactSymbols.length ? 'pass' : 'fail',
        reason: coverageErrors.length > 0
          ? 'whole-file-source-site-parser-errors-present'
          : callCoverageIncomplete.length > 0 || dependencyCoverageIncomplete.length > 0
            ? 'whole-file-call-or-dependency-site-language-coverage-incomplete'
            : 'every-supported-whole-file-call-and-dependency-site-is-accounted-by-an-exact-source-bound-observation',
      },
      resolution: {
        status: callableReferenceSites.length === 0 ? 'pass' : 'fail',
        reason: callableReferenceSites.length === 0
          ? 'no-call-sites-require-binding-resolution'
          : 'syntax-reference-sites-await-compiler-or-runtime-binding',
      },
    },
  }
  return withCorpusDigest(body)
}

export function applyRelationshipBindingObservations(corpus, bindingObservations) {
  if (!corpus || corpus.schemaVersion !== 'arc-atlas-relationship-corpus-v2') {
    throw new Error('relationship bindings require an exact relationship corpus')
  }
  const sources = Array.isArray(bindingObservations) ? bindingObservations : [bindingObservations]
  if (sources.length === 0) throw new Error('relationship binding requires at least one binding observation source')
  const referenceById = new Map(corpus.referenceSites.map(reference => [reference.id, reference]))
  const observationByReference = new Map()
  const authorityByReference = new Map()
  for (const bindingObservation of sources) {
    if (!bindingObservation || !bindingObservation.schemaVersion?.startsWith('arc-atlas-')) {
      throw new Error('relationship binding observation schema is unsupported')
    }
    for (const observation of bindingObservation.observations || []) {
      const reference = referenceById.get(observation.referenceSiteId)
      if (!reference) throw new Error(`binding observation cites an unknown reference site: ${observation.referenceSiteId}`)
      if (!callableReferenceSite(reference)) {
        throw new Error(`callable binding observation cites a non-callable source site: ${observation.referenceSiteId}`)
      }
      if (observation.referenceSourceSha256 !== reference.sourceSha256) {
        throw new Error(`binding observation does not bind exact reference bytes: ${observation.referenceSiteId}`)
      }
      const prior = observationByReference.get(observation.referenceSiteId)
      if (prior && prior.state.startsWith('resolved-')) {
        // A resolved observation is final; a later source may not conflict.
        throw new Error(`binding observation repeats a resolved reference site: ${observation.referenceSiteId}`)
      }
      // A later source may upgrade an unresolved site (layered resolution).
      observationByReference.set(observation.referenceSiteId, observation)
      authorityByReference.set(observation.referenceSiteId, bindingObservation.source.authority)
    }
  }
  const externalById = new Map(sources.flatMap(source => (source.externalEntities || []).map(entity => [entity.id, entity])))
  const bindingSourceSha256 = sha256(canonicalJson(sources.map(source => source.source)))
  const referenceSites = corpus.referenceSites
  for (const reference of referenceSites) {
    if (!callableReferenceSite(reference)) continue
    const observation = observationByReference.get(reference.id)
    if (!observation) continue
    const resolved = observation.state.startsWith('resolved-')
    if (resolved && (typeof observation.targetId !== 'string' || !observation.targetId)) {
      throw new Error(`resolved binding has no target: ${reference.id}`)
    }
    if (observation.state === 'resolved-external-compiler-binding' && !externalById.has(observation.targetId)) {
      throw new Error(`external binding target is absent from its exact entity denominator: ${observation.targetId}`)
    }
    reference.resolution = {
      state: observation.state,
      targetId: observation.targetId,
      reason: observation.reason,
      bindingSourceSha256,
      authority: authorityByReference.get(reference.id) || 'none',
    }
    reference.bindings.callable = reference.resolution
  }
  const relationships = corpus.relationships
  for (let index = relationships.length - 1; index >= 0; index -= 1) {
    if (relationships[index].kind === 'calls-declaration') relationships.splice(index, 1)
  }
  for (const reference of referenceSites.filter(reference => callableReferenceSite(reference)
    && reference.bindings.callable?.state.startsWith('resolved-'))) {
    relationships.push({
      id: `relationship:${sha256(`calls-declaration\0${reference.containingSymbolId || reference.sourceFileId}\0${reference.resolution.targetId}\0${reference.id}`)}`,
      kind: 'calls-declaration',
      source: reference.containingSymbolId || reference.sourceFileId,
      target: reference.resolution.targetId,
      referenceSiteId: reference.id,
      observation: {
        path: reference.path,
        sourceSha256: reference.sourceSha256,
        bindingSourceSha256: reference.resolution.bindingSourceSha256,
        authority: reference.resolution.authority,
      },
    })
  }
  relationships.sort((left, right) => left.kind.localeCompare(right.kind) || left.source.localeCompare(right.source) || left.target.localeCompare(right.target))
  const callableReferenceSites = referenceSites.filter(callableReferenceSite)
  const resolvedCallSites = callableReferenceSites.filter(reference => reference.bindings.callable?.state.startsWith('resolved-')).length
  const unresolvedCallSites = callableReferenceSites.length - resolvedCallSites
  const body = {
    ...corpus,
    denominators: {
      ...corpus.denominators,
      resolvedCallSites,
      unresolvedCallSites,
      externalCompilerEntities: externalById.size,
    },
    relationships,
    referenceSites,
    externalEntities: [...externalById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    bindingSources: sources.map(source => source.source),
    gates: {
      ...corpus.gates,
      resolution: {
        status: unresolvedCallSites === 0 ? 'pass' : 'fail',
        reason: unresolvedCallSites === 0
          ? 'every-observed-call-site-has-a-compiler-or-runtime-binding'
          : 'syntax-reference-sites-await-compiler-or-runtime-binding',
      },
    },
  }
  return withCorpusDigest(body)
}
