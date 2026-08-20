import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  captureAtlasBuildBasisV2,
  compileAtlasBuildProfileV2,
  finalizeAtlasBuildBasisV2,
  verifyAtlasBuildBasisCurrentV2,
} from '../src/build-input-authority.mjs'
import { createAtlasServer } from '../src/atlas-server.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const atlasCli = path.join(projectRoot, 'bin', 'atlas.mjs')

function write(root, relative, bytes) {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, bytes)
  return absolute
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-basis-repository-'))
  write(root, 'src/main.mjs', 'export function main() { return 42 }\n')
  write(root, 'README.md', '# Fixture\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  const inputsRoot = mkdtempSync(path.join(tmpdir(), 'arc-atlas-basis-inputs-'))
  const ontologyPath = write(inputsRoot, 'ontology.json', `${JSON.stringify({
    schemaVersion: 'arc-atlas-ontology-source-v1',
    title: 'Fixture ontology',
    northStar: 'Explain the fixture.',
    organs: [{
      id: 'fixture', name: 'Fixture', summary: 'The complete fixture.', thesis: 'Every file is visible.',
      match: { include: ['**'] }, sourceRefs: [{ path: 'README.md', line: 1 }], mitigates: [],
    }],
    pitfalls: [{ id: 'hidden', name: 'Hidden work', description: 'A file disappears.', sourceRefs: [{ path: 'README.md', line: 1 }] }],
    journeys: [{ id: 'tour', name: 'Tour', summary: 'See the fixture.', sourceRefs: [{ path: 'README.md', line: 1 }], steps: [{ id: 'start', name: 'Start', organIds: ['fixture'] }] }],
  }, null, 2)}\n`)
  return { root, inputsRoot, ontologyPath }
}

function locator(absolute) {
  return { root: 'absolute', path: absolute }
}

function notUsed() {
  return { state: 'not-used' }
}

function profile({ repository, ontologyPath }) {
  return {
    schemaVersion: 'arc-atlas-build-profile-v2',
    profileId: 'fixture',
    sourceRepository: {
      locator: locator(repository),
      inventory: 'git-ls-files-cached-others-exclude-standard-v1',
    },
    inputs: {
      codeGraph: notUsed(),
      ontology: locator(ontologyPath),
      componentReviews: [],
      transcript: notUsed(),
      scopePolicy: notUsed(),
      documentPolicy: notUsed(),
      languageParserPolicy: notUsed(),
    },
  }
}

function writeProfile(inputsRoot, value, name = 'build-profile.json') {
  return write(inputsRoot, name, `${JSON.stringify(value, null, 2)}\n`)
}

test('static profile contains locators only while generated basis binds every mutable byte', () => {
  const { root, inputsRoot, ontologyPath } = fixture()
  const profilePath = writeProfile(inputsRoot, profile({ repository: root, ontologyPath }))
  const authority = compileAtlasBuildProfileV2({ profilePath, builderRoot: projectRoot, repositoryOverride: root })
  assert.equal(authority.profile.schemaVersion, 'arc-atlas-build-profile-v2')
  assert.equal(JSON.stringify(authority.profile).includes('sha256'), false)
  assert.equal(authority.resolved.ontologyPath, ontologyPath)

  const first = captureAtlasBuildBasisV2({ authority, outputRoot: path.join(inputsRoot, 'snapshot') })
  const basis = finalizeAtlasBuildBasisV2({ capture: first, derived: { componentReviewBasisSha256: null } })
  assert.equal(basis.schemaVersion, 'arc-atlas-build-basis-v2')
  assert.equal(basis.source.visibleInventory.count, 2)
  assert.match(basis.source.visibleInventory.entries.find(entry => entry.path === 'src/main.mjs').sha256, /^[a-f0-9]{64}$/)
  assert.equal(basis.inputs.ontology.sha256, authority.descriptor.sha256 === basis.inputs.ontology.sha256 ? 'profile-cannot-alias-input' : basis.inputs.ontology.sha256)
  assert.match(basis.builder.source.sha256, /^[a-f0-9]{64}$/)
  assert.match(basis.builder.runtime.node.executable.sha256, /^[a-f0-9]{64}$/)
  assert.equal(verifyAtlasBuildBasisCurrentV2(basis, { authority, outputRoot: path.join(inputsRoot, 'snapshot') }).state, 'current-at-verified-at')

  writeFileSync(ontologyPath, `${readFileSync(ontologyPath, 'utf8')}\n`)
  const stale = verifyAtlasBuildBasisCurrentV2(basis, { authority, outputRoot: path.join(inputsRoot, 'snapshot') })
  assert.equal(stale.state, 'stale')
  assert.equal(stale.checks.some(check => check.id === 'input:ontology' && check.status === 'changed'), true)
})

test('atlas build is driven by the closed profile and persists its exact basis in snapshot identity', () => {
  const { root, inputsRoot, ontologyPath } = fixture()
  const profilePath = writeProfile(inputsRoot, profile({ repository: root, ontologyPath }))
  const output = path.join(inputsRoot, 'snapshot')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', root, '--out', output, '--build-inputs', profilePath], { cwd: projectRoot })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const basis = JSON.parse(readFileSync(path.join(output, 'data', 'build-basis.json'), 'utf8'))
  assert.equal(manifest.gates.buildInputProvenance.status, 'pass')
  assert.equal(basis.schemaVersion, 'arc-atlas-build-basis-v2')
  assert.equal(basis.basisSha256, manifest.build.basisSha256)
  assert.equal(manifest.snapshot.basisSha256, basis.basisSha256)
  assert.equal(manifest.artifacts.some(artifact => artifact.path === 'data/build-basis.json'), true)

  const packet = JSON.parse(execFileSync(process.execPath, [
    atlasCli,
    'packet',
    '--snapshot', output,
    '--query', 'main',
  ], { cwd: projectRoot, encoding: 'utf8' }))
  assert.equal(packet.snapshot.servingMode, 'current')
  assert.equal(packet.snapshot.freshness.status, 'current-at-verified-at')
  assert.equal(packet.matches[0].source.sourceState, 'current-source-file-exactly-matches-snapshot')
})

test('current serving refuses undeclared build provenance even when its copied bytes match the live source', () => {
  const { root, inputsRoot, ontologyPath } = fixture()
  const profilePath = writeProfile(inputsRoot, profile({ repository: root, ontologyPath }))
  const genuine = path.join(inputsRoot, 'genuine')
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', root, '--out', genuine, '--build-inputs', profilePath], { cwd: projectRoot })

  const forged = path.join(inputsRoot, 'forged')
  const web = path.join(inputsRoot, 'web')
  const uiBytes = '{"schemaVersion":"forged-ui"}\n'
  const genuineBasis = readFileSync(path.join(genuine, 'data', 'build-basis.json'))
  const genuineInputs = readFileSync(path.join(genuine, 'data', 'build-inputs.json'))
  write(forged, 'data/ui/manifest.json', uiBytes)
  write(forged, 'data/build-basis.json', genuineBasis)
  write(forged, 'data/build-inputs.json', genuineInputs)
  write(forged, 'manifest.json', `${JSON.stringify({
    schemaVersion: 'arc-repository-atlas-v3',
    snapshot: { repositoryRoot: root, snapshotSha256: 'f'.repeat(64), basisSha256: '0'.repeat(64) },
    build: { basisSha256: '1'.repeat(64), buildInputSha256: '2'.repeat(64) },
    gates: { buildInputProvenance: { status: 'pass' } },
    artifacts: [{ path: 'data/ui/manifest.json', bytes: uiBytes.length, sha256: sha256(uiBytes) }],
  })}\n`)
  write(web, 'index.html', '<!doctype html><title>Atlas fixture</title>')

  assert.throws(
    () => createAtlasServer({ snapshotRoot: forged, webRoot: web, mode: 'current' }),
    /reason: snapshot build provenance artifacts must be declared/i,
  )
})

test('current serving refuses a manifest whose declared provenance disagrees with its exact basis', () => {
  const { root, inputsRoot, ontologyPath } = fixture()
  const profilePath = writeProfile(inputsRoot, profile({ repository: root, ontologyPath }))
  const output = path.join(inputsRoot, 'snapshot')
  const web = path.join(inputsRoot, 'web')
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', root, '--out', output, '--build-inputs', profilePath], { cwd: projectRoot })
  const manifestPath = path.join(output, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.sources.buildInputs.basisSha256 = 'f'.repeat(64)
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`)
  write(web, 'index.html', '<!doctype html><title>Atlas fixture</title>')

  assert.throws(
    () => createAtlasServer({ snapshotRoot: output, webRoot: web, mode: 'current' }),
    /reason: snapshot manifest, declared build provenance artifacts, source summary, and build-input gate must cross-bind/i,
  )
})

test('closed profile rejects ambiguity, omission, traversal, and caller override', async t => {
  const { root, inputsRoot, ontologyPath } = fixture()
  const valid = profile({ repository: root, ontologyPath })

  await t.test('duplicate JSON key', () => {
    const bytes = `${JSON.stringify(valid).replace('"profileId":"fixture"', '"profileId":"fixture","profileId":"forged"')}\n`
    const profilePath = write(inputsRoot, 'duplicate.json', bytes)
    assert.throws(() => compileAtlasBuildProfileV2({ profilePath, builderRoot: projectRoot, repositoryOverride: root }), /duplicate JSON object key/)
  })

  await t.test('unknown key', () => {
    const profilePath = writeProfile(inputsRoot, { ...valid, surprise: true }, 'unknown.json')
    assert.throws(() => compileAtlasBuildProfileV2({ profilePath, builderRoot: projectRoot, repositoryOverride: root }), /must contain exactly/)
  })

  await t.test('omitted required role', () => {
    const omitted = structuredClone(valid)
    delete omitted.inputs.documentPolicy
    const profilePath = writeProfile(inputsRoot, omitted, 'omitted.json')
    assert.throws(() => compileAtlasBuildProfileV2({ profilePath, builderRoot: projectRoot, repositoryOverride: root }), /must contain exactly/)
  })

  await t.test('path traversal', () => {
    const escaped = structuredClone(valid)
    escaped.inputs.ontology = { root: 'atlas-project', path: '../secret.json' }
    const profilePath = writeProfile(inputsRoot, escaped, 'traversal.json')
    assert.throws(() => compileAtlasBuildProfileV2({ profilePath, builderRoot: projectRoot, repositoryOverride: root }), /safe relative path/)
  })

  await t.test('caller source repository override', () => {
    const other = fixture().root
    const profilePath = writeProfile(inputsRoot, valid, 'override.json')
    assert.throws(() => compileAtlasBuildProfileV2({ profilePath, builderRoot: projectRoot, repositoryOverride: other }), /source repository override/)
  })

  await t.test('caller semantic override', () => {
    const otherOntology = write(inputsRoot, 'other-ontology.json', '{}\n')
    const profilePath = writeProfile(inputsRoot, valid, 'semantic-override.json')
    assert.throws(() => compileAtlasBuildProfileV2({
      profilePath,
      builderRoot: projectRoot,
      repositoryOverride: root,
      supplied: { ontologyPath: otherOntology },
    }), /ontology override/)
  })
})

test('transcript append and source mutation are distinguishable freshness blockers', () => {
  const { root, inputsRoot, ontologyPath } = fixture()
  const transcriptPath = write(inputsRoot, 'rollout.jsonl', '{"type":"session_meta"}\n')
  const reviewPath = write(inputsRoot, 'review.json', '{"schemaVersion":"fixture-review"}\n')
  const configured = profile({ repository: root, ontologyPath })
  configured.inputs.transcript = {
    source: locator(transcriptPath),
    review: locator(reviewPath),
    threadId: 'fixture-thread',
  }
  const profilePath = writeProfile(inputsRoot, configured)
  const authority = compileAtlasBuildProfileV2({ profilePath, builderRoot: projectRoot, repositoryOverride: root })
  const basis = finalizeAtlasBuildBasisV2({
    capture: captureAtlasBuildBasisV2({ authority, outputRoot: path.join(inputsRoot, 'snapshot') }),
    derived: { componentReviewBasisSha256: null },
  })

  writeFileSync(transcriptPath, `${readFileSync(transcriptPath, 'utf8')}{"type":"event_msg"}\n`)
  const appended = verifyAtlasBuildBasisCurrentV2(basis, { authority, outputRoot: path.join(inputsRoot, 'snapshot') })
  assert.equal(appended.state, 'stale')
  assert.equal(appended.checks.find(check => check.id === 'input:transcript-source').reason, 'append-only-unreviewed')

  writeFileSync(transcriptPath, `X${readFileSync(transcriptPath, 'utf8').slice(1)}`)
  const changed = verifyAtlasBuildBasisCurrentV2(basis, { authority, outputRoot: path.join(inputsRoot, 'snapshot') })
  assert.equal(changed.checks.find(check => check.id === 'input:transcript-source').reason, 'input-bytes-changed')
})
