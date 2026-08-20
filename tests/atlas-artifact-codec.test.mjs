import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readJsonArtifact, writeJsonArtifact } from '../src/artifact-codec.mjs'

test('artifact codec preserves one exact JSON value through deterministic Brotli bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-codec-'))
  const value = [{ id: 'symbol:a', nested: { answer: 42 } }, { id: 'symbol:b', text: 'exact bytes' }]
  const first = writeJsonArtifact({ root, path: 'data/example.json', value, contentEncoding: 'br' })
  const secondRoot = mkdtempSync(path.join(tmpdir(), 'arc-atlas-codec-repeat-'))
  const second = writeJsonArtifact({ root: secondRoot, path: 'data/example.json', value, contentEncoding: 'br' })

  assert.equal(first.contentEncoding, 'br')
  assert.equal(first.path, 'data/example.json.br')
  assert.equal(first.sha256, second.sha256)
  assert.equal(first.decodedSha256, second.decodedSha256)
  assert.deepEqual(readJsonArtifact({ root, descriptor: first }), value)

  const physical = readFileSync(path.join(root, first.path))
  writeFileSync(path.join(root, first.path), Buffer.concat([physical.subarray(0, -1), Buffer.from([physical.at(-1) ^ 1])]))
  assert.throws(() => readJsonArtifact({ root, descriptor: first }), /physical digest mismatch/)
})

test('artifact codec reads historical uncompressed JSON descriptors', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-codec-legacy-'))
  const bytes = Buffer.from('[{"legacy":true}]\n')
  writeFileSync(path.join(root, 'legacy.json'), bytes)
  const descriptor = {
    path: 'legacy.json',
    bytes: bytes.length,
    sha256: '2f5961cd5d70a630a0db7f35338c2fd9c400a90f89ccd664296995afb140f0f6',
  }
  assert.deepEqual(readJsonArtifact({ root, descriptor }), [{ legacy: true }])
})
