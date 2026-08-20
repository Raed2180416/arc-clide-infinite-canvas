import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

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

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`)
  }
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`)
  return value
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a lowercase SHA-256`)
  return value
}

function uniqueStringArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const seen = new Set()
  for (const item of value) {
    nonempty(item, `${label} entry`)
    if (seen.has(item)) throw new Error(`${label} contains a duplicate: ${item}`)
    seen.add(item)
  }
}

function normalizeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`component review contains an unsafe repository path: ${value}`)
  }
  return normalized
}

function validateSourceRef(reference, { repository, fileByPath, organ, componentPath, label }) {
  exactObject(reference, ['path', 'line', 'role'], label)
  const relative = normalizeRelative(reference.path)
  const file = fileByPath.get(relative)
  if (!['component-behavior', 'component-entry', 'organ-definition'].includes(reference.role)) throw new Error(`${label}.role is not admitted`)
  if (reference.role === 'component-entry') {
    if (!file || file.fileClass === 'regular' || relative !== componentPath || Number(reference.line) !== 0) {
      throw new Error(`${label} must bind the reviewed non-regular component with line 0`)
    }
    return { path: relative, line: 0, role: reference.role }
  }
  if (!file || file.fileClass !== 'regular') throw new Error(`${label} is not a current regular source file: ${relative}`)
  const line = Number(reference.line)
  const lineCount = readFileSync(path.join(repository, relative), 'utf8').split('\n').length
  if (!Number.isInteger(line) || line < 1 || line > lineCount) throw new Error(`${label} is outside current source bytes: ${relative}:${reference.line}`)
  if (reference.role === 'component-behavior' && fileByPath.get(componentPath)?.fileClass === 'regular' && relative !== componentPath) {
    throw new Error(`${label} must cite the reviewed regular component itself`)
  }
  if (reference.role === 'organ-definition') {
    const admitted = (organ?.sourceRefs || []).some(source => normalizeRelative(source.path) === relative && Number(source.line) === line)
    if (!admitted) throw new Error(`${label} does not cite the exact protected organ definition`)
  }
  return { path: relative, line, role: reference.role }
}

function validateProposedOrgan(value, { repository, fileByPath, label }) {
  exactObject(value, ['id', 'name', 'summary', 'thesis', 'sourceRefs'], label)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(nonempty(value.id, `${label}.id`))) throw new Error(`${label}.id is invalid`)
  nonempty(value.name, `${label}.name`)
  nonempty(value.summary, `${label}.summary`)
  nonempty(value.thesis, `${label}.thesis`)
  if (!Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0) throw new Error(`${label}.sourceRefs must be nonempty`)
  for (const [index, reference] of value.sourceRefs.entries()) {
    exactObject(reference, ['path', 'line'], `${label}.sourceRefs[${index}]`)
    const relative = normalizeRelative(reference.path)
    const file = fileByPath.get(relative)
    if (!file || file.fileClass !== 'regular') throw new Error(`${label}.sourceRefs[${index}] is not a current regular file`)
    const line = Number(reference.line)
    const lineCount = readFileSync(path.join(repository, relative), 'utf8').split('\n').length
    if (!Number.isInteger(line) || line < 1 || line > lineCount) throw new Error(`${label}.sourceRefs[${index}] is outside current source bytes`)
  }
  return value
}

export function compileComponentOrganReviewBasisV1({ repositoryHead, ontologySha256, files, components, organs, fallbackOrganIds }) {
  const fileByPath = new Map(files.map(file => [file.path, file]))
  const fallbackComponents = components
    .filter(component => fallbackOrganIds.has(component.primaryOrganId))
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(component => {
      const file = fileByPath.get(component.path)
      if (!file) throw new Error(`fallback review basis cannot resolve component file: ${component.path}`)
      return {
        path: component.path,
        fileSha256: file.sha256,
        fileClass: file.fileClass,
        matchedOrganIds: [...component.organIds],
      }
    })
  const organDefinitionsSha256 = sha256(canonicalJson(
    [...organs].sort((left, right) => left.id.localeCompare(right.id)),
  ))
  const body = {
    schemaVersion: 'arc-atlas-component-organ-review-basis-v1',
    repositoryHead,
    ontologySha256,
    organDefinitionsSha256,
    fallbackComponents,
  }
  return {
    schemaVersion: body.schemaVersion,
    sha256: sha256(canonicalJson(body)),
    repositoryHead,
    ontologySha256,
    organDefinitionsSha256,
    fallbackFiles: fallbackComponents.length,
  }
}

export function applyComponentOrganReviews({ reviewPaths = [], repository, repositoryHead, files, components, organs, fallbackOrganIds, fallbackReviewBasis }) {
  if (!reviewPaths.length) {
    return {
      components,
      source: { state: 'not-requested', authority: 'none', shards: [], fallbackReviewBasis },
      reviewed: 0,
      unresolved: 0,
      proposedNewOrgan: 0,
    }
  }
  const repositoryRoot = realpathSync(repository)
  const fileByPath = new Map(files.map(file => [file.path, file]))
  const componentByPath = new Map(components.map(component => [component.path, component]))
  const organById = new Map(organs.map(organ => [organ.id, organ]))
  const fallbackPaths = new Set(components.filter(component => fallbackOrganIds.has(component.primaryOrganId)).map(component => component.path))
  const reviewByPath = new Map()
  const shardIds = new Set()
  const shards = []
  let declaredEligible = 0
  let declaredReviewed = 0
  let declaredProposed = 0
  let declaredUnresolved = 0

  for (const [shardIndex, reviewPath] of reviewPaths.entries()) {
    const absolutePath = realpathSync(reviewPath)
    const bytes = readFileSync(absolutePath)
    let ledger
    try { ledger = JSON.parse(bytes) } catch (error) { throw new Error(`component review shard is invalid JSON: ${error.message}`) }
    const label = `component review shard[${shardIndex}]`
    exactObject(ledger, ['schemaVersion', 'repositoryHead', 'fallbackBasisSha256', 'shard', 'reviewer', 'denominator', 'entries'], label)
    if (ledger.schemaVersion !== 'arc-atlas-component-organ-review-v2') throw new Error(`${label}.schemaVersion is unsupported`)
    if (ledger.repositoryHead !== repositoryHead) throw new Error(`${label} does not bind the current repository HEAD`)
    digest(ledger.fallbackBasisSha256, `${label}.fallbackBasisSha256`)
    if (ledger.fallbackBasisSha256 !== fallbackReviewBasis.sha256) {
      throw new Error(`${label} component review does not bind the current fallback review basis`)
    }
    nonempty(ledger.shard, `${label}.shard`)
    if (shardIds.has(ledger.shard)) throw new Error(`duplicate component review shard id: ${ledger.shard}`)
    shardIds.add(ledger.shard)
    exactObject(ledger.reviewer, ['identity', 'basis'], `${label}.reviewer`)
    nonempty(ledger.reviewer.identity, `${label}.reviewer.identity`)
    if (ledger.reviewer.basis !== 'explicit-file-by-file-review') throw new Error(`${label}.reviewer.basis is not admitted`)
    exactObject(ledger.denominator, ['eligible', 'reviewed', 'proposedNewOrgan', 'unresolved'], `${label}.denominator`)
    for (const key of ['eligible', 'reviewed', 'proposedNewOrgan', 'unresolved']) {
      if (!Number.isInteger(ledger.denominator[key]) || ledger.denominator[key] < 0) throw new Error(`${label}.denominator.${key} must be a nonnegative integer`)
    }
    if (!Array.isArray(ledger.entries)) throw new Error(`${label}.entries must be an array`)
    if (ledger.denominator.eligible !== ledger.entries.length || ledger.denominator.reviewed !== ledger.entries.length) {
      throw new Error(`${label} denominator does not bind every entry`)
    }
    declaredEligible += ledger.denominator.eligible
    declaredReviewed += ledger.denominator.reviewed
    declaredProposed += ledger.denominator.proposedNewOrgan
    declaredUnresolved += ledger.denominator.unresolved

    for (const [entryIndex, entry] of ledger.entries.entries()) {
      const entryLabel = `${label}.entries[${entryIndex}]`
      exactObject(entry, ['path', 'fileSha256', 'disposition', 'primaryOrganId', 'secondaryOrganIds', 'proposedNewOrgan', 'plainLanguagePurpose', 'rationale', 'sourceRefs', 'confidence', 'unresolvedQuestions'], entryLabel)
      const relative = normalizeRelative(entry.path)
      if (!fallbackPaths.has(relative)) throw new Error(`${entryLabel} is not in the current fallback denominator: ${relative}`)
      if (reviewByPath.has(relative)) throw new Error(`duplicate component review entry: ${relative}`)
      const file = fileByPath.get(relative)
      if (!file || entry.fileSha256 !== file.sha256) throw new Error(`component review does not bind current file bytes: ${relative}`)
      if (!['existing-organ', 'proposed-new-organ'].includes(entry.disposition)) throw new Error(`${entryLabel}.disposition is not admitted`)
      uniqueStringArray(entry.secondaryOrganIds, `${entryLabel}.secondaryOrganIds`)
      uniqueStringArray(entry.unresolvedQuestions, `${entryLabel}.unresolvedQuestions`)
      nonempty(entry.plainLanguagePurpose, `${entryLabel}.plainLanguagePurpose`)
      nonempty(entry.rationale, `${entryLabel}.rationale`)
      if (!['reviewed-high', 'reviewed-medium'].includes(entry.confidence)) throw new Error(`${entryLabel}.confidence is not admitted`)

      let organ = null
      let proposedNewOrgan = null
      if (entry.disposition === 'existing-organ') {
        if (entry.proposedNewOrgan !== null) throw new Error(`${entryLabel}.proposedNewOrgan must be null for an existing organ`)
        organ = organById.get(entry.primaryOrganId)
        if (!organ || fallbackOrganIds.has(entry.primaryOrganId)) throw new Error(`${entryLabel}.primaryOrganId is not a specific existing organ`)
      } else {
        if (entry.primaryOrganId !== null) throw new Error(`${entryLabel}.primaryOrganId must be null for a proposed organ`)
        proposedNewOrgan = validateProposedOrgan(entry.proposedNewOrgan, { repository: repositoryRoot, fileByPath, label: `${entryLabel}.proposedNewOrgan` })
      }
      for (const secondary of entry.secondaryOrganIds) {
        if (!organById.has(secondary) || fallbackOrganIds.has(secondary)) throw new Error(`${entryLabel}.secondaryOrganIds references an unknown or fallback organ: ${secondary}`)
      }
      if (!Array.isArray(entry.sourceRefs) || entry.sourceRefs.length < 2) throw new Error(`${entryLabel}.sourceRefs must include component behavior and organ definition`)
      const sourceRefs = entry.sourceRefs.map((reference, index) => validateSourceRef(reference, {
        repository: repositoryRoot,
        fileByPath,
        organ,
        componentPath: relative,
        label: `${entryLabel}.sourceRefs[${index}]`,
      }))
      if (!sourceRefs.some(reference => ['component-behavior', 'component-entry'].includes(reference.role))) throw new Error(`${entryLabel} has no component behavior or non-regular entry ref`)
      if (entry.disposition === 'existing-organ' && !sourceRefs.some(reference => reference.role === 'organ-definition')) throw new Error(`${entryLabel} has no organ-definition source ref`)
      reviewByPath.set(relative, {
        ...entry,
        path: relative,
        sourceRefs,
        proposedNewOrgan,
        reviewAuthority: 'source-addressed-file-review-below-protected-ontology',
        reviewShard: {
          id: ledger.shard,
          path: absolutePath,
          sha256: sha256(bytes),
          reviewer: ledger.reviewer,
          entryIndex,
        },
      })
    }
    shards.push({ id: ledger.shard, path: absolutePath, sha256: sha256(bytes), reviewer: ledger.reviewer, denominator: ledger.denominator })
  }

  if (declaredEligible !== fallbackPaths.size || declaredReviewed !== fallbackPaths.size || reviewByPath.size !== fallbackPaths.size) {
    throw new Error(`component review shards do not exactly cover the fallback denominator: fallback=${fallbackPaths.size} eligible=${declaredEligible} reviewed=${declaredReviewed} unique=${reviewByPath.size}`)
  }
  const observedProposed = [...reviewByPath.values()].filter(review => review.disposition === 'proposed-new-organ').length
  const observedUnresolved = [...reviewByPath.values()].filter(review => review.unresolvedQuestions.length > 0).length
  if (declaredProposed !== observedProposed || declaredUnresolved !== observedUnresolved) throw new Error('component review shard denominator totals do not match reviewed entries')

  const updatedComponents = components.map(component => {
    const review = reviewByPath.get(component.path)
    if (!review) return component
    if (review.disposition === 'proposed-new-organ') {
      return {
        ...component,
        classification: {
          authority: review.reviewAuthority,
          disposition: review.disposition,
          plainLanguagePurpose: review.plainLanguagePurpose,
          rationale: review.rationale,
          confidence: review.confidence,
          sourceRefs: review.sourceRefs,
          proposedNewOrgan: review.proposedNewOrgan,
          unresolvedQuestions: review.unresolvedQuestions,
          reviewShard: review.reviewShard,
        },
      }
    }
    const organIds = [...new Set([review.primaryOrganId, ...review.secondaryOrganIds, ...component.organIds])]
    return {
      ...component,
      id: `component:${sha256(`${component.fileId}\0${organIds.join('\0')}\0${review.reviewShard.sha256}`)}`,
      primaryOrganId: review.primaryOrganId,
      organIds,
      classification: {
        authority: review.reviewAuthority,
        disposition: review.disposition,
        plainLanguagePurpose: review.plainLanguagePurpose,
        rationale: review.rationale,
        confidence: review.confidence,
        sourceRefs: review.sourceRefs,
        proposedNewOrgan: null,
        unresolvedQuestions: review.unresolvedQuestions,
        reviewShard: review.reviewShard,
      },
    }
  })
  return {
    components: updatedComponents,
    source: {
      state: 'observed',
      authority: 'source-addressed-file-review-below-protected-ontology',
      fallbackReviewBasis,
      shards,
      denominator: {
        fallbackBeforeReview: fallbackPaths.size,
        reviewed: reviewByPath.size,
        proposedNewOrgan: observedProposed,
        unresolved: observedUnresolved,
      },
    },
    reviewed: reviewByPath.size,
    unresolved: observedUnresolved,
    proposedNewOrgan: observedProposed,
  }
}
