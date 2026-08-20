import { useEffect, useMemo, useState } from 'react'
import { loadOrganDetail, loadSourceBlob, loadSymbolDetail, loadSymbolRelations } from '../atlas-data'
import type { AtlasNode, InitialAtlas, OrganDetail, Overview, RelationDenominator, RelationDetail, SearchRecord, SymbolDetail } from '../types'
import { Inspector } from './Inspector'
import { NeighborhoodView } from './NeighborhoodView'
import { OrganismView } from './OrganismView'

export function Explorer({ atlas, selectedId, selectedSymbol, onSelect, onSelectSymbol }: { atlas: InitialAtlas; selectedId: string | null; selectedSymbol: SearchRecord | null; onSelect: (id: string) => void; onSelectSymbol: (record: SearchRecord) => void }) {
  const [detail, setDetail] = useState<OrganDetail | null>(null)
  const [symbolDetail, setSymbolDetail] = useState<SymbolDetail | null>(null)
  const [relations, setRelations] = useState<RelationDetail[]>([])
  const [relationDenominator, setRelationDenominator] = useState<RelationDenominator | null>(null)
  const [loadingMoreRelations, setLoadingMoreRelations] = useState(false)
  const [relationLoadError, setRelationLoadError] = useState<string | null>(null)
  const [sourceText, setSourceText] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedId?.startsWith('organ:')) { setDetail(null); return }
    loadOrganDetail(atlas.manifest, selectedId).then(value => {
      if (value && value.snapshotSha256 !== atlas.manifest.snapshotSha256) throw new Error('Organ detail does not bind the open snapshot')
      setDetail(value)
    }).catch(() => setDetail(null))
  }, [atlas.manifest, selectedId])
  useEffect(() => {
    if (!selectedSymbol) { setSymbolDetail(null); setRelations([]); setRelationDenominator(null); setLoadingMoreRelations(false); setRelationLoadError(null); setSourceText(null); return }
    let current = true
    Promise.all([
      loadSymbolDetail(atlas.manifest, selectedSymbol),
      loadSymbolRelations(atlas.manifest, selectedSymbol),
    ]).then(async ([entity, relationPage]) => {
      const source = entity.source ? await loadSourceBlob(entity.source.blobPath, entity.source.fileSha256) : null
      if (current) { setSymbolDetail(entity); setRelations(relationPage.records); setRelationDenominator(relationPage.denominator); setRelationLoadError(null); setSourceText(source) }
    }).catch(() => { if (current) { setSymbolDetail(null); setRelations([]); setRelationDenominator(null); setSourceText(null) } })
    return () => { current = false }
  }, [atlas.manifest, selectedSymbol])
  const expandedOverview = useMemo<Overview>(() => detail ? {
    ...atlas.overview,
    nodes: [...atlas.overview.nodes, ...detail.nodes],
    edges: [...atlas.overview.edges, ...detail.edges],
  } : atlas.overview, [atlas.overview, detail])
  const selectedNode: AtlasNode | null = expandedOverview.nodes.find(node => node.id === selectedId) || null
  const neighborhoodOverview = useMemo<Overview>(() => {
    if (!symbolDetail) return expandedOverview
    const selectedSymbolNode: AtlasNode = {
      id: symbolDetail.id, kind: 'symbol', label: symbolDetail.name, path: symbolDetail.path, language: symbolDetail.language,
      primaryOrganId: symbolDetail.component?.primaryOrganId || null, organIds: symbolDetail.component?.organIds || [],
      status: symbolDetail.purpose.status, position: { x: 0, y: 0, z: 0 },
    }
    const neighborRelations = [...new Map(relations.slice(0, 30).map(relation => [relation.neighbor, relation])).values()]
    const symbolNodes: AtlasNode[] = neighborRelations.map((relation, index) => {
      const summary = relation.neighborSummary
      return {
        id: summary.id,
        kind: summary.kind === 'symbol' ? 'symbol' : summary.kind === 'file' ? 'file' : summary.kind === 'external-compiler-symbol' ? 'external-symbol' : 'reference-site',
        label: summary.label,
        path: summary.path || undefined,
        status: summary.status,
        position: { x: index + 1, y: 0, z: 0 },
      }
    })
    const available = new Set(symbolNodes.map(node => node.id))
    return {
      ...expandedOverview,
      nodes: [selectedSymbolNode, ...symbolNodes],
      edges: relations.filter(relation => available.has(relation.neighbor)).slice(0, 30).map(relation => ({
        id: `${relation.id}:${relation.direction}`,
        source: relation.source,
        target: relation.target,
        kind: relation.kind,
        count: 1,
        authority: relation.authority,
      })),
      denominators: { ...expandedOverview.denominators, nodes: 1 + symbolNodes.length, edges: relations.length },
    }
  }, [expandedOverview, relations, symbolDetail])
  const selectNeighborhood = (id: string) => {
    if (id.startsWith('symbol:')) {
      if (id === symbolDetail?.id) { onSelectSymbol(symbolDetail); return }
      const relation = relations.find(candidate => candidate.neighbor === id)
      if (relation?.neighborSummary.kind === 'symbol') {
        onSelectSymbol({
          id,
          name: relation.neighborSummary.label,
          qualifiedName: relation.neighborSummary.label,
          path: relation.neighborSummary.path || '',
          kind: 'symbol',
          language: '',
          purposeStatus: relation.neighborSummary.status,
          primaryOrganId: null,
        })
        return
      }
    }
    onSelect(id)
  }
  const loadMoreRelations = () => {
    if (!selectedSymbol || !relationDenominator || loadingMoreRelations) return
    const nextOffset = relationDenominator.offset + relationDenominator.limit
    if (nextOffset >= relationDenominator.total) return
    setLoadingMoreRelations(true)
    setRelationLoadError(null)
    loadSymbolRelations(atlas.manifest, selectedSymbol, { limit: relationDenominator.limit, offset: nextOffset })
      .then(page => {
        setRelations(current => [...current, ...page.records])
        setRelationDenominator(page.denominator)
      })
      .catch(reason => setRelationLoadError(String(reason?.message || reason)))
      .finally(() => setLoadingMoreRelations(false))
  }
  return (
    <main className="workbench" id="atlas-main">
      <div className="workbench-heading"><div><p className="eyebrow">One selection · two truthful views</p><h1>Explorer workbench</h1></div><p>3D answers “where am I?” Exact 2D and evidence answer “what is this really?”</p></div>
      <div className="workbench-grid">
        <section className="stage-grid">
          <OrganismView overview={expandedOverview} selectedId={selectedId} onSelect={onSelect} />
          <NeighborhoodView overview={neighborhoodOverview} selectedId={selectedId} onSelect={selectNeighborhood} relationDenominator={symbolDetail ? relationDenominator : undefined} />
        </section>
        <Inspector node={selectedNode} symbol={selectedSymbol} detail={symbolDetail} relations={relations} relationDenominator={relationDenominator} sourceText={sourceText} loadingMoreRelations={loadingMoreRelations} onLoadMoreRelations={loadMoreRelations} relationLoadError={relationLoadError} />
      </div>
    </main>
  )
}
