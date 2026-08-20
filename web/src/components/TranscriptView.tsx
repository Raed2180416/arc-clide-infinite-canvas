import { useEffect, useState } from 'react'
import { loadTranscriptManifest, loadTranscriptPage } from '../atlas-data'
import type { InitialAtlas, TranscriptManifest, TranscriptPage } from '../types'

export function TranscriptView({ atlas }: { atlas: InitialAtlas }) {
  const [manifest, setManifest] = useState<TranscriptManifest | null>(null)
  const [page, setPage] = useState<TranscriptPage | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { loadTranscriptManifest(atlas.manifest).then(setManifest).catch(reason => setError(String(reason.message || reason))) }, [atlas.manifest])
  useEffect(() => {
    const descriptor = manifest?.pages[pageIndex]
    if (!descriptor) return
    setPage(null)
    loadTranscriptPage(descriptor.path).then(value => {
      if (value.snapshotSha256 !== atlas.manifest.snapshotSha256 || value.transcriptSha256 !== manifest.transcriptSha256) throw new Error('Transcript page does not bind the open snapshot')
      setPage(value)
    }).catch(reason => setError(String(reason.message || reason)))
  }, [atlas.manifest.snapshotSha256, manifest, pageIndex])
  if (error) return <main className="corpus-state" id="atlas-main"><p className="eyebrow">Unavailable, never invented</p><h1>The exact visible transcript could not open.</h1><p>{error}</p></main>
  if (!manifest) return <main className="corpus-state" id="atlas-main"><p className="eyebrow">Verbatim visible history</p><h1>Opening the conversation ledger…</h1></main>
  return <main className="transcript-view" id="atlas-main"><header className="corpus-heading"><div><p className="eyebrow">What was actually said</p><h1>Conversation and clarification history</h1><p>Owner messages carry direction, but later owner direction and adjudicated canon can supersede them. Assistant messages are commitments, never owner authority. Private reasoning and tool traffic are excluded.</p></div><span className="corpus-hash">{manifest.coverage.messages.toLocaleString()} visible messages</span></header><section className="transcript-metrics"><article><strong>{manifest.coverage.userMessages.toLocaleString()}</strong><span>owner messages</span></article><article><strong>{manifest.coverage.assistantMessages.toLocaleString()}</strong><span>assistant messages</span></article><article><strong>{manifest.coverage.reviewedDecisionMessages.toLocaleString()}</strong><span>reviewed decisions</span></article><article><strong>{manifest.coverage.decisionReviewPending.toLocaleString()}</strong><span>semantic reviews pending</span></article></section><div className="corpus-pagination"><button disabled={pageIndex === 0} onClick={() => setPageIndex(value => value - 1)} type="button">← Newer source page</button><span>Messages {(manifest.pages[pageIndex]?.startIndex || 0) + 1}–{(manifest.pages[pageIndex]?.endIndex || 0) + 1} of {manifest.coverage.messages.toLocaleString()}</span><button disabled={pageIndex >= manifest.pages.length - 1} onClick={() => setPageIndex(value => value + 1)} type="button">Older source page →</button></div>{!page ? <section className="loading-corpus">Opening exact content-addressed page…</section> : <section className="message-ledger">{page.messages.map((message, index) => <article data-role={message.role} key={message.id}><aside><span>{message.role === 'user' ? 'Owner' : 'Assistant'}</span><b>#{(manifest.pages[pageIndex]?.startIndex || 0) + index + 1}</b><small>{message.timestamp || 'time unavailable'}</small></aside><div><p>{message.text}</p><footer><code>line {message.source.line} · {message.textSha256.slice(0, 12)}</code><span>{message.authority.replaceAll('-', ' ')}</span></footer></div></article>)}</section>}</main>
}
