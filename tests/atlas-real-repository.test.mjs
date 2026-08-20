import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectRoot = path.resolve(import.meta.dirname, '..')
const atlasCli = path.join(projectRoot, 'bin', 'atlas.mjs')
const repository = process.env.ARC_ATLAS_REAL_REPO || '/home/raed/.agentic-os'
const graphDb = process.env.ARC_ATLAS_GRAPH_DB
  || '/home/raed/.local/state/agentic-os/codebase-memory-mcp/agentic-os.db'
const languageParsers = process.env.ARC_ATLAS_LANGUAGE_PARSERS
  || path.join(projectRoot, 'atlas', 'agentic-os-language-parsers.json')
const runRealRepositoryIntegration = process.env.ARC_ATLAS_RUN_REAL_REPOSITORY === '1'

function visiblePaths(root) {
  return execFileSync('git', [
    '-C', root,
    'ls-files', '-z', '--cached', '--others', '--exclude-standard',
  ], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

test('atlas build emits an honest completeness receipt for the current Agentic OS worktree', {
  skip: !runRealRepositoryIntegration || !existsSync(repository) || !existsSync(graphDb),
  timeout: 1_200_000,
}, () => {
  const output = mkdtempSync(path.join(tmpdir(), 'arc-atlas-real-repo-'))
  const denominator = visiblePaths(repository)
  const expectedRegular = denominator.filter(relative => lstatSync(path.join(repository, relative)).isFile()).length

  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--graph-db', graphDb,
    '--graph-project', 'agentic-os',
    '--language-parsers', languageParsers,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const receipt = JSON.parse(readFileSync(path.join(output, 'data', 'completeness.json'), 'utf8'))

  assert.equal(receipt.schemaVersion, 'arc-atlas-completeness-receipt-v1')
  assert.equal(receipt.authority, 'read-only-derived-projection')
  assert.equal(receipt.snapshotSha256, manifest.snapshot.snapshotSha256)
  assert.deepEqual(receipt.denominators.files, {
    visible: denominator.length,
    accounted: denominator.length,
    regular: expectedRegular,
    nonRegular: denominator.length - expectedRegular,
    missing: 0,
  })
  assert.equal(receipt.gates.fileDenominator.status, 'pass')
  assert.equal(receipt.gates.parserOutcomes.status, 'pass')
  assert.equal(receipt.gates.syntaxHealth.status, 'pass')
  assert.equal(receipt.denominators.codeFiles.nativeParserMissing, 0)
  assert.equal(receipt.gates.symbolDenominator.status, 'pass')
  assert.equal(receipt.sources.languageParsers.state, 'observed')
  assert.equal(receipt.denominators.parserOutcomes.total, receipt.denominators.parseEligibleFiles)
  assert.equal(
    Object.values(receipt.denominators.parserOutcomes.byState).reduce((sum, value) => sum + value, 0),
    receipt.denominators.parseEligibleFiles,
  )
  assert.equal(receipt.denominators.symbols.total, manifest.coverage.symbols.total)
  assert.equal(
    receipt.denominators.symbols.exactParserEntities
      + receipt.denominators.symbols.advisoryCandidates,
    receipt.denominators.symbols.total,
  )
  assert.equal(
    receipt.denominators.symbols.sourceAuthoredPurpose
      + receipt.denominators.symbols.reviewedPurpose
      + receipt.denominators.symbols.unavailablePurpose
      + receipt.denominators.symbols.unresolvedPurpose,
    receipt.denominators.symbols.exactParserEntities,
  )
  assert.equal(receipt.denominators.symbols.inferredPurpose, 0)
  assert.equal(receipt.gates.semanticPurpose.status, 'pass')
  assert.equal(receipt.sources.codeGraph.project, 'agentic-os')
  assert.ok(receipt.sources.codeGraph.fileHashes.total > 0)
  assert.equal(receipt.sources.codeGraph.fileHashes.hashed, receipt.sources.codeGraph.fileHashes.total)
  assert.equal(receipt.sources.codeGraph.fileHashes.matchedCurrent, receipt.sources.codeGraph.fileHashes.total)
  assert.equal(receipt.sources.codeGraph.fileHashes.mismatchedCurrent, 0)
  assert.equal(receipt.sources.codeGraph.fileHashes.staleRows, 0)
  assert.equal(receipt.gates.codeGraphFreshness.status, 'pass')
  assert.equal(receipt.gates.productProof.status, 'not-claimed')
  assert.ok(manifest.artifacts.some(artifact => artifact.path === 'data/completeness.json'))
})
