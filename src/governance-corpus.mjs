import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt', '.json', '.jsonl', '.yaml', '.yml'])
const NARRATIVE_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt'])

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]))
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function readJson(absolute, label) {
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`)
  }
}

function lineOf(bytes, needle) {
  const index = bytes.indexOf(needle)
  return index === -1 ? null : bytes.slice(0, index).split('\n').length
}

function headings(bytes) {
  return bytes.split(/\r?\n/).flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    return match ? [{ level: match[1].length, text: match[2], line: index + 1 }] : []
  })
}

function sourceAddress(relative, bytes, needle) {
  return { path: relative, line: lineOf(bytes, needle), fileSha256: sha256(bytes) }
}

function pathUnder(relative, parent) {
  return relative === parent || relative.startsWith(`${parent.replace(/\/$/, '')}/`)
}

function canonicalMetadataComplete(document, requiredMetadata) {
  return requiredMetadata.every(key => Object.hasOwn(document, key) && document[key] !== null)
}

function loadDocumentPolicies(policyPath) {
  if (!policyPath) return { path: null, sha256: null, bytes: null, policies: [] }
  const absolute = path.resolve(policyPath)
  const bytes = readFileSync(absolute)
  const value = readJson(absolute, 'document policy ledger')
  if (value.schemaVersion !== 'arc-atlas-document-policy-ledger-v1' || !Array.isArray(value.policies)) throw new Error('document policy ledger has an unsupported or invalid schema')
  const ids = new Set()
  for (const policy of value.policies) {
    if (!policy.id || ids.has(policy.id) || !policy.classification || !policy.role || !policy.authority || (!policy.path && !policy.pathPrefix)) throw new Error('document policy ledger contains an invalid or duplicate policy')
    ids.add(policy.id)
  }
  return { path: absolute, sha256: sha256(bytes), bytes: bytes.toString('utf8'), policies: value.policies }
}

function documentPolicyFor(relative, policies) {
  const matches = policies.filter(policy => policy.path === relative || (policy.pathPrefix && pathUnder(relative, policy.pathPrefix)))
  if (matches.length > 1) throw new Error(`document matches multiple governance policies: ${relative}`)
  return matches[0] || null
}

export function compileGovernanceCorpus({ repository, files, documentPolicyPath = null }) {
  const registryPath = 'docs/canon/CANONICAL-DOCS.json'
  const intentPath = 'docs/canon/ARC-CLIDE-INTENT-MAP.json'
  const registryAbsolute = path.join(repository, registryPath)
  const intentAbsolute = path.join(repository, intentPath)
  const registryPresent = existsSync(registryAbsolute)
  const registryBytes = registryPresent ? readFileSync(registryAbsolute, 'utf8') : null
  const registry = registryPresent ? readJson(registryAbsolute, 'canonical document registry') : null
  const canonicalDocuments = Array.isArray(registry?.documents) ? registry.documents : []
  const evidenceCollections = Array.isArray(registry?.evidenceCollections) ? registry.evidenceCollections : []
  const demotions = Array.isArray(registry?.demotions) ? registry.demotions : []
  const canonicalByPath = new Map(canonicalDocuments.map(document => [document.path, document]))
  const demotionByPath = new Map(demotions.map(document => [document.path, document]))
  const policyLedger = loadDocumentPolicies(documentPolicyPath)
  const usedPolicyIds = new Set()
  const visibleDocumentPaths = files
    .filter(file => {
      if (file.fileClass !== 'regular') return false
      const extension = path.extname(file.path).toLowerCase()
      return canonicalByPath.has(file.path)
        || NARRATIVE_EXTENSIONS.has(extension)
        || (file.path.startsWith('docs/') && DOCUMENT_EXTENSIONS.has(extension))
    })
    .map(file => file.path)
    .sort((left, right) => left.localeCompare(right))
  const visibleSet = new Set(visibleDocumentPaths)
  const requiredMetadata = registry?.documentGovernance?.requiredMetadata || []
  const documents = visibleDocumentPaths.map(relative => {
    const bytes = readFileSync(path.join(repository, relative), 'utf8')
    const canonical = canonicalByPath.get(relative) || null
    const evidence = evidenceCollections.find(collection => pathUnder(relative, collection.path)) || null
    const demotion = demotionByPath.get(relative) || null
    const documentPolicy = documentPolicyFor(relative, policyLedger.policies)
    if (documentPolicy) usedPolicyIds.add(documentPolicy.id)
    const classification = canonical ? 'registered-canonical-document'
      : evidence ? 'registered-evidence-collection-member'
        : demotion ? 'registered-demoted-or-historical-document'
          : documentPolicy ? documentPolicy.classification
        : relative === registryPath || relative === intentPath ? 'canon-control-document'
          : 'unclassified-document'
    const teachingText = canonical?.role || documentPolicy?.role || demotion?.reason || evidence?.authority || null
    const teachingSource = canonical || demotion || evidence
      ? sourceAddress(registryPath, registryBytes, `"path": "${canonical?.path || demotion?.path || evidence?.path}"`)
      : documentPolicy
        ? sourceAddress(policyLedger.path, policyLedger.bytes, `"id": "${documentPolicy.id}"`)
        : null
    return {
      id: `document:${sha256(relative)}`,
      path: relative,
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
      headings: headings(bytes),
      classification,
      canonical: canonical ? { ...canonical, metadataComplete: canonicalMetadataComplete(canonical, requiredMetadata) } : null,
      evidenceCollection: evidence,
      demotion,
      documentPolicy: documentPolicy ? { ...documentPolicy, source: { path: policyLedger.path, sha256: policyLedger.sha256 } } : null,
      teaching: teachingText
        ? { status: 'source-authored', plainLanguage: teachingText, sourceRefs: [teachingSource] }
        : { status: 'review-required', plainLanguage: null, sourceRefs: [] },
    }
  })
  const missingCanonicalPaths = canonicalDocuments.map(document => document.path).filter(relative => !visibleSet.has(relative)).sort()
  const malformedCanonicalMetadata = canonicalDocuments.filter(document => !canonicalMetadataComplete(document, requiredMetadata)).map(document => document.path).sort()

  let intentMap = null
  let intentBytes = null
  if (existsSync(intentAbsolute)) {
    intentBytes = readFileSync(intentAbsolute, 'utf8')
    intentMap = readJson(intentAbsolute, 'intent map')
  }
  const intentNodes = (intentMap?.nodes || []).map(node => ({
    ...node,
    atlasId: `intent:${node.id}`,
    sourceAddress: sourceAddress(intentPath, intentBytes, `\"id\": \"${node.id}\"`),
    teaching: {
      status: 'source-authored',
      plainLanguage: node.statement,
      sourceRefs: [sourceAddress(intentPath, intentBytes, `"id": "${node.id}"`)],
    },
  }))

  const findingPaths = visibleDocumentPaths.filter(relative => /^docs\/canon\/findings\/.+\.json$/.test(relative))
  const findings = findingPaths.map(relative => {
    const bytes = readFileSync(path.join(repository, relative), 'utf8')
    const value = readJson(path.join(repository, relative), `finding ${relative}`)
    return {
      ...value,
      atlasId: `finding:${value.findingId}`,
      path: relative,
      sha256: sha256(bytes),
      sourceAddress: sourceAddress(relative, bytes, `\"findingId\"`),
      teaching: value.claim && value.impact
        ? {
          status: 'source-authored',
          plainLanguage: `${value.claim}\n\nImpact: ${value.impact}`,
          sourceRefs: [sourceAddress(relative, bytes, `\"claim\"`), sourceAddress(relative, bytes, `\"impact\"`)],
        }
        : { status: 'review-required', plainLanguage: null, sourceRefs: [] },
    }
  })
  const authorityEventPaths = visibleDocumentPaths.filter(relative => /^docs\/canon\/authority-events\/.+\.json$/.test(relative))
  const authorityEvents = authorityEventPaths.map(relative => {
    const bytes = readFileSync(path.join(repository, relative), 'utf8')
    const value = readJson(path.join(repository, relative), `authority event ${relative}`)
    const teachingText = value.authorizationEvidence && Array.isArray(value.changes) && value.changes.every(change => change.after)
      ? [value.authorizationEvidence, ...value.changes.map(change => change.after)].join('\n\n')
      : null
    return {
      ...value,
      atlasId: `authority-event:${value.eventId}`,
      path: relative,
      sha256: sha256(bytes),
      sourceAddress: sourceAddress(relative, bytes, `\"eventId\"`),
      teaching: teachingText
        ? {
          status: 'source-authored',
          plainLanguage: teachingText,
          sourceRefs: [
            sourceAddress(relative, bytes, `\"authorizationEvidence\"`),
            ...value.changes.map(change => sourceAddress(relative, bytes, `\"nodeId\": \"${change.nodeId}\"`)),
          ],
        }
        : { status: 'review-required', plainLanguage: null, sourceRefs: [] },
    }
  })
  const relations = []
  for (const document of canonicalDocuments) {
    for (const intentRef of document.intentRefs || []) relations.push({ kind: 'document-addresses-intent', source: `document:${sha256(document.path)}`, target: `intent:${intentRef}` })
  }
  for (const finding of findings) {
    for (const intentRef of finding.intentRefs || []) relations.push({ kind: 'finding-addresses-intent', source: finding.atlasId, target: `intent:${intentRef}` })
    for (const superseded of finding.supersedes || []) relations.push({ kind: 'finding-supersedes-finding', source: finding.atlasId, target: `finding:${superseded}` })
  }
  for (const event of authorityEvents) {
    for (const change of event.changes || []) relations.push({ kind: 'authority-event-changes-intent', source: event.atlasId, target: `intent:${change.nodeId}` })
  }
  relations.sort((left, right) => `${left.kind}\0${left.source}\0${left.target}`.localeCompare(`${right.kind}\0${right.source}\0${right.target}`))
  const teachingConcepts = [...documents, ...intentNodes, ...findings, ...authorityEvents]
  const reviewedTeaching = teachingConcepts.filter(concept => concept.teaching?.status === 'source-authored'
    && concept.teaching.plainLanguage
    && concept.teaching.sourceRefs.length > 0).length

  const body = {
    schemaVersion: 'arc-atlas-governance-corpus-v1',
    authority: 'source-addressed-governance-derived-projection',
    sources: {
      canonicalRegistry: registryPresent ? { path: registryPath, sha256: sha256(registryBytes) } : { state: 'missing', path: registryPath },
      intentMap: intentBytes ? { path: intentPath, sha256: sha256(intentBytes) } : { state: 'missing', path: intentPath },
      documentPolicyLedger: documentPolicyPath ? { path: policyLedger.path, sha256: policyLedger.sha256 } : { state: 'not-requested' },
    },
    denominators: {
      documents: { visible: documents.length, classified: documents.filter(document => document.classification !== 'unclassified-document').length, unclassified: documents.filter(document => document.classification === 'unclassified-document').length },
      canonical: { registered: canonicalDocuments.length, present: canonicalDocuments.length - missingCanonicalPaths.length, missingPaths: missingCanonicalPaths, malformedMetadataPaths: malformedCanonicalMetadata },
      intentNodes: { total: intentNodes.length, protected: intentNodes.filter(node => node.protected === true).length },
      findings: { total: findings.length },
      authorityEvents: { total: authorityEvents.length },
      teaching: { concepts: teachingConcepts.length, reviewed: reviewedTeaching, reviewRequired: teachingConcepts.length - reviewedTeaching },
      documentPolicies: { total: policyLedger.policies.length, used: usedPolicyIds.size, unusedIds: policyLedger.policies.map(policy => policy.id).filter(id => !usedPolicyIds.has(id)).sort() },
    },
    gates: {
      canonicalDocuments: { status: registryPresent && missingCanonicalPaths.length === 0 && malformedCanonicalMetadata.length === 0 ? 'pass' : 'fail', reason: !registryPresent ? 'canonical-registry-missing' : missingCanonicalPaths.length ? 'registered-canonical-documents-missing' : malformedCanonicalMetadata.length ? 'registered-canonical-metadata-incomplete' : 'every-registered-canonical-document-is-present-and-metadata-complete' },
      intentMap: { status: intentNodes.length > 0 ? 'pass' : 'fail', reason: intentNodes.length > 0 ? 'intent-map-nodes-physically-opened' : 'intent-map-missing-or-empty' },
      findings: { status: findings.every(finding => finding.findingId && finding.claim && finding.evidenceStatus) ? 'pass' : 'fail', reason: findings.every(finding => finding.findingId && finding.claim && finding.evidenceStatus) ? 'every-visible-finding-has-core-identity-and-claim-fields' : 'finding-core-fields-incomplete' },
      authorityEvents: { status: authorityEvents.every(event => event.eventId && event.authorizedBy && Array.isArray(event.changes)) ? 'pass' : 'fail', reason: authorityEvents.every(event => event.eventId && event.authorizedBy && Array.isArray(event.changes)) ? 'every-visible-authority-event-has-core-identity-and-change-fields' : 'authority-event-core-fields-incomplete' },
      documentClassification: { status: documents.every(document => document.classification !== 'unclassified-document') ? 'pass' : 'fail', reason: documents.every(document => document.classification !== 'unclassified-document') ? 'every-visible-document-has-a-governance-classification' : 'visible-documents-remain-unclassified' },
      teachingCoverage: {
        status: teachingConcepts.length > 0 && reviewedTeaching === teachingConcepts.length ? 'pass' : 'fail',
        reason: teachingConcepts.length === 0
          ? 'governance-teaching-denominator-is-empty'
          : reviewedTeaching !== teachingConcepts.length
            ? 'governance-concepts-await-source-authored-teaching'
            : 'every-governance-concept-has-source-authored-teaching-text-and-addresses',
      },
    },
    teaching: { status: 'review-required', rule: 'A content hash proves which bytes exist; it does not prove a plain-language explanation or semantic entailment.' },
    documents,
    intentNodes,
    findings,
    authorityEvents,
    relations,
  }
  return { ...body, governanceSha256: sha256(canonicalJson(body)) }
}
