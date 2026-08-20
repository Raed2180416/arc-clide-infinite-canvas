export type Gate = { status: string; reason: string }

export type AtlasNode = {
  id: string
  kind: 'repository' | 'organ' | 'file' | 'symbol' | 'reference-site' | 'external-symbol'
  label: string
  summary?: string
  path?: string
  language?: string
  fileClass?: string
  parserState?: string
  primaryOrganId?: string | null
  organIds?: string[]
  fallback?: boolean
  fileCount?: number
  status: string
  position: { x: number; y: number; z: number }
}

export type AtlasEdge = {
  id: string
  source: string
  target: string
  kind: string
  count: number
  authority?: string
}

type UiManifestCommon = {
  schemaVersion: string
  authority: string
  snapshotSha256: string
  canonicalCorpora?: { symbols: string; relationships: string }
  loading: {
    initial: string[]
    initialBytes: number
    lazySearch: string | null
    lazyGovernance?: string | null
    lazyTranscript?: string | null
    lazyScope?: string | null
  }
  shards: { entities: Record<string, string>; relations: Record<string, string>; organs?: Record<string, string> }
  counts: { overviewNodes: number; overviewEdges: number; searchRecords?: number; searchableSymbols?: number }
}

export type LegacyUiManifest = UiManifestCommon & {
  schemaVersion: 'arc-atlas-ui-projection-v1' | 'arc-atlas-ui-projection-v2'
}

export type NavigationManifest = {
  schemaVersion: 'arc-atlas-navigation-index-v1'
  authority: 'non-authoritative-deterministic-navigation-index'
  querySchemaVersion: 'arc-atlas-navigation-query-v1'
  artifact: { path: string; bytes: number; sha256: string; contentEncoding: null; decodedBytes: number; decodedSha256: string; mediaType: string }
  bindings: { snapshotSha256: string; symbolSequenceSha256: string; symbolSequenceCount: number; relationshipCorpusSha256: string; componentSetSha256: string }
  denominators: { symbols: number; symbolShards: number; relationshipShards: number; exactAdjacency: number; advisoryAdjacency: number }
  searchSemantics: string
}

export type NavigationUiManifest = UiManifestCommon & {
  schemaVersion: 'arc-atlas-ui-projection-v3'
  navigation: NavigationManifest
}

export type UiManifest = LegacyUiManifest | NavigationUiManifest

export type Overview = {
  schemaVersion: string
  authority: string
  snapshotSha256: string
  nodes: AtlasNode[]
  edges: AtlasEdge[]
  denominators: { nodes: number; edges: number; files: number; organs: number }
}

export type OrganDetail = {
  schemaVersion: string
  authority: string
  snapshotSha256: string
  ownerId: string
  nodes: AtlasNode[]
  edges: AtlasEdge[]
  denominator: number
}

export type SourceRef = { path: string; line: number }

export type JourneyStep = {
  id: string
  name: string
  explanation?: string
  summary?: string
  organIds: string[]
}

export type Journey = {
  id: string
  name: string
  summary: string
  sourceRefs: SourceRef[]
  steps: JourneyStep[]
}

export type JourneysProjection = {
  journeys: Journey[]
  pitfalls: Array<{ id: string; name?: string; summary?: string; sourceRefs?: SourceRef[] }>
  constitutionalKernels: Array<{ id: string; name: string; summary: string; sourceRefs?: SourceRef[] }>
  graphFacets: Array<{ id: string; name: string; summary: string; sourceRefs?: SourceRef[] }>
  membranes: Array<{ id: string; name: string; summary: string; sourceRefs?: SourceRef[] }>
  proofLadder: string[]
  lenses: Array<{ id: string; name: string; summary: string; sourceRefs?: SourceRef[] }>
}

export type QualityProjection = {
  snapshotSha256: string
  gates: Record<string, Gate>
  counts: {
    files: number
    symbols: number
    relations: number
    exactRelations: number
    advisoryRelations: number
    referenceOccurrences: number
    resolvedReferenceOccurrences: number
    unresolvedReferenceOccurrences: number
    ignored: number
    ignoredReviewRequired: number
    transcriptMessages: number
    transcriptDecisionReviewPending: number
    governanceDocuments?: number
    governanceUnclassifiedDocuments?: number
    governanceIntentNodes?: number
    governanceFindings?: number
    governanceAuthorityEvents?: number
  }
}

export type SearchRecord = {
  id: string
  bucket?: string
  name: string
  qualifiedName: string
  path: string
  kind: string
  language: string
  signature?: string
  purposeStatus: string
  primaryOrganId: string | null
  canonicalSymbol?: { manifestPath: string; shardPath: string; shardSha256: string; recordIndex: number }
  source?: null | { fileSha256: string; blobPath: string; start: { line: number; column: number }; end: { line: number; column: number }; bodySha256: string }
}

export type SymbolDetail = SearchRecord & {
  start: { line: number; column: number }
  end: { line: number; column: number }
  bodySha256: string
  exported: boolean
  purpose: { status: string; summary: string | null; provenance: string; authority: string }
  declaration: { callable: boolean; syntaxKind: string }
  derivation: { adapter: string; confidence: string }
  structuralExplanation: { status: string; summary: string; authority: string; resolutionCeiling: string }
  operationalBehavior: {
    status: string
    plainLanguage: string
    authority: string
    resolutionCeiling: string
    declaredInputs: Array<{ text: string }>
    eventCounts: Record<string, number>
    eventDenominator?: number
    events: Array<{ kind: string; subject?: string; syntaxKind?: string; start?: { line: number; column: number }; end?: { line: number; column: number }; sourceSha256?: string }>
  }
  canonicalSymbol?: { manifestPath: string; shardPath: string; shardSha256: string; recordIndex: number }
  component: null | {
    id: string
    fileId: string
    path: string
    primaryOrganId: string | null
    organIds: string[]
    authority: string
    classification?: {
      authority: string
      plainLanguagePurpose: string
      rationale: string
      confidence: string
      sourceRefs: Array<SourceRef & { role?: string }>
      unresolvedQuestions: string[]
    }
  }
}

export type RelationDetail = {
  id: string
  source: string
  target: string
  kind: string
  self: string
  direction: 'inbound' | 'outbound'
  neighbor: string
  evidenceClass: 'exact-source-relationship' | 'advisory-code-graph'
  authority: string
  neighborSummary: { id: string; kind: string; label: string; path: string | null; start?: { line: number; column: number } | null; status: string; resolution?: { state: string; targetId: string | null; reason: string; authority: string } }
  observation?: { adapter?: string; graphProject?: string; confidence?: number; line?: number; strategy?: string; authority?: string; path?: string; sourceSha256?: string }
}

export type SearchProjection = { lazy: true; records: SearchRecord[] }

export type NavigationSearchResult = {
  schemaVersion: 'arc-atlas-navigation-search-result-v1'
  authority: string
  snapshotSha256: string
  query: string
  records: SearchRecord[]
  total: number
  offset: number
  limit: number
}

export type NavigationSymbolResult = {
  schemaVersion: 'arc-atlas-navigation-symbol-result-v1'
  authority: string
  snapshotSha256: string
  symbol: Omit<SymbolDetail, 'source' | 'component' | 'purposeStatus' | 'primaryOrganId'>
  source: NonNullable<SearchRecord['source']>
  component: SymbolDetail['component']
}

export type NavigationRelationsResult = {
  schemaVersion: 'arc-atlas-navigation-relations-result-v1'
  authority: string
  snapshotSha256: string
  symbolId: string
  records: RelationDetail[]
  denominator: RelationDenominator
}

export type RelationDenominator = { total: number; exact: number; advisory: number; offset: number; limit: number }

export type GovernanceProjection = {
  schemaVersion: string
  authority: string
  snapshotSha256: string
  governanceSha256: string
  denominators: Record<string, Record<string, unknown>>
  gates: Record<string, Gate>
  teaching: { status: string; rule: string }
  documents: Array<{
    id: string
    path: string
    sha256: string
    bytes: number
    classification: string
    headings: Array<{ level: number; text: string; line: number }>
    canonical: null | Record<string, unknown>
    teaching: { status: string; plainLanguage: string | null; sourceRefs: SourceRef[] }
  }>
  intentNodes: Array<Record<string, unknown> & { id: string; atlasId: string; statement: string; parentId: string | null; type: string; protected: boolean }>
  findings: Array<Record<string, unknown> & { findingId: string; atlasId: string; claim: string; impact: string; evidenceStatus: string; path: string; sha256: string }>
  authorityEvents: Array<Record<string, unknown> & { eventId: string; atlasId: string; authorizedBy: string; changes: Array<{ nodeId: string; before: string; after: string; rationale: string }> }>
  relations: Array<{ kind: string; source: string; target: string }>
}

export type TranscriptManifest = {
  schemaVersion: string
  authority: string
  snapshotSha256: string
  transcriptSha256: string
  source: Record<string, unknown>
  coverage: { messages: number; userMessages: number; assistantMessages: number; reviewedDecisionMessages: number; decisionReviewPending: number }
  pageSize: number
  pages: Array<{ page: number; path: string; count: number; startIndex: number; endIndex: number; firstMessageId: string | null; lastMessageId: string | null }>
}

export type TranscriptPage = {
  snapshotSha256: string
  transcriptSha256: string
  page: number
  messages: Array<{ id: string; role: 'user' | 'assistant'; turnId: string | null; phase: string; timestamp: string | null; text: string; textSha256: string; source: { path: string; line: number; recordSha256: string }; authority: string }>
}

export type ScopeGroup = {
  id: string
  topLevel: string
  count: number
  codeLike: number
  reviewRequired: number
  bytes: number
  pages: Array<{ page: number; path: string; count: number; startIndex: number; endIndex: number }>
}

export type ScopeManifest = {
  schemaVersion: string
  authority: string
  snapshotSha256: string
  scopeSha256: string
  ignored: { total: number; codeLike: number; policyReviewed: number; reviewRequired: number }
  safety: { ignoredContentRead: boolean; statement: string }
  groups: ScopeGroup[]
}

export type ScopePage = {
  snapshotSha256: string
  scopeSha256: string
  topLevel: string
  page: number
  entries: Array<{
    id: string
    path: string
    fileClass: string
    bytes: number | null
    codeLike: boolean
    contentRead: false
    ignoreRule: null | { sourcePath: string; line: number; pattern: string }
    policy: { status: string; classification: string | null; rationale: string | null; sourceRefs: SourceRef[] }
  }>
}

export type InitialAtlas = {
  manifest: UiManifest
  overview: Overview
  journeys: JourneysProjection
  quality: QualityProjection
}

export type AtlasView = 'guide' | 'explorer' | 'journeys' | 'knowledge' | 'evidence' | 'governance' | 'transcript' | 'scope'
