#!/usr/bin/env node
/**
 * Generate a per-module DEEP DIGEST from the gate-clean atlas snapshot.
 *
 * For every one of the 204 modules, this reads the snapshot's real symbol
 * corpus (brotli shards) and produces a source-derived digest of what the
 * module's files actually contain: functions, classes, methods, signatures,
 * and purpose summaries. This is the "deeply explained" layer that turns the
 * component census into an explanation of what each component DOES.
 *
 * Outputs:
 *   - MODULE-DIGESTS.json   (machine-readable; module -> file -> symbols)
 *   - MODULE-DIGESTS.md     (human-readable; per-module digests)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJsonArtifact } from './src/artifact-codec.mjs'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const snapshotDir = path.join(outDir, 'snapshots', 'agentic-os', 'current')
const symbolsManifestPath = path.join(snapshotDir, 'data', 'symbols.json')
const componentMapPath = path.join(outDir, 'COMPLETE-COMPONENT-MAP.json')
const filesPath = path.join(snapshotDir, 'data', 'files.json')

if (!existsSync(symbolsManifestPath)) throw new Error('missing symbols manifest: ' + symbolsManifestPath)
if (!existsSync(componentMapPath)) throw new Error('missing component map: ' + componentMapPath)
if (!existsSync(filesPath)) throw new Error('missing files.json: ' + filesPath)

const componentMap = JSON.parse(readFileSync(componentMapPath, 'utf8'))
const symbolsManifest = JSON.parse(readFileSync(symbolsManifestPath, 'utf8'))
const allFiles = JSON.parse(readFileSync(filesPath, 'utf8'))

// ---- 1. Read every symbol from the brotli shards via the verified codec.
function readShard(descriptor) {
  const value = readJsonArtifact({ root: snapshotDir, descriptor })
  if (!Array.isArray(value) || value.length !== descriptor.count) {
    throw new Error('symbol shard denominator mismatch: ' + descriptor.path)
  }
  return value
}

const symbols = []
if (Array.isArray(symbolsManifest)) {
  symbols.push(...symbolsManifest)
} else if (symbolsManifest.schemaVersion === 'arc-atlas-symbol-artifact-manifest-v1') {
  for (const shard of symbolsManifest.sequence.shards) {
    symbols.push(...readShard(shard))
  }
} else {
  throw new Error('unsupported symbols manifest schema')
}

// ---- 2. Index symbols by file path.
const symbolsByFile = new Map()
for (const symbol of symbols) {
  if (!symbolsByFile.has(symbol.path)) symbolsByFile.set(symbol.path, [])
  symbolsByFile.get(symbol.path).push(symbol)
}

// ---- 3. Build a module -> files -> symbols digest.
function digestSymbol(symbol) {
  return {
    name: symbol.name,
    kind: symbol.kind,
    signature: (symbol.signature || '').slice(0, 200),
    startLine: symbol.start?.line,
    endLine: symbol.end?.line,
    purpose: symbol.purpose?.status === 'source-authored' ? (symbol.purpose.summary || '').slice(0, 200) : null,
    callable: symbol.declaration?.callable ?? null,
  }
}

// ---- 3b. Build the complete per-file digest for EVERY symbol-bearing file.
const moduleFileIds = new Set()
for (const plane of componentMap.planes) for (const mod of plane.modules) for (const f of mod.files) moduleFileIds.add(f)
const completeFiles = allFiles
  .filter(file => symbolsByFile.has(file.path))
  .map(file => {
    const fileSymbols = symbolsByFile.get(file.path)
    return {
      path: file.path,
      language: file.language || null,
      fileClass: file.fileClass,
      symbolCount: fileSymbols.length,
      callableCount: fileSymbols.filter(s => s.declaration?.callable).length,
      authoredPurposeCount: fileSymbols.filter(s => s.purpose?.status === 'source-authored').length,
    }
  })
  .sort((a, b) => a.path.localeCompare(b.path))

// Group the complete file digests by top-level path (scripts/, apps/, benchmarks/, etc.)
const completeByGroup = new Map()
for (const fd of completeFiles) {
  const group = fd.path.includes('/') ? fd.path.split('/')[0] : '<root>'
  if (!completeByGroup.has(group)) completeByGroup.set(group, [])
  completeByGroup.get(group).push(fd)
}
const completeGroups = [...completeByGroup.entries()]
  .map(([id, files]) => ({
    id,
    fileCount: files.length,
    totalSymbols: files.reduce((n, f) => n + f.symbolCount, 0),
    callableCount: files.reduce((n, f) => n + f.callableCount, 0),
    files,
  }))
  .sort((a, b) => a.id.localeCompare(b.id))

const moduleDigests = componentMap.planes.map(plane => ({
  id: plane.id,
  label: plane.label,
  modules: plane.modules.map(mod => {
    const fileDigests = mod.files
      .filter(f => symbolsByFile.has(f))
      .map(f => {
        const fileSymbols = symbolsByFile.get(f)
        return {
          path: f,
          symbolCount: fileSymbols.length,
          symbols: fileSymbols
            .sort((a, b) => (a.start?.line || 0) - (b.start?.line || 0))
            .map(digestSymbol),
        }
      })
    const totalSymbols = fileDigests.reduce((n, fd) => n + fd.symbolCount, 0)
    const callableCount = fileDigests.reduce((n, fd) => n + fd.symbols.filter(s => s.callable).length, 0)
    const authoredPurposeCount = fileDigests.reduce((n, fd) => n + fd.symbols.filter(s => s.purpose).length, 0)
    return {
      id: mod.id,
      name: mod.name,
      status: mod.status,
      fileCount: mod.files.length,
      filesWithSymbols: fileDigests.length,
      totalSymbols,
      callableCount,
      authoredPurposeCount,
      files: fileDigests,
    }
  }),
}))

const completeTotals = completeGroups.reduce(
  (acc, g) => ({ fileCount: acc.fileCount + g.fileCount, totalSymbols: acc.totalSymbols + g.totalSymbols, callableCount: acc.callableCount + g.callableCount }),
  { fileCount: 0, totalSymbols: 0, callableCount: 0 },
)

const digest = {
  schemaVersion: 'arc-clide-module-digests-v1',
  authority: 'source-addressed-snapshot-symbol-corpus',
  generatedAt: new Date().toISOString(),
  snapshotSha256: componentMap.snapshot.sha256,
  totals: {
    modules: moduleDigests.reduce((n, p) => n + p.modules.length, 0),
    filesWithSymbols: moduleDigests.reduce((n, p) => n + p.modules.reduce((m, mod) => m + mod.filesWithSymbols, 0), 0),
    totalSymbols: moduleDigests.reduce((n, p) => n + p.modules.reduce((m, mod) => m + mod.totalSymbols, 0), 0),
    callableCount: moduleDigests.reduce((n, p) => n + p.modules.reduce((m, mod) => m + mod.callableCount, 0), 0),
    authoredPurposeCount: moduleDigests.reduce((n, p) => n + p.modules.reduce((m, mod) => m + mod.authoredPurposeCount, 0), 0),
    complete: completeTotals,
  },
  planes: moduleDigests,
  completeByDirectory: completeGroups,
}

writeFileSync(path.join(outDir, 'MODULE-DIGESTS.json'), JSON.stringify(digest, null, 2) + '\n')
writeFileSync(path.join(outDir, 'COMPLETE-FILE-DIGESTS.json'), `${JSON.stringify({ schemaVersion: 'arc-clide-file-digests-v1', snapshotSha256: componentMap.snapshot.sha256, completeGroups, completeTotals }, null, 2)}\n`)

// ---- 4. Human-readable Markdown.
const statusLabel = {
  authority: 'SOLE AUTHORITY / CONSTITUTION',
  live: 'LIVE / DEFAULT',
  partial: 'LIVE / PARTIAL',
  substrate: 'EXISTS / DARK OR NON-PROMOTIONAL',
  blocked: 'MISSING / LAUNCH BLOCKER',
  external: 'OPTIONAL EXTERNAL / PATTERN ONLY',
}
const lines = []
lines.push('# ARC / CLIDE — Per-Module Deep Digests (what every component actually does)')
lines.push('')
lines.push('> Machine-generated from the gate-clean atlas snapshot symbol corpus. For every module,')
lines.push('> this lists the real functions, classes, methods, and signatures its files contain —')
lines.push('> the source-derived explanation of what each component DOES, not just what it is.')
lines.push('')
lines.push(`**Generated:** ${digest.generatedAt}`)
lines.push(`**Snapshot SHA-256:** ${digest.snapshotSha256}`)
lines.push(`**Totals:** ${digest.totals.modules} modules · ${digest.totals.filesWithSymbols} files with symbols · ${digest.totals.totalSymbols} symbols · ${digest.totals.callableCount} callable · ${digest.totals.authoredPurposeCount} with source-authored purpose`)
lines.push('')
for (const plane of digest.planes) {
  lines.push(`## ${plane.label}`)
  lines.push('')
  for (const mod of plane.modules) {
    const status = statusLabel[mod.status] || mod.status
    lines.push(`### ${mod.name} — ${status}`)
    lines.push(`- **Files:** ${mod.fileCount} (${mod.filesWithSymbols} with symbols) · **Symbols:** ${mod.totalSymbols} · **Callable:** ${mod.callableCount} · **Authored purpose:** ${mod.authoredPurposeCount}`)
    for (const fd of mod.files) {
      lines.push(`- \`${fd.path}\` (${fd.symbolCount} symbols)`)
      for (const s of fd.symbols.slice(0, 40)) {
        const sig = s.signature ? ` — \`${s.signature}\`` : ''
        const purpose = s.purpose ? ` — *${s.purpose}*` : ''
        lines.push(`  - ${s.kind} \`${s.name}\`${sig}${purpose}`)
      }
      if (fd.symbols.length > 40) lines.push(`  - … and ${fd.symbols.length - 40} more symbols`)
    }
    lines.push('')
  }
}
writeFileSync(path.join(outDir, 'MODULE-DIGESTS.md'), lines.join('\n'))

console.log(JSON.stringify({
  modules: digest.totals.modules,
  filesWithSymbols: digest.totals.filesWithSymbols,
  totalSymbols: digest.totals.totalSymbols,
  callableCount: digest.totals.callableCount,
  authoredPurposeCount: digest.totals.authoredPurposeCount,
}, null, 2))