import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

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

function scanJsonLines(absolutePath, visit) {
  const descriptor = openSync(absolutePath, 'r')
  const decoder = new StringDecoder('utf8')
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  let pending = ''
  let lineNumber = 0
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      const observed = buffer.subarray(0, bytesRead)
      digest.update(observed)
      pending += decoder.write(observed)
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, '')
        pending = pending.slice(newline + 1)
        lineNumber += 1
        if (line.trim()) visit(line, lineNumber)
        newline = pending.indexOf('\n')
      }
    }
    pending += decoder.end()
    if (pending.trim()) {
      lineNumber += 1
      visit(pending.replace(/\r$/, ''), lineNumber)
    }
  } finally {
    closeSync(descriptor)
  }
  return { sha256: digest.digest('hex'), lineCount: lineNumber }
}

function messageText(content, expectedType) {
  return (content || [])
    .filter(item => item.type === expectedType && typeof item.text === 'string')
    .map(item => item.text)
    .join('')
}

const REVIEW_CLASSIFICATIONS = new Set([
  'vision-principle',
  'operating-principle',
  'constraint',
  'scope-correction',
  'clarification',
  'approval',
  'decision',
  'status-request',
  'question',
  'continuation',
  'supersession',
  'implementation-request',
  'completion-criterion',
  'resource-direction',
  'no-canon-delta',
])

const CANONICAL_EFFECT_KINDS = new Set([
  'candidate-reinforcement',
  'candidate-correction',
  'candidate-expansion',
  'candidate-supersession',
  'no-canon-delta',
  'question-only',
])

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}`)
  }
}

function assertNonemptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`)
}

function assertUniqueStringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a nonempty'} array`)
  const seen = new Set()
  for (const item of value) {
    assertNonemptyString(item, `${label} entry`)
    if (seen.has(item)) throw new Error(`${label} contains a duplicate entry: ${item}`)
    seen.add(item)
  }
}

function readTranscriptReviewLedger(reviewLedgerPath, { threadId, ownerMessageSetSha256, ownerMessages, canonicalIntentIds = null }) {
  if (!reviewLedgerPath) return null
  const absolutePath = path.resolve(reviewLedgerPath)
  const bytes = readFileSync(absolutePath)
  let ledger
  try {
    ledger = JSON.parse(bytes)
  } catch (error) {
    throw new Error(`transcript review ledger is invalid JSON: ${error.message}`)
  }
  assertExactKeys(ledger, ['schemaVersion', 'authority', 'threadId', 'ownerMessageSetSha256', 'reviewer', 'targetCatalog', 'reviews'], 'transcript review ledger')
  if (ledger.schemaVersion !== 'arc-atlas-transcript-review-ledger-v1') throw new Error('transcript review ledger has an unsupported schemaVersion')
  if (ledger.authority !== 'reviewed-interpretation-proposal-below-owner-message-and-protected-canon') {
    throw new Error('transcript review ledger attempts an unsupported authority class')
  }
  if (ledger.threadId !== threadId || ledger.ownerMessageSetSha256 !== ownerMessageSetSha256) {
    throw new Error('transcript review ledger does not bind the exact owner-message denominator')
  }
  assertExactKeys(ledger.reviewer, ['identity', 'basis'], 'transcript review ledger reviewer')
  assertNonemptyString(ledger.reviewer.identity, 'transcript review ledger reviewer identity')
  if (ledger.reviewer.basis !== 'explicit-message-by-message-review') {
    throw new Error('transcript review ledger reviewer basis must be explicit-message-by-message-review')
  }
  if (!Array.isArray(ledger.reviews)) throw new Error('transcript review ledger reviews must be an array')

  const ownerById = new Map(ownerMessages.map(message => [message.id, message]))
  const canonicalIntentSet = canonicalIntentIds === null ? null : new Set(canonicalIntentIds)
  let canonicalIntentRefCount = 0
  if (!Array.isArray(ledger.targetCatalog)) throw new Error('transcript review ledger targetCatalog must be an array')
  const targetByRef = new Map()
  for (const [index, target] of ledger.targetCatalog.entries()) {
    const label = `transcript review ledger targetCatalog[${index}]`
    assertExactKeys(target, ['ref', 'label', 'authority', 'canonicalIntentIds', 'sourceMessageIds', 'adjudication'], label)
    if (typeof target.ref !== 'string' || !/^review-topic:[a-z0-9][a-z0-9-]*$/.test(target.ref)) throw new Error(`${label}.ref must be a review-topic ref`)
    if (targetByRef.has(target.ref)) throw new Error(`duplicate transcript review target: ${target.ref}`)
    assertNonemptyString(target.label, `${label}.label`)
    if (target.authority !== 'reviewer-defined-topic-not-canon') throw new Error(`${label}.authority is not admitted`)
    assertUniqueStringArray(target.canonicalIntentIds, `${label}.canonicalIntentIds`)
    assertUniqueStringArray(target.sourceMessageIds, `${label}.sourceMessageIds`, { allowEmpty: false })
    for (const sourceMessageId of target.sourceMessageIds) {
      if (!ownerById.has(sourceMessageId)) throw new Error(`${label}.sourceMessageIds references an unknown owner message: ${sourceMessageId}`)
    }
    if (!['matched-to-protected-intent', 'review-only-no-canon-effect'].includes(target.adjudication)) throw new Error(`${label}.adjudication is not admitted`)
    if (target.adjudication === 'matched-to-protected-intent' && target.canonicalIntentIds.length === 0) throw new Error(`${label} has no canonical intent match`)
    if (target.adjudication === 'review-only-no-canon-effect' && target.canonicalIntentIds.length !== 0) throw new Error(`${label} cannot cite canonical intents when it declares no canon effect`)
    if (canonicalIntentSet) {
      for (const intentId of target.canonicalIntentIds) {
        if (!canonicalIntentSet.has(intentId)) throw new Error(`${label}.canonicalIntentIds references an unknown protected intent: ${intentId}`)
        canonicalIntentRefCount += 1
      }
    }
    targetByRef.set(target.ref, target)
  }
  const reviewsByMessageId = new Map()
  for (const [index, review] of ledger.reviews.entries()) {
    const label = `transcript review ledger reviews[${index}]`
    assertExactKeys(review, ['messageId', 'textSha256', 'classification', 'plainLanguage', 'canonicalEffect', 'obligations', 'supersedesMessageIds'], label)
    assertNonemptyString(review.messageId, `${label}.messageId`)
    if (reviewsByMessageId.has(review.messageId)) throw new Error(`duplicate transcript review for owner message: ${review.messageId}`)
    const message = ownerById.get(review.messageId)
    if (!message) throw new Error(`transcript review references an unknown owner message: ${review.messageId}`)
    if (review.textSha256 !== message.textSha256) throw new Error(`transcript review does not bind exact owner-message bytes: ${review.messageId}`)
    if (!REVIEW_CLASSIFICATIONS.has(review.classification)) throw new Error(`${label}.classification is not admitted`)
    assertNonemptyString(review.plainLanguage, `${label}.plainLanguage`)
    assertExactKeys(review.canonicalEffect, ['kind', 'targetRefs', 'explanation'], `${label}.canonicalEffect`)
    if (!CANONICAL_EFFECT_KINDS.has(review.canonicalEffect.kind)) throw new Error(`${label}.canonicalEffect.kind is not admitted`)
    assertUniqueStringArray(review.canonicalEffect.targetRefs, `${label}.canonicalEffect.targetRefs`)
    for (const ref of review.canonicalEffect.targetRefs) if (!targetByRef.has(ref)) throw new Error(`${label}.canonicalEffect.targetRefs contains an undeclared review topic: ${ref}`)
    if (review.canonicalEffect.kind.startsWith('candidate-') && review.canonicalEffect.targetRefs.length === 0) {
      throw new Error(`${label}.canonicalEffect requires at least one typed target ref`)
    }
    assertNonemptyString(review.canonicalEffect.explanation, `${label}.canonicalEffect.explanation`)
    assertUniqueStringArray(review.obligations, `${label}.obligations`)
    assertUniqueStringArray(review.supersedesMessageIds, `${label}.supersedesMessageIds`)
    for (const supersededId of review.supersedesMessageIds) {
      if (!ownerById.has(supersededId)) throw new Error(`${label}.supersedesMessageIds references an unknown owner message: ${supersededId}`)
      if (supersededId === review.messageId) throw new Error(`${label}.supersedesMessageIds cannot reference itself`)
    }
    if (review.canonicalEffect.kind === 'candidate-supersession' && review.supersedesMessageIds.length === 0) {
      throw new Error(`${label} claims supersession without naming superseded owner messages`)
    }
    reviewsByMessageId.set(review.messageId, {
      ...review,
      canonAuthority: 'proposal-only-until-protected-canon-adjudication',
      reviewSource: {
        path: absolutePath,
        ledgerSha256: sha256(bytes),
        reviewIndex: index,
      },
    })
  }
  return {
    descriptor: {
      path: absolutePath,
      sha256: sha256(bytes),
      schemaVersion: ledger.schemaVersion,
      authority: ledger.authority,
      threadId: ledger.threadId,
      ownerMessageSetSha256: ledger.ownerMessageSetSha256,
      reviewer: ledger.reviewer,
      targetCatalog: ledger.targetCatalog,
      canonCrosswalk: {
        state: canonicalIntentSet ? 'verified-against-protected-intent-denominator' : 'not-evaluated-outside-atlas-build',
        reviewTopics: ledger.targetCatalog.length,
        matchedTopics: ledger.targetCatalog.filter(target => target.adjudication === 'matched-to-protected-intent').length,
        reviewOnlyTopics: ledger.targetCatalog.filter(target => target.adjudication === 'review-only-no-canon-effect').length,
        canonicalIntentRefsVerified: canonicalIntentSet ? canonicalIntentRefCount : 0,
      },
    },
    reviewsByMessageId,
  }
}

export function compileVisibleTranscript(transcriptPath, reviewLedgerPath = null, { canonicalIntentIds = null } = {}) {
  const absolutePath = path.resolve(transcriptPath)
  const messages = []
  const seenIds = new Set()
  let threadId = null
  let currentTurnId = null
  const source = scanJsonLines(absolutePath, (line, lineNumber) => {
    let record
    try {
      record = JSON.parse(line)
    } catch (error) {
      throw new Error(`transcript JSONL is invalid at line ${lineNumber}: ${error.message}`)
    }
    const payload = record.payload || {}
    if (record.type === 'session_meta') {
      threadId = payload.id || payload.session_id || threadId
      return
    }
    if (record.type === 'turn_context') currentTurnId = payload.turn_id || currentTurnId
    if (record.type === 'event_msg' && payload.type === 'task_started') {
      currentTurnId = payload.turn_id || currentTurnId
      return
    }
    if (record.type === 'event_msg' && payload.type === 'user_message') {
      const text = typeof payload.message === 'string' ? payload.message : ''
      const id = payload.client_id || `user:${sha256(`${lineNumber}\0${text}`)}`
      if (!text || seenIds.has(id)) return
      seenIds.add(id)
      messages.push({
        id,
        role: 'user',
        turnId: currentTurnId,
        phase: 'user-direction',
        timestamp: record.timestamp || null,
        text,
        textSha256: sha256(text),
        source: { path: absolutePath, line: lineNumber, recordSha256: sha256(line) },
        authority: 'verbatim-owner-message-below-current-owner-direction-and-canon-adjudication',
      })
      return
    }
    if (record.type !== 'response_item' || payload.type !== 'message' || payload.role !== 'assistant') return
    const text = messageText(payload.content, 'output_text')
    if (!text || !payload.id || seenIds.has(payload.id)) return
    seenIds.add(payload.id)
    messages.push({
      id: payload.id,
      role: 'assistant',
      turnId: payload.internal_chat_message_metadata_passthrough?.turn_id || currentTurnId,
      phase: payload.phase || 'visible-assistant-message',
      timestamp: record.timestamp || null,
      text,
      textSha256: sha256(text),
      source: { path: absolutePath, line: lineNumber, recordSha256: sha256(line) },
      authority: 'visible-assistant-commitment-not-owner-intent-or-product-proof',
    })
  })
  const ownerMessages = messages.filter(message => message.role === 'user')
  const ownerMessageSetSha256 = sha256(canonicalJson(ownerMessages.map(message => ({
    id: message.id,
    source: { line: message.source.line, recordSha256: message.source.recordSha256 },
    textSha256: message.textSha256,
  }))))
  const reviewLedger = readTranscriptReviewLedger(reviewLedgerPath, {
    threadId,
    ownerMessageSetSha256,
    ownerMessages,
    canonicalIntentIds,
  })
  for (const message of ownerMessages) {
    const review = reviewLedger?.reviewsByMessageId.get(message.id)
    if (review) message.review = review
  }
  const userMessages = ownerMessages.length
  const assistantMessages = messages.length - userMessages
  const reviewedDecisionMessages = ownerMessages.filter(message => message.review).length
  const body = {
    schemaVersion: 'arc-atlas-visible-transcript-v1',
    authority: 'verbatim-visible-history-derived-projection',
    threadId,
    source: {
      path: absolutePath,
      sha256: source.sha256,
      lineCount: source.lineCount,
      inclusion: 'event_msg.user_message plus response_item assistant output_text only',
      exclusions: ['developer/system instructions', 'private reasoning', 'tool calls', 'tool outputs', 'world state'],
    },
    coverage: {
      messages: messages.length,
      userMessages,
      assistantMessages,
      privateReasoningIncluded: 0,
      reviewedDecisionMessages,
      decisionReviewPending: userMessages - reviewedDecisionMessages,
      ownerMessageSetSha256,
    },
    reviewLedger: reviewLedger?.descriptor || null,
    messages,
  }
  return { ...body, transcriptSha256: sha256(canonicalJson(body)) }
}
