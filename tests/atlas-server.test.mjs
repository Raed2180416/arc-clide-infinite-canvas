import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createAtlasServer } from '../src/atlas-server.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const atlasCli = path.join(projectRoot, 'bin', 'atlas.mjs')

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function write(root, relative, bytes) { const absolute = path.join(root, relative); mkdirSync(path.dirname(absolute), { recursive: true }); writeFileSync(absolute, bytes) }

test('atlas server exposes one verified snapshot, SPA shell, and no undeclared or traversed files', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-server-'))
  const snapshot = path.join(root, 'snapshot')
  const web = path.join(root, 'web')
  const artifactBytes = '{"hello":"atlas"}\n'
  write(snapshot, 'data/ui/manifest.json', artifactBytes)
  write(snapshot, 'secret.txt', 'must not be served')
  const manifest = {
    schemaVersion: 'arc-repository-atlas-v3', authority: 'read-only-derived-projection',
    snapshot: { snapshotSha256: 'a'.repeat(64), git: { head: 'b'.repeat(40), branch: 'fixture', dirty: false } },
    gates: { fileDenominator: { status: 'pass', reason: 'fixture' } },
    artifacts: [{ path: 'data/ui/manifest.json', bytes: Buffer.byteLength(artifactBytes), sha256: sha256(artifactBytes) }],
  }
  write(snapshot, 'manifest.json', `${JSON.stringify(manifest)}\n`)
  write(web, 'index.html', '<!doctype html><title>Atlas shell</title>')
  write(web, 'assets/app.js', 'console.log("atlas")')
  assert.throws(
    () => createAtlasServer({ snapshotRoot: snapshot, webRoot: web }),
    /atlas current-serving requires a fresh closed build basis; use mode: 'historical'/,
  )

  const server = createAtlasServer({ snapshotRoot: snapshot, webRoot: web, mode: 'historical' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  assert.equal(typeof address, 'object')
  const origin = `http://127.0.0.1:${address.port}`

  const health = await fetch(`${origin}/__atlas/health`).then(response => response.json())
  assert.equal(health.snapshotSha256, 'a'.repeat(64))
  assert.equal(health.blockingGates.length, 0)
  assert.equal(health.servingMode, 'historical')
  assert.equal(health.freshness.status, 'historical-only')
  assert.match(await fetch(`${origin}/`).then(response => response.text()), /Atlas shell/)
  assert.equal((await fetch(`${origin}/atlas-snapshot/data/ui/manifest.json`)).status, 200)
  assert.equal((await fetch(`${origin}/atlas-snapshot/secret.txt`)).status, 404)
  assert.equal((await fetch(`${origin}/atlas-snapshot/%2e%2e%2fsecret.txt`)).status, 404)
  assert.match(await fetch(`${origin}/deep/link`).then(response => response.text()), /Atlas shell/)
})

test('atlas server refuses a snapshot whose declared artifact has drifted', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-server-tamper-'))
  const snapshot = path.join(root, 'snapshot')
  const web = path.join(root, 'web')
  write(snapshot, 'data/value.json', '{}\n')
  write(snapshot, 'manifest.json', `${JSON.stringify({ snapshot: { snapshotSha256: 'a'.repeat(64) }, gates: {}, artifacts: [{ path: 'data/value.json', sha256: '0'.repeat(64), bytes: 3 }] })}\n`)
  write(web, 'index.html', 'atlas')
  assert.throws(() => createAtlasServer({ snapshotRoot: snapshot, webRoot: web }), /artifact digest mismatch/)
})

test('atlas server navigates canonical symbols and relationships without duplicated UI corpora', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-server-navigation-'))
  const repository = path.join(root, 'repository')
  const snapshot = path.join(root, 'snapshot')
  const web = path.join(root, 'web')
  write(repository, 'src/main.mjs', "import { answer } from './value.mjs'\nexport function start() { return answer() }\n")
  write(repository, 'src/value.mjs', 'export function answer() { return 42 }\n')
  write(repository, 'README.md', '# Navigation fixture\n')
  execFileSync('git', ['init', '-q'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: repository })
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository })
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', snapshot], { cwd: projectRoot })
  write(web, 'index.html', '<!doctype html><title>Atlas shell</title>')

  const uiManifest = JSON.parse(readFileSync(path.join(snapshot, 'data', 'ui', 'manifest.json'), 'utf8'))
  assert.equal(uiManifest.navigation.schemaVersion, 'arc-atlas-navigation-index-v1')
  assert.equal(uiManifest.loading.lazySearch, null)
  assert.deepEqual(uiManifest.shards.entities, {})
  assert.deepEqual(uiManifest.shards.relations, {})
  assert.equal((JSON.parse(readFileSync(path.join(snapshot, 'manifest.json'), 'utf8')).artifacts || []).some(artifact => artifact.path === 'data/ui/search-index.json'), false)

  const server = createAtlasServer({ snapshotRoot: snapshot, webRoot: web, mode: 'historical' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  assert.equal(typeof address, 'object')
  const origin = `http://127.0.0.1:${address.port}`

  const search = await fetch(`${origin}/__atlas/api/search?q=start&limit=5`).then(response => response.json())
  assert.equal(search.schemaVersion, 'arc-atlas-navigation-search-result-v1')
  assert.equal(search.records.length, 1)
  assert.equal(search.records[0].name, 'start')
  const symbol = await fetch(`${origin}/__atlas/api/symbol?id=${encodeURIComponent(search.records[0].id)}`).then(response => response.json())
  assert.equal(symbol.schemaVersion, 'arc-atlas-navigation-symbol-result-v1')
  assert.equal(symbol.symbol.id, search.records[0].id)
  assert.equal(symbol.symbol.operationalBehavior.events.length > 0, true)
  assert.equal(symbol.source.fileSha256.length, 64)
  const relations = await fetch(`${origin}/__atlas/api/relations?id=${encodeURIComponent(search.records[0].id)}`).then(response => response.json())
  assert.equal(relations.schemaVersion, 'arc-atlas-navigation-relations-result-v1')
  assert.equal(relations.records.some(record => record.kind === 'calls-declaration'), true)
})
