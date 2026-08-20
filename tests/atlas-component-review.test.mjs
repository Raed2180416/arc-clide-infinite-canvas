import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(import.meta.dirname, '..')
const atlasCli = path.join(projectRoot, 'bin', 'atlas.mjs')

function write(relative, bytes, root) {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, bytes)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-component-review-'))
  write('docs/runtime.md', '# Runtime organ\nOwns durable execution state.\n', root)
  write('mystery.mjs', 'export function advance() { return "advanced" }\n', root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  const policyRoot = mkdtempSync(path.join(tmpdir(), 'arc-atlas-component-review-policy-'))
  const ontologyPath = path.join(policyRoot, 'ontology.json')
  writeFileSync(ontologyPath, `${JSON.stringify({
    schemaVersion: 'arc-atlas-ontology-source-v1',
    title: 'Fixture ontology',
    northStar: 'Understand every file.',
    organs: [{
      id: 'runtime',
      name: 'Runtime',
      summary: 'Runs durable work.',
      thesis: 'Execution state must be durable.',
      match: { include: ['docs/**'] },
      sourceRefs: [{ path: 'docs/runtime.md', line: 1 }],
      mitigates: [],
    }, {
      id: 'repository-surface',
      name: 'Unresolved substrate',
      summary: 'Temporary fallback only.',
      thesis: 'Fallback is never semantic completion.',
      match: { include: ['**'] },
      fallback: true,
      sourceRefs: [{ path: 'docs/runtime.md', line: 1 }],
      mitigates: [],
    }],
    pitfalls: [{ id: 'unknown-file', name: 'Unknown file', description: 'A file has no reviewed home.', sourceRefs: [{ path: 'docs/runtime.md', line: 1 }] }],
    journeys: [{ id: 'tour', name: 'Tour', summary: 'Tour runtime.', sourceRefs: [{ path: 'docs/runtime.md', line: 1 }], steps: [{ id: 'runtime', name: 'Runtime', organIds: ['runtime'] }] }],
  }, null, 2)}\n`)
  return { root, ontologyPath, policyRoot }
}

function fallbackBasis(root, ontologyPath) {
  const output = mkdtempSync(path.join(tmpdir(), 'arc-atlas-component-review-basis-'))
  execFileSync(process.execPath, [
    atlasCli, 'build', '--repo', root, '--out', output,
    '--ontology', ontologyPath,
  ], { cwd: projectRoot })
  const ontology = JSON.parse(readFileSync(path.join(output, 'data', 'ontology.json'), 'utf8'))
  return ontology.coverage.fallbackReviewBasisSha256
}

function reviewLedger(root, basisSha256, overrides = {}) {
  const fileBytes = readFileSync(path.join(root, 'mystery.mjs'))
  return {
    schemaVersion: 'arc-atlas-component-organ-review-v2',
    repositoryHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    fallbackBasisSha256: basisSha256,
    shard: 'fixture',
    reviewer: { identity: 'codex:fixture-reviewer', basis: 'explicit-file-by-file-review' },
    denominator: { eligible: 1, reviewed: 1, proposedNewOrgan: 0, unresolved: 0 },
    entries: [{
      path: 'mystery.mjs',
      fileSha256: sha256(fileBytes),
      disposition: 'existing-organ',
      primaryOrganId: 'runtime',
      secondaryOrganIds: [],
      proposedNewOrgan: null,
      plainLanguagePurpose: 'Advances one durable runtime step and returns the observed result.',
      rationale: 'The exported advance operation is an execution step, so the runtime organ is its reviewed home.',
      sourceRefs: [
        { path: 'mystery.mjs', line: 1, role: 'component-behavior' },
        { path: 'docs/runtime.md', line: 1, role: 'organ-definition' },
      ],
      confidence: 'reviewed-high',
      unresolvedQuestions: [],
      ...overrides,
    }],
  }
}

test('an exact source-addressed component review replaces only fallback classification', () => {
  const { root, ontologyPath, policyRoot } = fixture()
  const reviewPath = path.join(policyRoot, 'review.json')
  writeFileSync(reviewPath, `${JSON.stringify(reviewLedger(root, fallbackBasis(root, ontologyPath)), null, 2)}\n`)
  const output = path.join(root, '.atlas-output')

  execFileSync(process.execPath, [
    atlasCli, 'build', '--repo', root, '--out', output,
    '--ontology', ontologyPath,
    '--component-reviews', reviewPath,
  ], { cwd: projectRoot })

  const components = JSON.parse(readFileSync(path.join(output, 'data', 'components.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const component = components.find(item => item.path === 'mystery.mjs')
  assert.equal(component.primaryOrganId, 'runtime')
  assert.deepEqual(component.organIds, ['runtime', 'repository-surface'])
  assert.equal(component.classification.authority, 'source-addressed-file-review-below-protected-ontology')
  assert.equal(component.classification.plainLanguagePurpose, 'Advances one durable runtime step and returns the observed result.')
  assert.equal(manifest.gates.ontology.status, 'pass')
})

test('component reviews reject source drift and incomplete fallback denominators', async t => {
  const { root, ontologyPath, policyRoot } = fixture()
  const basisSha256 = fallbackBasis(root, ontologyPath)
  const run = ledger => {
    const reviewPath = path.join(policyRoot, `review-${Math.random().toString(16).slice(2)}.json`)
    writeFileSync(reviewPath, `${JSON.stringify(ledger, null, 2)}\n`)
    return () => execFileSync(process.execPath, [
      atlasCli, 'build', '--repo', root, '--out', path.join(root, `.atlas-${Math.random().toString(16).slice(2)}`),
      '--ontology', ontologyPath,
      '--component-reviews', reviewPath,
    ], { cwd: projectRoot, stdio: 'pipe' })
  }
  await t.test('source drift', () => {
    assert.throws(run(reviewLedger(root, basisSha256, { fileSha256: 'f'.repeat(64) })), /component review does not bind current file bytes/)
  })
  await t.test('missing fallback entry', () => {
    const ledger = reviewLedger(root, basisSha256)
    ledger.entries = []
    ledger.denominator.eligible = 0
    ledger.denominator.reviewed = 0
    ledger.denominator.unresolved = 0
    assert.throws(run(ledger), /component review shards do not exactly cover the fallback denominator/)
  })
  await t.test('ontology or denominator transplant', () => {
    assert.throws(run(reviewLedger(root, 'f'.repeat(64))), /component review does not bind the current fallback review basis/)
  })
})
