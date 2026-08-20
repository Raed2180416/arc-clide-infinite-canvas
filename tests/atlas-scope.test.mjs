import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

test('atlas scope ledger accounts for ignored code without reading or silently omitting it', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-scope-'))
  write('README.md', '# Scope fixture\n', repository)
  write('.gitignore', 'ignored/\nnode_modules/\n', repository)
  write('ignored/private.py', 'SECRET = "must-not-enter-atlas-bytes"\n', repository)
  write('node_modules/example/index.js', 'export const dependency = true\n', repository)
  execFileSync('git', ['init', '-q'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: repository })
  execFileSync('git', ['add', 'README.md', '.gitignore'], { cwd: repository })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository })
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const scope = JSON.parse(readFileSync(path.join(output, 'data', 'scope.json'), 'utf8'))

  assert.equal(scope.schemaVersion, 'arc-atlas-repository-scope-v1')
  assert.equal(scope.ignored.total, 2)
  assert.equal(scope.ignored.codeLike, 2)
  assert.deepEqual(scope.ignored.entries.map(entry => entry.path), [
    'ignored/private.py',
    'node_modules/example/index.js',
  ])
  assert.deepEqual(scope.ignored.entries.map(entry => entry.ignoreRule.pattern), ['ignored/', 'node_modules/'])
  assert.ok(scope.ignored.entries.every(entry => entry.contentRead === false))
  assert.ok(scope.ignored.entries.every(entry => entry.policy.status === 'review-required'))
  assert.equal(JSON.stringify(scope).includes('must-not-enter-atlas-bytes'), false)
  assert.equal(manifest.gates.repositoryScope.status, 'fail')
  assert.equal(manifest.gates.repositoryScope.reason, 'ignored-entries-await-source-addressed-scope-policy')
})

test('source-addressed scope policies classify every matching ignored entry without reading content', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-scope-policy-'))
  write('README.md', '# Scope fixture\n', repository)
  write('.gitignore', 'ignored/\nnode_modules/\n', repository)
  write('ignored/private.py', 'SECRET = "must-stay-unread"\n', repository)
  write('node_modules/example/index.js', 'export const dependency = true\n', repository)
  execFileSync('git', ['init', '-q'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: repository })
  execFileSync('git', ['add', 'README.md', '.gitignore'], { cwd: repository })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository })
  const policyPath = path.join(repository, '..', `${path.basename(repository)}-scope-policies.json`)
  writeFileSync(policyPath, `${JSON.stringify({ schemaVersion: 'arc-atlas-scope-policy-ledger-v1', authority: 'reviewed-scope-classification', policies: [
    { id: 'private', match: { ignorePattern: 'ignored/' }, classification: 'private-local-state', rationale: 'The exact ignore rule reserves this subtree for local private state.', contentPolicy: 'never-read' },
    { id: 'dependencies', match: { ignorePattern: 'node_modules/' }, classification: 'installed-dependencies', rationale: 'Installed third-party dependencies are governed by lockfiles and remain outside source ownership.', contentPolicy: 'metadata-only' },
  ] }, null, 2)}\n`)
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output, '--scope-policies', policyPath], { cwd: projectRoot })
  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const scope = JSON.parse(readFileSync(path.join(output, 'data', 'scope.json'), 'utf8'))
  assert.equal(scope.ignored.policyReviewed, 2)
  assert.equal(scope.ignored.reviewRequired, 0)
  assert.deepEqual(scope.ignored.entries.map(entry => entry.policy.classification), ['private-local-state', 'installed-dependencies'])
  assert.equal(JSON.stringify(scope).includes('must-stay-unread'), false)
  assert.equal(manifest.gates.repositoryScope.status, 'pass')
})
