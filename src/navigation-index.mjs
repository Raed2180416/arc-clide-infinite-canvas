import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describeUnencodedArtifact } from './artifact-codec.mjs'

export const NAVIGATION_INDEX_SCHEMA_VERSION = 'arc-atlas-navigation-index-v1'
export const NAVIGATION_QUERY_SCHEMA_VERSION = 'arc-atlas-navigation-query-v1'

const APPLICATION_ID = 1_095_910_212

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function sqlitePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) {
    throw new Error('atlas navigation path must be one non-empty relative path')
  }
  const normalized = path.posix.normalize(relative.replaceAll(path.sep, '/'))
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('atlas navigation path escapes its root')
  const absolute = path.resolve(root, normalized)
  const containment = path.relative(path.resolve(root), absolute)
  if (!containment || containment === '.' || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
    throw new Error('atlas navigation path must name a file below its root')
  }
  return { absolute, relative: normalized }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be one lowercase SHA-256 digest`)
  }
}

function assertArtifactDescriptor(value, label) {
  if (!value || typeof value.path !== 'string' || !Number.isInteger(value.bytes) || value.bytes < 0) {
    throw new Error(`${label} is not an atlas artifact descriptor`)
  }
  assertSha256(value.sha256, `${label}.sha256`)
  if (value.decodedSha256 != null) assertSha256(value.decodedSha256, `${label}.decodedSha256`)
}

function exactArtifactMatch(observed, expected, label) {
  for (const field of ['path', 'bytes', 'sha256', 'contentEncoding', 'decodedBytes', 'decodedSha256', 'mediaType']) {
    if ((observed[field] ?? null) !== (expected[field] ?? null)) {
      throw new Error(`${label} does not match its declared physical artifact at field ${field}`)
    }
  }
}

function insertMeta(database, values) {
  const statement = database.prepare('INSERT INTO meta(key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(values).sort(([left], [right]) => left.localeCompare(right))) {
    statement.run(key, typeof value === 'string' ? value : canonicalJson(value))
  }
}

function navigationBindings({ snapshotSha256, symbolManifest, relationshipCorpusSha256, componentSetSha256 }) {
  assertSha256(snapshotSha256, 'navigation snapshotSha256')
  assertSha256(symbolManifest?.sequence?.sha256, 'navigation symbol sequence SHA-256')
  assertSha256(relationshipCorpusSha256, 'navigation relationship corpus SHA-256')
  assertSha256(componentSetSha256, 'navigation component set SHA-256')
  return {
    snapshotSha256,
    symbolSequenceSha256: symbolManifest.sequence.sha256,
    symbolSequenceCount: symbolManifest.sequence.count,
    relationshipCorpusSha256,
    componentSetSha256,
  }
}

export function createNavigationIndexBuilder({
  outputRoot,
  snapshotSha256,
  symbols,
  symbolLocators,
  symbolManifest,
  components,
  relationshipCorpusSha256,
}) {
  if (!Array.isArray(symbols) || !(symbolLocators instanceof Map) || !Array.isArray(components)) {
    throw new Error('atlas navigation builder requires canonical symbols, locators, and components')
  }
  if (symbolManifest?.schemaVersion !== 'arc-atlas-symbol-artifact-manifest-v1') {
    throw new Error('atlas navigation builder requires the canonical symbol manifest')
  }
  const componentSetSha256 = sha256(canonicalJson(components))
  const bindings = navigationBindings({ snapshotSha256, symbolManifest, relationshipCorpusSha256, componentSetSha256 })
  const target = sqlitePath(outputRoot, 'data/navigation.sqlite')
  mkdirSync(path.dirname(target.absolute), { recursive: true })
  rmSync(target.absolute, { force: true })
  const database = new DatabaseSync(target.absolute)
  database.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    PRAGMA page_size = 4096;
    PRAGMA auto_vacuum = NONE;
    PRAGMA application_id = ${APPLICATION_ID};
    PRAGMA user_version = 1;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE symbol_shard (
      shard_key INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      decoded_sha256 TEXT NOT NULL,
      record_count INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE symbol_lookup (
      symbol_key INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      shard_key INTEGER NOT NULL REFERENCES symbol_shard(shard_key),
      record_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      language TEXT NOT NULL,
      purpose_status TEXT NOT NULL,
      primary_organ_id TEXT
    ) STRICT;
    CREATE VIRTUAL TABLE symbol_search USING fts5(
      name,
      qualified_name,
      path,
      kind,
      language,
      content='symbol_lookup',
      content_rowid='symbol_key',
      tokenize='unicode61 remove_diacritics 2 tokenchars _'
    );
    CREATE TABLE relationship_shard (
      shard_key INTEGER PRIMARY KEY,
      field TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      decoded_sha256 TEXT NOT NULL,
      record_count INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE exact_adjacency (
      symbol_key INTEGER NOT NULL REFERENCES symbol_lookup(symbol_key),
      shard_key INTEGER NOT NULL REFERENCES relationship_shard(shard_key),
      record_index INTEGER NOT NULL,
      direction INTEGER NOT NULL CHECK(direction IN (0, 1)),
      PRIMARY KEY(symbol_key, shard_key, record_index, direction)
    ) WITHOUT ROWID;
    CREATE TABLE advisory_adjacency (
      symbol_key INTEGER NOT NULL REFERENCES symbol_lookup(symbol_key),
      shard_key INTEGER NOT NULL REFERENCES relationship_shard(shard_key),
      record_index INTEGER NOT NULL,
      direction INTEGER NOT NULL CHECK(direction IN (0, 1)),
      PRIMARY KEY(symbol_key, shard_key, record_index, direction)
    ) WITHOUT ROWID;
    CREATE INDEX exact_adjacency_symbol ON exact_adjacency(symbol_key);
    CREATE INDEX advisory_adjacency_symbol ON advisory_adjacency(symbol_key);
  `)

  const componentByPath = new Map(components.map(component => [component.path, component]))
  const symbolKeyById = new Map()
  const symbolShardKeyByPath = new Map()
  const insertSymbolShard = database.prepare('INSERT INTO symbol_shard(shard_key, path, sha256, decoded_sha256, record_count) VALUES (?, ?, ?, ?, ?)')
  database.exec('BEGIN IMMEDIATE')
  try {
    symbolManifest.sequence.shards.forEach((descriptor, index) => {
      assertArtifactDescriptor(descriptor, 'canonical symbol shard')
      const shardKey = index + 1
      symbolShardKeyByPath.set(descriptor.path, shardKey)
      insertSymbolShard.run(shardKey, descriptor.path, descriptor.sha256, descriptor.decodedSha256, descriptor.count)
    })
    const insertSymbol = database.prepare(`
      INSERT INTO symbol_lookup(
        symbol_key, id, shard_key, record_index, name, qualified_name, path, kind, language,
        purpose_status, primary_organ_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    symbols.forEach((symbol, index) => {
      const locator = symbolLocators.get(symbol.id)
      const shardKey = locator && symbolShardKeyByPath.get(locator.shardPath)
      if (!locator || !shardKey || !Number.isInteger(locator.recordIndex)) {
        throw new Error(`atlas navigation symbol lacks one canonical locator: ${symbol.id}`)
      }
      const symbolKey = index + 1
      symbolKeyById.set(symbol.id, symbolKey)
      insertSymbol.run(
        symbolKey,
        symbol.id,
        shardKey,
        locator.recordIndex,
        symbol.name,
        symbol.qualifiedName,
        symbol.path,
        symbol.kind,
        symbol.language,
        symbol.purpose?.status || 'unavailable',
        componentByPath.get(symbol.path)?.primaryOrganId || null,
      )
    })
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    database.close()
    throw error
  }

  const observedShardPaths = new Set()
  let exactAdjacency = 0
  let advisoryAdjacency = 0
  let relationshipShards = 0
  const insertRelationshipShard = database.prepare('INSERT INTO relationship_shard(shard_key, field, path, sha256, decoded_sha256, record_count) VALUES (?, ?, ?, ?, ?, ?)')
  const insertExact = database.prepare('INSERT INTO exact_adjacency(symbol_key, shard_key, record_index, direction) VALUES (?, ?, ?, ?)')
  const insertAdvisory = database.prepare('INSERT INTO advisory_adjacency(symbol_key, shard_key, record_index, direction) VALUES (?, ?, ?, ?)')

  const observeRelationshipShard = (field, records, descriptor) => {
    if (!Array.isArray(records) || !['relationships', 'referenceSites', 'advisoryRelationships', 'externalEntities', 'bindingSources'].includes(field)) {
      throw new Error('atlas navigation relationship shard observation is invalid')
    }
    assertArtifactDescriptor(descriptor, 'canonical relationship shard')
    if (descriptor.count !== records.length) throw new Error(`atlas navigation relationship shard denominator mismatch: ${descriptor.path}`)
    if (observedShardPaths.has(descriptor.path)) throw new Error(`atlas navigation relationship shard repeated: ${descriptor.path}`)
    observedShardPaths.add(descriptor.path)
    relationshipShards += 1
    const shardKey = relationshipShards
    database.exec('BEGIN IMMEDIATE')
    try {
      insertRelationshipShard.run(shardKey, field, descriptor.path, descriptor.sha256, descriptor.decodedSha256, records.length)
      if (field === 'relationships' || field === 'advisoryRelationships') {
        const insert = field === 'relationships' ? insertExact : insertAdvisory
        records.forEach((record, recordIndex) => {
          const sourceKey = symbolKeyById.get(record.source)
          const targetKey = symbolKeyById.get(record.target)
          if (sourceKey) {
            insert.run(sourceKey, shardKey, recordIndex, 0)
            if (field === 'relationships') exactAdjacency += 1
            else advisoryAdjacency += 1
          }
          if (targetKey) {
            insert.run(targetKey, shardKey, recordIndex, 1)
            if (field === 'relationships') exactAdjacency += 1
            else advisoryAdjacency += 1
          }
        })
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  let finalized = false
  const finalize = () => {
    if (finalized) throw new Error('atlas navigation index was already finalized')
    finalized = true
    insertMeta(database, {
      schemaVersion: NAVIGATION_INDEX_SCHEMA_VERSION,
      querySchemaVersion: NAVIGATION_QUERY_SCHEMA_VERSION,
      authority: 'non-authoritative-deterministic-navigation-index',
      ...bindings,
      symbolCount: symbols.length,
      symbolShardCount: symbolManifest.sequence.shards.length,
      relationshipShardCount: relationshipShards,
      exactAdjacency,
      advisoryAdjacency,
      searchSemantics: 'deterministic-unicode61-prefix-lexical-navigation-not-semantic-truth',
    })
    database.exec("INSERT INTO symbol_search(symbol_search) VALUES ('rebuild')")
    database.exec("INSERT INTO symbol_search(symbol_search) VALUES ('optimize')")
    database.exec('ANALYZE')
    database.exec('VACUUM')
    database.close()
    const artifact = describeUnencodedArtifact({ root: outputRoot, path: target.relative, mediaType: 'application/vnd.sqlite3' })
    return {
      schemaVersion: NAVIGATION_INDEX_SCHEMA_VERSION,
      authority: 'non-authoritative-deterministic-navigation-index',
      querySchemaVersion: NAVIGATION_QUERY_SCHEMA_VERSION,
      artifact,
      bindings,
      denominators: {
        symbols: symbols.length,
        symbolShards: symbolManifest.sequence.shards.length,
        relationshipShards,
        exactAdjacency,
        advisoryAdjacency,
      },
      searchSemantics: 'deterministic-unicode61-prefix-lexical-navigation-not-semantic-truth',
    }
  }

  return Object.freeze({ observeRelationshipShard, finalize })
}

function parseMeta(database) {
  return Object.fromEntries(database.prepare('SELECT key, value FROM meta ORDER BY key').all().map(row => [row.key, row.value]))
}

function lexicalQuery(value) {
  const tokens = String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []
  if (tokens.length === 0) throw new Error('atlas navigation query must contain a letter, number, or underscore')
  return [...new Set(tokens)].map(token => `"${token.replaceAll('"', '""')}"*`).join(' AND ')
}

function boundedInteger(value, fallback, maximum, label) {
  if (value == null || value === '') return fallback
  const observed = Number(value)
  if (!Number.isInteger(observed) || observed < 0 || observed > maximum) throw new Error(`${label} is outside its bounded integer range`)
  return observed
}

export function openNavigationIndex({ snapshotRoot, navigation }) {
  if (navigation?.schemaVersion !== NAVIGATION_INDEX_SCHEMA_VERSION || navigation.authority !== 'non-authoritative-deterministic-navigation-index') {
    throw new Error('atlas navigation manifest schema or authority is unsupported')
  }
  assertArtifactDescriptor(navigation.artifact, 'navigation index artifact')
  const observed = describeUnencodedArtifact({ root: snapshotRoot, path: navigation.artifact.path, mediaType: navigation.artifact.mediaType })
  exactArtifactMatch(observed, navigation.artifact, 'navigation index')
  const target = sqlitePath(snapshotRoot, navigation.artifact.path)
  const database = new DatabaseSync(realpathSync(target.absolute), { readOnly: true })
  const applicationId = database.prepare('PRAGMA application_id').get().application_id
  const userVersion = database.prepare('PRAGMA user_version').get().user_version
  const integrity = database.prepare('PRAGMA quick_check').get().quick_check
  if (applicationId !== APPLICATION_ID || userVersion !== 1 || integrity !== 'ok') {
    database.close()
    throw new Error('atlas navigation database identity or integrity is invalid')
  }
  const meta = parseMeta(database)
  const expectedMeta = {
    schemaVersion: navigation.schemaVersion,
    querySchemaVersion: navigation.querySchemaVersion,
    authority: navigation.authority,
    snapshotSha256: navigation.bindings?.snapshotSha256,
    symbolSequenceSha256: navigation.bindings?.symbolSequenceSha256,
    relationshipCorpusSha256: navigation.bindings?.relationshipCorpusSha256,
    componentSetSha256: navigation.bindings?.componentSetSha256,
  }
  for (const [key, value] of Object.entries(expectedMeta)) {
    if (meta[key] !== String(value)) {
      database.close()
      throw new Error(`atlas navigation database binding mismatch: ${key}`)
    }
  }

  const searchStatement = database.prepare(`
    SELECT l.id, l.name, l.qualified_name, l.path, l.kind, l.language,
           l.purpose_status, l.primary_organ_id, bm25(symbol_search) AS score
      FROM symbol_search
      JOIN symbol_lookup AS l ON l.symbol_key = symbol_search.rowid
     WHERE symbol_search MATCH ?
     ORDER BY score, lower(l.name), lower(l.path), l.id
     LIMIT ? OFFSET ?
  `)
  const searchCountStatement = database.prepare(`
    SELECT count(*) AS total
      FROM symbol_search
     WHERE symbol_search MATCH ?
  `)
  const symbolStatement = database.prepare(`
    SELECT l.symbol_key, l.id, l.record_index, l.name, l.qualified_name, l.path AS source_path,
           l.kind, l.language, l.purpose_status, l.primary_organ_id,
           s.path AS shard_path, s.sha256 AS shard_sha256,
           s.decoded_sha256 AS shard_decoded_sha256, s.record_count AS shard_record_count
      FROM symbol_lookup AS l
      JOIN symbol_shard AS s ON s.shard_key = l.shard_key
     WHERE l.id = ?
  `)
  const relationStatement = database.prepare(`
    SELECT evidence_class, field, shard_path, shard_sha256, shard_decoded_sha256,
           shard_record_count, record_index, direction
      FROM (
        SELECT 'exact' AS evidence_class, s.field, s.path AS shard_path, s.sha256 AS shard_sha256,
               s.decoded_sha256 AS shard_decoded_sha256, s.record_count AS shard_record_count,
               a.record_index, a.direction
          FROM exact_adjacency AS a
          JOIN relationship_shard AS s ON s.shard_key = a.shard_key
         WHERE a.symbol_key = ?
        UNION ALL
        SELECT 'advisory' AS evidence_class, s.field, s.path AS shard_path, s.sha256 AS shard_sha256,
               s.decoded_sha256 AS shard_decoded_sha256, s.record_count AS shard_record_count,
               a.record_index, a.direction
          FROM advisory_adjacency AS a
          JOIN relationship_shard AS s ON s.shard_key = a.shard_key
         WHERE a.symbol_key = ?
      )
     ORDER BY evidence_class, shard_path, record_index, direction
     LIMIT ? OFFSET ?
  `)
  const relationCountStatement = database.prepare(`
    SELECT
      (SELECT count(*) FROM exact_adjacency WHERE symbol_key = ?) AS exact_count,
      (SELECT count(*) FROM advisory_adjacency WHERE symbol_key = ?) AS advisory_count
  `)

  let closed = false
  const assertOpen = () => { if (closed) throw new Error('atlas navigation index is closed') }
  return Object.freeze({
    meta: Object.freeze({ ...meta }),
    searchSymbols(query, { limit = 25, offset = 0 } = {}) {
      assertOpen()
      const match = lexicalQuery(query)
      const boundedLimit = boundedInteger(limit, 25, 100, 'atlas navigation search limit')
      if (boundedLimit < 1) throw new Error('atlas navigation search limit must be positive')
      const boundedOffset = boundedInteger(offset, 0, 10_000_000, 'atlas navigation search offset')
      const records = searchStatement.all(match, boundedLimit, boundedOffset).map(row => ({
        id: row.id,
        summary: {
          id: row.id,
          name: row.name,
          qualifiedName: row.qualified_name,
          path: row.source_path,
          kind: row.kind,
          language: row.language,
          purposeStatus: row.purpose_status,
          primaryOrganId: row.primary_organ_id,
        },
        name: row.name,
        qualifiedName: row.qualified_name,
        path: row.path,
        kind: row.kind,
        language: row.language,
        purposeStatus: row.purpose_status,
        primaryOrganId: row.primary_organ_id,
      }))
      return { records, total: Number(searchCountStatement.get(match).total), offset: boundedOffset, limit: boundedLimit }
    },
    locateSymbol(id) {
      assertOpen()
      if (typeof id !== 'string' || !id) throw new Error('atlas navigation symbol id is invalid')
      const row = symbolStatement.get(id)
      if (!row) return null
      return {
        symbolKey: Number(row.symbol_key),
        id: row.id,
        recordIndex: Number(row.record_index),
        shard: {
          path: row.shard_path,
          sha256: row.shard_sha256,
          decodedSha256: row.shard_decoded_sha256,
          count: Number(row.shard_record_count),
        },
      }
    },
    locateRelationships(symbolKey, { limit = 250, offset = 0 } = {}) {
      assertOpen()
      const boundedLimit = boundedInteger(limit, 250, 1_000, 'atlas navigation relationship limit')
      if (boundedLimit < 1) throw new Error('atlas navigation relationship limit must be positive')
      const boundedOffset = boundedInteger(offset, 0, 100_000_000, 'atlas navigation relationship offset')
      const count = relationCountStatement.get(symbolKey, symbolKey)
      const records = relationStatement.all(symbolKey, symbolKey, boundedLimit, boundedOffset).map(row => ({
        evidenceClass: row.evidence_class,
        field: row.field,
        recordIndex: Number(row.record_index),
        direction: Number(row.direction) === 0 ? 'outbound' : 'inbound',
        shard: {
          path: row.shard_path,
          sha256: row.shard_sha256,
          decodedSha256: row.shard_decoded_sha256,
          count: Number(row.shard_record_count),
        },
      }))
      return {
        records,
        total: Number(count.exact_count) + Number(count.advisory_count),
        exact: Number(count.exact_count),
        advisory: Number(count.advisory_count),
        offset: boundedOffset,
        limit: boundedLimit,
      }
    },
    close() {
      if (closed) return
      closed = true
      database.close()
    },
  })
}
