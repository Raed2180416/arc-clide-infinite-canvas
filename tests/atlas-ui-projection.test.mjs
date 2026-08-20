import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readJsonArtifact } from '../src/artifact-codec.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const atlasCli = path.join(projectRoot, 'bin', 'atlas.mjs')

function write(relative, bytes, root) {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, bytes)
}

test('atlas build emits a small deterministic overview and lazy exact-detail projections', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-ui-'))
  write('src/main.mjs', 'export function start(value) { return value + 1 }\n', repository)
  write('README.md', '# UI fixture\n', repository)
  execFileSync('git', ['init', '-q'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: repository })
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository })
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  const uiManifest = JSON.parse(readFileSync(path.join(output, 'data', 'ui', 'manifest.json'), 'utf8'))
  const overview = JSON.parse(readFileSync(path.join(output, 'data', 'ui', 'overview.json'), 'utf8'))
  const quality = JSON.parse(readFileSync(path.join(output, 'data', 'ui', 'quality.json'), 'utf8'))

  assert.equal(uiManifest.schemaVersion, 'arc-atlas-ui-projection-v3')
  assert.deepEqual(uiManifest.canonicalCorpora, {
    symbols: 'data/symbols.json',
    relationships: 'data/relationships.json',
  })
  assert.equal(uiManifest.physicalEncoding.canonicalLargeArtifacts, 'brotli-minified-json-utf8-v1')
  assert.equal(uiManifest.navigation.schemaVersion, 'arc-atlas-navigation-index-v1')
  assert.equal(uiManifest.navigation.authority, 'non-authoritative-deterministic-navigation-index')
  assert.equal(uiManifest.loading.lazySearch, null)
  assert.deepEqual(uiManifest.shards.entities, {})
  assert.deepEqual(uiManifest.shards.relations, {})
  assert.equal(existsSync(path.join(output, 'data', 'ui', 'search-index.json')), false)
  assert.ok(uiManifest.loading.initialBytes <= 1_500_000)
  assert.equal(overview.nodes.filter(node => node.kind === 'repository').length, 1)
  assert.equal(overview.nodes.filter(node => node.kind === 'file').length, 0)
  assert.equal(overview.nodes.some(node => node.kind === 'symbol'), false)
  assert.ok(overview.nodes.every(node => Number.isFinite(node.position.x)))
  const canonicalSymbolManifest = JSON.parse(readFileSync(path.join(output, 'data', 'symbols.json'), 'utf8'))
  assert.equal(canonicalSymbolManifest.physicalEncoding, 'brotli-minified-json-utf8-v1')
  assert.equal(canonicalSymbolManifest.sequence.count, 1)
  const canonicalSymbolDescriptor = canonicalSymbolManifest.sequence.shards[0]
  const canonicalSymbolShard = readJsonArtifact({ root: output, descriptor: canonicalSymbolDescriptor })
  const canonicalSymbol = canonicalSymbolShard[0]
  assert.equal(canonicalSymbol.name, 'start')
  assert.equal(canonicalSymbol.purpose.status, 'source-addressed-unavailable')
  assert.equal(canonicalSymbol.operationalBehavior.events.length > 0, true)
  const canonicalRelationshipManifest = JSON.parse(readFileSync(path.join(output, 'data', 'relationships.json'), 'utf8'))
  assert.equal(canonicalRelationshipManifest.physicalEncoding, 'brotli-minified-json-utf8-v1')
  const relationshipShard = readJsonArtifact({ root: output, descriptor: canonicalRelationshipManifest.sequences.relationships.shards[0] })
  const declaration = relationshipShard.find(relation => relation.target === canonicalSymbol.id && relation.kind === 'declares')
  assert.equal(declaration.observation.authority, 'exact-parser-source-span')
  const rootManifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  assert.equal(rootManifest.artifacts.some(artifact => artifact.path === 'data/ui/search-index.json'), false)
  assert.equal(rootManifest.artifacts.some(artifact => artifact.path === uiManifest.navigation.artifact.path), true)
  assert.equal(quality.counts.exactRelations > 0, true)
  assert.equal(quality.counts.advisoryRelations, 0)
  const unclassifiedDetailPath = uiManifest.shards.organs['repository:unclassified']
  const unclassifiedDetail = JSON.parse(readFileSync(path.join(output, unclassifiedDetailPath), 'utf8'))
  assert.equal(unclassifiedDetail.denominator, 2)
  assert.equal(unclassifiedDetail.nodes.every(node => node.kind === 'file'), true)
})
