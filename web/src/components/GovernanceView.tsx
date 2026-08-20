import { useEffect, useMemo, useState } from 'react'
import { loadGovernance } from '../atlas-data'
import type { GovernanceProjection, InitialAtlas } from '../types'
import { SourceRefs } from './SourceRefs'

type Section = 'intent' | 'canon' | 'findings' | 'authority' | 'documents'

function sourceLabel(value: { path?: string; sha256?: string }) {
  return `${value.path || 'source unavailable'}${value.sha256 ? ` · ${value.sha256.slice(0, 12)}` : ''}`
}

export function GovernanceView({ atlas }: { atlas: InitialAtlas }) {
  const [governance, setGovernance] = useState<GovernanceProjection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('intent')
  useEffect(() => { loadGovernance(atlas.manifest).then(setGovernance).catch(reason => setError(String(reason.message || reason))) }, [atlas.manifest])
  const root = useMemo(() => governance?.intentNodes.find(node => node.parentId === null), [governance])
  if (error) return <main className="corpus-state" id="atlas-main"><p className="eyebrow">Fail closed</p><h1>Decision genealogy is unavailable.</h1><p>{error}</p></main>
  if (!governance) return <main className="corpus-state" id="atlas-main"><p className="eyebrow">Opening exact governance bytes</p><h1>Reconstructing who decided what…</h1></main>
  const sections: Array<[Section, string, number]> = [
    ['intent', 'Protected intent', governance.intentNodes.length],
    ['canon', 'Canonical read order', governance.documents.filter(document => document.canonical).length],
    ['findings', 'Findings', governance.findings.length],
    ['authority', 'Owner changes', governance.authorityEvents.length],
    ['documents', 'All documents', governance.documents.length],
  ]
  return <main className="governance-view" id="atlas-main">
    <header className="corpus-heading"><div><p className="eyebrow">Intent → decisions → evidence → implementation</p><h1>Why the system is shaped this way</h1><p>A file hash proves which words exist. It does not prove that the words are correct or child-simple. This view keeps owner authority, canonical guidance, measured findings, and teaching review visibly separate.</p></div><span className="corpus-hash">governance {governance.governanceSha256.slice(0, 12)}</span></header>
    <section className="governance-truth-banner" data-status={governance.teaching.status}><strong>Teaching coverage: {governance.teaching.status.replaceAll('-', ' ')}</strong><p>{governance.teaching.rule}</p></section>
    <nav className="corpus-tabs" aria-label="Decision genealogy sections">{sections.map(([id, label, count]) => <button aria-current={section === id ? 'page' : undefined} key={id} onClick={() => setSection(id)} type="button"><span>{label}</span><b>{count.toLocaleString()}</b></button>)}</nav>
    {section === 'intent' && <section className="intent-map"><article className="root-intent"><span>Protected destination</span><h2>{String(root?.id || 'Root intent unavailable')}</h2><p>{String(root?.statement || 'No root statement was physically opened.')}</p><small>{String(root?.source || 'source unavailable')} · owner authority required to change</small></article><div className="intent-children">{governance.intentNodes.filter(node => node.id !== root?.id).map(node => <article key={node.id}><div><span>{node.type}</span>{node.protected && <i>protected</i>}</div><h3>{node.id}</h3><p>{node.statement}</p><small>Parent: {node.parentId || 'none'} · exact statement, plain-language teaching {String((node.teaching as { status?: string })?.status || 'unreviewed')}</small></article>)}</div></section>}
    {section === 'canon' && <section className="record-grid">{governance.documents.filter(document => document.canonical).map(document => <article key={document.id}><span>Canonical document</span><h2>{document.path}</h2><p>{String(document.canonical?.role || 'Role missing')}</p><dl><dt>Authority</dt><dd>{String(document.canonical?.authority || 'missing')}</dd><dt>Owner</dt><dd>{String(document.canonical?.owner || 'missing')}</dd><dt>Fresh when</dt><dd>{String(document.canonical?.freshness || 'missing')}</dd></dl><code>{document.sha256}</code></article>)}</section>}
    {section === 'findings' && <section className="timeline-list">{governance.findings.map(finding => <article key={finding.findingId}><div className="timeline-mark" /><div><span>{finding.evidenceStatus} finding · {finding.findingId}</span><h2>{finding.claim}</h2><p>{finding.impact}</p><footer><code>{finding.path}</code><small>{finding.sha256.slice(0, 12)}</small></footer></div></article>)}</section>}
    {section === 'authority' && <section className="timeline-list authority-list">{governance.authorityEvents.map(event => <article key={event.eventId}><div className="timeline-mark" /><div><span>Owner-authorized change · {event.eventId}</span><h2>Authorized by {event.authorizedBy}</h2>{event.changes.map((change, index) => <section className="change-card" key={`${event.eventId}:${index}`}><strong>{change.nodeId}</strong><p><del>{change.before}</del></p><p><ins>{change.after}</ins></p><small>{change.rationale}</small></section>)}</div></article>)}</section>}
    {section === 'documents' && <section className="document-ledger"><div className="ledger-head"><span>Document</span><span>Governance class</span><span>Teaching state</span><span>Exact source</span></div>{governance.documents.map(document => <article key={document.id} data-status={document.classification === 'unclassified-document' ? 'fail' : 'pass'}><div><strong>{document.path}</strong><small>{document.bytes.toLocaleString()} bytes · {document.headings.length} headings</small><SourceRefs label="Teaching sources" refs={document.teaching.sourceRefs} /></div><span>{document.classification.replaceAll('-', ' ')}</span><span>{document.teaching.status.replaceAll('-', ' ')}</span><code>{sourceLabel(document)}</code></article>)}</section>}
  </main>
}
