import { useEffect, useState } from 'react'
import { loadScopeManifest, loadScopePage } from '../atlas-data'
import type { InitialAtlas, ScopeManifest, ScopePage } from '../types'
import { SourceRefs } from './SourceRefs'

export function ScopeView({ atlas }: { atlas: InitialAtlas }) {
  const [manifest, setManifest] = useState<ScopeManifest | null>(null)
  const [groupIndex, setGroupIndex] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [page, setPage] = useState<ScopePage | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { loadScopeManifest(atlas.manifest).then(setManifest).catch(reason => setError(String(reason.message || reason))) }, [atlas.manifest])
  useEffect(() => {
    const descriptor = manifest?.groups[groupIndex]?.pages[pageIndex]
    if (!descriptor) return
    setPage(null)
    loadScopePage(descriptor.path).then(value => {
      if (value.snapshotSha256 !== atlas.manifest.snapshotSha256 || value.scopeSha256 !== manifest.scopeSha256) throw new Error('Scope page does not bind the open snapshot')
      setPage(value)
    }).catch(reason => setError(String(reason.message || reason)))
  }, [atlas.manifest.snapshotSha256, groupIndex, manifest, pageIndex])
  if (error) return <main className="corpus-state" id="atlas-main"><p className="eyebrow">Fail closed</p><h1>The repository scope ledger could not open.</h1><p>{error}</p></main>
  if (!manifest) return <main className="corpus-state" id="atlas-main"><p className="eyebrow">Visible and deliberately excluded state</p><h1>Opening the scope denominator…</h1></main>
  const group = manifest.groups[groupIndex]
  return <main className="scope-view" id="atlas-main"><header className="corpus-heading"><div><p className="eyebrow">Nothing silently outside the map</p><h1>Repository scope ledger</h1><p>Ignored paths are named with their Git rule and physical metadata. Their contents were deliberately not read. A path is not understood until a source-addressed policy says why it is generated, private, cached, external, or otherwise excluded.</p></div><span className="corpus-hash">scope {manifest.scopeSha256.slice(0, 12)}</span></header><section className="scope-safety"><strong>Ignored contents read: {String(manifest.safety.ignoredContentRead)}</strong><p>{manifest.safety.statement}</p></section><div className="scope-layout"><aside className="scope-groups"><div><strong>{manifest.ignored.total.toLocaleString()}</strong><span>ignored paths</span></div>{manifest.groups.map((item, index) => <button aria-pressed={groupIndex === index} key={item.id} onClick={() => { setGroupIndex(index); setPageIndex(0) }} type="button"><span>{item.topLevel}</span><b>{item.count.toLocaleString()}</b><small>{item.codeLike.toLocaleString()} code-like · {item.reviewRequired.toLocaleString()} pending</small></button>)}</aside><section className="scope-ledger"><header><div><p className="eyebrow">Top-level scope</p><h2>{group?.topLevel || 'No ignored groups'}</h2></div><span>{group?.count.toLocaleString()} exact paths</span></header>{group && <div className="corpus-pagination"><button disabled={pageIndex === 0} onClick={() => setPageIndex(value => value - 1)} type="button">← Previous</button><span>Page {pageIndex + 1} of {group.pages.length}</span><button disabled={pageIndex >= group.pages.length - 1} onClick={() => setPageIndex(value => value + 1)} type="button">Next →</button></div>}{!page ? <div className="loading-corpus">Opening path metadata…</div> : <div className="scope-rows"><div className="ledger-head"><span>Path</span><span>Kind</span><span>Why ignored</span><span>Policy</span></div>{page.entries.map(entry => <article key={entry.id} data-status={entry.policy.status === 'review-required' ? 'fail' : 'pass'}><div><strong>{entry.path}</strong><small>{entry.bytes?.toLocaleString() || 'unknown'} bytes · content not read</small></div><span>{entry.codeLike ? 'code-like' : entry.fileClass}</span><code>{entry.ignoreRule ? `${entry.ignoreRule.sourcePath}:${entry.ignoreRule.line} ${entry.ignoreRule.pattern}` : 'rule unavailable'}</code><div className="scope-policy"><span>{entry.policy.status.replaceAll('-', ' ')}</span><SourceRefs label="Policy sources" refs={entry.policy.sourceRefs} /></div></article>)}</div>}</section></div></main>
}
