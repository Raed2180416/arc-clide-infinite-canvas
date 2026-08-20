import { useEffect, useMemo, useRef, useState } from 'react'
import { loadInitialAtlas } from './atlas-data'
import { EvidenceView } from './components/EvidenceView'
import { Explorer } from './components/Explorer'
import { GuidedStart } from './components/GuidedStart'
import { GovernanceView } from './components/GovernanceView'
import { JourneyView } from './components/JourneyView'
import { KnowledgeView } from './components/KnowledgeView'
import { QualityBadge, QualitySheet } from './components/QualityBadge'
import { SearchPalette } from './components/SearchPalette'
import { ScopeView } from './components/ScopeView'
import { TranscriptView } from './components/TranscriptView'
import type { AtlasView, InitialAtlas, SearchRecord } from './types'

const NAV: Array<{ id: AtlasView; label: string; shortcut?: string }> = [
  { id: 'guide', label: 'Start' }, { id: 'explorer', label: 'Explore' }, { id: 'journeys', label: 'Journeys' },
  { id: 'knowledge', label: 'Textbook' }, { id: 'evidence', label: 'Evidence' }, { id: 'governance', label: 'Decisions' }, { id: 'transcript', label: 'Chat' }, { id: 'scope', label: 'Scope' },
]

function initialView(): AtlasView {
  const value = new URLSearchParams(window.location.search).get('view') as AtlasView | null
  return NAV.some(item => item.id === value) ? value! : 'guide'
}

function updateUrl(view: AtlasView, node: string | null) {
  const url = new URL(window.location.href)
  url.searchParams.set('view', view)
  if (node) url.searchParams.set('node', node)
  else url.searchParams.delete('node')
  window.history.pushState({}, '', url)
}

function focusAtlasMain(preferHeading = false) {
  const main = document.getElementById('atlas-main')
  if (!main) return
  const target = preferHeading ? main.querySelector<HTMLElement>('h1') || main : main
  target.tabIndex = -1
  target.focus({ preventScroll: true })
}

export function App() {
  const [atlas, setAtlas] = useState<InitialAtlas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setViewState] = useState<AtlasView>(initialView)
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('node'))
  const [selectedSymbol, setSelectedSymbol] = useState<SearchRecord | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [navigationEpoch, setNavigationEpoch] = useState(0)
  const [routeAnnouncement, setRouteAnnouncement] = useState('')
  const hasOpenedAtlas = useRef(false)
  const overlayOpen = paletteOpen || qualityOpen
  useEffect(() => { loadInitialAtlas().then(setAtlas).catch(reason => setError(String(reason.message || reason))) }, [])
  useEffect(() => {
    const skipLink = document.querySelector<HTMLAnchorElement>('body > .skip-link')
    if (!skipLink) return
    const focusTarget = () => focusAtlasMain()
    skipLink.addEventListener('click', focusTarget)
    return () => skipLink.removeEventListener('click', focusTarget)
  }, [])
  useEffect(() => {
    const skipLink = document.querySelector<HTMLElement>('body > .skip-link')
    if (!skipLink) return
    skipLink.toggleAttribute('inert', overlayOpen)
    return () => skipLink.removeAttribute('inert')
  }, [overlayOpen])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' || event.key === '/') {
        if ((event.target as HTMLElement)?.tagName === 'INPUT') return
        event.preventDefault(); setPaletteOpen(true)
      }
      if (event.key === 'Escape') { setPaletteOpen(false); setQualityOpen(false) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  useEffect(() => {
    if (!atlas) return
    const label = NAV.find(item => item.id === view)?.label || 'Atlas'
    document.title = `${label} · ARC / CLIDE repository atlas`
    if (hasOpenedAtlas.current) {
      setRouteAnnouncement(`Showing ${label} view.`)
      window.requestAnimationFrame(() => focusAtlasMain(true))
    } else {
      hasOpenedAtlas.current = true
    }
  }, [atlas, navigationEpoch, view])
  const setView = (next: AtlasView) => { setViewState(next); updateUrl(next, selectedId); setNavigationEpoch(value => value + 1) }
  const selectNode = (id: string) => { setSelectedId(id); setSelectedSymbol(null); updateUrl(view, id) }
  const selectSymbol = (record: SearchRecord) => { setSelectedSymbol(record); setSelectedId(record.id); setViewState('explorer'); updateUrl('explorer', record.id); setNavigationEpoch(value => value + 1) }
  const currentOrgan = useMemo(() => atlas?.overview.nodes.find(node => node.id === selectedId && node.kind === 'organ'), [atlas, selectedId])

  if (error) return <main className="fatal-state" id="atlas-main"><p className="eyebrow">Fail closed</p><h1>The atlas could not open one exact snapshot.</h1><p>{error}</p></main>
  if (!atlas) return <main className="loading-state" id="atlas-main"><div className="loading-orbit" /><p className="eyebrow">Opening one content-addressed organism</p><h1>Building your orientation…</h1></main>
  return <>
  <div className="app-shell" inert={overlayOpen}>
    <header className="global-header">
      <button className="brand" onClick={() => setView('guide')} type="button"><span className="brand-mark">A</span><span><strong>ARC / CLIDE</strong><small>repository atlas</small></span></button>
      <nav aria-label="Primary atlas views">{NAV.map(item => <button aria-current={view === item.id ? 'page' : undefined} key={item.id} onClick={() => setView(item.id)} type="button">{item.label}</button>)}</nav>
      <button className="search-trigger" onClick={() => setPaletteOpen(true)} type="button"><span>⌕</span><span>Search the whole atlas</span><kbd>⌘ K</kbd></button>
      <QualityBadge quality={atlas.quality} onOpen={() => setQualityOpen(true)} />
    </header>
    {view === 'guide' && <GuidedStart atlas={atlas} onExplore={() => setView('explorer')} onStartJourney={() => setView('journeys')} />}
    {view === 'explorer' && <Explorer atlas={atlas} selectedId={selectedId} selectedSymbol={selectedSymbol} onSelect={selectNode} onSelectSymbol={selectSymbol} />}
    {view === 'journeys' && <JourneyView atlas={atlas} onSelectOrgan={id => { setSelectedId(id); setSelectedSymbol(null); setViewState('explorer'); updateUrl('explorer', id); setNavigationEpoch(value => value + 1) }} />}
    {view === 'knowledge' && <KnowledgeView atlas={atlas} />}
    {view === 'evidence' && <EvidenceView atlas={atlas} />}
    {view === 'governance' && <GovernanceView atlas={atlas} />}
    {view === 'transcript' && <TranscriptView atlas={atlas} />}
    {view === 'scope' && <ScopeView atlas={atlas} />}
    <footer className="global-footer"><span><i className="footer-dot" /> snapshot {atlas.manifest.snapshotSha256.slice(0, 12)}</span><span>{currentOrgan ? `focused: ${currentOrgan.label}` : selectedSymbol ? `focused: ${selectedSymbol.name}` : 'no entity selected'}</span><span>{atlas.overview.denominators.nodes.toLocaleString()} overview nodes · exact detail lazy</span><span>read-only derived projection</span></footer>
  </div>
  <p className="sr-only" aria-atomic="true" aria-live="polite">{routeAnnouncement}</p>
  <SearchPalette open={paletteOpen} manifest={atlas.manifest} onClose={() => setPaletteOpen(false)} onSelect={selectSymbol} />
  {qualityOpen && <QualitySheet quality={atlas.quality} onClose={() => setQualityOpen(false)} />}
  </>
}
