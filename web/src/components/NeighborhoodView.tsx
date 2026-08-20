import type { AtlasNode, Overview, RelationDenominator } from '../types'

export function NeighborhoodView({ overview, selectedId, onSelect, relationDenominator }: { overview: Overview; selectedId: string | null; onSelect: (id: string) => void; relationDenominator?: RelationDenominator | null }) {
  const selected = overview.nodes.find(node => node.id === selectedId) || overview.nodes[0]
  const edgeSet = overview.edges.filter(edge => edge.source === selected.id || edge.target === selected.id)
  const ids = new Set([selected.id, ...edgeSet.flatMap(edge => [edge.source, edge.target])])
  const neighbors = overview.nodes.filter(node => ids.has(node.id)).slice(0, 14)
  const center = { x: 330, y: 210 }
  const coordinates = new Map(neighbors.map((node, index) => {
    if (node.id === selected.id) return [node.id, center]
    const angle = (index / Math.max(neighbors.length - 1, 1)) * Math.PI * 2
    return [node.id, { x: center.x + Math.cos(angle) * 170, y: center.y + Math.sin(angle) * 125 }]
  }))
  return (
    <div className="visual-panel neighborhood-panel" aria-label="Exact neighborhood">
      <div className="panel-caption"><div><span className="eyebrow">Inspection surface</span><h3>Exact neighborhood</h3></div><span>{edgeSet.length} adjacent · {relationDenominator ? `${relationDenominator.total.toLocaleString()} relationships total · offset ${relationDenominator.offset.toLocaleString()}` : `${edgeSet.length} relationships loaded`}</span></div>
      <svg aria-hidden="true" viewBox="0 0 660 420">
        {edgeSet.map(edge => {
          const source = coordinates.get(edge.source)
          const target = coordinates.get(edge.target)
          return source && target ? <line className={edge.authority?.includes('advisory') ? 'advisory-edge' : ''} key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null
        })}
        {neighbors.map((node: AtlasNode) => {
          const point = coordinates.get(node.id) || center
          return <g className="svg-node" data-kind={node.kind} key={node.id} transform={`translate(${point.x} ${point.y})`} onClick={() => onSelect(node.id)}>
            <circle r={node.id === selected.id ? 20 : 13} />
            <text y={node.id === selected.id ? 35 : 27} textAnchor="middle">{node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label}</text>
          </g>
        })}
      </svg>
      <ul className="neighborhood-access-list" aria-label={`Visible nodes around ${selected.label}`}>{neighbors.map(node => <li key={node.id}><button aria-pressed={node.id === selected.id} onClick={() => onSelect(node.id)} type="button">{node.label}</button></li>)}</ul>
      {neighbors.length >= 14 && <div className="folded-neighbors">Showing 14 of {Math.max(ids.size, (relationDenominator?.total ?? edgeSet.length) + 1)} nodes · exact remainder stays counted</div>}
    </div>
  )
}
