#!/usr/bin/env node

// PROTOTYPE — three read-only infinite-canvas variants of the same measured ARC/CLIDE graph.
// A = system planes, B = causal river, C = complete module universe. Switch with ?variant=A|B|C.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = '/home/raed/.agentic-os'
const outDir = path.dirname(fileURLToPath(import.meta.url))
const atlasPath = path.join(outDir, 'arc-clide-complete-system-atlas-v2.data.json')
const atlas = JSON.parse(readFileSync(atlasPath, 'utf8'))
const levers = JSON.parse(execFileSync('node', ['scripts/verify/lever-liveness-map.mjs', '--json'], {
  cwd: repo,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
}))
const { DOMAIN_CATEGORIES } = await import(pathToFileURL(path.join(repo, 'scripts/onboarding/domain-registry.mjs')).href)

const nodes = []
const edges = []
const nodeIds = new Set()
const edgeIds = new Set()

function addNode(node) {
  if (nodeIds.has(node.id)) return
  nodeIds.add(node.id)
  nodes.push(node)
}

function addEdge(source, target, kind = 'flow', label = '') {
  if (!nodeIds.has(source) || !nodeIds.has(target)) return
  const key = `${source}\u0000${target}\u0000${kind}\u0000${label}`
  if (edgeIds.has(key)) return
  edgeIds.add(key)
  edges.push({ id: `edge:${edges.length + 1}`, source, target, kind, label })
}

const planeByArch = new Map()
for (const [planeIndex, cluster] of atlas.clusters.entries()) {
  for (const [order, item] of cluster.nodes.entries()) {
    const id = `arch:${item.id}`
    planeByArch.set(item.id, cluster.id)
    addNode({
      id,
      label: item.name,
      kind: 'architecture',
      category: 'architecture',
      plane: cluster.id,
      planeLabel: cluster.label,
      planeIndex,
      order,
      status: item.status,
      iface: item.iface,
      detail: item.detail,
      modules: item.modules,
      searchable: `${item.name} ${item.iface} ${item.detail} ${item.modules.join(' ')}`.toLowerCase(),
    })
  }
}

for (const edge of atlas.edges) {
  addEdge(`arch:${edge.from}`, `arch:${edge.to}`, edge.kind || 'flow', edge.label || '')
}

const partitionByPath = new Map()
for (const [partition, paths] of Object.entries(atlas.moduleCensus.partition)) {
  for (const relative of paths) partitionByPath.set(relative, partition)
}

let rustPaths = []
try {
  rustPaths = execFileSync('rg', ['--files', 'apps/arc-tui/src'], { cwd: repo, encoding: 'utf8' })
    .trim().split('\n').filter(value => value.endsWith('.rs'))
} catch {}

const sourcePaths = [...new Set([
  ...Object.values(atlas.moduleCensus.partition).flat(),
  ...atlas.referencedModules,
  ...rustPaths,
])].sort()

const archParentsByModule = new Map()
for (const cluster of atlas.clusters) {
  for (const item of cluster.nodes) {
    for (const relative of item.modules) {
      if (!archParentsByModule.has(relative)) archParentsByModule.set(relative, [])
      archParentsByModule.get(relative).push(`arch:${item.id}`)
    }
  }
}

function inferPlane(relative) {
  const lower = relative.toLowerCase()
  if (lower.includes('event-kernel') || lower.includes('task-runtime') || lower.includes('contract') || lower.includes('artifact-store') || lower.includes('receipt')) return 'authority'
  if (lower.includes('intent') || lower.includes('semantic') || lower.includes('objective') || lower.includes('obligation')) return 'normative'
  if (lower.includes('graph-control') || lower.includes('decision') || lower.includes('epistemic') || lower.includes('adaptive') || lower.includes('branch')) return 'belief_control'
  if (lower.includes('context') || lower.includes('retriev') || lower.includes('repo-graph') || lower.includes('index') || lower.includes('embedding')) return 'context'
  if (lower.includes('model') || lower.includes('specialist') || lower.includes('provider') || lower.includes('sandbox') || lower.includes('tool') || lower.includes('mcp')) return 'routing_tools'
  if (lower.includes('candidate') || lower.includes('workspace') || lower.includes('author')) return 'candidates'
  if (lower.includes('oracle') || lower.includes('verifier') || lower.includes('mutation') || lower.includes('patch-safety')) return 'oracle_verifier'
  if (lower.includes('effect') || lower.includes('completion') || lower.includes('terminal-bridge')) return 'effect_completion'
  if (lower.includes('memory') || lower.includes('consolidat') || lower.includes('plastic')) return 'memory_learning'
  if (lower.includes('tui') || lower.includes('daemon') || lower.includes('onboarding') || lower.includes('install') || lower.includes('observ')) return 'product_ops'
  if (lower.includes('research') || lower.includes('domain') || lower.includes('coding') || lower.includes('patch')) return 'work'
  return 'work'
}

function fileCategory(relative) {
  if (partitionByPath.has(relative)) return partitionByPath.get(relative)
  if (relative.endsWith('.rs')) return 'rust'
  return 'referenced'
}

for (const [order, relative] of sourcePaths.entries()) {
  const absolute = path.join(repo, relative)
  const exists = existsSync(absolute)
  const category = fileCategory(relative)
  const parents = archParentsByModule.get(relative) || []
  let bytes = null
  if (exists) {
    try { bytes = statSync(absolute).size } catch {}
  }
  addNode({
    id: `file:${relative}`,
    label: path.basename(relative),
    kind: 'file',
    category,
    plane: parents.length ? planeByArch.get(parents[0].slice(5)) : inferPlane(relative),
    status: category === 'live' ? 'live' : category === 'deepResearch' ? 'substrate' : category === 'orphan' ? 'orphan' : 'support',
    path: relative,
    absolutePath: absolute,
    exists,
    bytes,
    referencedBy: parents,
    order,
    searchable: `${relative} ${category}`.toLowerCase(),
  })
}

for (const [relative, parents] of archParentsByModule.entries()) {
  for (const parent of parents) addEdge(parent, `file:${relative}`, 'implements', 'implemented by')
}

const knownPaths = new Set(sourcePaths)
function resolveRelativeImport(fromRelative, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelative), specifier))
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, `${base}.json`, `${base}/index.mjs`, `${base}/index.js`]
  return candidates.find(candidate => knownPaths.has(candidate)) || null
}

const importPattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g
for (const relative of sourcePaths) {
  if (!/\.(?:mjs|js|cjs)$/.test(relative)) continue
  const absolute = path.join(repo, relative)
  if (!existsSync(absolute)) continue
  let source = ''
  try {
    if (statSync(absolute).size > 4 * 1024 * 1024) continue
    source = readFileSync(absolute, 'utf8')
  } catch { continue }
  for (const match of source.matchAll(importPattern)) {
    const target = resolveRelativeImport(relative, match[1])
    if (target) addEdge(`file:${relative}`, `file:${target}`, 'imports', '')
  }
}

for (const relative of rustPaths) {
  const absolute = path.join(repo, relative)
  let source = ''
  try { source = readFileSync(absolute, 'utf8') } catch { continue }
  for (const match of source.matchAll(/\bmod\s+([A-Za-z0-9_]+)\s*;/g)) {
    const stem = match[1]
    const dir = path.posix.dirname(relative)
    const candidates = [`${dir}/${stem}.rs`, `${dir}/${stem}/mod.rs`]
    const target = candidates.find(candidate => knownPaths.has(candidate))
    if (target) addEdge(`file:${relative}`, `file:${target}`, 'rust-module', 'mod')
  }
}

for (const [order, eventType] of atlas.taskEventTypes.entries()) {
  const id = `event:${eventType}`
  addNode({
    id,
    label: eventType,
    kind: 'event',
    category: 'event',
    plane: 'authority',
    status: 'live',
    order,
    searchable: `taskevent ${eventType}`.toLowerCase(),
  })
  addEdge('arch:contracts', id, 'declares', 'TaskEvent V9')
  addEdge(id, 'arch:event_kernel', 'durable', 'append/replay')
}

const memoryAnchor = {
  'governed-memory': 'arch:governed_memory',
  'agent-memory': 'arch:agent_memory',
  'project-intent': 'arch:project_intent_memory',
  'semantic-cache': 'arch:semantic_cache',
  'vector-store': 'arch:vector_store',
  'research-memory': 'arch:research_memory',
  'letta-archival': 'arch:letta_archive',
}
for (const [order, store] of atlas.measuredState.memory.stores.entries()) {
  const id = `memory-store:${store.storeName}`
  addNode({
    id,
    label: store.storeName,
    kind: 'catalog',
    category: 'memory-store',
    plane: 'memory_learning',
    status: store.storeClass === 'authoritative' ? 'authority' : store.status === 'not-configured' ? 'substrate' : 'partial',
    order,
    detail: `${store.storeClass}; ${store.status}; active=${store.counts.active}; evidence-backed=${store.counts.evidenceBacked}`,
    data: store,
    searchable: `memory ${store.storeName} ${store.storeClass} ${store.status}`.toLowerCase(),
  })
  addEdge(memoryAnchor[store.storeName], id, 'catalog', 'physical store')
}

for (const [order, model] of atlas.measuredState.models.specialists.entries.entries()) {
  const id = `model:${model.id}`
  addNode({
    id,
    label: model.id,
    kind: 'catalog',
    category: 'model',
    plane: 'routing_tools',
    status: model.status === 'verified' ? 'live' : model.status === 'disabled' ? 'substrate' : 'partial',
    order,
    detail: `${model.status}; ${model.residency}; ${model.ollamaRef || 'no Ollama ref'}`,
    data: model,
    searchable: `model ${model.id} ${model.status} ${model.ollamaRef || ''}`.toLowerCase(),
  })
  addEdge('arch:specialists', id, 'catalog', 'specialist')
}

const domainIds = []
for (const category of DOMAIN_CATEGORIES) {
  for (const subdomain of category.subDomains) domainIds.push({ category, subdomain })
}
for (const [order, entry] of domainIds.entries()) {
  const id = `domain:${entry.category.id}:${entry.subdomain}`
  addNode({
    id,
    label: entry.subdomain,
    kind: 'catalog',
    category: 'domain',
    plane: 'work',
    status: ['physics', 'pure-mathematics', 'theoretical-computer-science'].includes(entry.subdomain) ? 'live' : 'partial',
    order,
    detail: `${entry.category.label}: ${entry.category.description}`,
    searchable: `domain ${entry.category.id} ${entry.subdomain} ${entry.category.label}`.toLowerCase(),
  })
  addEdge('arch:domain_routes', id, 'catalog', entry.category.id)
}

for (const [order, lever] of levers.rows.entries()) {
  const id = `lever:${lever.name}`
  addNode({
    id,
    label: lever.name,
    kind: 'lever',
    category: 'lever',
    plane: 'product_ops',
    status: lever.liveAtDefault ? 'live' : lever.consumed ? 'partial' : 'substrate',
    order,
    detail: `rung=${lever.rung}; consumed=${lever.consumed}; liveDefault=${lever.liveAtDefault}; executed=${lever.executed}`,
    data: lever,
    searchable: `lever ${lever.name} ${lever.site}`.toLowerCase(),
  })
  addEdge('arch:levers', id, 'catalog', `rung ${lever.rung}`)
  const targetMatch = lever.site.match(/(?:^|[\s(])([A-Za-z0-9_./-]+\.mjs)\b/)
  if (targetMatch) {
    const candidate = targetMatch[1].startsWith('scripts/') ? targetMatch[1] : `scripts/${targetMatch[1]}`
    if (knownPaths.has(candidate)) addEdge(id, `file:${candidate}`, 'configures', '')
  }
}

let modelArtifacts = []
try {
  modelArtifacts = execFileSync('find', ['-L', '/home/raed/.agentic-models', '-type', 'f'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .trim().split('\n').filter(Boolean).filter(value => /\.(?:gguf|safetensors|pth)$/i.test(value))
  modelArtifacts = [...new Set(modelArtifacts.map(value => {
    try { return realpathSync(value) } catch { return value }
  }))].filter(value => {
    try { return statSync(value).size >= 1024 * 1024 } catch { return false }
  })
} catch {}
for (const [order, absolute] of modelArtifacts.entries()) {
  let bytes = null
  try { bytes = statSync(absolute).size } catch {}
  const id = `model-artifact:${absolute}`
  addNode({
    id,
    label: path.basename(absolute),
    kind: 'catalog',
    category: 'model-artifact',
    plane: 'routing_tools',
    status: 'substrate',
    order,
    path: absolute,
    bytes,
    detail: bytes == null ? 'model weight artifact' : `${(bytes / 1073741824).toFixed(2)} GiB`,
    searchable: `model artifact ${absolute}`.toLowerCase(),
  })
  addEdge('arch:model_onboarding', id, 'catalog', 'artifact on disk')
}

const runtimeTemplate = [
  ['task', 'TaskInstance', 'arch:taskspec'],
  ['intent', 'IntentEpoch', 'arch:semantic_admission'],
  ['belief', 'BeliefSnapshot', 'arch:decision_state'],
  ['graph', 'GraphEpoch', 'arch:graph_program'],
  ['branch', 'WorkBranch', 'arch:branch_invocation'],
  ['observation', 'TypedObservation', 'arch:epistemic_graph'],
  ['candidate', 'CandidateInstance', 'arch:candidate_proposed'],
  ['oracle', 'OracleEvaluation', 'arch:oracle_evaluation'],
  ['effect', 'EffectTransaction', 'arch:effect_reservation'],
  ['completion', 'CompletionProposal', 'arch:task_completed'],
]
for (const [order, [key, label, anchor]] of runtimeTemplate.entries()) {
  const id = `runtime-template:${key}`
  addNode({ id, label, kind: 'runtime-template', category: 'runtime', plane: 'runtime', status: order < 7 ? 'partial' : 'blocked', order, detail: 'Materialized per live task; schema slot, not a pre-enumerated future task.', searchable: `runtime task graph ${label}`.toLowerCase() })
  addEdge(anchor, id, 'materializes', 'runtime instance slot')
  if (order) addEdge(`runtime-template:${runtimeTemplate[order - 1][0]}`, id, order >= 7 ? 'missing' : 'flow', '')
}

const payload = {
  schemaVersion: 'arc-clide-infinite-canvas-prototype-v1',
  generatedAt: new Date().toISOString(),
  repository: atlas.repository,
  prototype: {
    question: 'Can one navigable surface preserve the complete E2E system while supporting unbounded task-specific runtime graphs?',
    authority: 'none',
    persistence: 'none',
    variants: {
      A: 'System planes — architecture first, expand implementation on demand',
      B: 'Causal river — ingress-to-completion path and red launch corridor',
      C: 'Module universe — every measured module and supporting catalog at once',
    },
  },
  counts: {
    nodes: nodes.length,
    edges: edges.length,
    architecture: nodes.filter(node => node.kind === 'architecture').length,
    files: nodes.filter(node => node.kind === 'file').length,
    events: nodes.filter(node => node.kind === 'event').length,
    levers: nodes.filter(node => node.kind === 'lever').length,
    models: nodes.filter(node => node.category === 'model').length,
    modelArtifacts: nodes.filter(node => node.category === 'model-artifact').length,
    domains: nodes.filter(node => node.category === 'domain').length,
    memoryStores: nodes.filter(node => node.category === 'memory-store').length,
    runtimeTemplate: runtimeTemplate.length,
  },
  statuses: atlas.statuses,
  clusters: atlas.clusters.map(cluster => ({ id: cluster.id, label: cluster.label })),
  measuredState: {
    verdict: atlas.measuredState.verdict,
    truth: atlas.measuredState.truth,
    context: atlas.measuredState.context,
    moduleTotals: atlas.moduleCensus.totals,
    leverTotals: levers.totals,
    receiptSha256: atlas.measuredState.receiptSha256,
  },
  nodes,
  edges,
}

const dataJson = JSON.stringify(payload).replaceAll('</script', '<\\/script')
const template = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ARC / CLIDE Infinite System Canvas — PROTOTYPE</title>
  <style>
    :root{color-scheme:dark;--bg:#080d18;--panel:rgba(12,19,34,.94);--line:#26344d;--text:#edf3ff;--muted:#91a2bc;--accent:#78dce8;--danger:#ff5c69;--purple:#d18cff;--green:#6be585;--amber:#ffc857;--blue:#5da9ff}
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text)}
    #stage{position:fixed;inset:0;width:100%;height:100%;touch-action:none;cursor:grab}#stage.dragging{cursor:grabbing}
    .panel{position:fixed;z-index:5;background:var(--panel);border:1px solid #27334a;box-shadow:0 18px 60px #0009;backdrop-filter:blur(15px)}
    #left{left:14px;top:14px;bottom:14px;width:310px;border-radius:18px;padding:16px;overflow:auto}
    #right{right:14px;top:14px;bottom:14px;width:330px;border-radius:18px;padding:16px;overflow:auto}
    .eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8ea0bd}.title{font-size:21px;line-height:1.08;font-weight:760;margin:7px 0 6px}.sub{font-size:12px;line-height:1.45;color:var(--muted)}
    .prototype{display:inline-flex;align-items:center;gap:7px;margin-top:10px;padding:5px 8px;border-radius:999px;background:#53252b;color:#ffbdc3;font-size:10px;font-weight:800;letter-spacing:.09em}.dot{width:7px;height:7px;border-radius:50%;background:#ff6672;box-shadow:0 0 12px #ff6672}
    input[type=search]{width:100%;margin:14px 0 8px;border:1px solid #34435e;border-radius:11px;background:#0a1120;padding:10px 11px;color:#fff;outline:none}input[type=search]:focus{border-color:#5da9ff;box-shadow:0 0 0 3px #5da9ff22}
    .row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.btn{border:1px solid #34435e;background:#121c2f;color:#dce7fa;border-radius:9px;padding:7px 9px;font-size:11px;cursor:pointer}.btn:hover{background:#1c2a43;border-color:#577095}.btn.primary{background:#163c48;border-color:#2f8697;color:#c9f8ff}.btn.danger{background:#3b1e25;border-color:#803440;color:#ffc6cb}
    .section{margin-top:15px;padding-top:13px;border-top:1px solid #26334a}.section h3{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#9fb0ca}.toggle{display:flex;align-items:center;gap:8px;font-size:12px;color:#c9d5e8;margin:7px 0}.toggle input{accent-color:#5da9ff}.swatch{width:9px;height:9px;border-radius:3px;flex:none}
    .stats{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}.stat{background:#0c1424;border:1px solid #243149;border-radius:10px;padding:9px}.stat b{display:block;font-size:16px}.stat span{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.09em}
    #variantName{font-size:12px;color:#d5e2f5;margin-top:7px}.law{margin-top:11px;padding:10px;border-left:3px solid #d18cff;background:#171426;color:#cfc4e5;font-size:11px;line-height:1.45}
    #inspectorEmpty{color:var(--muted);font-size:12px;line-height:1.55}.nodeTitle{font-size:18px;font-weight:750;line-height:1.15;margin:5px 0}.pill{display:inline-block;font-size:9px;text-transform:uppercase;letter-spacing:.08em;border:1px solid #3b4a66;border-radius:999px;padding:4px 7px;margin:3px 4px 3px 0}.field{margin:11px 0}.field label{display:block;color:#8295b1;font-size:9px;text-transform:uppercase;letter-spacing:.11em;margin-bottom:4px}.field div,.field pre{font-size:11px;line-height:1.45;color:#dce7f8;white-space:pre-wrap;word-break:break-word;margin:0}.sourceLink{color:#8fdcff;text-decoration:none}.sourceLink:hover{text-decoration:underline}
    .neighbor{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #243149;background:transparent;color:#cbd8ec;padding:7px 2px;cursor:pointer;font-size:10px}.neighbor:hover{color:#fff;background:#172139}
    #switcher{position:fixed;z-index:8;left:50%;bottom:18px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;border:1px solid #40506b;border-radius:999px;background:#0d1627ee;padding:7px 10px;box-shadow:0 12px 45px #000a}.switchArrow{width:32px;height:30px;border-radius:999px;border:1px solid #364661;background:#172238;color:#fff;cursor:pointer}.switchLabel{min-width:235px;text-align:center;font-size:11px}.switchLabel b{color:#8ee8f2}
    #hint{position:fixed;z-index:3;left:340px;top:17px;padding:8px 11px;border-radius:10px;background:#0c1424cc;border:1px solid #293750;color:#a9b8cf;font-size:10px;pointer-events:none}
    @media(max-width:900px){#left{width:250px}#right{display:none}#hint{left:280px}.switchLabel{min-width:155px}}
  </style>
</head>
<body>
  <canvas id="stage"></canvas>
  <aside id="left" class="panel">
    <div class="eyebrow">Complete E2E system explorer</div>
    <div class="title">ARC / CLIDE<br>Infinite Canvas</div>
    <div class="sub">Every measured architecture organ, module, event, lever, memory store, model and domain route—plus runtime slots for graphs that do not exist until a task creates them.</div>
    <div class="prototype"><span class="dot"></span>PROTOTYPE · READ ONLY · AUTHORITY NONE</div>
    <input id="search" type="search" placeholder="Search component, module, event, model…">
    <div class="row"><button class="btn primary" id="findBtn">Find</button><button class="btn" id="fitBtn">Fit visible</button><button class="btn" id="allBtn">Reveal everything</button></div>
    <div id="variantName"></div>
    <div class="stats"><div class="stat"><b id="visibleNodes">0</b><span>visible nodes</span></div><div class="stat"><b id="visibleEdges">0</b><span>visible edges</span></div><div class="stat"><b>__NODE_COUNT__</b><span>measured nodes</span></div><div class="stat"><b>__EDGE_COUNT__</b><span>measured edges</span></div></div>
    <div class="section"><h3>Layers</h3>
      <label class="toggle"><input id="showLive" type="checkbox"><span class="swatch" style="background:#6be585"></span>Live implementation modules</label>
      <label class="toggle"><input id="showProof" type="checkbox"><span class="swatch" style="background:#4dd0e1"></span>Tests and verifier drivers</label>
      <label class="toggle"><input id="showDark" type="checkbox"><span class="swatch" style="background:#64748b"></span>Dark research and orphan modules</label>
      <label class="toggle"><input id="showEvents" type="checkbox"><span class="swatch" style="background:#d18cff"></span>All TaskEvent types</label>
      <label class="toggle"><input id="showLevers" type="checkbox"><span class="swatch" style="background:#f59e0b"></span>All registered levers</label>
      <label class="toggle"><input id="showCatalogs" type="checkbox"><span class="swatch" style="background:#5da9ff"></span>Memory, models, domains, weights</label>
      <label class="toggle"><input id="showRuntime" type="checkbox" checked><span class="swatch" style="background:#ff7ab2"></span>Runtime graph slots/instances</label>
      <label class="toggle"><input id="showImports" type="checkbox"><span class="swatch" style="background:#66758f"></span>File import edges</label>
    </div>
    <div class="section"><h3>Status</h3>
      <label class="toggle"><input class="statusFilter" data-status="authority" type="checkbox" checked><span class="swatch" style="background:#ab47bc"></span>Sole authority</label>
      <label class="toggle"><input class="statusFilter" data-status="live" type="checkbox" checked><span class="swatch" style="background:#66bb6a"></span>Live/default</label>
      <label class="toggle"><input class="statusFilter" data-status="partial" type="checkbox" checked><span class="swatch" style="background:#ffd54f"></span>Live/partial</label>
      <label class="toggle"><input class="statusFilter" data-status="substrate" type="checkbox" checked><span class="swatch" style="background:#64b5f6"></span>Dark substrate</label>
      <label class="toggle"><input class="statusFilter" data-status="blocked" type="checkbox" checked><span class="swatch" style="background:#ef5350"></span>Missing/blocker</label>
      <label class="toggle"><input class="statusFilter" data-status="external" type="checkbox" checked><span class="swatch" style="background:#9e9e9e"></span>External pattern</label>
    </div>
    <div class="section"><h3>Unbounded runtime</h3><div class="sub">Future task nodes are not guessed in advance. Materialize an in-memory example of the typed slots GraphProgram must instantiate.</div><div class="row" style="margin-top:8px"><button class="btn primary" id="spawnBtn">+ Materialize task</button><button class="btn danger" id="clearBtn">Clear</button></div></div>
    <div class="law">EventKernel remains the sole durable history. TaskRuntime remains the sole lifecycle/effect/completion interpreter. This canvas is a read-only projection, never a second brain.</div>
  </aside>
  <aside id="right" class="panel"><div class="eyebrow">Selected object</div><div id="inspector"><div id="inspectorEmpty">Click any node. Double-click an architecture component to reveal its backing implementation files. Search selects exact objects across the complete universe.</div></div></aside>
  <div id="hint">drag to pan · wheel to zoom · click to inspect · double-click component to expand</div>
  <div id="switcher"><button id="prevVariant" class="switchArrow">←</button><div id="switchLabel" class="switchLabel"></div><button id="nextVariant" class="switchArrow">→</button></div>
  <script>
  const DATA=__DATA__;
  const VARIANTS=['A','B','C'];
  const VARIANT_NAMES=DATA.prototype.variants;
  const canvas=document.getElementById('stage');
  const ctx=canvas.getContext('2d');
  const nodeById=new Map(DATA.nodes.map(function(n){return[n.id,n]}));
  let extraNodes=[];let extraEdges=[];let runtimeCounter=0;
  let variant=(new URLSearchParams(location.search).get('variant')||'A').toUpperCase();if(!VARIANTS.includes(variant))variant='A';
  let positions=new Map();let camera={x:innerWidth/2,y:innerHeight/2,z:.6};let selected=null;let hover=null;let dragging=false;let moved=false;let pointer={x:0,y:0};let expanded=new Set();
  const filters={showLive:false,showProof:false,showDark:false,showEvents:false,showLevers:false,showCatalogs:false,showRuntime:true,showImports:false};
  const statusOn=new Set(['authority','live','partial','substrate','blocked','external','orphan','support']);
  const COLORS={authority:'#d18cff',live:'#6be585',partial:'#ffc857',substrate:'#5da9ff',blocked:'#ff5c69',external:'#9aa4b2',orphan:'#64748b',support:'#4dd0e1'};
  const EDGE_COLORS={flow:'#7b8ca8',durable:'#d18cff',advisory:'#5da9ff',missing:'#ff5c69',external:'#818896',implements:'#6be585',imports:'#40506b','rust-module':'#4dd0e1',declares:'#b47cff',catalog:'#5da9ff',configures:'#f59e0b',materializes:'#ff7ab2'};
  const CRITICAL=['owner','raw_source','taskspec','goal_capsule','semantic_admission','event_kernel','task_runtime','bootstrap_plan','decision_state','graph_control','repo_probe','evidence_cycle','author_action','author_context','greenfield_author','candidate_artifact','candidate_proposed','workspace_router','candidate_materialized','oracle_batch','oracle_evaluation','effect_admission','effect_reservation','apply_effect','effect_observation','post_effect_verify','complete_candidate','task_completed','delivery'];
  function allNodes(){return DATA.nodes.concat(extraNodes)}function allEdges(){return DATA.edges.concat(extraEdges)}
  function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
  function setVariant(next,initial){variant=next;const q=new URLSearchParams(location.search);q.set('variant',variant);history.replaceState(null,'','?'+q.toString());if(initial||variant==='C'){filters.showLive=variant==='C';filters.showProof=variant==='C';filters.showDark=variant==='C';filters.showEvents=variant==='C';filters.showLevers=variant==='C';filters.showCatalogs=variant==='C';filters.showImports=variant==='C';syncChecks()}computePositions();fitVisible();updateVariant();render()}
  function syncChecks(){Object.keys(filters).forEach(function(k){const el=document.getElementById(k);if(el)el.checked=filters[k]})}
  function updateVariant(){document.getElementById('variantName').textContent=variant+' — '+VARIANT_NAMES[variant];document.getElementById('switchLabel').innerHTML='<b>'+variant+'</b> — '+VARIANT_NAMES[variant]}
  function computePositions(){positions=new Map();const arch=DATA.nodes.filter(function(n){return n.kind==='architecture'});const files=DATA.nodes.filter(function(n){return n.kind==='file'});const aux=DATA.nodes.filter(function(n){return n.kind!=='architecture'&&n.kind!=='file'});if(variant==='A')layoutPlanes(arch,files,aux);else if(variant==='B')layoutRiver(arch,files,aux);else layoutUniverse(arch,files,aux);layoutExtra()}
  function layoutPlanes(arch,files,aux){const clusters=DATA.clusters;const cols=4;clusters.forEach(function(c,ci){const members=arch.filter(function(n){return n.plane===c.id});const bx=(ci%cols)*1380;const by=Math.floor(ci/cols)*1120;members.forEach(function(n,i){positions.set(n.id,{x:bx+(i%3)*390,y:by+120+Math.floor(i/3)*115})})});files.forEach(function(n,i){const p=n.referencedBy&&n.referencedBy.length?positions.get(n.referencedBy[0]):null;if(p){const a=(hash(n.id)%628)/100;const r=170+(hash(n.id+'r')%180);positions.set(n.id,{x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r})}else{const group=['live','test','verify','deepResearch','orphan','rust','referenced'].indexOf(n.category);const k=Math.max(group,0);positions.set(n.id,{x:(i%80)*30,y:4700+k*250+Math.floor(i/80)*25})}});aux.forEach(function(n,i){const anchor=auxAnchor(n);const p=positions.get(anchor);if(p){const a=(hash(n.id)%628)/100;const r=240+(hash(n.id+'a')%260);positions.set(n.id,{x:p.x+Math.cos(a)*r,y:p.y+Math.sin(a)*r})}else positions.set(n.id,{x:(i%80)*35,y:6800+Math.floor(i/80)*32})})}
  function layoutRiver(arch,files,aux){const criticalSet=new Set(CRITICAL.map(function(id){return'arch:'+id}));CRITICAL.forEach(function(id,i){positions.set('arch:'+id,{x:i*330,y:0})});const byPlane=new Map();arch.forEach(function(n){if(criticalSet.has(n.id))return;if(!byPlane.has(n.planeIndex))byPlane.set(n.planeIndex,[]);byPlane.get(n.planeIndex).push(n)});for(const pair of byPlane){const pi=pair[0],members=pair[1];members.forEach(function(n,i){positions.set(n.id,{x:pi*760,y:520+(i%9)*105+Math.floor(i/9)*1020})})}files.forEach(function(n,i){const p=n.referencedBy&&n.referencedBy.length?positions.get(n.referencedBy[0]):null;if(p)positions.set(n.id,{x:p.x+((hash(n.id)%9)-4)*24,y:p.y+180+Math.floor((hash(n.id)>>4)%7)*24});else positions.set(n.id,{x:(i%120)*28,y:2600+Math.floor(i/120)*25})});aux.forEach(function(n,i){const p=positions.get(auxAnchor(n));if(p)positions.set(n.id,{x:p.x+((hash(n.id)%11)-5)*35,y:p.y+260+Math.floor(i%11)*25});else positions.set(n.id,{x:(i%120)*28,y:3600+Math.floor(i/120)*25})})}
  function layoutUniverse(arch,files,aux){const golden=2.3999632297;arch.forEach(function(n,i){const r=300+Math.sqrt(i)*75;positions.set(n.id,{x:Math.cos(i*golden)*r,y:Math.sin(i*golden)*r})});const groups=['live','test','verify','deepResearch','orphan','rust','referenced'];groups.forEach(function(g,gi){const members=files.filter(function(n){return n.category===g});members.forEach(function(n,i){const r=1700+gi*520+Math.sqrt(i)*45;const a=i*golden+gi;positions.set(n.id,{x:Math.cos(a)*r,y:Math.sin(a)*r})})});aux.forEach(function(n,i){const r=1150+Math.sqrt(i)*55;const a=i*golden+.7;positions.set(n.id,{x:Math.cos(a)*r,y:Math.sin(a)*r})})}
  function auxAnchor(n){if(n.kind==='event')return'arch:contracts';if(n.category==='lever')return'arch:levers';if(n.category==='model'||n.category==='model-artifact')return'arch:specialists';if(n.category==='domain')return'arch:domain_routes';if(n.category==='memory-store')return'arch:memory_recall';if(n.kind==='runtime-template')return'arch:graph_program';return'arch:self_model'}
  function layoutExtra(){extraNodes.forEach(function(n,i){const anchor=positions.get(n.anchor)||positions.get('arch:graph_program')||{x:0,y:0};positions.set(n.id,{x:anchor.x+360+(i%5)*220,y:anchor.y-300+Math.floor(i/5)*115})})}
  function visible(n){if(n.kind==='architecture')return statusOn.has(n.status);if(n.kind==='file'){if(n.referencedBy&&n.referencedBy.some(function(id){return expanded.has(id)}))return true;if(n.category==='live'||n.category==='rust'||n.category==='referenced')return filters.showLive;if(n.category==='test'||n.category==='verify')return filters.showProof;return filters.showDark}if(n.kind==='event')return filters.showEvents;if(n.kind==='lever')return filters.showLevers;if(n.kind==='catalog')return filters.showCatalogs;if(n.kind==='runtime-template'||n.kind==='runtime-instance')return filters.showRuntime;return true}
  function edgeVisible(e,set){if(!set.has(e.source)||!set.has(e.target))return false;if(e.kind==='imports'||e.kind==='rust-module')return filters.showImports||selected===e.source||selected===e.target;return true}
  function nodeSize(n){if(n.kind==='architecture')return{w:238,h:60};if(n.kind==='runtime-instance'||n.kind==='runtime-template')return{w:150,h:38};if(n.kind==='event')return{w:16,h:16};if(n.kind==='catalog')return{w:18,h:18};if(n.kind==='lever')return{w:10,h:10};return{w:11,h:11}}
  function resize(){const d=devicePixelRatio||1;canvas.width=Math.floor(innerWidth*d);canvas.height=Math.floor(innerHeight*d);canvas.style.width=innerWidth+'px';canvas.style.height=innerHeight+'px';ctx.setTransform(d,0,0,d,0,0);if(positions.size)render()}
  function worldToScreen(p){return{x:p.x*camera.z+camera.x,y:p.y*camera.z+camera.y}}function screenToWorld(x,y){return{x:(x-camera.x)/camera.z,y:(y-camera.y)/camera.z}}
  function render(){ctx.clearRect(0,0,innerWidth,innerHeight);drawGrid();const vis=allNodes().filter(visible);const set=new Set(vis.map(function(n){return n.id}));const ve=allEdges().filter(function(e){return edgeVisible(e,set)});if(variant==='A')drawPlaneBounds(vis);drawEdges(ve);drawNodes(vis);drawMinimap(vis);document.getElementById('visibleNodes').textContent=vis.length.toLocaleString();document.getElementById('visibleEdges').textContent=ve.length.toLocaleString()}
  function drawGrid(){ctx.save();const step=Math.max(40,Math.pow(2,Math.round(Math.log2(120/camera.z))));const a=screenToWorld(0,0),b=screenToWorld(innerWidth,innerHeight);ctx.strokeStyle='#172136';ctx.lineWidth=1;ctx.globalAlpha=.55;ctx.beginPath();for(let x=Math.floor(a.x/step)*step;x<b.x;x+=step){const s=worldToScreen({x:x,y:0});ctx.moveTo(s.x,0);ctx.lineTo(s.x,innerHeight)}for(let y=Math.floor(a.y/step)*step;y<b.y;y+=step){const s=worldToScreen({x:0,y:y});ctx.moveTo(0,s.y);ctx.lineTo(innerWidth,s.y)}ctx.stroke();ctx.restore()}
  function drawPlaneBounds(vis){const arch=vis.filter(function(n){return n.kind==='architecture'});DATA.clusters.forEach(function(c){const m=arch.filter(function(n){return n.plane===c.id});if(!m.length)return;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;m.forEach(function(n){const p=positions.get(n.id);if(!p)return;minX=Math.min(minX,p.x-170);maxX=Math.max(maxX,p.x+170);minY=Math.min(minY,p.y-80);maxY=Math.max(maxY,p.y+80)});const s=worldToScreen({x:minX,y:minY});ctx.save();ctx.fillStyle='#10192a88';ctx.strokeStyle='#30415f';ctx.lineWidth=1;roundRect(s.x,s.y,(maxX-minX)*camera.z,(maxY-minY)*camera.z,14);ctx.fill();ctx.stroke();if(camera.z>.18){ctx.fillStyle='#8297b7';ctx.font='700 '+Math.max(9,12*camera.z)+'px Inter, sans-serif';ctx.fillText(c.label,s.x+12,s.y+18)}ctx.restore()})}
  function drawEdges(list){ctx.save();for(const e of list){const a=positions.get(e.source),b=positions.get(e.target);if(!a||!b)continue;const sa=worldToScreen(a),sb=worldToScreen(b);if((sa.x<-100&&sb.x<-100)||(sa.x>innerWidth+100&&sb.x>innerWidth+100)||(sa.y<-100&&sb.y<-100)||(sa.y>innerHeight+100&&sb.y>innerHeight+100))continue;const active=selected===e.source||selected===e.target;ctx.strokeStyle=EDGE_COLORS[e.kind]||'#53627b';ctx.globalAlpha=active ? .95 : ((e.kind==='imports'||e.kind==='rust-module') ? .12 : .36);ctx.lineWidth=active?2.4:(e.kind==='missing'?1.8:1);if(e.kind==='missing'||e.kind==='advisory'||e.kind==='external')ctx.setLineDash(e.kind==='missing'?[2,5]:[6,6]);else ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(sa.x,sa.y);const mx=(sa.x+sb.x)/2;ctx.bezierCurveTo(mx,sa.y,mx,sb.y,sb.x,sb.y);ctx.stroke();if(active&&e.label&&camera.z>.3){ctx.setLineDash([]);ctx.globalAlpha=1;ctx.fillStyle='#dce7f8';ctx.font='10px Inter, sans-serif';ctx.fillText(e.label,mx+4,(sa.y+sb.y)/2-4)}}ctx.restore()}
  function drawNodes(list){for(const n of list){const p=positions.get(n.id);if(!p)continue;const s=worldToScreen(p);const z=camera.z;const size=nodeSize(n);const w=size.w*(n.kind==='architecture'?Math.max(.52,z):Math.max(.7,z));const h=size.h*(n.kind==='architecture'?Math.max(.52,z):Math.max(.7,z));if(s.x+w<-30||s.x-w>innerWidth+30||s.y+h<-30||s.y-h>innerHeight+30)continue;const color=COLORS[n.status]||'#94a3b8';ctx.save();ctx.globalAlpha=selected&&selected!==n.id ? .48 : 1;if(n.kind==='architecture'||n.kind==='runtime-instance'||n.kind==='runtime-template'){ctx.fillStyle=n.status==='partial'?'#6b5315':n.status==='blocked'?'#5a1e27':n.status==='authority'?'#4a1e62':n.status==='live'?'#173d25':n.status==='external'?'#2c3138':'#163351';ctx.strokeStyle=color;ctx.lineWidth=selected===n.id?3:1.5;roundRect(s.x-w/2,s.y-h/2,w,h,Math.max(5,9*z));ctx.fill();ctx.stroke();if(z>.24||selected===n.id){ctx.fillStyle=n.status==='partial'?'#fff3c7':'#f4f7ff';ctx.font=(selected===n.id?'700 ':'600 ')+Math.max(8,11*z)+'px Inter, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';wrapText(n.label,s.x,s.y,Math.max(80,w-12),Math.max(10,13*z))}}else{ctx.beginPath();ctx.arc(s.x,s.y,selected===n.id?Math.max(5,w):Math.max(2.5,w/2),0,Math.PI*2);ctx.fillStyle=color;ctx.fill();if(selected===n.id||hover===n.id){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke()}if((z>.72&&n.kind!=='lever')||selected===n.id){ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='9px Inter, sans-serif';ctx.fillStyle='#d9e5f7';ctx.fillText(n.label,s.x+8,s.y)}}ctx.restore()}}
  function wrapText(text,x,y,maxWidth,lineHeight){const words=text.split(' ');const lines=[];let line='';for(const word of words){const t=line?line+' '+word:word;if(ctx.measureText(t).width>maxWidth&&line){lines.push(line);line=word}else line=t}if(line)lines.push(line);const shown=lines.slice(0,3);shown.forEach(function(l,i){ctx.fillText(l,x,y+(i-(shown.length-1)/2)*lineHeight)})}
  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function drawMinimap(vis){const arch=vis.filter(function(n){return n.kind==='architecture'});if(!arch.length)return;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;arch.forEach(function(n){const p=positions.get(n.id);if(!p)return;minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y)});if(!Number.isFinite(minX))return;const box={x:innerWidth-340,y:innerHeight-170,w:300,h:125};if(innerWidth<900)return;ctx.save();ctx.fillStyle='#0b1322dd';ctx.strokeStyle='#394a66';roundRect(box.x,box.y,box.w,box.h,10);ctx.fill();ctx.stroke();const sx=(box.w-16)/Math.max(1,maxX-minX),sy=(box.h-16)/Math.max(1,maxY-minY),m=Math.min(sx,sy);arch.forEach(function(n){const p=positions.get(n.id);if(!p)return;ctx.fillStyle=COLORS[n.status]||'#fff';ctx.fillRect(box.x+8+(p.x-minX)*m,box.y+8+(p.y-minY)*m,2,2)});const a=screenToWorld(0,0),b=screenToWorld(innerWidth,innerHeight);ctx.strokeStyle='#fff';ctx.globalAlpha=.55;ctx.strokeRect(box.x+8+(a.x-minX)*m,box.y+8+(a.y-minY)*m,(b.x-a.x)*m,(b.y-a.y)*m);ctx.restore()}
  function hit(x,y){const w=screenToWorld(x,y);let best=null,bestD=Infinity;for(const n of allNodes()){if(!visible(n))continue;const p=positions.get(n.id);if(!p)continue;const s=nodeSize(n);if(n.kind==='architecture'||n.kind==='runtime-instance'||n.kind==='runtime-template'){if(Math.abs(w.x-p.x)<=s.w/2&&Math.abs(w.y-p.y)<=s.h/2)return n.id}else{const d=Math.hypot(w.x-p.x,w.y-p.y);if(d<Math.max(16,10/camera.z)&&d<bestD){best=n.id;bestD=d}}}return best}
  function fitVisible(){const vis=allNodes().filter(visible);if(!vis.length)return;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;vis.forEach(function(n){const p=positions.get(n.id);if(!p)return;minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y)});const left=340,right=360,top=50,bottom=80;const availW=Math.max(200,innerWidth-left-right),availH=Math.max(200,innerHeight-top-bottom);camera.z=Math.max(.035,Math.min(1.1,Math.min(availW/Math.max(1,maxX-minX+400),availH/Math.max(1,maxY-minY+300))));camera.x=left+availW/2-((minX+maxX)/2)*camera.z;camera.y=top+availH/2-((minY+maxY)/2)*camera.z;render()}
  function centerNode(id){const p=positions.get(id);if(!p)return;camera.z=Math.max(camera.z,.8);camera.x=innerWidth/2-p.x*camera.z;camera.y=innerHeight/2-p.y*camera.z;selected=id;inspect();render()}
  function inspect(){const root=document.getElementById('inspector');const n=allNodes().find(function(x){return x.id===selected});if(!n){root.innerHTML='<div id="inspectorEmpty">Click any node to inspect its exact interface, status, path and graph neighbours.</div>';return}const incident=allEdges().filter(function(e){return e.source===n.id||e.target===n.id}).slice(0,80);let html='<div class="nodeTitle">'+esc(n.label)+'</div><span class="pill">'+esc(n.kind)+'</span><span class="pill">'+esc(n.status)+'</span><span class="pill">'+esc(n.plane||'')+'</span>';if(n.iface)html+=field('Interface',n.iface);if(n.detail)html+=field('Detail',n.detail);if(n.path){const abs=n.absolutePath||n.path;html+=field('Source','<a class="sourceLink" href="file://'+esc(abs)+'">'+esc(n.path)+'</a>')}if(n.modules&&n.modules.length)html+=field('Implementation files',n.modules.map(function(p){return'<a class="sourceLink" href="file:///home/raed/.agentic-os/'+esc(p)+'">'+esc(p)+'</a>'}).join('<br>'));if(n.bytes!=null)html+=field('Bytes',Number(n.bytes).toLocaleString());if(n.referencedBy&&n.referencedBy.length)html+=field('Architecture parents',n.referencedBy.join('\n'));if(n.data)html+=field('Measured record','<pre>'+esc(JSON.stringify(n.data,null,2))+'</pre>');if(n.kind==='architecture')html+='<div class="row" style="margin:12px 0"><button class="btn primary" onclick="toggleExpand(\''+n.id+'\')">'+(expanded.has(n.id)?'Hide':'Reveal')+' implementation</button></div>';html+='<div class="field"><label>Graph neighbours ('+incident.length+(incident.length===80?'+':'')+')</label>';incident.forEach(function(e){const other=e.source===n.id?e.target:e.source;const o=nodeById.get(other)||extraNodes.find(function(x){return x.id===other});if(o)html+='<button class="neighbor" onclick="selectNode(\''+escAttr(other)+'\')">'+esc(e.kind)+' · '+esc(o.label)+'</button>'});html+='</div>';root.innerHTML=html}
  function field(label,value){return'<div class="field"><label>'+esc(label)+'</label><div>'+value+'</div></div>'}function esc(v){return String(v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}function escAttr(v){return String(v).replaceAll('\\','\\\\').replaceAll("'","\\'")}
  window.selectNode=function(id){centerNode(id)};window.toggleExpand=function(id){if(expanded.has(id))expanded.delete(id);else expanded.add(id);inspect();render()}
  function spawnRuntime(){runtimeCounter++;const prefix='runtime-instance:'+runtimeCounter+':';const stages=['task','intent','belief','graph','branch','observation','candidate','oracle','effect','completion'];const labels=['Task '+runtimeCounter,'Intent epoch','Belief snapshot','Graph epoch','Work branch','Typed observation','Candidate','Oracle: unresolved','Effect: withheld','Completion: withheld'];const anchors=['arch:taskspec','arch:semantic_admission','arch:decision_state','arch:graph_program','arch:branch_invocation','arch:epistemic_graph','arch:candidate_proposed','arch:oracle_evaluation','arch:effect_reservation','arch:task_completed'];stages.forEach(function(stage,i){extraNodes.push({id:prefix+stage,label:labels[i],kind:'runtime-instance',category:'runtime',plane:'runtime',status:i<7?'partial':'blocked',anchor:anchors[i],detail:'In-memory prototype instance. Not persisted; no authority.',searchable:('runtime '+labels[i]).toLowerCase()});nodeById.set(prefix+stage,extraNodes[extraNodes.length-1]);if(i)extraEdges.push({id:'extra-edge:'+extraEdges.length,source:prefix+stages[i-1],target:prefix+stage,kind:i>=7?'missing':'materializes',label:''})});extraEdges.push({id:'extra-edge:'+extraEdges.length,source:'arch:graph_program',target:prefix+'graph',kind:'materializes',label:'task-specific'});computePositions();filters.showRuntime=true;syncChecks();centerNode(prefix+'graph')}
  function clearRuntime(){extraNodes.forEach(function(n){nodeById.delete(n.id)});extraNodes=[];extraEdges=[];selected=null;computePositions();inspect();fitVisible()}
  canvas.addEventListener('pointerdown',function(e){dragging=true;moved=false;pointer={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging')});canvas.addEventListener('pointermove',function(e){hover=hit(e.clientX,e.clientY);if(dragging){const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;camera.x+=dx;camera.y+=dy;pointer={x:e.clientX,y:e.clientY}}render()});canvas.addEventListener('pointerup',function(e){dragging=false;canvas.classList.remove('dragging');if(!moved){selected=hit(e.clientX,e.clientY);inspect();render()}});canvas.addEventListener('dblclick',function(e){const id=hit(e.clientX,e.clientY);const n=nodeById.get(id);if(n&&n.kind==='architecture'){toggleExpand(id)}});canvas.addEventListener('wheel',function(e){e.preventDefault();const before=screenToWorld(e.clientX,e.clientY);const next=Math.max(.025,Math.min(4,camera.z*Math.exp(-e.deltaY*.001)));camera.z=next;camera.x=e.clientX-before.x*next;camera.y=e.clientY-before.y*next;render()},{passive:false});
  document.getElementById('fitBtn').onclick=fitVisible;document.getElementById('allBtn').onclick=function(){filters.showLive=filters.showProof=filters.showDark=filters.showEvents=filters.showLevers=filters.showCatalogs=filters.showRuntime=filters.showImports=true;syncChecks();fitVisible()};document.getElementById('spawnBtn').onclick=spawnRuntime;document.getElementById('clearBtn').onclick=clearRuntime;
  Object.keys(filters).forEach(function(k){const el=document.getElementById(k);if(el)el.addEventListener('change',function(){filters[k]=el.checked;render()})});document.querySelectorAll('.statusFilter').forEach(function(el){el.addEventListener('change',function(){if(el.checked)statusOn.add(el.dataset.status);else statusOn.delete(el.dataset.status);render()})});
  function search(){const q=document.getElementById('search').value.trim().toLowerCase();if(!q)return;const found=allNodes().find(function(n){return(n.searchable||n.label.toLowerCase()).includes(q)});if(found){if(found.kind==='file'){if(found.category==='test'||found.category==='verify')filters.showProof=true;else if(found.category==='deepResearch'||found.category==='orphan')filters.showDark=true;else filters.showLive=true}else if(found.kind==='event')filters.showEvents=true;else if(found.kind==='lever')filters.showLevers=true;else if(found.kind==='catalog')filters.showCatalogs=true;syncChecks();centerNode(found.id)}}document.getElementById('findBtn').onclick=search;document.getElementById('search').addEventListener('keydown',function(e){if(e.key==='Enter')search()});
  function cycle(delta){const i=VARIANTS.indexOf(variant);setVariant(VARIANTS[(i+delta+VARIANTS.length)%VARIANTS.length],false)}document.getElementById('prevVariant').onclick=function(){cycle(-1)};document.getElementById('nextVariant').onclick=function(){cycle(1)};addEventListener('keydown',function(e){if(['INPUT','TEXTAREA'].includes(document.activeElement.tagName)||document.activeElement.isContentEditable)return;if(e.key==='ArrowLeft')cycle(-1);if(e.key==='ArrowRight')cycle(1)});addEventListener('resize',resize);
  resize();setVariant(variant,true);
  </script>
</body>
</html>`

const html = template
  .replace('__DATA__', dataJson)
  .replace('__NODE_COUNT__', payload.counts.nodes.toLocaleString())
  .replace('__EDGE_COUNT__', payload.counts.edges.toLocaleString())

const outputPath = path.join(outDir, 'arc-clide-infinite-canvas-prototype.html')
writeFileSync(outputPath, html)
writeFileSync(path.join(outDir, 'arc-clide-infinite-canvas-prototype.data.json'), `${JSON.stringify(payload)}\n`)

process.stdout.write(`${JSON.stringify({ outputPath, dataPath: path.join(outDir, 'arc-clide-infinite-canvas-prototype.data.json'), counts: payload.counts, bytes: Buffer.byteLength(html) }, null, 2)}\n`)
