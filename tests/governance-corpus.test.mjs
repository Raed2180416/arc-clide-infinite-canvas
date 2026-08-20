import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { compileGovernanceCorpus } from '../src/governance-corpus.mjs'

function write(root, relative, value) {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
}

test('governance corpus binds canon, intent, findings, authority events, and every visible document', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-governance-'))
  write(repository, 'CODEX.md', '# Mission\n\nProtect the original ask.\n')
  write(repository, 'docs/extra.md', '# Unregistered note\n')
  write(repository, 'docs/canon/CANONICAL-DOCS.json', {
    schemaVersion: '1.0.0', kind: 'CanonicalDocumentRegistry', gateway: 'CODEX.md',
    documentGovernance: { requiredMetadata: ['intentRefs', 'owner', 'consumers', 'authority', 'freshness', 'supersedes', 'retirement'] },
    documents: [{
      id: 'gateway', path: 'CODEX.md', status: 'canonical', role: 'stable read order', intentRefs: ['ARC'],
      owner: 'canon', consumers: ['agents'], authority: 'normative only', freshness: 'on change', supersedes: [], retirement: 'replacement required',
    }],
    evidenceCollections: [{ path: 'docs/canon/findings', status: 'append-only' }],
  })
  write(repository, 'docs/canon/ARC-CLIDE-INTENT-MAP.json', {
    schemaVersion: '1.0.0', kind: 'IntentMap', rootId: 'ARC', authorityPolicy: { rootProtected: true },
    nodes: [{ id: 'ARC', parentId: null, type: 'mission', protected: true, statement: 'Build the whole system.', source: 'owner-objective' }],
  })
  write(repository, 'docs/canon/findings/2026/F-1.json', {
    kind: 'CanonFinding', schemaVersion: '1.0.0', findingId: 'F-1', observedAt: '2026-01-01T00:00:00Z', actor: 'agent',
    intentRefs: ['ARC'], evidenceStatus: 'measured', claim: 'A fact was measured.', evidenceRefs: [{ kind: 'file', ref: 'CODEX.md' }],
    impact: 'It changes the plan.', planDelta: { status: 'proposed', targetRefs: ['ARC'], summary: 'Continue.', rationale: 'Evidence.' },
    authorityChange: false, supersedes: [],
  })
  write(repository, 'docs/canon/authority-events/A-1.json', {
    kind: 'IntentAuthorityEvent', schemaVersion: '1.0.0', eventId: 'A-1', authorizedAt: '2026-01-01T00:00:00Z', authorizedBy: 'owner',
    authorizationEvidence: 'Exact owner direction.', reviewedBy: 'agent', evidenceRefs: ['owner-message'],
    changes: [{ nodeId: 'ARC', before: 'old', after: 'Build the whole system.', scopeEffect: 'correct', rationale: 'Owner correction.' }],
  })
  const files = [
    'CODEX.md', 'docs/extra.md', 'docs/canon/CANONICAL-DOCS.json', 'docs/canon/ARC-CLIDE-INTENT-MAP.json',
    'docs/canon/findings/2026/F-1.json', 'docs/canon/authority-events/A-1.json',
  ].map(filePath => ({ path: filePath, fileClass: 'regular' }))

  const corpus = compileGovernanceCorpus({ repository, files })

  assert.equal(corpus.denominators.documents.visible, 6)
  assert.equal(corpus.denominators.canonical.registered, 1)
  assert.equal(corpus.denominators.intentNodes.total, 1)
  assert.equal(corpus.denominators.findings.total, 1)
  assert.equal(corpus.denominators.authorityEvents.total, 1)
  assert.equal(corpus.gates.canonicalDocuments.status, 'pass')
  assert.equal(corpus.gates.documentClassification.status, 'fail')
  assert.ok(corpus.documents.find(document => document.path === 'CODEX.md').sha256.match(/^[a-f0-9]{64}$/))
  assert.equal(corpus.documents.find(document => document.path === 'docs/extra.md').classification, 'unclassified-document')
  assert.equal(corpus.intentNodes[0].statement, 'Build the whole system.')
  assert.equal(corpus.relations.some(relation => relation.kind === 'finding-addresses-intent'), true)
  assert.equal(corpus.documents.find(document => document.path === 'CODEX.md').teaching.status, 'source-authored')
  assert.equal(corpus.intentNodes[0].teaching.plainLanguage, 'Build the whole system.')
  assert.match(corpus.findings[0].teaching.plainLanguage, /Impact: It changes the plan\./)
  assert.match(corpus.authorityEvents[0].teaching.plainLanguage, /Exact owner direction\./)
  assert.equal(corpus.gates.teachingCoverage.status, 'fail')
  assert.ok(corpus.denominators.teaching.reviewRequired > 0)
  assert.equal(corpus.teaching.status, 'review-required')
})

test('governance corpus refuses a canonical registry whose required document is absent', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-governance-missing-'))
  write(repository, 'docs/canon/CANONICAL-DOCS.json', {
    schemaVersion: '1.0.0', kind: 'CanonicalDocumentRegistry', gateway: 'MISSING.md',
    documentGovernance: { requiredMetadata: ['intentRefs', 'owner', 'consumers', 'authority', 'freshness', 'supersedes', 'retirement'] },
    documents: [{ id: 'missing', path: 'MISSING.md', status: 'canonical', role: 'missing', intentRefs: [], owner: 'canon', consumers: [], authority: 'none', freshness: 'never', supersedes: [], retirement: 'none' }],
    evidenceCollections: [],
  })
  const files = [{ path: 'docs/canon/CANONICAL-DOCS.json', fileClass: 'regular' }]
  const corpus = compileGovernanceCorpus({ repository, files })
  assert.equal(corpus.gates.canonicalDocuments.status, 'fail')
  assert.deepEqual(corpus.denominators.canonical.missingPaths, ['MISSING.md'])
})

test('document policies source-address noncanonical operational manuals without promoting them to canon', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-governance-policy-'))
  write(repository, 'AGENTS.md', '# Agent rules\n')
  write(repository, '.agents/skills/example/SKILL.md', '# Example skill\n')
  const policyPath = path.join(repository, '..', `${path.basename(repository)}-documents.json`)
  write(repository, 'docs/canon/CANONICAL-DOCS.json', { schemaVersion: '1', kind: 'CanonicalDocumentRegistry', documents: [], evidenceCollections: [], demotions: [], documentGovernance: { requiredMetadata: [] } })
  writeFileSync(policyPath, `${JSON.stringify({ schemaVersion: 'arc-atlas-document-policy-ledger-v1', policies: [{ id: 'skills', pathPrefix: '.agents/skills', classification: 'registered-operational-skill-manual', role: 'bounded reasoning and workflow procedure', authority: 'procedural guidance only' }] }, null, 2)}\n`)
  const files = ['AGENTS.md', '.agents/skills/example/SKILL.md', 'docs/canon/CANONICAL-DOCS.json'].map(filePath => ({ path: filePath, fileClass: 'regular' }))
  const corpus = compileGovernanceCorpus({ repository, files, documentPolicyPath: policyPath })
  const skill = corpus.documents.find(document => document.path.endsWith('SKILL.md'))
  assert.equal(skill.classification, 'registered-operational-skill-manual')
  assert.equal(skill.canonical, null)
  assert.equal(skill.documentPolicy.source.sha256, corpus.sources.documentPolicyLedger.sha256)
  assert.deepEqual(skill.teaching, {
    status: 'source-authored',
    plainLanguage: 'bounded reasoning and workflow procedure',
    sourceRefs: [skill.teaching.sourceRefs[0]],
  })
  assert.match(skill.teaching.sourceRefs[0].fileSha256, /^[a-f0-9]{64}$/)
})
