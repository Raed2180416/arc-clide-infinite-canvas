import type { InitialAtlas } from '../types'
import { SourceRefs } from './SourceRefs'

export function GuidedStart({ atlas, onExplore, onStartJourney }: { atlas: InitialAtlas; onExplore: () => void; onStartJourney: () => void }) {
  const journey = atlas.journeys.journeys.find(item => item.id === 'repository-understanding') || atlas.journeys.journeys[0]
  const failing = Object.entries(atlas.quality.gates).find(([, gate]) => gate.status === 'fail')
  return (
    <main className="guide-view" id="atlas-main">
      <section className="guide-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="live-dot" /> ARC / CLIDE · repository atlas V3</p>
          <h1>Understand the whole engineering organism.</h1>
          <p className="hero-lede">Start with the human goal. Follow one request through reasoning, context, tools, evidence, code, effects, verification, recovery, and learning. Every claim opens to its source.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStartJourney} type="button">Start the guided system tour <span aria-hidden="true">→</span></button>
            <button className="secondary-button" onClick={onExplore} type="button">Explore freely</button>
          </div>
          <p className="boundary-note"><span aria-hidden="true">◇</span> This atlas explains structure and evidence. It never turns repository coverage into product proof.</p>
        </div>
        <div className="organism-preview" aria-label="System organism preview">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
          <div className="core-mark"><span>ARC</span><small>intent</small></div>
          {['reason', 'context', 'act', 'verify', 'learn'].map((label, index) => <span className={`satellite satellite-${index + 1}`} key={label}>{label}</span>)}
        </div>
      </section>
      <section className="guide-lower">
        <article className="journey-card">
          <div className="card-topline"><span>Recommended first path</span><span>{journey?.steps.length || 0} steps</span></div>
          <h2>{journey?.name || 'Repository understanding'}</h2>
          <p>{journey?.summary}</p>
          <SourceRefs label="Why this path is in the atlas" refs={journey?.sourceRefs} />
          <ol className="tour-steps">
            {(journey?.steps || []).map((step, index) => (
              <li key={step.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.name}</strong><p>{step.explanation || step.summary}</p></div></li>
            ))}
          </ol>
        </article>
        <aside className="guide-status">
          <div className="card-topline"><span>Snapshot honesty</span><span className="status-amber">in progress</span></div>
          <h2>Useful now. Not allowed to overclaim.</h2>
          <p className="status-copy">The map can be explored while its quality gates remain visible. Missing semantics and stale evidence are named work, never hidden.</p>
          <dl>
            <div><dt>Files</dt><dd>{atlas.quality.counts.files.toLocaleString()}</dd></div>
            <div><dt>Declarations</dt><dd>{atlas.quality.counts.symbols.toLocaleString()}</dd></div>
            <div><dt>Visible chat messages</dt><dd>{atlas.quality.counts.transcriptMessages.toLocaleString()}</dd></div>
            <div><dt>Ignored paths awaiting policy</dt><dd>{atlas.quality.counts.ignoredReviewRequired.toLocaleString()}</dd></div>
          </dl>
          {failing && <div className="blocking-callout"><strong>{failing[0].replaceAll(/([A-Z])/g, ' $1')}</strong><span>{failing[1].reason.replaceAll('-', ' ')}</span></div>}
        </aside>
      </section>
    </main>
  )
}
