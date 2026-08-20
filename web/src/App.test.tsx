import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const uiManifest = {
  schemaVersion: 'arc-atlas-ui-projection-v3',
  authority: 'read-only-derived-projection',
  snapshotSha256: 'a'.repeat(64),
  loading: {
    initial: ['data/ui/overview.json', 'data/ui/journeys.json', 'data/ui/quality.json'],
    initialBytes: 2048,
    lazySearch: null,
    lazyGovernance: 'data/ui/governance.json',
    lazyTranscript: 'data/ui/transcript/manifest.json',
    lazyScope: 'data/ui/scope/manifest.json',
  },
  shards: { entities: {}, relations: {} },
  navigation: {
    schemaVersion: 'arc-atlas-navigation-index-v1', authority: 'non-authoritative-deterministic-navigation-index', querySchemaVersion: 'arc-atlas-navigation-query-v1',
    artifact: { path: 'data/navigation.sqlite', bytes: 1, sha256: 'n'.repeat(64), contentEncoding: null, decodedBytes: 1, decodedSha256: 'n'.repeat(64), mediaType: 'application/vnd.sqlite3' },
    bindings: { snapshotSha256: 'a'.repeat(64), symbolSequenceSha256: 'b'.repeat(64), symbolSequenceCount: 1, relationshipCorpusSha256: 'c'.repeat(64), componentSetSha256: 'd'.repeat(64) },
    denominators: { symbols: 1, symbolShards: 1, relationshipShards: 1, exactAdjacency: 1, advisoryAdjacency: 0 }, searchSemantics: 'deterministic lexical',
  },
  counts: { overviewNodes: 4, overviewEdges: 3, searchableSymbols: 1 },
}

const overview = {
  schemaVersion: 'arc-atlas-ui-overview-v1',
  authority: 'read-only-derived-projection',
  snapshotSha256: 'a'.repeat(64),
  nodes: [
    { id: 'repository:root', kind: 'repository', label: 'ARC / CLIDE', position: { x: 0, y: 0, z: 0 }, status: 'derived-snapshot-root' },
    { id: 'organ:protected-intent', kind: 'organ', label: 'Protected intent', summary: 'Preserves what the user actually asked for.', position: { x: 8, y: 0, z: 0 }, status: 'source-addressed-curated' },
    { id: 'file:one', kind: 'file', label: 'task-runtime.mjs', path: 'scripts/task-runtime.mjs', language: 'JavaScript', primaryOrganId: 'protected-intent', organIds: ['protected-intent'], position: { x: 10, y: 2, z: 0 }, status: 'classified' },
    { id: 'file:two', kind: 'file', label: 'CODEX.md', path: 'CODEX.md', language: 'Markdown', primaryOrganId: 'protected-intent', organIds: ['protected-intent'], position: { x: 9, y: -2, z: 0 }, status: 'classified' },
  ],
  edges: [
    { id: 'e1', source: 'repository:root', target: 'organ:protected-intent', kind: 'contains-organ', count: 1 },
    { id: 'e2', source: 'organ:protected-intent', target: 'file:one', kind: 'contains-file', count: 1 },
    { id: 'e3', source: 'organ:protected-intent', target: 'file:two', kind: 'contains-file', count: 1 },
  ],
  denominators: { nodes: 4, edges: 3, files: 2, organs: 1 },
}

const journeys = {
  schemaVersion: 'arc-atlas-ui-journeys-v1',
  authority: 'curated-source-addressed-derived-projection',
  snapshotSha256: 'a'.repeat(64),
  journeys: [{
    id: 'repository-understanding',
    name: 'Repository understanding and continuation',
    summary: 'Learn the system from the request to verified continuation.',
    sourceRefs: [{ path: 'CODEX.md', line: 1 }],
    steps: [
      { id: 'orient', name: 'Meet the mission', explanation: 'Start with what the human wants.', organIds: ['protected-intent'] },
      { id: 'trace', name: 'Trace one task', explanation: 'Follow one request end to end.', organIds: ['protected-intent'] },
    ],
  }],
  pitfalls: [{ id: 'intent-drift', name: 'Intent drift', summary: 'The system slowly stops solving the original request.' }],
  constitutionalKernels: [],
  graphFacets: [],
  membranes: [],
  proofLadder: ['exists', 'reachable', 'default-live', 'observed', 'causal', 'product-proven'],
  lenses: [],
}

const quality = {
  schemaVersion: 'arc-atlas-ui-quality-v1',
  authority: 'read-only-derived-projection',
  snapshotSha256: 'a'.repeat(64),
  gates: {
    fileDenominator: { status: 'pass', reason: 'every-visible-entry-accounted' },
    semanticPurpose: { status: 'fail', reason: 'symbols-require-source-addressed-purpose-review' },
  },
  counts: { files: 2, symbols: 1, relations: 0, ignored: 1, ignoredReviewRequired: 1, transcriptMessages: 4, transcriptDecisionReviewPending: 2 },
}

const search = {
  schemaVersion: 'arc-atlas-navigation-search-result-v1',
  authority: 'non-authoritative-navigation-candidates-canonical-detail-required',
  snapshotSha256: 'a'.repeat(64),
  query: 'advanceTask', total: 1, offset: 0, limit: 30,
  records: [{ id: `symbol:${'a'.repeat(64)}`, bucket: 'aa', name: 'advanceTask', qualifiedName: 'scripts/task-runtime.mjs#advanceTask@1:1', path: 'scripts/task-runtime.mjs', kind: 'function', language: 'JavaScript', signature: 'function advanceTask()', purposeStatus: 'review-required', primaryOrganId: 'protected-intent' }],
}
const pagedSearchRecords = Array.from({ length: 31 }, (_, index) => ({ ...search.records[0], id: `symbol:paged-${index + 1}`, name: `pagedSymbol${index + 1}`, qualifiedName: `scripts/task-runtime.mjs#pagedSymbol${index + 1}@1:1` }))
const legacyManifest = { ...uiManifest, schemaVersion: 'arc-atlas-ui-projection-v1', loading: { ...uiManifest.loading, lazySearch: 'data/ui/search-index.json' } }
let activeManifest: typeof uiManifest | typeof legacyManifest = uiManifest
let legacySearchGetRequests = 0

const exactSource = 'export function advanceTask() { return 1 }\n'
const exactSourceSha256 = createHash('sha256').update(exactSource).digest('hex')
const navigationSymbol = {
  schemaVersion: 'arc-atlas-navigation-symbol-result-v1', authority: 'digest-verified-canonical-symbol-record', snapshotSha256: 'a'.repeat(64),
  symbol: {
    ...search.records[0], start: { line: 1, column: 1 }, end: { line: 1, column: 43 }, bodySha256: createHash('sha256').update(exactSource.trim()).digest('hex'), exported: true,
    purpose: { status: 'review-required', summary: null, provenance: 'none', authority: 'none' }, declaration: { callable: true, syntaxKind: 'FunctionDeclaration' }, derivation: { adapter: 'typescript-ast', confidence: 'exact-syntax' },
    structuralExplanation: { status: 'exact-parser-derived', summary: 'A callable function declaration named advanceTask.', authority: 'exact-syntax', resolutionCeiling: 'syntax' },
    operationalBehavior: { status: 'exact-parser-derived', plainLanguage: 'The parser observed one return inside this exact declaration.', authority: 'exact-syntax', resolutionCeiling: 'syntax-only', declaredInputs: [], eventCounts: { call: 0, construct: 0, branch: 0, loop: 0, return: 1, throw: 0, mutation: 0 }, events: [{ kind: 'return' }] },
  },
  source: { fileSha256: exactSourceSha256, blobPath: `source/blobs/${exactSourceSha256}`, start: { line: 1, column: 1 }, end: { line: 1, column: 43 }, bodySha256: createHash('sha256').update(exactSource.trim()).digest('hex') },
  component: { id: 'component:task-runtime', fileId: 'file:one', path: 'scripts/task-runtime.mjs', primaryOrganId: 'protected-intent', organIds: ['protected-intent'], authority: 'source-addressed-review' },
}
const navigationRelations = { schemaVersion: 'arc-atlas-navigation-relations-result-v1', authority: 'digest-verified-canonical-relationship-records', snapshotSha256: 'a'.repeat(64), symbolId: search.records[0].id, records: [], denominator: { total: 0, exact: 0, advisory: 0, offset: 0, limit: 1000 } }

const governance = {
  schemaVersion: 'arc-atlas-ui-governance-v1', authority: 'source-addressed-governance-derived-projection', snapshotSha256: 'a'.repeat(64), governanceSha256: 'g'.repeat(64),
  denominators: { documents: { visible: 2, classified: 1, unclassified: 1 } },
  gates: { documentClassification: { status: 'fail', reason: 'visible-documents-remain-unclassified' } },
  teaching: { status: 'review-required', rule: 'A content hash proves bytes, not meaning.' },
  documents: [{ id: 'document:one', path: 'CODEX.md', sha256: 'c'.repeat(64), bytes: 200, classification: 'registered-canonical-document', headings: [{ level: 1, text: 'Mission', line: 1 }], canonical: { role: 'stable read order', authority: 'normative only', owner: 'canon', freshness: 'on change' }, teaching: { status: 'review-required', plainLanguage: null, sourceRefs: [] } }],
  intentNodes: [{ id: 'ARC', atlasId: 'intent:ARC', parentId: null, type: 'mission', protected: true, statement: 'Build the whole evidence-governed system.', source: 'owner-objective', teaching: { status: 'source-authored-statement-only' } }],
  findings: [{ findingId: 'F-1', atlasId: 'finding:F-1', claim: 'A fact was measured.', impact: 'The plan changed.', evidenceStatus: 'measured', path: 'docs/canon/findings/F-1.json', sha256: 'f'.repeat(64) }],
  authorityEvents: [{ eventId: 'A-1', atlasId: 'authority-event:A-1', authorizedBy: 'owner', changes: [{ nodeId: 'ARC', before: 'old', after: 'new', rationale: 'owner correction' }] }], relations: [],
}

const transcriptManifest = {
  schemaVersion: 'arc-atlas-ui-transcript-manifest-v1', authority: 'verbatim-visible-history-derived-projection', snapshotSha256: 'a'.repeat(64), transcriptSha256: 't'.repeat(64), source: {},
  coverage: { messages: 1, userMessages: 1, assistantMessages: 0, reviewedDecisionMessages: 0, decisionReviewPending: 1 }, pageSize: 100,
  pages: [{ page: 0, path: 'data/ui/transcript/pages/0000.json', count: 1, startIndex: 0, endIndex: 0, firstMessageId: 'u1', lastMessageId: 'u1' }],
}
const transcriptPage = { schemaVersion: 'arc-atlas-ui-transcript-page-v1', authority: transcriptManifest.authority, snapshotSha256: 'a'.repeat(64), transcriptSha256: 't'.repeat(64), page: 0, messages: [{ id: 'u1', role: 'user', turnId: 'turn-1', phase: 'user-direction', timestamp: null, text: 'Everything must be understandable.', textSha256: 'u'.repeat(64), source: { path: '/rollout.jsonl', line: 42, recordSha256: 'r'.repeat(64) }, authority: 'verbatim-owner-message-below-current-owner-direction-and-canon-adjudication' }] }
const scopeManifest = { schemaVersion: 'arc-atlas-ui-scope-manifest-v1', authority: 'read-only-derived-projection', snapshotSha256: 'a'.repeat(64), scopeSha256: 's'.repeat(64), ignored: { total: 1, codeLike: 1, policyReviewed: 0, reviewRequired: 1 }, safety: { ignoredContentRead: false, statement: 'Ignored content was not read.' }, groups: [{ id: 'node', topLevel: 'node_modules', count: 1, codeLike: 1, reviewRequired: 1, bytes: 100, pages: [{ page: 0, path: 'data/ui/scope/groups/node/0000.json', count: 1, startIndex: 0, endIndex: 0 }] }] }
const scopePage = { schemaVersion: 'arc-atlas-ui-scope-group-page-v1', authority: scopeManifest.authority, snapshotSha256: 'a'.repeat(64), scopeSha256: 's'.repeat(64), topLevel: 'node_modules', page: 0, entries: [{ id: 'ignored:1', path: 'node_modules/pkg/index.js', fileClass: 'regular', bytes: 100, codeLike: true, contentRead: false, ignoreRule: { sourcePath: '.gitignore', line: 1, pattern: 'node_modules/' }, policy: { status: 'review-required', classification: null, rationale: null, sourceRefs: [] } }] }

function response(value: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(value) } as Response)
}

function byteResponse(value: string) {
  const bytes = new TextEncoder().encode(value)
  return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(bytes.buffer) } as Response)
}

function headResponse(bytes: number) {
  return Promise.resolve({ ok: true, headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? String(bytes) : null } } as Response)
}

describe('repository atlas workbench', () => {
  beforeEach(() => {
    activeManifest = uiManifest
    legacySearchGetRequests = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/data/ui/manifest.json')) return response(activeManifest)
      if (url.endsWith('/data/ui/overview.json')) return response(overview)
      if (url.endsWith('/data/ui/journeys.json')) return response(journeys)
      if (url.endsWith('/data/ui/quality.json')) return response(quality)
      if (url.includes('/__atlas/api/search?')) {
        const parameters = new URL(url, window.location.href).searchParams
        if (parameters.get('q') === 'paged') {
          const offset = Number(parameters.get('offset') || 0)
          return response({ ...search, query: 'paged', total: pagedSearchRecords.length, offset, limit: 30, records: pagedSearchRecords.slice(offset, offset + 30) })
        }
        return response(search)
      }
      if (url.endsWith('/data/ui/search-index.json')) {
        if (init?.method === 'HEAD') return headResponse(177 * 1024 * 1024)
        legacySearchGetRequests += 1
        throw new Error('The giant legacy search index must never be downloaded')
      }
      if (url.includes('/__atlas/api/symbol?')) return response(navigationSymbol)
      if (url.includes('/__atlas/api/relations?')) return response(navigationRelations)
      if (url.endsWith(`/source/blobs/${exactSourceSha256}`)) return byteResponse(exactSource)
      if (url.endsWith('/data/ui/governance.json')) return response(governance)
      if (url.endsWith('/data/ui/transcript/manifest.json')) return response(transcriptManifest)
      if (url.endsWith('/data/ui/transcript/pages/0000.json')) return response(transcriptPage)
      if (url.endsWith('/data/ui/scope/manifest.json')) return response(scopeManifest)
      if (url.endsWith('/data/ui/scope/groups/node/0000.json')) return response(scopePage)
      throw new Error(`Unexpected fetch ${url}`)
    }))
    window.history.replaceState({}, '', '/')
    document.documentElement.lang = 'en'
    document.body.insertAdjacentHTML('afterbegin', '<a class="skip-link" href="#atlas-main">Skip to the atlas</a>')
  })

  afterEach(() => {
    document.querySelector('body > .skip-link')?.remove()
    vi.unstubAllGlobals()
  })

  it('starts with a novice-safe tour and exposes the incomplete evidence boundary', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: /understand the whole engineering organism/i })).toBeInTheDocument()
    expect(screen.getByText(/built incomplete/i)).toBeInTheDocument()
    expect(screen.getByText(/Meet the mission/i)).toBeInTheDocument()
    expect(screen.getByText(/symbols require source addressed purpose review/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Implements advance task')
  })

  it('has no axe-detected structural accessibility violations on the first-run view', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: /understand the whole engineering organism/i })

    const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations).toEqual([])
  })

  it('keeps both dialogs free of axe-detected structural accessibility violations', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /understand the whole engineering organism/i })

    await user.click(screen.getByRole('button', { name: /search the whole atlas/i }))
    expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: /open snapshot evidence/i }))
    expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([])
  })

  it('keeps explorer, search, URL, and evidence inspector on one selection', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /understand the whole engineering organism/i })
    await user.click(screen.getByRole('button', { name: /explore freely/i }))

    expect(screen.getByRole('heading', { name: /explorer workbench/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/3D organism orientation/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/exact neighborhood/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const searchBox = await screen.findByRole('searchbox', { name: /search the atlas/i })
    await user.type(searchBox, 'advanceTask')
    await waitFor(() => expect(screen.getByRole('button', { name: /advanceTask/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /advanceTask/i }))

    expect(screen.getByRole('heading', { name: 'advanceTask' })).toBeInTheDocument()
    expect(screen.getByText(/purpose review required/i)).toBeInTheDocument()
    expect(await screen.findByText(/parser observed one return/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('search-index.json'), expect.anything())
    expect(window.location.search).toContain('node=symbol%3A')
  })

  it('gives keyboard users a real skip target, native search controls, and a focus-safe evidence dialog', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /understand the whole engineering organism/i })

    await user.click(screen.getByText(/why this path is in the atlas/i))
    expect(screen.getByText('CODEX.md:1')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /skip to the atlas/i }))
    expect(document.activeElement).toBe(screen.getByRole('main'))

    await user.click(screen.getByRole('button', { name: /search the whole atlas/i }))
    expect(await screen.findByRole('dialog', { name: /atlas search/i })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(document.querySelector('.app-shell')).toHaveAttribute('inert')

    const searchBox = screen.getByRole('searchbox', { name: /search the atlas/i })
    await user.type(searchBox, 'advanceTask')
    await waitFor(() => expect(screen.getByRole('button', { name: /advanceTask/i })).toBeInTheDocument())
    await user.keyboard('{ArrowDown}{Enter}')

    const explorerHeading = await screen.findByRole('heading', { name: /explorer workbench/i })
    await waitFor(() => expect(document.activeElement).toBe(explorerHeading))

    const qualityTrigger = screen.getByRole('button', { name: /open snapshot evidence/i })
    await user.click(qualityTrigger)
    expect(await screen.findByRole('dialog', { name: /snapshot evidence/i })).toBeInTheDocument()
    const closeButton = screen.getByRole('button', { name: /close snapshot evidence/i })
    await waitFor(() => expect(document.activeElement).toBe(closeButton))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(qualityTrigger))
  })

  it('shows a bounded server-search denominator and loads the next server page', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /understand the whole engineering organism/i })
    await user.click(screen.getByRole('button', { name: /search the whole atlas/i }))
    await user.type(await screen.findByRole('searchbox', { name: /search the atlas/i }), 'paged')

    await waitFor(() => expect(screen.getAllByText(/showing 1–30 of 31 exact lexical matches.*offset 0/i).length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: /load 1 more results/i }))
    await waitFor(() => expect(screen.getAllByText(/showing 1–31 of 31 exact lexical matches.*offset 30/i).length).toBeGreaterThan(0))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('offset=30'), expect.anything())
  })

  it('fails closed before downloading an oversized legacy client-search index', async () => {
    activeManifest = legacyManifest
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /understand the whole engineering organism/i })
    await user.click(screen.getByRole('button', { name: /search the whole atlas/i }))
    await user.type(await screen.findByRole('searchbox', { name: /search the atlas/i }), 'advanceTask')

    expect((await screen.findAllByText(/legacy search stays unavailable/i)).length).toBeGreaterThan(0)
    expect(legacySearchGetRequests).toBe(0)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/data/ui/search-index.json'), expect.objectContaining({ method: 'HEAD' }))
  })

  it('opens exact governance, chat, and ignored-scope ledgers without treating bytes as meaning', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: /understand the whole engineering organism/i })

    await user.click(screen.getByRole('button', { name: 'Decisions' }))
    expect(await screen.findByRole('heading', { name: /why the system is shaped this way/i })).toBeInTheDocument()
    expect(screen.getByText(/content hash proves bytes, not meaning/i)).toBeInTheDocument()
    expect(screen.getByText(/build the whole evidence-governed system/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Chat' }))
    expect(await screen.findByRole('heading', { name: /conversation and clarification history/i })).toBeInTheDocument()
    expect(await screen.findByText('Everything must be understandable.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Scope' }))
    expect(await screen.findByRole('heading', { name: /repository scope ledger/i })).toBeInTheDocument()
    expect(await screen.findByText('node_modules/pkg/index.js')).toBeInTheDocument()
    expect(screen.getByText(/ignored content was not read/i)).toBeInTheDocument()
  })
})
