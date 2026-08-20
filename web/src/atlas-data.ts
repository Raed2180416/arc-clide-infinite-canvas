import type { GovernanceProjection, InitialAtlas, NavigationRelationsResult, NavigationSearchResult, NavigationSymbolResult, OrganDetail, RelationDenominator, RelationDetail, ScopeManifest, ScopePage, SearchProjection, SearchRecord, SymbolDetail, TranscriptManifest, TranscriptPage, UiManifest } from './types'

const MAX_LEGACY_SEARCH_BYTES = 5 * 1024 * 1024

export type AtlasSearchPage = { records: SearchRecord[]; total: number; offset: number; limit: number }
export type AtlasRelationsPage = { records: RelationDetail[]; denominator: RelationDenominator }

function baseUrl() {
  const configured = new URLSearchParams(window.location.search).get('snapshot')
  return (configured || '/atlas-snapshot').replace(/\/$/, '')
}

async function fetchJson<T>(relative: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${baseUrl()}/${relative.replace(/^\//, '')}`, { signal })
  if (!response.ok) throw new Error(`Atlas artifact unavailable: ${relative} (${response.status})`)
  return response.json() as Promise<T>
}

async function fetchApiJson<T>(relative: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/__atlas/api/${relative.replace(/^\//, '')}`, { signal })
  if (!response.ok) throw new Error(`Atlas navigation query failed: ${relative} (${response.status})`)
  return response.json() as Promise<T>
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function loadInitialAtlas(): Promise<InitialAtlas> {
  const manifest = await fetchJson<UiManifest>('data/ui/manifest.json')
  const [overview, journeys, quality] = await Promise.all([
    fetchJson<InitialAtlas['overview']>('data/ui/overview.json'),
    fetchJson<InitialAtlas['journeys']>('data/ui/journeys.json'),
    fetchJson<InitialAtlas['quality']>('data/ui/quality.json'),
  ])
  for (const projection of [overview, journeys, quality]) {
    if ('snapshotSha256' in projection && projection.snapshotSha256 !== manifest.snapshotSha256) {
      throw new Error('Atlas initial projections do not bind one snapshot')
    }
  }
  return { manifest, overview, journeys, quality }
}

function displayBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

export async function loadSearchIndex(manifest: UiManifest, signal?: AbortSignal) {
  if (!manifest.loading.lazySearch) throw new Error('This snapshot has no client-side search projection')
  const relative = manifest.loading.lazySearch
  const url = `${baseUrl()}/${relative.replace(/^\//, '')}`
  const response = await fetch(url, { method: 'HEAD', signal })
  if (!response.ok) throw new Error(`Legacy search size could not be verified: ${relative} (${response.status})`)
  const contentLength = Number(response.headers.get('content-length'))
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error('Legacy search stays unavailable because its download size cannot be verified. Open a bounded navigation snapshot instead.')
  }
  if (contentLength > MAX_LEGACY_SEARCH_BYTES) {
    throw new Error(`Legacy search stays unavailable: its ${displayBytes(contentLength)} client index exceeds the ${displayBytes(MAX_LEGACY_SEARCH_BYTES)} safe download limit. Open a bounded navigation snapshot instead.`)
  }
  return fetchJson<SearchProjection>(relative, signal)
}

export async function searchAtlas(manifest: UiManifest, query: string, { limit = 30, offset = 0, signal }: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<AtlasSearchPage> {
  if (manifest.schemaVersion === 'arc-atlas-ui-projection-v3') {
    const parameters = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })
    const result = await fetchApiJson<NavigationSearchResult>(`search?${parameters}`, signal)
    if (result.snapshotSha256 !== manifest.snapshotSha256) throw new Error('Atlas search result does not bind the open snapshot')
    return { records: result.records, total: result.total, offset: result.offset, limit: result.limit }
  }
  const projection = await loadSearchIndex(manifest, signal)
  const normalized = query.trim().toLowerCase()
  const records = projection.records.filter(record => [record.name, record.qualifiedName, record.path, record.kind, record.language]
    .join(' ').toLowerCase().includes(normalized))
  return { records: records.slice(offset, offset + limit), total: records.length, offset, limit }
}

export function loadEntityShard(manifest: UiManifest, bucket: string) {
  const relative = manifest.shards.entities[bucket]
  if (!relative) return Promise.resolve([])
  return fetchJson<SymbolDetail[]>(relative)
}

export function loadRelationShard(manifest: UiManifest, bucket: string) {
  const relative = manifest.shards.relations[bucket]
  if (!relative) return Promise.resolve<RelationDetail[]>([])
  return fetchJson<RelationDetail[]>(relative)
}

export async function loadSymbolDetail(manifest: UiManifest, selected: SearchRecord): Promise<SymbolDetail> {
  if (manifest.schemaVersion === 'arc-atlas-ui-projection-v3') {
    const result = await fetchApiJson<NavigationSymbolResult>(`symbol?id=${encodeURIComponent(selected.id)}`)
    if (result.snapshotSha256 !== manifest.snapshotSha256 || result.symbol.id !== selected.id) {
      throw new Error('Atlas symbol result does not bind the selected symbol and open snapshot')
    }
    return {
      ...selected,
      ...result.symbol,
      purposeStatus: result.symbol.purpose.status,
      primaryOrganId: result.component?.primaryOrganId || selected.primaryOrganId || null,
      source: result.source,
      component: result.component,
    } as SymbolDetail
  }
  if (!selected.bucket) throw new Error('Legacy atlas symbol has no entity bucket')
  const entities = await loadEntityShard(manifest, selected.bucket)
  const detail = entities.find(candidate => candidate.id === selected.id)
  if (!detail) throw new Error('Selected symbol is absent from its declared entity shard')
  return detail
}

export async function loadSymbolRelations(manifest: UiManifest, selected: SearchRecord, { limit = 250, offset = 0, signal }: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<AtlasRelationsPage> {
  if (manifest.schemaVersion === 'arc-atlas-ui-projection-v3') {
    const result = await fetchApiJson<NavigationRelationsResult>(`relations?id=${encodeURIComponent(selected.id)}&limit=${limit}&offset=${offset}`, signal)
    if (result.snapshotSha256 !== manifest.snapshotSha256 || result.symbolId !== selected.id) {
      throw new Error('Atlas relationship result does not bind the selected symbol and open snapshot')
    }
    return { records: result.records, denominator: result.denominator }
  }
  if (!selected.bucket) throw new Error('Legacy atlas symbol has no relationship bucket')
  const records = (await loadRelationShard(manifest, selected.bucket)).filter(relation => relation.self === selected.id)
  const page = records.slice(offset, offset + limit)
  return {
    records: page,
    denominator: {
      total: records.length,
      exact: records.filter(relation => relation.evidenceClass === 'exact-source-relationship').length,
      advisory: records.filter(relation => relation.evidenceClass === 'advisory-code-graph').length,
      offset,
      limit,
    },
  }
}

export async function loadSourceBlob(relative: string, expectedSha256: string) {
  const response = await fetch(`${baseUrl()}/${relative.replace(/^\//, '')}`)
  if (!response.ok) throw new Error(`Exact source blob unavailable: ${relative} (${response.status})`)
  const bytes = await response.arrayBuffer()
  if (await sha256Hex(bytes) !== expectedSha256) throw new Error(`Exact source blob digest mismatch: ${relative}`)
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function loadOrganDetail(manifest: UiManifest, ownerId: string) {
  const relative = manifest.shards.organs?.[ownerId]
  if (!relative) return Promise.resolve<OrganDetail | null>(null)
  return fetchJson<OrganDetail>(relative)
}

export function loadGovernance(manifest: UiManifest) {
  if (!manifest.loading.lazyGovernance) throw new Error('Governance projection is unavailable in this snapshot')
  return fetchJson<GovernanceProjection>(manifest.loading.lazyGovernance)
}

export function loadTranscriptManifest(manifest: UiManifest) {
  if (!manifest.loading.lazyTranscript) throw new Error('Visible transcript was not attached to this snapshot')
  return fetchJson<TranscriptManifest>(manifest.loading.lazyTranscript)
}

export function loadTranscriptPage(path: string) {
  return fetchJson<TranscriptPage>(path)
}

export function loadScopeManifest(manifest: UiManifest) {
  if (!manifest.loading.lazyScope) throw new Error('Repository scope projection is unavailable in this snapshot')
  return fetchJson<ScopeManifest>(manifest.loading.lazyScope)
}

export function loadScopePage(path: string) {
  return fetchJson<ScopePage>(path)
}
