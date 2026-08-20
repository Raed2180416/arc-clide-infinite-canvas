import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildPublicPages } from '../bin/build-public-pages.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')

test('public Pages build is a bounded historical artifact with no local locators', () => {
  const output = mkdtempSync(path.join(tmpdir(), 'arc-atlas-public-pages-test-'))
  try {
    const { manifest } = buildPublicPages({ sourceRoot: projectRoot, out: output })
    assert.equal(manifest.schemaVersion, 'arc-clide-public-atlas-pages-v1')
    assert.equal(manifest.kind, 'historical-static-reference')
    assert.equal(manifest.authority, 'read-only-projection-authority-none')
    assert.equal(manifest.artifacts.some(artifact => artifact.path === 'atlas.html'), true)
    assert.equal(manifest.artifacts.some(artifact => artifact.path === 'data/component-map.json'), true)
    assert.equal(manifest.artifacts.some(artifact => artifact.path === 'data/module-digests.json'), true)

    const index = readFileSync(path.join(output, 'index.html'), 'utf8')
    const atlas = readFileSync(path.join(output, 'atlas.html'), 'utf8')
    const map = readFileSync(path.join(output, 'data', 'component-map.json'), 'utf8')
    const digest = readFileSync(path.join(output, 'data', 'module-digests.json'), 'utf8')
    const manifestBytes = readFileSync(path.join(output, 'public-site-manifest.json'), 'utf8')
    for (const value of [index, atlas, map, digest, manifestBytes]) {
      assert.doesNotMatch(value, /file:\/\/(?:\/|home\/|Users\/|[A-Za-z]:)/i)
      assert.doesNotMatch(value, /\/home\/raed/i)
      assert.doesNotMatch(value, /(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/)
    }
    assert.match(index, /Historical reference/i)
    assert.match(atlas, /data\/component-map\.json/)
    assert.match(atlas, /data\/module-digests\.json/)
    assert.doesNotMatch(atlas, /COMPLETE-COMPONENT-MAP\.json/)
    assert.doesNotMatch(atlas, /MODULE-DIGESTS\.json/)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})
