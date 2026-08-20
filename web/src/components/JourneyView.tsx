import { useState } from 'react'
import type { InitialAtlas } from '../types'
import { SourceRefs } from './SourceRefs'

export function JourneyView({ atlas, initialJourney = 'repository-understanding', onSelectOrgan }: { atlas: InitialAtlas; initialJourney?: string; onSelectOrgan: (id: string) => void }) {
  const [journeyId, setJourneyId] = useState(initialJourney)
  const [stepIndex, setStepIndex] = useState(0)
  const journey = atlas.journeys.journeys.find(item => item.id === journeyId) || atlas.journeys.journeys[0]
  const step = journey?.steps[stepIndex]
  return <main className="journey-view" id="atlas-main">
    <aside className="journey-rail"><p className="eyebrow">Curated journeys</p><h2>Follow the system moving.</h2><p>A journey is a source-addressed explanation—not an observed runtime trace.</p>{atlas.journeys.journeys.map(item => <button aria-pressed={journey?.id === item.id} key={item.id} onClick={() => { setJourneyId(item.id); setStepIndex(0) }} type="button"><span>{String(item.steps.length).padStart(2, '0')}</span>{item.name}</button>)}</aside>
    <section className="journey-stage"><div className="journey-heading"><div><p className="eyebrow">Curated journey · no runtime trace attached</p><h1>{journey?.name}</h1><p>{journey?.summary}</p><SourceRefs label="Journey sources" refs={journey?.sourceRefs} /></div><span>{stepIndex + 1} / {journey?.steps.length}</span></div>
      <div className="journey-map">{journey?.steps.map((item, index) => <button aria-current={index === stepIndex ? 'step' : undefined} key={item.id} onClick={() => { setStepIndex(index); item.organIds[0] && onSelectOrgan(`organ:${item.organIds[0]}`) }} type="button"><span>{index + 1}</span><strong>{item.name}</strong></button>)}</div>
      <article className="step-explanation"><span className="step-number">{String(stepIndex + 1).padStart(2, '0')}</span><div><p className="eyebrow">Current step</p><h2>{step?.name}</h2><p>{step?.explanation || step?.summary}</p><div className="organ-tags">{step?.organIds.map(id => <button key={id} onClick={() => onSelectOrgan(`organ:${id}`)} type="button">{id.replaceAll('-', ' ')}</button>)}</div></div></article>
      <div className="journey-controls"><button disabled={stepIndex === 0} onClick={() => setStepIndex(value => value - 1)} type="button">← Previous</button><button disabled={stepIndex >= (journey?.steps.length || 1) - 1} onClick={() => setStepIndex(value => value + 1)} type="button">Next step →</button></div>
    </section>
  </main>
}
