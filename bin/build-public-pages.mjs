#!/usr/bin/env node

/**
 * Build the deliberately static public edition of the ARC / CLIDE Atlas.
 *
 * This is not the mutable Atlas server and does not publish a local snapshot.
 * It publishes a bounded historical reference set whose source bytes are
 * listed in a manifest, after redacting machine-local locator strings.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const DEFAULT_OUTPUT = path.join(projectRoot, 'dist-pages')
const DATA_INPUTS = [
  ['COMPLETE-COMPONENT-MAP.json', 'data/component-map.json'],
  ['MODULE-DIGESTS.json', 'data/module-digests.json'],
]
const DOCUMENT_INPUTS = [
  ['README.md', 'documents/README.md'],
  ['ARC-CLIDE-TODDLER-NARRATIVE.md', 'documents/TODDLER-NARRATIVE.md'],
  ['COMPLETE-ARCHITECTURE-BOOK.md', 'documents/ARCHITECTURE-BOOK.md'],
  ['COMPLETE-COMPONENT-MAP.md', 'documents/COMPONENT-MAP.md'],
  ['MODULE-DIGESTS.md', 'documents/MODULE-DIGESTS.md'],
  ['ATLAS-RELEASE-READINESS-2026-08-20.md', 'documents/RELEASE-READINESS.md'],
  ['NEXT-AGENT-ATLAS-HANDOFF-2026-08-16.md', 'documents/NEXT-AGENT-HANDOFF.md'],
]
const FORBIDDEN_PUBLIC_PATTERNS = [
  /file:\/\/(?:\/|home\/|Users\/|[A-Za-z]:)/i,
  /(?:^|[^A-Za-z])\/home\/[^\s"'<]+/,
  /(?:^|[^A-Za-z])\/Users\/[^\s"'<]+/,
  /(?:^|[^A-Za-z])C:\\Users\\/i,
  /(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
]

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function write(root, relative, value) {
  const target = path.join(root, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, value)
  return target
}

function readSource(relative, root = projectRoot) {
  const absolute = path.join(root, relative)
  if (!existsSync(absolute)) throw new Error(`public-pages source is missing: ${relative}`)
  return readFileSync(absolute)
}

function redactLocalLocators(text) {
  return text
    .replace(/file:\/\/[^\s"'<]+/gi, '[local-file-url-redacted]')
    .replace(/(?:\/home\/[^\s"'<]+|\/Users\/[^\s"'<]+|C:\\Users\\[^\s"'<]+)/g, '[local-path-redacted]')
    .replace(/~\/(?:\.agentic-os|\.agentic-models|\.local\/state\/agentic-os)[^\s"'<]*/g, '[local-path-redacted]')
}

function redactJson(value) {
  if (Array.isArray(value)) return value.map(redactJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactJson(child)]))
  return typeof value === 'string' ? redactLocalLocators(value) : value
}

function assertPublicBytes(relative, bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes)
  for (const pattern of FORBIDDEN_PUBLIC_PATTERNS) {
    if (pattern.test(text)) throw new Error(`public-pages output contains a forbidden local/sensitive locator in ${relative}: ${pattern}`)
  }
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function sourceDescriptor({ sourceRoot, sourcePath, publishedPath }) {
  const bytes = readSource(sourcePath, sourceRoot)
  return { sourcePath, publishedPath, sourceSha256: sha256(bytes), sourceBytes: bytes.length }
}

function documentHref(sourceRepositoryUrl, sourceBranch, pathName) {
  return `${sourceRepositoryUrl.replace(/\/$/, '')}/blob/${encodeURIComponent(sourceBranch).replace(/%2F/g, '/')}/${pathName}`
}

function publicIndexHtml({ sourceCommit, sourceRepositoryUrl, sourceBranch, documents, data }) {
  const href = pathName => documentHref(sourceRepositoryUrl, sourceBranch, pathName)
  const cards = [
    ['Start here', 'A toddler-first tour of what the system is trying to become.', href('ARC-CLIDE-TODDLER-NARRATIVE.md'), 'Read the guided narrative'],
    ['Architecture book', 'The intended end-to-end organism, its laws, and what remains unproven.', href('COMPLETE-ARCHITECTURE-BOOK.md'), 'Read the architecture book'],
    ['Interactive atlas', 'Browse the captured component and symbol reference without a local server.', 'atlas.html', 'Open the historical explorer'],
    ['Release boundary', 'Exactly what this public edition can and cannot establish.', href('ATLAS-RELEASE-READINESS-2026-08-20.md'), 'Read the release boundary'],
  ]
  const docRows = documents.map(document => `<li><a href="${documentHref(sourceRepositoryUrl, sourceBranch, document.sourcePath)}">${escapeHtml(document.sourcePath)}</a><span>exact source document</span></li>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#071018">
  <meta name="description" content="A public, provenance-labeled historical reference for the ARC / CLIDE engineering atlas.">
  <title>ARC / CLIDE Atlas — public reference</title>
  <style>
    :root{--ink:#e9f1fb;--muted:#a5b6c9;--line:#294158;--bg:#071018;--panel:#0d1b29;--panel-2:#11263a;--teal:#5ce1d2;--violet:#ac9bff;--amber:#ffc96b;--red:#ff7783;--max:1120px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(80rem 40rem at 20% -10%,#173a4a 0,transparent 56%),radial-gradient(60rem 30rem at 90% 10%,#251f54 0,transparent 58%),var(--bg);color:var(--ink);font:16px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#a8eeff;text-decoration-thickness:.08em;text-underline-offset:.18em}a:hover{color:#fff}.shell{max-width:var(--max);margin:auto;padding:24px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:10px 0 42px}.brand{font-weight:800;letter-spacing:.04em}.badge{font-size:.76rem;border:1px solid #9e6f2c;background:#2f2312;color:#ffe1a0;border-radius:999px;padding:.35rem .65rem;white-space:nowrap}.hero{padding:48px 0 58px;max-width:850px}.eyebrow{margin:0 0 14px;color:var(--teal);font-size:.76rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase}h1{font-size:clamp(2.5rem,7vw,5.8rem);line-height:.98;letter-spacing:-.055em;margin:0 0 24px;max-width:780px}.lede{font-size:clamp(1.05rem,2.2vw,1.32rem);color:#c7d6e7;max-width:740px}.truth{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:34px 0 0}.truth div{background:linear-gradient(145deg,#132940,#0b1826);border:1px solid var(--line);border-radius:16px;padding:16px}.truth b{display:block;font-size:.8rem;color:var(--teal);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}.truth span{font-size:.92rem;color:#c7d5e5}.section{padding:46px 0;border-top:1px solid var(--line)}h2{font-size:clamp(1.6rem,3vw,2.45rem);letter-spacing:-.035em;margin:0 0 12px}h3{font-size:1.13rem;margin:0 0 8px}.sub{max-width:760px;color:var(--muted);margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.card{background:linear-gradient(145deg,rgba(21,44,66,.97),rgba(10,24,38,.97));border:1px solid var(--line);border-radius:18px;padding:22px;min-height:190px;display:flex;flex-direction:column}.card p{color:#bfd0e2;margin:0 0 18px}.card a{margin-top:auto;font-weight:750}.notice{border-left:4px solid var(--amber);background:#221b12;padding:18px 20px;border-radius:0 14px 14px 0;color:#f6dfaf}.notice strong{color:#fff3cf}.stats{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}.stat{border:1px solid #30506a;background:#0b1a29;padding:9px 12px;border-radius:10px;font-size:.88rem;color:#c3d8e9}.stat b{color:#fff}.docs{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.docs li{border:1px solid #294158;background:#091827;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column}.docs span{font-size:.78rem;color:#8296ac}.footer{border-top:1px solid var(--line);padding:28px 0 40px;color:#94a9be;font-size:.9rem}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82em;word-break:break-all}@media(max-width:680px){.shell{padding:16px}.top{padding-bottom:24px}.truth,.grid,.docs{grid-template-columns:1fr}.hero{padding:28px 0 40px}.badge{white-space:normal;text-align:right}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="top"><div class="brand">ARC / CLIDE <span style="color:var(--teal)">ATLAS</span></div><div class="badge">Historical reference · authority none</div></header>
    <section class="hero" aria-labelledby="title"><p class="eyebrow">A map for people and agents</p><h1 id="title">Understand the engineering organism before changing it.</h1><p class="lede">This public edition is a self-contained, read-only guide to the ARC / CLIDE repository architecture. It helps a new engineer find the major organs, follow the intended journeys, and see the evidence boundary—without publishing a private local snapshot or pretending the mutable product is complete.</p><div class="truth"><div><b>Captured map</b><span>Static component and symbol material is a historical reference, not a claim about today’s checkout.</span></div><div><b>Safe by design</b><span>Machine-local paths and local snapshot blobs are excluded. No API server is required to browse this edition.</span></div><div><b>Continuation-ready</b><span>Exact source documents, release limits, and the source branch are linked from each entry point.</span></div></div></section>
    <section class="section" aria-labelledby="start"><h2 id="start">Choose your way in</h2><p class="sub">Start at your actual level. Every route leads back to the same explicit truth boundary.</p><div class="grid">${cards.map(([title, body, link, cta]) => `<article class="card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p><a href="${link}">${escapeHtml(cta)} →</a></article>`).join('')}</div></section>
    <section class="section" aria-labelledby="reference"><h2 id="reference">What is inside the public reference</h2><p class="sub">The interactive explorer reads a sanitized historical component map and digest corpus directly in your browser. It contains architecture labels, relative repository paths, module descriptions, signatures, and explicitly unavailable meaning—it does not contain the local snapshot’s raw source blobs, SQLite index, transcript pages, or machine identifiers.</p><div class="stats"><div class="stat"><b>${data.componentMap.visibleFiles.toLocaleString()}</b> captured files</div><div class="stat"><b>${data.componentMap.modules.toLocaleString()}</b> architecture modules</div><div class="stat"><b>${data.moduleDigests.totalSymbols.toLocaleString()}</b> compact symbol records</div><div class="stat"><b>${data.moduleDigests.callableCount.toLocaleString()}</b> callable records</div></div><div class="notice"><strong>Do not turn this into product proof.</strong> The Atlas is a projection. It cannot prove an agent completed a user task, applied a safe effect, or causally improved the product. The linked release boundary tells you what must be verified separately.</div></section>
    <section class="section" aria-labelledby="agents"><h2 id="agents">For the next engineer or coding agent</h2><p class="sub">Use the source branch as the executable authority for the Atlas itself. Treat the interactive page as an orientation layer, then follow its cited source document or run the local verifier before acting.</p><ul class="docs">${docRows}</ul></section>
    <footer class="footer"><div>Public artifact generated from source commit <span class="mono">${sourceCommit}</span>.</div><div>Source: <a href="${sourceRepositoryUrl}/tree/${encodeURIComponent(sourceBranch).replace(/%2F/g, '/')}">${sourceRepositoryUrl.replace('https://github.com/', '')}@${sourceBranch}</a> · <a href="public-site-manifest.json">artifact manifest</a></div></footer>
  </main>
</body>
</html>
`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

function publicAtlasHtml({ sourceRepositoryUrl, sourceBranch }) {
  const template = readSource('COMPLETE-MAP-EXPLORER.html').toString('utf8')
  const sourceLink = documentHref(sourceRepositoryUrl, sourceBranch, 'COMPLETE-ARCHITECTURE-BOOK.md')
  const replaced = template
    .replace('<title>ARC / CLIDE — Complete Component Map + Deep Digests Explorer</title>', '<title>ARC / CLIDE Atlas — historical component explorer</title>')
    .replace('ARC / CLIDE — Complete Component Map + Deep Digests', 'ARC / CLIDE Atlas — Historical Component Reference')
    .replace('Every one of the 204 modules across 13 planes, every mapped file, and every real symbol (functions, classes, methods, signatures) from the gate-clean atlas snapshot.', 'A static historical reference: captured module, relative-path, and compact symbol records. It is not a live snapshot, product proof, or a substitute for the source verifier.')
    .replace('<a href="ARC-CLIDE-TODDLER-NARRATIVE.md" target="_blank">Toddler narrative</a>', `<a href="${documentHref(sourceRepositoryUrl, sourceBranch, 'ARC-CLIDE-TODDLER-NARRATIVE.md')}" target="_blank" rel="noopener">Toddler narrative</a>`)
    .replace('<a href="COMPLETE-COMPONENT-MAP.md" target="_blank">Component map (md)</a>', `<a href="${documentHref(sourceRepositoryUrl, sourceBranch, 'COMPLETE-COMPONENT-MAP.md')}" target="_blank" rel="noopener">Component map (source)</a>`)
    .replace('<a href="MODULE-DIGESTS.md" target="_blank">Module digests (md)</a>', `<a href="${documentHref(sourceRepositoryUrl, sourceBranch, 'MODULE-DIGESTS.md')}" target="_blank" rel="noopener">Module digests (source)</a>`)
    .replace('<a href="index.html" target="_blank">Infinite canvas</a>', '<a href="index.html">Public guide</a>')
    .replace("fetch('COMPLETE-COMPONENT-MAP.json')", "fetch('data/component-map.json')")
    .replace("fetch('MODULE-DIGESTS.json')", "fetch('data/module-digests.json')")
    .replace('Read-only projection · authority none · generated from the gate-clean atlas snapshot (built-complete, blockingGates [])', 'Read-only historical projection · authority none · exact current/product status is intentionally unclaimed')
  if (replaced === template) throw new Error('public-pages atlas template did not receive its required replacement')
  return replaced
}

function publicNotFoundHtml() {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas page not found</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#071018;color:#e9f1fb;font:18px/1.5 system-ui}main{max-width:36rem;padding:2rem}a{color:#a8eeff}</style><main><p>ARC / CLIDE Atlas</p><h1>That page is not in this public edition.</h1><p><a href="index.html">Return to the public guide</a>.</p></main>'
}

function cleanDestination(out) {
  const resolved = path.resolve(out)
  if (resolved === path.parse(resolved).root) throw new Error('public-pages output cannot be a filesystem root')
  rmSync(resolved, { recursive: true, force: true })
  mkdirSync(resolved, { recursive: true })
  return resolved
}

export function buildPublicPages({
  sourceRoot = projectRoot,
  out = DEFAULT_OUTPUT,
  sourceRepositoryUrl = 'https://github.com/Raed2180416/arc-clide-infinite-canvas',
  sourceBranch = 'codex/atlas-source-release-20260820',
} = {}) {
  const sourceCommit = git(sourceRoot, ['rev-parse', 'HEAD'])
  const sourceCommitTime = git(sourceRoot, ['show', '-s', '--format=%cI', 'HEAD'])
  const output = cleanDestination(out)
  const staging = mkdtempSync(path.join(tmpdir(), 'arc-atlas-public-pages-'))
  try {
    const componentMap = redactJson(JSON.parse(readSource('COMPLETE-COMPONENT-MAP.json', sourceRoot)))
    const moduleDigests = redactJson(JSON.parse(readSource('MODULE-DIGESTS.json', sourceRoot)))
    const data = {
      componentMap: { visibleFiles: componentMap.coverage.visibleFiles, modules: componentMap.totals.modules },
      moduleDigests: { totalSymbols: moduleDigests.totals.totalSymbols, callableCount: moduleDigests.totals.callableCount },
    }
    const inputDescriptors = [...DATA_INPUTS, ...DOCUMENT_INPUTS].map(([sourcePath, publishedPath]) => sourceDescriptor({ sourceRoot, sourcePath, publishedPath }))
    write(staging, 'data/component-map.json', `${JSON.stringify(componentMap)}\n`)
    write(staging, 'data/module-digests.json', `${JSON.stringify(moduleDigests)}\n`)
    for (const [sourcePath, publishedPath] of DOCUMENT_INPUTS) write(staging, publishedPath, redactLocalLocators(readSource(sourcePath, sourceRoot).toString('utf8')))
    write(staging, 'index.html', publicIndexHtml({ sourceCommit, sourceRepositoryUrl, sourceBranch, documents: inputDescriptors.filter(item => item.publishedPath.startsWith('documents/')), data }))
    write(staging, 'atlas.html', publicAtlasHtml({ sourceRepositoryUrl, sourceBranch }))
    write(staging, '404.html', publicNotFoundHtml())
    write(staging, '.nojekyll', '')

    const publishedPaths = [
      '.nojekyll', '404.html', 'atlas.html', 'index.html',
      ...DATA_INPUTS.map(([, publishedPath]) => publishedPath),
      ...DOCUMENT_INPUTS.map(([, publishedPath]) => publishedPath),
    ].sort()
    const artifacts = publishedPaths.map(publishedPath => {
      const bytes = readFileSync(path.join(staging, publishedPath))
      assertPublicBytes(publishedPath, bytes)
      return { path: publishedPath, sha256: sha256(bytes), bytes: bytes.length }
    })
    const manifest = {
      schemaVersion: 'arc-clide-public-atlas-pages-v1',
      kind: 'historical-static-reference',
      authority: 'read-only-projection-authority-none',
      generatedFrom: { sourceCommit, sourceCommitTime, sourceRepositoryUrl, sourceBranch },
      intentionallyExcluded: [
        'mutable Agentic OS source checkout',
        'local Atlas snapshot blobs and SQLite navigation index',
        'transcript pages and private runtime state',
        'machine-local filesystem locators',
        'product/effect/completion proof',
      ],
      sourceInputs: inputDescriptors,
      artifacts,
      artifactsSha256: sha256(canonicalJson(artifacts)),
    }
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`
    assertPublicBytes('public-site-manifest.json', manifestBytes)
    write(staging, 'public-site-manifest.json', manifestBytes)
    cpSync(staging, output, { recursive: true })
    return { output, manifest }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function usage() {
  return 'Usage: node bin/build-public-pages.mjs [--out <directory>]'
}

function main(argv) {
  const args = argv.slice(2)
  const index = args.indexOf('--out')
  if (index !== -1 && (!args[index + 1] || index + 2 !== args.length)) throw new Error(usage())
  if (index === -1 && args.length) throw new Error(usage())
  const result = buildPublicPages({ out: index === -1 ? DEFAULT_OUTPUT : args[index + 1] })
  process.stdout.write(`${JSON.stringify({ status: 'built-public-historical-atlas', output: result.output, artifactCount: result.manifest.artifacts.length, sourceCommit: result.manifest.generatedFrom.sourceCommit })}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main(process.argv)
