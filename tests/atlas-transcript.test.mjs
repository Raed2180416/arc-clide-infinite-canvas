import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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

function makeRepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-transcript-repo-'))
  write('README.md', '# Transcript fixture\n', root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: root })
  execFileSync('git', ['add', 'README.md'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

function transcriptReviewLedger({ threadId = 'thread-reviewed', ownerMessageSetSha256, messageId = 'user-1', textSha256, overrides = {} }) {
  return {
    schemaVersion: 'arc-atlas-transcript-review-ledger-v1',
    authority: 'reviewed-interpretation-proposal-below-owner-message-and-protected-canon',
    threadId,
    ownerMessageSetSha256,
    reviewer: {
      identity: 'codex:atlas-test-reviewer',
      basis: 'explicit-message-by-message-review',
    },
    targetCatalog: [{
      ref: 'review-topic:complete-repository-understanding',
      label: 'Complete repository understanding',
      authority: 'reviewer-defined-topic-not-canon',
      canonicalIntentIds: [],
      sourceMessageIds: [messageId],
      adjudication: 'review-only-no-canon-effect',
    }],
    reviews: [{
      messageId,
      textSha256,
      classification: 'vision-principle',
      plainLanguage: 'Every repository component must be understandable to a new engineer.',
      canonicalEffect: {
        kind: 'candidate-reinforcement',
        targetRefs: ['review-topic:complete-repository-understanding'],
        explanation: 'This restates the required audience and completeness standard.',
      },
      obligations: ['Expose source, purpose, relationships, evidence, and unresolved gaps for every component.'],
      supersedesMessageIds: [],
      ...overrides,
    }],
  }
}

test('atlas build losslessly extracts only visible user and assistant messages from a rollout', () => {
  const repository = makeRepository()
  const transcriptPath = path.join(mkdtempSync(path.join(tmpdir(), 'arc-atlas-transcript-')), 'rollout.jsonl')
  const records = [
    { timestamp: '2026-08-15T00:00:00.000Z', type: 'session_meta', payload: { id: 'thread-1', session_id: 'thread-1' } },
    { timestamp: '2026-08-15T00:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { timestamp: '2026-08-15T00:00:02.000Z', type: 'response_item', payload: { type: 'message', id: 'developer-1', role: 'developer', content: [{ type: 'input_text', text: 'internal rule' }] } },
    { timestamp: '2026-08-15T00:00:03.000Z', type: 'event_msg', payload: { type: 'user_message', client_id: 'user-1', message: 'Make every component understandable.' } },
    { timestamp: '2026-08-15T00:00:04.000Z', type: 'event_msg', payload: { type: 'agent_reasoning', text: 'private reasoning must not appear' } },
    { timestamp: '2026-08-15T00:00:05.000Z', type: 'response_item', payload: { type: 'message', id: 'assistant-1', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'I will bind every explanation to evidence.' }], internal_chat_message_metadata_passthrough: { turn_id: 'turn-1' } } },
    { timestamp: '2026-08-15T00:00:06.000Z', type: 'response_item', payload: { type: 'function_call', name: 'secret-tool', arguments: '{"hidden":true}' } },
  ]
  writeFileSync(transcriptPath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--transcript', transcriptPath,
  ], { cwd: projectRoot })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const transcript = JSON.parse(readFileSync(path.join(output, 'data', 'transcript.json'), 'utf8'))

  assert.equal(transcript.schemaVersion, 'arc-atlas-visible-transcript-v1')
  assert.equal(transcript.threadId, 'thread-1')
  assert.deepEqual(transcript.messages.map(message => [message.role, message.text]), [
    ['user', 'Make every component understandable.'],
    ['assistant', 'I will bind every explanation to evidence.'],
  ])
  assert.ok(transcript.messages.every(message => /^[a-f0-9]{64}$/.test(message.textSha256)))
  assert.deepEqual(transcript.messages.map(message => message.source.line), [4, 6])
  assert.equal(transcript.coverage.userMessages, 1)
  assert.equal(transcript.coverage.assistantMessages, 1)
  assert.equal(transcript.coverage.privateReasoningIncluded, 0)
  assert.equal(manifest.gates.transcriptCoverage.status, 'pass')
  assert.equal(manifest.gates.transcriptSemantics.status, 'fail')
  assert.equal(manifest.gates.transcriptSemantics.reason, 'visible-messages-await-source-addressed-decision-review')
})

test('an exact reviewed owner-message denominator passes without turning review prose into canon', () => {
  const repository = makeRepository()
  const transcriptPath = path.join(mkdtempSync(path.join(tmpdir(), 'arc-atlas-transcript-reviewed-')), 'rollout.jsonl')
  const reviewPath = path.join(path.dirname(transcriptPath), 'reviews.json')
  const records = [
    { timestamp: '2026-08-15T00:00:00.000Z', type: 'session_meta', payload: { id: 'thread-reviewed' } },
    { timestamp: '2026-08-15T00:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', client_id: 'user-1', message: 'Make every component understandable.' } },
    { timestamp: '2026-08-15T00:00:02.000Z', type: 'response_item', payload: { type: 'message', id: 'assistant-1', role: 'assistant', content: [{ type: 'output_text', text: 'I will.' }] } },
  ]
  writeFileSync(transcriptPath, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
  const textSha256 = createHash('sha256').update('Make every component understandable.').digest('hex')
  const recordSha256 = createHash('sha256').update(JSON.stringify(records[1])).digest('hex')
  const ownerMessageSetSha256 = createHash('sha256').update(JSON.stringify([{
    id: 'user-1',
    source: { line: 2, recordSha256 },
    textSha256,
  }])).digest('hex')
  writeFileSync(reviewPath, `${JSON.stringify(transcriptReviewLedger({ ownerMessageSetSha256, textSha256 }), null, 2)}\n`)
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--transcript', transcriptPath,
    '--transcript-reviews', reviewPath,
  ], { cwd: projectRoot })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const transcript = JSON.parse(readFileSync(path.join(output, 'data', 'transcript.json'), 'utf8'))
  assert.equal(manifest.gates.transcriptSemantics.status, 'pass')
  assert.equal(transcript.coverage.reviewedDecisionMessages, 1)
  assert.equal(transcript.coverage.decisionReviewPending, 0)
  assert.equal(transcript.messages[0].review.classification, 'vision-principle')
  assert.equal(transcript.messages[0].review.canonAuthority, 'proposal-only-until-protected-canon-adjudication')
  assert.equal(transcript.messages[1].review, undefined)
})

test('a supplied transcript review ledger rejects stale, duplicate, or fabricated message bindings', async t => {
  const repository = makeRepository()
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'arc-atlas-transcript-hostile-'))
  const transcriptPath = path.join(fixtureRoot, 'rollout.jsonl')
  const reviewPath = path.join(fixtureRoot, 'reviews.json')
  const messageText = 'Make every component understandable.'
  writeFileSync(transcriptPath, `${JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', client_id: 'user-1', message: messageText } })}\n`)
  const textSha256 = createHash('sha256').update(messageText).digest('hex')
  const recordSha256 = createHash('sha256').update(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', client_id: 'user-1', message: messageText } })).digest('hex')
  const ownerMessageSetSha256 = createHash('sha256').update(JSON.stringify([{
    id: 'user-1',
    source: { line: 1, recordSha256 },
    textSha256,
  }])).digest('hex')

  const rejects = (ledger, pattern) => {
    writeFileSync(reviewPath, `${JSON.stringify(ledger, null, 2)}\n`)
    assert.throws(() => execFileSync(process.execPath, [
      atlasCli,
      'build',
      '--repo', repository,
      '--out', path.join(repository, `.atlas-${Math.random().toString(16).slice(2)}`),
      '--transcript', transcriptPath,
      '--transcript-reviews', reviewPath,
    ], { cwd: projectRoot, stdio: 'pipe' }), pattern)
  }

  await t.test('stale owner-message denominator', () => {
    rejects(transcriptReviewLedger({ threadId: null, ownerMessageSetSha256: 'f'.repeat(64), textSha256 }), /transcript review ledger does not bind the exact owner-message denominator/)
  })
  await t.test('duplicate review', () => {
    const ledger = transcriptReviewLedger({ threadId: null, ownerMessageSetSha256, textSha256 })
    ledger.reviews.push(structuredClone(ledger.reviews[0]))
    rejects(ledger, /duplicate transcript review/)
  })
  await t.test('unknown message id', () => {
    rejects(transcriptReviewLedger({ threadId: null, ownerMessageSetSha256, messageId: 'fabricated-user', textSha256 }), /unknown owner message/)
  })
  await t.test('stale message bytes', () => {
    rejects(transcriptReviewLedger({ threadId: null, ownerMessageSetSha256, textSha256: 'e'.repeat(64) }), /does not bind exact owner-message bytes/)
  })
})
