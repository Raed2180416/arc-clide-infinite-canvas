import { useEffect, useRef, useState } from 'react'
import { searchAtlas } from '../atlas-data'
import type { SearchRecord, UiManifest } from '../types'
import { useDialogFocus } from './useDialogFocus'

const PAGE_SIZE = 30

export function SearchPalette({ open, manifest, onClose, onSelect }: { open: boolean; manifest: UiManifest; onClose: () => void; onSelect: (record: SearchRecord) => void }) {
  const [query, setQuery] = useState('')
  const [records, setRecords] = useState<SearchRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState({ offset: 0, limit: PAGE_SIZE })
  const [requestedOffset, setRequestedOffset] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([])
  const { preventFocusRestore } = useDialogFocus({ open, dialogRef, initialFocusRef: inputRef, onClose })

  useEffect(() => {
    if (open) return
    setQuery('')
    setRecords([])
    setTotal(0)
    setPage({ offset: 0, limit: PAGE_SIZE })
    setRequestedOffset(0)
    setActiveIndex(0)
    setLoading(false)
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const normalized = query.trim()
    if (!normalized) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      searchAtlas(manifest, normalized, { limit: PAGE_SIZE, offset: requestedOffset, signal: controller.signal })
        .then(result => {
          setRecords(current => requestedOffset === 0 ? result.records : [...current, ...result.records])
          setTotal(result.total)
          setPage({ offset: result.offset, limit: result.limit })
          setActiveIndex(0)
        })
        .catch(reason => {
          if (reason?.name !== 'AbortError') {
            setRecords([])
            setTotal(0)
            setError(String(reason?.message || reason))
          }
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 120)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [manifest, open, query, requestedOffset])

  if (!open) return null

  const choose = (record: SearchRecord) => {
    preventFocusRestore()
    onSelect(record)
    onClose()
  }
  const moveToResult = (index: number) => {
    if (!records.length) return
    const next = (index + records.length) % records.length
    setActiveIndex(next)
    window.requestAnimationFrame(() => resultRefs.current[next]?.focus())
  }
  const handleQueryChange = (value: string) => {
    setQuery(value)
    setRecords([])
    setTotal(0)
    setPage({ offset: 0, limit: PAGE_SIZE })
    setRequestedOffset(0)
    setActiveIndex(0)
    setError(null)
  }
  const nextOffset = page.offset + page.limit
  const canLoadMore = records.length > 0 && nextOffset < total
  const shown = records.length ? `Showing 1–${records.length.toLocaleString()} of ${total.toLocaleString()} exact lexical matches · latest server offset ${page.offset.toLocaleString()}` : `Showing 0 of ${total.toLocaleString()} exact lexical matches`
  const loadMoreCount = Math.min(page.limit, Math.max(0, total - records.length))

  return (
    <div className="palette-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section aria-describedby="atlas-search-help atlas-search-status" aria-labelledby="atlas-search-title" className="command-palette" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <h2 className="sr-only" id="atlas-search-title">Atlas search</h2>
        <p className="sr-only" id="atlas-search-help">Search the current snapshot. Use the Down Arrow to move to a result and Enter to open it.</p>
        <div className="palette-input"><span aria-hidden="true">⌕</span><input aria-describedby="atlas-search-help atlas-search-status" aria-label="Search the atlas" ref={inputRef} type="search" value={query} onChange={event => handleQueryChange(event.target.value)} onKeyDown={event => {
          if (event.key === 'ArrowDown' && records.length) { event.preventDefault(); moveToResult(activeIndex) }
          if (event.key === 'ArrowUp' && records.length) { event.preventDefault(); moveToResult(activeIndex - 1) }
          if (event.key === 'Enter' && records[activeIndex]) { event.preventDefault(); choose(records[activeIndex]) }
        }} placeholder="Search organs, files, symbols, journeys…" /><kbd>esc</kbd></div>
        <div className="palette-groups">
          <p className="sr-only" id="atlas-search-status" role="status" aria-live="polite">{loading ? 'Searching the exact snapshot.' : error ? `Search failed closed. ${error}` : query.trim() ? shown : 'Type a search term to inspect the exact snapshot.'}</p>
          {loading && !records.length && <p className="palette-empty">Opening the bounded search surface…</p>}
          {!loading && error && <p className="palette-empty">Search failed closed: {error}</p>}
          {!loading && !error && !query.trim() && <p className="palette-empty">Type a symbol, file path, language, or declaration kind. Results are bounded and exact detail is verified only after selection.</p>}
          {!loading && !error && query.trim() && records.length === 0 && <p className="palette-empty">No exact snapshot declarations match this query.</p>}
          {records.length > 0 && <ul className="palette-results" aria-label="Search results">{records.map((record, index) => <li key={`${record.id}:${index}`}><button aria-label={`${record.name}, ${record.kind}, ${record.path}`} className="palette-result" data-active={activeIndex === index || undefined} ref={element => { resultRefs.current[index] = element }} onClick={() => choose(record)} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); moveToResult(index + 1) }
            if (event.key === 'ArrowUp') { event.preventDefault(); moveToResult(index - 1) }
            if (event.key === 'Home') { event.preventDefault(); moveToResult(0) }
            if (event.key === 'End') { event.preventDefault(); moveToResult(records.length - 1) }
          }} type="button"><span className="result-icon" data-kind={record.kind}>{record.kind.slice(0, 2).toUpperCase()}</span><span><strong>{record.name}</strong><small>{record.path} · {record.kind}</small></span><span className="result-provenance">{record.purposeStatus === 'review-required' ? 'why pending' : 'reviewed'}</span></button></li>)}</ul>}
          {canLoadMore && <button className="palette-load-more" disabled={loading} onClick={() => setRequestedOffset(nextOffset)} type="button">{loading ? 'Loading more results…' : `Load ${loadMoreCount.toLocaleString()} more results`}</button>}
        </div>
        <footer><span><kbd>↓</kbd> choose result</span><span><kbd>esc</kbd> close</span><span>{shown}</span></footer>
      </section>
    </div>
  )
}
