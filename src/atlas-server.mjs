import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

import { readJsonArtifact } from './artifact-codec.mjs'
import { openNavigationIndex } from './navigation-index.mjs'
import { observeAtlasSnapshotFreshnessV1 } from './build-input-authority.mjs'

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

function relativeRequest(urlPath, prefix) {
  let decoded
  try { decoded = decodeURIComponent(urlPath) } catch { return null }
  if (!decoded.startsWith(prefix)) return null
  const relative = decoded.slice(prefix.length).replace(/^\/+/, '')
  if (!relative || relative.includes('\0')) return null
  const normalized = path.posix.normalize(relative)
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null
  return normalized
}

function contentType(relative) {
  const extension = path.extname(relative).toLowerCase()
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[extension] || 'application/octet-stream'
}

function send(response, status, bytes, type = 'text/plain; charset=utf-8', cache = 'no-store') {
  response.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(bytes),
    'cache-control': cache,
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(bytes)
}

function openedFile(root, relative) {
  const absolute = path.join(root, relative)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return null
  const real = realpathSync(absolute)
  const rel = path.relative(root, real)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
  return { absolute: real, bytes: readFileSync(real) }
}

function sendJson(response, status, value) {
  return send(response, status, `${JSON.stringify(value)}\n`, 'application/json; charset=utf-8')
}

function descriptorMatches(left, right) {
  return ['path', 'bytes', 'sha256', 'contentEncoding', 'decodedBytes', 'decodedSha256', 'mediaType']
    .every(field => (left?.[field] ?? null) === (right?.[field] ?? null))
}

function boundedQueryInteger(requestUrl, name, fallback, maximum) {
  const raw = requestUrl.searchParams.get(name)
  if (raw == null) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${name} is outside its bounded integer range`)
  return value
}

function assertServingMode(mode) {
  if (mode !== 'current' && mode !== 'historical') {
    throw new Error("atlas serving mode must be 'current' or 'historical'")
  }
  return mode
}

function currentServingFailure(freshness) {
  const reason = freshness?.nextReview?.requiredEvidence || freshness?.status || 'freshness-could-not-be-verified'
  return `atlas current-serving requires a fresh closed build basis; use mode: 'historical' for a frozen snapshot (reason: ${reason})`
}

export function createAtlasServer({ snapshotRoot, webRoot, mode = 'current' }) {
  const servingMode = assertServingMode(mode)
  const snapshot = realpathSync(snapshotRoot)
  const web = realpathSync(webRoot)
  const manifestFile = openedFile(snapshot, 'manifest.json')
  if (!manifestFile) throw new Error('atlas snapshot manifest is missing')
  const manifest = JSON.parse(manifestFile.bytes.toString('utf8'))
  const declared = new Map()
  for (const artifact of manifest.artifacts || []) {
    const opened = openedFile(snapshot, artifact.path)
    if (!opened || sha256(opened.bytes) !== artifact.sha256 || opened.bytes.length !== artifact.bytes) throw new Error(`atlas artifact digest mismatch: ${artifact.path}`)
    declared.set(artifact.path, artifact)
  }
  const parseDeclaredJson = relative => {
    const descriptor = declared.get(relative)
    const opened = descriptor && openedFile(snapshot, relative)
    if (!descriptor || !opened) return null
    return JSON.parse(opened.bytes.toString('utf8'))
  }
  const uiManifest = parseDeclaredJson('data/ui/manifest.json')
  let buildInputFreshness = observeAtlasSnapshotFreshnessV1({
    snapshotRoot: snapshot,
    manifest,
    builderRoot: path.resolve(import.meta.dirname, '..'),
  })
  if (servingMode === 'current' && buildInputFreshness.status !== 'current-at-verified-at') {
    throw new Error(currentServingFailure(buildInputFreshness))
  }
  const reverifyCurrentServing = () => {
    buildInputFreshness = observeAtlasSnapshotFreshnessV1({
      snapshotRoot: snapshot,
      manifest,
      builderRoot: path.resolve(import.meta.dirname, '..'),
    })
    return buildInputFreshness
  }
  let navigation = null
  let symbolManifest = null
  let relationshipManifest = null
  let filesByPath = new Map()
  let filesById = new Map()
  let componentsByPath = new Map()
  let symbolShards = new Map()
  let relationshipShards = new Map()
  const shardCache = new Map()
  const readCanonicalShard = descriptor => {
    if (shardCache.has(descriptor.path)) return shardCache.get(descriptor.path)
    const declaredDescriptor = declared.get(descriptor.path)
    if (!declaredDescriptor || !descriptorMatches(descriptor, declaredDescriptor)) {
      throw new Error(`canonical shard is absent from the admitted snapshot manifest: ${descriptor.path}`)
    }
    const value = readJsonArtifact({ root: snapshot, descriptor })
    shardCache.set(descriptor.path, value)
    if (shardCache.size > 12) shardCache.delete(shardCache.keys().next().value)
    return value
  }
  if (uiManifest?.navigation) {
    if (!declared.has(uiManifest.navigation.artifact?.path)
      || !descriptorMatches(uiManifest.navigation.artifact, declared.get(uiManifest.navigation.artifact.path))) {
      throw new Error('atlas navigation artifact is not exactly declared by the snapshot')
    }
    symbolManifest = parseDeclaredJson('data/symbols.json')
    relationshipManifest = parseDeclaredJson('data/relationships.json')
    const files = parseDeclaredJson('data/files.json') || []
    const components = parseDeclaredJson('data/components.json') || []
    if (symbolManifest?.schemaVersion !== 'arc-atlas-symbol-artifact-manifest-v1'
      || relationshipManifest?.schemaVersion !== 'arc-atlas-relationship-artifact-manifest-v1') {
      throw new Error('atlas navigation requires canonical symbol and relationship manifests')
    }
    symbolShards = new Map(symbolManifest.sequence.shards.map(descriptor => [descriptor.path, descriptor]))
    relationshipShards = new Map(Object.values(relationshipManifest.sequences)
      .flatMap(sequence => sequence.shards)
      .map(descriptor => [descriptor.path, descriptor]))
    filesByPath = new Map(files.map(file => [file.path, file]))
    filesById = new Map(files.map(file => [file.id, file]))
    componentsByPath = new Map(components.map(component => [component.path, component]))
    navigation = openNavigationIndex({ snapshotRoot: snapshot, navigation: uiManifest.navigation })
  }
  const blockingGates = Object.entries(manifest.gates || {}).filter(([name, gate]) => name !== 'productProof' && gate.status !== 'pass').map(([name]) => name)
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://atlas.local')
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'Method not allowed\n')
    if (requestUrl.pathname === '/__atlas/health') {
      if (servingMode === 'current') reverifyCurrentServing()
      return send(response, 200, `${JSON.stringify({ schemaVersion: 'arc-atlas-server-health-v1', snapshotSha256: manifest.snapshot?.snapshotSha256, git: manifest.snapshot?.git, servingMode, blockingGates, freshness: buildInputFreshness, authority: manifest.authority })}\n`, 'application/json; charset=utf-8')
    }
    if (servingMode === 'current') {
      const freshness = reverifyCurrentServing()
      if (freshness.status !== 'current-at-verified-at') {
        return sendJson(response, 409, {
          error: 'atlas-current-snapshot-stale',
          snapshotSha256: manifest.snapshot?.snapshotSha256 ?? null,
          servingMode,
          freshness,
        })
      }
    }
    if (requestUrl.pathname === '/__atlas/api/search') {
      if (!navigation) return sendJson(response, 404, { error: 'navigation-index-unavailable' })
      try {
        const query = requestUrl.searchParams.get('q') || ''
        const limit = boundedQueryInteger(requestUrl, 'limit', 25, 100)
        const offset = boundedQueryInteger(requestUrl, 'offset', 0, 10_000_000)
        if (limit < 1) throw new Error('limit must be positive')
        const result = navigation.searchSymbols(query, { limit, offset })
        return sendJson(response, 200, {
          schemaVersion: 'arc-atlas-navigation-search-result-v1',
          authority: 'non-authoritative-navigation-candidates-canonical-detail-required',
          snapshotSha256: manifest.snapshot?.snapshotSha256,
          query,
          ...result,
        })
      } catch (error) {
        return sendJson(response, 400, { error: 'invalid-navigation-query', reason: error.message })
      }
    }
    if (requestUrl.pathname === '/__atlas/api/symbol') {
      if (!navigation) return sendJson(response, 404, { error: 'navigation-index-unavailable' })
      try {
        const id = requestUrl.searchParams.get('id') || ''
        const locator = navigation.locateSymbol(id)
        if (!locator) return sendJson(response, 404, { error: 'canonical-symbol-not-found' })
        const descriptor = symbolShards.get(locator.shard.path)
        if (!descriptor || descriptor.sha256 !== locator.shard.sha256
          || descriptor.decodedSha256 !== locator.shard.decodedSha256
          || descriptor.count !== locator.shard.count) {
          throw new Error('navigation symbol locator does not match the canonical symbol manifest')
        }
        const records = readCanonicalShard(descriptor)
        const symbol = records[locator.recordIndex]
        if (!symbol || symbol.id !== id) throw new Error('navigation symbol locator does not resolve to the requested canonical symbol')
        const file = filesByPath.get(symbol.path)
        if (!file || file.sha256 !== symbol.declaration?.fileSha256 && symbol.declaration?.fileSha256) {
          throw new Error('canonical symbol does not join its exact current source file')
        }
        return sendJson(response, 200, {
          schemaVersion: 'arc-atlas-navigation-symbol-result-v1',
          authority: 'digest-verified-canonical-symbol-record',
          snapshotSha256: manifest.snapshot?.snapshotSha256,
          symbol,
          component: componentsByPath.get(symbol.path) || null,
          source: {
            fileSha256: file.sha256,
            blobPath: `source/blobs/${file.sha256}`,
            start: symbol.start,
            end: symbol.end,
            bodySha256: symbol.bodySha256,
          },
        })
      } catch (error) {
        return sendJson(response, 409, { error: 'canonical-symbol-verification-failed', reason: error.message })
      }
    }
    if (requestUrl.pathname === '/__atlas/api/relations') {
      if (!navigation) return sendJson(response, 404, { error: 'navigation-index-unavailable' })
      try {
        const id = requestUrl.searchParams.get('id') || ''
        const symbol = navigation.locateSymbol(id)
        if (!symbol) return sendJson(response, 404, { error: 'canonical-symbol-not-found' })
        const limit = boundedQueryInteger(requestUrl, 'limit', 250, 1_000)
        const offset = boundedQueryInteger(requestUrl, 'offset', 0, 100_000_000)
        if (limit < 1) throw new Error('limit must be positive')
        const located = navigation.locateRelationships(symbol.symbolKey, { limit, offset })
        const records = located.records.map(locator => {
          const descriptor = relationshipShards.get(locator.shard.path)
          if (!descriptor || descriptor.sha256 !== locator.shard.sha256
            || descriptor.decodedSha256 !== locator.shard.decodedSha256
            || descriptor.count !== locator.shard.count) {
            throw new Error('navigation relationship locator does not match the canonical relationship manifest')
          }
          const shard = readCanonicalShard(descriptor)
          const canonical = shard[locator.recordIndex]
          if (!canonical || (locator.direction === 'outbound' ? canonical.source !== id : canonical.target !== id)) {
            throw new Error('navigation relationship locator does not bind the requested symbol endpoint')
          }
          const neighbor = locator.direction === 'outbound' ? canonical.target : canonical.source
          const neighborSymbol = navigation.locateSymbol(neighbor)?.summary || null
          const neighborFile = filesById.get(neighbor) || null
          return {
            ...canonical,
            self: id,
            direction: locator.direction,
            neighbor,
            neighborSummary: neighborSymbol
              ? { id: neighbor, kind: 'symbol', label: neighborSymbol.name, path: neighborSymbol.path, status: neighborSymbol.purposeStatus }
              : neighborFile
                ? { id: neighbor, kind: 'file', label: neighborFile.path.split('/').at(-1), path: neighborFile.path, status: neighborFile.fileClass }
                : { id: neighbor, kind: 'canonical-entity', label: neighbor, path: canonical.observation?.path || null, status: 'canonical-id-with-detail-not-loaded' },
            evidenceClass: locator.evidenceClass === 'exact' ? 'exact-source-relationship' : 'advisory-code-graph',
            authority: locator.evidenceClass === 'exact'
              ? canonical.observation?.authority || 'exact-canonical-relationship-record'
              : 'advisory-code-graph-not-exact-relationship-truth',
          }
        })
        return sendJson(response, 200, {
          schemaVersion: 'arc-atlas-navigation-relations-result-v1',
          authority: 'digest-verified-canonical-relationship-records',
          snapshotSha256: manifest.snapshot?.snapshotSha256,
          symbolId: id,
          records,
          denominator: {
            total: located.total,
            exact: located.exact,
            advisory: located.advisory,
            offset: located.offset,
            limit: located.limit,
          },
        })
      } catch (error) {
        return sendJson(response, 409, { error: 'canonical-relationship-verification-failed', reason: error.message })
      }
    }
    if (requestUrl.pathname === '/atlas-snapshot/manifest.json') return send(response, 200, manifestFile.bytes, 'application/json; charset=utf-8', 'no-cache')
    if (requestUrl.pathname.startsWith('/atlas-snapshot/')) {
      const relative = relativeRequest(requestUrl.pathname, '/atlas-snapshot/')
      if (!relative || !declared.has(relative)) return send(response, 404, 'Not found\n')
      const opened = openedFile(snapshot, relative)
      const expected = declared.get(relative)
      if (!opened || sha256(opened.bytes) !== expected.sha256 || opened.bytes.length !== expected.bytes) return send(response, 409, 'Snapshot artifact drifted after server admission\n')
      return send(response, 200, request.method === 'HEAD' ? Buffer.alloc(0) : opened.bytes, contentType(relative), 'public, max-age=31536000, immutable')
    }
    const relative = requestUrl.pathname === '/' ? 'index.html' : relativeRequest(requestUrl.pathname, '/')
    const opened = relative ? openedFile(web, relative) : null
    const fallback = opened || openedFile(web, 'index.html')
    if (!fallback) return send(response, 404, 'Not found\n')
    return send(response, 200, request.method === 'HEAD' ? Buffer.alloc(0) : fallback.bytes, contentType(opened ? relative : 'index.html'), opened ? 'public, max-age=3600' : 'no-cache')
  })
  if (navigation) server.once('close', () => navigation.close())
  return server
}
