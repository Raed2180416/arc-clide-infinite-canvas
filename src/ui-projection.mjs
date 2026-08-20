import { createHash } from 'node:crypto'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function jsonBytes(value) {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`)
}

function unit(value, offset) {
  const digest = sha256(value)
  return Number.parseInt(digest.slice(offset, offset + 8), 16) / 0xffffffff
}

function positionForOrgan(id, index, total) {
  const angle = total ? (index / total) * Math.PI * 2 : 0
  const radius = 18
  return {
    x: Math.cos(angle) * radius,
    y: (unit(id, 0) - 0.5) * 10,
    z: Math.sin(angle) * radius,
  }
}

function positionForFile(id, center) {
  const azimuth = unit(id, 0) * Math.PI * 2
  const elevation = (unit(id, 8) - 0.5) * Math.PI
  const radius = 3 + unit(id, 16) * 5
  return {
    x: center.x + Math.cos(azimuth) * Math.cos(elevation) * radius,
    y: center.y + Math.sin(elevation) * radius,
    z: center.z + Math.sin(azimuth) * Math.cos(elevation) * radius,
  }
}

function shardFor(id) {
  const digest = id.includes(':') ? id.slice(id.lastIndexOf(':') + 1) : sha256(id)
  return /^[a-f0-9]{2}/.test(digest) ? digest.slice(0, 2) : sha256(id).slice(0, 2)
}

function pushShard(map, bucket, value) {
  if (!map.has(bucket)) map.set(bucket, [])
  map.get(bucket).push(value)
}

export function compileUiProjection({ snapshotSha256, files, symbols, edges, relationshipCorpus, ontology, components, gates, scope, transcript, governance, navigation }) {
  const componentByPath = new Map(components.map(component => [component.path, component]))
  const organPositions = new Map()
  const organs = ontology?.organs || []
  const nodes = [{
    id: 'repository:root',
    kind: 'repository',
    label: ontology?.title || 'Repository',
    position: { x: 0, y: 0, z: 0 },
    status: 'derived-snapshot-root',
  }]
  const overviewEdges = []
  const organDetailShards = new Map()
  organs.forEach((organ, index) => {
    const position = positionForOrgan(organ.id, index, organs.length)
    organPositions.set(organ.id, position)
    nodes.push({
      id: `organ:${organ.id}`,
      kind: 'organ',
      label: organ.name,
      summary: organ.summary,
      fallback: organ.fallback === true,
      fileCount: organ.fileCount,
      position,
      status: organ.fallback === true ? 'unresolved-substrate' : 'source-addressed-curated',
    })
    overviewEdges.push({ id: `overview:${sha256(`repository:root\0organ:${organ.id}`)}`, source: 'repository:root', target: `organ:${organ.id}`, kind: 'contains-organ', count: 1 })
  })
  for (const file of files) {
    const component = componentByPath.get(file.path)
    const organId = component?.primaryOrganId || null
    const center = organPositions.get(organId) || { x: 0, y: 0, z: 0 }
    const fileNode = {
      id: file.id,
      kind: 'file',
      label: file.path.split('/').at(-1),
      path: file.path,
      language: file.language,
      fileClass: file.fileClass,
      parserState: file.parser.state,
      sha256: file.sha256,
      primaryOrganId: organId,
      organIds: component?.organIds || [],
      position: positionForFile(file.id, center),
      status: organId ? 'classified' : 'unclassified',
    }
    const detailKey = organId ? `organ:${organId}` : 'repository:unclassified'
    pushShard(organDetailShards, detailKey, {
      node: fileNode,
      edge: {
      id: `overview:${sha256(`${organId || 'repository:root'}\0${file.id}`)}`,
      source: organId ? `organ:${organId}` : 'repository:root',
      target: file.id,
      kind: organId ? 'contains-file' : 'contains-unclassified-file',
      count: 1,
      },
    })
  }
  const symbolById = new Map(symbols.map(symbol => [symbol.id, symbol]))
  const aggregate = new Map()
  for (const relationship of relationshipCorpus.relationships) {
    if (!['calls', 'calls-declaration'].includes(relationship.kind)) continue
    const sourceSymbol = symbolById.get(relationship.source)
    const targetSymbol = symbolById.get(relationship.target)
    if (!sourceSymbol || !targetSymbol) continue
    const sourceOrgan = componentByPath.get(sourceSymbol.path)?.primaryOrganId
    const targetOrgan = componentByPath.get(targetSymbol.path)?.primaryOrganId
    if (!sourceOrgan || !targetOrgan || sourceOrgan === targetOrgan) continue
    const key = `${sourceOrgan}\0${targetOrgan}\0exact-call`
    aggregate.set(key, (aggregate.get(key) || 0) + 1)
  }
  for (const edge of edges) {
    const sourceSymbol = symbolById.get(edge.source)
    const targetSymbol = symbolById.get(edge.target)
    if (!sourceSymbol || !targetSymbol) continue
    const sourceOrgan = componentByPath.get(sourceSymbol.path)?.primaryOrganId
    const targetOrgan = componentByPath.get(targetSymbol.path)?.primaryOrganId
    if (!sourceOrgan || !targetOrgan || sourceOrgan === targetOrgan) continue
    const key = `${sourceOrgan}\0${targetOrgan}\0advisory-${edge.kind}`
    aggregate.set(key, (aggregate.get(key) || 0) + 1)
  }
  for (const [key, count] of [...aggregate.entries()].sort()) {
    const [sourceOrgan, targetOrgan, kind] = key.split('\0')
    overviewEdges.push({
      id: `overview:${sha256(key)}`,
      source: `organ:${sourceOrgan}`,
      target: `organ:${targetOrgan}`,
      kind: `aggregate-${kind}`,
      count,
      authority: kind.startsWith('advisory-') ? 'aggregate-of-advisory-relations' : 'aggregate-of-exact-compiler-bound-relations',
    })
  }

  const overview = {
    schemaVersion: 'arc-atlas-ui-overview-v1',
    authority: 'read-only-derived-projection',
    snapshotSha256,
    nodes,
    edges: overviewEdges,
    denominators: { nodes: nodes.length, edges: overviewEdges.length, files: files.length, organs: organs.length },
  }
  const journeys = {
    schemaVersion: 'arc-atlas-ui-journeys-v1',
    authority: 'curated-source-addressed-derived-projection',
    snapshotSha256,
    journeys: ontology?.journeys || [],
    pitfalls: ontology?.pitfalls || [],
    constitutionalKernels: ontology?.constitutionalKernels || [],
    graphFacets: ontology?.graphFacets || [],
    membranes: ontology?.membranes || [],
    proofLadder: ontology?.proofLadder || [],
    lenses: ontology?.lenses || [],
  }
  const quality = {
    schemaVersion: 'arc-atlas-ui-quality-v1',
    authority: 'read-only-derived-projection',
    snapshotSha256,
    gates,
    counts: {
      files: files.length,
      symbols: symbols.length,
      relations: relationshipCorpus.relationships.length + edges.length,
      exactRelations: relationshipCorpus.relationships.length,
      advisoryRelations: edges.length,
      referenceOccurrences: relationshipCorpus.denominators.callSites,
      resolvedReferenceOccurrences: relationshipCorpus.denominators.resolvedCallSites,
      unresolvedReferenceOccurrences: relationshipCorpus.denominators.unresolvedCallSites,
      ignored: scope.ignored.total,
      ignoredReviewRequired: scope.ignored.reviewRequired,
      transcriptMessages: transcript?.coverage.messages || 0,
      transcriptDecisionReviewPending: transcript?.coverage.decisionReviewPending || 0,
      governanceDocuments: governance?.denominators.documents.visible || 0,
      governanceUnclassifiedDocuments: governance?.denominators.documents.unclassified || 0,
      governanceIntentNodes: governance?.denominators.intentNodes.total || 0,
      governanceFindings: governance?.denominators.findings.total || 0,
      governanceAuthorityEvents: governance?.denominators.authorityEvents.total || 0,
    },
  }
  const governanceProjection = governance ? {
    schemaVersion: 'arc-atlas-ui-governance-v1',
    authority: governance.authority,
    snapshotSha256,
    governanceSha256: governance.governanceSha256,
    denominators: governance.denominators,
    gates: governance.gates,
    teaching: governance.teaching,
    documents: governance.documents.map(document => ({
      id: document.id,
      path: document.path,
      sha256: document.sha256,
      bytes: document.bytes,
      classification: document.classification,
      headings: document.headings,
      canonical: document.canonical,
      teaching: document.teaching,
    })),
    intentNodes: governance.intentNodes,
    findings: governance.findings,
    authorityEvents: governance.authorityEvents,
    relations: governance.relations,
  } : null
  const transcriptPageSize = 100
  const transcriptPages = []
  const transcriptArtifacts = []
  if (transcript) {
    for (let index = 0; index < transcript.messages.length; index += transcriptPageSize) {
      const messages = transcript.messages.slice(index, index + transcriptPageSize)
      const pageNumber = index / transcriptPageSize
      const artifactPath = `data/ui/transcript/pages/${String(pageNumber).padStart(4, '0')}.json`
      transcriptPages.push({
        page: pageNumber,
        path: artifactPath,
        count: messages.length,
        startIndex: index,
        endIndex: index + messages.length - 1,
        firstMessageId: messages[0]?.id || null,
        lastMessageId: messages.at(-1)?.id || null,
      })
      transcriptArtifacts.push({
        path: artifactPath,
        value: {
          schemaVersion: 'arc-atlas-ui-transcript-page-v1',
          authority: transcript.authority,
          snapshotSha256,
          transcriptSha256: transcript.transcriptSha256,
          page: pageNumber,
          messages,
        },
      })
    }
  }
  const transcriptManifest = transcript ? {
    schemaVersion: 'arc-atlas-ui-transcript-manifest-v1',
    authority: transcript.authority,
    snapshotSha256,
    transcriptSha256: transcript.transcriptSha256,
    source: transcript.source,
    coverage: transcript.coverage,
    pageSize: transcriptPageSize,
    pages: transcriptPages,
  } : null
  const scopeGroups = []
  const scopeArtifacts = []
  for (const [topLevel, count] of Object.entries(scope.ignored.byTopLevel)) {
    const entries = scope.ignored.entries.filter(entry => entry.topLevel === topLevel)
    const bucket = sha256(topLevel).slice(0, 16)
    const pages = []
    for (let index = 0; index < entries.length; index += 250) {
      const page = index / 250
      const artifactPath = `data/ui/scope/groups/${bucket}/${String(page).padStart(4, '0')}.json`
      const pageEntries = entries.slice(index, index + 250)
      pages.push({ page, path: artifactPath, count: pageEntries.length, startIndex: index, endIndex: index + pageEntries.length - 1 })
      scopeArtifacts.push({
        path: artifactPath,
        value: {
          schemaVersion: 'arc-atlas-ui-scope-group-page-v1',
          authority: scope.authority,
          snapshotSha256,
          scopeSha256: scope.scopeSha256,
          topLevel,
          page,
          entries: pageEntries,
        },
      })
    }
    scopeGroups.push({
      id: bucket,
      topLevel,
      count,
      codeLike: entries.filter(entry => entry.codeLike).length,
      reviewRequired: entries.filter(entry => entry.policy.status === 'review-required').length,
      bytes: entries.reduce((total, entry) => total + (entry.bytes || 0), 0),
      pages,
    })
  }
  scopeGroups.sort((left, right) => right.count - left.count || left.topLevel.localeCompare(right.topLevel))
  const scopeManifest = {
    schemaVersion: 'arc-atlas-ui-scope-manifest-v1',
    authority: scope.authority,
    snapshotSha256,
    scopeSha256: scope.scopeSha256,
    ignored: {
      total: scope.ignored.total,
      codeLike: scope.ignored.codeLike,
      policyReviewed: scope.ignored.policyReviewed,
      reviewRequired: scope.ignored.reviewRequired,
    },
    safety: scope.safety,
    groups: scopeGroups,
  }
  const artifacts = [
    { path: 'data/ui/overview.json', value: overview },
    { path: 'data/ui/journeys.json', value: journeys },
    { path: 'data/ui/quality.json', value: quality },
    ...(governanceProjection ? [{ path: 'data/ui/governance.json', value: governanceProjection }] : []),
    ...(transcriptManifest ? [{ path: 'data/ui/transcript/manifest.json', value: transcriptManifest }, ...transcriptArtifacts] : []),
    { path: 'data/ui/scope/manifest.json', value: scopeManifest },
    ...scopeArtifacts,
  ]
  const organPaths = {}
  for (const [ownerId, records] of [...organDetailShards.entries()].sort()) {
    const bucket = sha256(ownerId).slice(0, 16)
    const artifactPath = `data/ui/organs/${bucket}.json`
    organPaths[ownerId] = artifactPath
    artifacts.push({
      path: artifactPath,
      value: {
        schemaVersion: 'arc-atlas-ui-organ-detail-v1',
        authority: 'read-only-derived-projection',
        snapshotSha256,
        ownerId,
        nodes: records.map(record => record.node),
        edges: records.map(record => record.edge),
        denominator: records.length,
      },
    })
  }
  const initial = ['data/ui/overview.json', 'data/ui/journeys.json', 'data/ui/quality.json']
  const valueByPath = new Map(artifacts.map(artifact => [artifact.path, artifact.value]))
  const uiManifest = {
    schemaVersion: 'arc-atlas-ui-projection-v3',
    authority: 'read-only-derived-projection',
    snapshotSha256,
    navigation,
    canonicalCorpora: {
      symbols: 'data/symbols.json',
      relationships: 'data/relationships.json',
    },
    physicalEncoding: {
      manifests: 'pretty-json-utf8-v1',
      canonicalLargeArtifacts: 'brotli-minified-json-utf8-v1',
      navigationIndex: 'sqlite-v1',
    },
    loading: {
      initial,
      initialBytes: initial.reduce((total, artifactPath) => total + jsonBytes(valueByPath.get(artifactPath)), 0),
      lazySearch: null,
      lazyGovernance: governanceProjection ? 'data/ui/governance.json' : null,
      lazyTranscript: transcriptManifest ? 'data/ui/transcript/manifest.json' : null,
      lazyScope: 'data/ui/scope/manifest.json',
    },
    shards: { entities: {}, relations: {}, organs: organPaths },
    counts: { overviewNodes: nodes.length, overviewEdges: overviewEdges.length, searchableSymbols: symbols.length },
  }
  artifacts.push({ path: 'data/ui/manifest.json', value: uiManifest })
  return { artifacts, manifest: uiManifest }
}
