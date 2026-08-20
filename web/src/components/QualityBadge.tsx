import { useRef } from 'react'
import type { QualityProjection } from '../types'
import { useDialogFocus } from './useDialogFocus'

function words(value: string) {
  return value.replaceAll('-', ' ')
}

export function QualityBadge({ quality, onOpen }: { quality: QualityProjection; onOpen: () => void }) {
  const blocking = Object.values(quality.gates).filter(gate => gate.status !== 'pass' && gate.status !== 'not-claimed').length
  return (
    <button className="quality-badge" data-state={blocking ? 'blocked' : 'ready'} onClick={onOpen} type="button">
      <span className="quality-pulse" aria-hidden="true" />
      <span>{blocking ? 'Built incomplete' : 'Corpus complete'}</span>
      <span className="quality-count">{blocking}</span>
      <span className="sr-only">Open snapshot evidence. {blocking} blocking gates.</span>
    </button>
  )
}

export function QualitySheet({ quality, onClose }: { quality: QualityProjection; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useDialogFocus({ open: true, dialogRef, initialFocusRef: closeRef, onClose })
  return (
    <div className="sheet-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section aria-describedby="quality-description" aria-labelledby="quality-title" className="evidence-sheet" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="sheet-heading">
          <div>
            <p className="eyebrow">Truth boundary</p>
            <h2 id="quality-title">Snapshot evidence</h2>
            <p className="sr-only" id="quality-description">Snapshot quality gates and their exact reasons.</p>
          </div>
          <button className="icon-button" ref={closeRef} onClick={onClose} type="button" aria-label="Close snapshot evidence">×</button>
        </div>
        <div className="quality-metrics">
          <article><strong>{quality.counts.files.toLocaleString()}</strong><span>files</span></article>
          <article><strong>{quality.counts.symbols.toLocaleString()}</strong><span>declarations</span></article>
          <article><strong>{quality.counts.relations.toLocaleString()}</strong><span>relations</span></article>
          <article><strong>{quality.counts.ignored.toLocaleString()}</strong><span>ignored paths</span></article>
        </div>
        <div className="gate-list">
          {Object.entries(quality.gates).map(([name, gate]) => (
            <article className="gate-row" data-status={gate.status} key={name}>
              <span className="gate-mark" aria-hidden="true" />
              <div><strong>{words(name)}</strong><p>{words(gate.reason)}</p></div>
              <span className="status-chip">{words(gate.status)}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
