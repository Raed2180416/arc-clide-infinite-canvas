import type { AtlasNode, RelationDenominator, RelationDetail, SearchRecord, SymbolDetail } from '../types'
import { SourceRefs } from './SourceRefs'

function titleCase(value: string) {
  return value.replaceAll('-', ' ').replace(/\b\w/g, character => character.toUpperCase())
}

type InspectorProps = {
  node: AtlasNode | null
  symbol: SearchRecord | null
  detail: SymbolDetail | null
  relations: RelationDetail[]
  relationDenominator?: RelationDenominator | null
  sourceText: string | null
  loadingMoreRelations?: boolean
  onLoadMoreRelations?: () => void
  relationLoadError?: string | null
}

export function Inspector({
  node,
  symbol,
  detail,
  relations,
  relationDenominator = null,
  sourceText,
  loadingMoreRelations = false,
  onLoadMoreRelations = () => {},
  relationLoadError = null,
}: InspectorProps) {
  if (!node && !symbol) return <aside className="inspector"><div className="empty-inspector"><span>◇</span><h2>Select anything</h2><p>Pick an organ, file, symbol, journey step, decision, or evidence record. Every selection opens on the same exact snapshot.</p></div></aside>
  const name = symbol?.name || node?.label || 'Selection'
  const sourceExcerpt = detail && sourceText
    ? sourceText.split(/\r?\n/).slice(Math.max(0, detail.start.line - 1), detail.end.line).join('\n')
    : null
  const observedEvents = detail ? Object.entries(detail.operationalBehavior.eventCounts).filter(([, count]) => count > 0) : []
  const exactRelations = relations.filter(relation => relation.evidenceClass === 'exact-source-relationship')
  const advisoryRelations = relations.filter(relation => relation.evidenceClass === 'advisory-code-graph')
  const reviewedFilePurpose = detail?.component?.classification?.plainLanguagePurpose || null
  const canLoadMoreRelations = Boolean(relationDenominator && relationDenominator.offset + relationDenominator.limit < relationDenominator.total)
  return (
    <aside className="inspector" aria-label="Selection inspector">
      <div className="inspector-heading">
        <span className="entity-kind">{titleCase(symbol?.kind || node?.kind || 'entity')}</span>
        <h2>{name}</h2>
        <p className="entity-path">{symbol?.path || node?.path || node?.id}</p>
      </div>
      {symbol ? <>
        <section><h3>What it is</h3><p>{detail?.structuralExplanation.summary || `This is a ${titleCase(symbol.kind)} declared in ${symbol.path}.`} This is an exact syntax explanation, not guessed author intent.</p><pre>{detail?.signature || symbol.signature || 'Exact declaration signature is loading.'}</pre></section>
        <section><h3>How it behaves in code</h3>{detail ? <><p>{detail.operationalBehavior.plainLanguage}</p><dl className="inspector-list"><div><dt>Inputs</dt><dd>{detail.operationalBehavior.declaredInputs.map(input => input.text).join(', ') || 'No declared inputs'}</dd></div><div><dt>Observed syntax</dt><dd>{observedEvents.map(([kind, count]) => `${count} ${titleCase(kind)}`).join(' · ') || 'No executable event syntax inside this declaration'}</dd></div><div><dt>Ceiling</dt><dd>{titleCase(detail.operationalBehavior.resolutionCeiling)}</dd></div></dl></> : <p>Opening the exact operational syntax record…</p>}</section>
        <section><h3>Exact source</h3>{sourceExcerpt ? <><p>Snapshot bytes {detail?.source?.fileSha256.slice(0, 12)} · lines {detail?.start.line}–{detail?.end.line} · body {detail?.bodySha256.slice(0, 12)}</p><pre>{sourceExcerpt}</pre></> : <p>Opening and digest-checking the content-addressed source blob…</p>}</section>
        {detail?.purpose.summary ? <section><h3>Why it exists</h3><p>{detail.purpose.summary}</p><small>{titleCase(detail.purpose.status)} · {titleCase(detail.purpose.authority)}</small></section> : <section className="purpose-gap"><h3>Why it exists</h3><strong>Symbol purpose review required</strong>{reviewedFilePurpose ? <><p>The containing file has a reviewed role: {reviewedFilePurpose}</p><p>That file-level explanation does not prove why this individual symbol exists. Atlas keeps the narrower purpose unavailable until source-authored or explicitly reviewed evidence is attached.</p><SourceRefs label="Containing file evidence" refs={detail?.component?.classification?.sourceRefs} /></> : <p>No source-authored or source-addressed explanation has been attached yet. Atlas refuses to invent one from the identifier.</p>}</section>}
        <section><h3>Evidence state</h3><dl className="inspector-list"><div><dt>Purpose</dt><dd>{titleCase(symbol.purposeStatus)}</dd></div><div><dt>Language</dt><dd>{symbol.language}</dd></div><div><dt>Parser</dt><dd>{detail ? `${detail.derivation.adapter} · ${detail.derivation.confidence}` : 'opening exact entity shard'}</dd></div><div><dt>Organ</dt><dd>{symbol.primaryOrganId || 'Unclassified'}</dd></div><div><dt>Entity ID</dt><dd><code>{symbol.id.slice(0, 24)}…</code></dd></div></dl></section>
        <section><h3>Relationships</h3><p>{exactRelations.length} exact source relationships · {advisoryRelations.length} separately labeled advisory graph observations.</p>{relations.length ? <div className="relation-list">{relations.slice(0, 150).map(relation => <article data-evidence={relation.evidenceClass} key={`${relation.id}:${relation.direction}`}><span>{relation.direction}</span><strong>{titleCase(relation.kind)}</strong><b>{relation.neighborSummary.label}</b><code>{relation.neighborSummary.path || relation.neighbor.slice(0, 28)}</code><small>{relation.evidenceClass === 'exact-source-relationship' ? `Exact · ${titleCase(relation.authority)}` : `Advisory · ${relation.observation?.adapter || 'graph adapter'} · confidence ${relation.observation?.confidence ?? 'unavailable'}`}</small>{relation.neighborSummary.resolution && <small>{titleCase(relation.neighborSummary.resolution.state)} · {relation.neighborSummary.resolution.reason}</small>}</article>)}</div> : <p>No exact or advisory relationship observation is attached. Absence is not proof that no dependency exists.</p>}{canLoadMoreRelations && <button disabled={loadingMoreRelations} onClick={onLoadMoreRelations} type="button">{loadingMoreRelations ? 'Loading more relationships…' : `Load more relationships (${relations.length.toLocaleString()} of ${relationDenominator?.total.toLocaleString()})`}</button>}{relationLoadError && <p role="alert">Could not load more relationships: {relationLoadError}</p>}</section>
      </> : <>
        <section><h3>Plain-language role</h3><p>{node?.summary || (node?.kind === 'file' ? 'A physical repository file. Open its evidence to see declarations, relations, ownership, tests, and journey roles.' : 'The content-addressed root of this repository snapshot.')}</p></section>
        <section><h3>Exact identity</h3><dl className="inspector-list"><div><dt>Status</dt><dd>{titleCase(node?.status || '')}</dd></div>{node?.language && <div><dt>Language</dt><dd>{node.language}</dd></div>}<div><dt>Entity ID</dt><dd><code>{node?.id.slice(0, 26)}…</code></dd></div></dl></section>
      </>}
    </aside>
  )
}
