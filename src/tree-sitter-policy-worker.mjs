import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Language, Parser, Query } from 'web-tree-sitter'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function readInput() {
  return JSON.parse(readFileSync(0, 'utf8'))
}

const OPERATION_EVENT_KINDS = ['call', 'construct', 'branch', 'loop', 'return', 'throw', 'await', 'yield', 'mutation', 'guard']

const TREE_SITTER_EVENT_TYPES = new Map([
  ['call', new Set(['call', 'call_expression', 'command', 'function_call', 'function_call_expression', 'invocation_expression', 'method_invocation'])],
  ['construct', new Set(['new_expression', 'object_creation_expression'])],
  ['branch', new Set(['case_expression', 'case_statement', 'cond', 'conditional_expression', 'if', 'if_expression', 'if_statement', 'match_expression', 'switch_expression', 'switch_statement', 'unless'])],
  ['loop', new Set(['do_statement', 'for_expression', 'for_statement', 'foreach_statement', 'loop_expression', 'until', 'while_expression', 'while_statement'])],
  ['return', new Set(['return', 'return_expression', 'return_statement'])],
  ['throw', new Set(['raise', 'raise_expression', 'throw_expression', 'throw_statement'])],
  ['await', new Set(['await_expression'])],
  ['yield', new Set(['yield_expression', 'yield_statement'])],
  ['mutation', new Set(['assignment', 'assignment_expression', 'assignment_statement', 'augmented_assignment', 'update_expression', 'variable_assignment'])],
  ['guard', new Set(['catch_clause', 'except_clause', 'rescue', 'try_expression', 'try_statement', 'using_statement', 'with_statement'])],
])

function nodeKey(node) {
  return `${node.startIndex}:${node.endIndex}:${node.type}`
}

function nodeBytes(source, node) {
  return Buffer.from(source.slice(node.startIndex, node.endIndex), 'utf8')
}

function nodeText(source, node) {
  return source.slice(node.startIndex, node.endIndex)
}

function nodeSpan(node) {
  return {
    start: { line: node.startPosition.row + 1, column: node.startPosition.column + 1 },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column + 1 },
  }
}

function sourceSpecifierText(source, capture, literal, language, role) {
  if (!capture) return null
  let text = nodeText(source, capture.node).trim()
  if (language === 'C#' && role === 'use') {
    text = text.replace(/^using\s+/, '').replace(/;$/, '').split('=').at(-1).trim()
  } else if (language === 'Scala' && role === 'static-import') {
    text = text.replace(/^import\s+/, '').trim()
  } else if (language === 'PHP') {
    text = text.replace(/^(?:use(?:\s+(?:function|const))?|include(?:_once)?|require(?:_once)?)\s+/i, '').replace(/;$/, '').trim()
  }
  if (!literal || text.length < 2) return text
  const first = text[0]
  const last = text.at(-1)
  if (['"', "'", '`'].includes(first) && last === first) return text.slice(1, -1)
  if (first === '<' && last === '>') return text.slice(1, -1)
  return text
}

function queriedSourceSites(relative, language, rootNode, source, policy, query) {
  const sites = []
  if (!query) return sites
  for (const match of query.matches(rootNode)) {
    const siteCaptures = match.captures.filter(capture => capture.name.startsWith('source.site.'))
    for (const capture of siteCaptures) {
      const role = capture.name.slice('source.site.'.length)
      const literalName = `source.specifier.literal.${role}`
      const nonliteralName = `source.specifier.nonliteral.${role}`
      const literalCapture = match.captures.find(candidate => candidate.name === literalName)
      const nonliteralCapture = match.captures.find(candidate => candidate.name === nonliteralName)
      const specifierCapture = literalCapture || nonliteralCapture || null
      const bytes = nodeBytes(source, capture.node)
      sites.push({
        path: relative,
        language,
        syntaxKind: capture.node.type,
        ...nodeSpan(capture.node),
        sourceSha256: sha256(bytes),
        roles: [role],
        spelling: specifierCapture ? nodeText(source, specifierCapture.node) : null,
        literalSpecifier: sourceSpecifierText(source, specifierCapture, Boolean(literalCapture), language, role),
        specifierState: literalCapture ? 'literal' : nonliteralCapture ? 'nonliteral' : 'not-applicable',
        parserAdapter: 'tree-sitter-policy-v1',
        parserPolicy: {
          grammarSha256: policy.grammar.sha256,
          definitionQuerySha256: policy.query.sha256,
          sourceSiteQuerySha256: policy.sourceSiteQuery.sha256,
        },
        authority: 'hash-pinned-tree-sitter-source-site-query',
      })
    }
  }
  return sites
}

function mergeSourceSites(...groups) {
  const byOccurrence = new Map()
  for (const site of groups.flat()) {
    const key = `${site.path}\0${site.start.line}:${site.start.column}\0${site.end.line}:${site.end.column}\0${site.sourceSha256}`
    const prior = byOccurrence.get(key)
    if (!prior) {
      byOccurrence.set(key, { ...site, roles: [...site.roles] })
      continue
    }
    if (prior.literalSpecifier != null && site.literalSpecifier != null && prior.literalSpecifier !== site.literalSpecifier) {
      throw new Error(`tree-sitter source-site query produced conflicting specifiers for one exact occurrence: ${site.path}`)
    }
    prior.roles = [...new Set([...prior.roles, ...site.roles])].sort()
    prior.spelling ||= site.spelling
    prior.literalSpecifier ??= site.literalSpecifier
    if (site.specifierState !== 'not-applicable') prior.specifierState = site.specifierState
    if (site.parserPolicy?.sourceSiteQuerySha256) prior.parserPolicy = site.parserPolicy
    if (site.authority === 'hash-pinned-tree-sitter-source-site-query') prior.authority = site.authority
  }
  return [...byOccurrence.values()].sort((left, right) => left.start.line - right.start.line
    || left.start.column - right.start.column
    || left.end.line - right.end.line
    || left.end.column - right.end.column
    || left.roles.join(',').localeCompare(right.roles.join(',')))
}

function eventKindForNodeType(nodeType) {
  for (const [kind, types] of TREE_SITTER_EVENT_TYPES) {
    if (types.has(nodeType)) return kind
  }
  return null
}

function eventSubjectNode(node, kind) {
  const fieldNames = kind === 'mutation'
    ? ['left', 'target', 'name']
    : ['function', 'method', 'name', 'command', 'constructor']
  for (const fieldName of fieldNames) {
    const child = node.childForFieldName(fieldName)
    if (child) return child
  }
  return kind === 'call' || kind === 'construct' || kind === 'mutation'
    ? node.firstNamedChild
    : null
}

function plainCount(value) {
  if (value === 0) return 'no'
  if (value === 1) return 'one'
  return String(value)
}

function operationalPlainLanguage({ declaredInputs, eventCounts }) {
  const calls = eventCounts.call + eventCounts.construct
  return `The parser observed ${plainCount(declaredInputs.length)} declared input node${declaredInputs.length === 1 ? '' : 's'}, ${plainCount(calls)} call or construction site${calls === 1 ? '' : 's'}, ${plainCount(eventCounts.branch)} branch${eventCounts.branch === 1 ? '' : 'es'}, ${plainCount(eventCounts.loop)} loop${eventCounts.loop === 1 ? '' : 's'}, ${plainCount(eventCounts.return)} return${eventCounts.return === 1 ? '' : 's'}, ${plainCount(eventCounts.throw)} thrown exception${eventCounts.throw === 1 ? '' : 's'}, and ${plainCount(eventCounts.mutation)} mutation site${eventCounts.mutation === 1 ? '' : 's'} inside this exact declaration. These are source-syntax facts, not a claim about author intent or runtime effects.`
}

function parameterContainer(node) {
  const explicit = node.childForFieldName('parameters')
  if (explicit) return explicit
  return node.namedChildren.find(child => [
    'formal_parameters',
    'parameter_list',
    'parameters',
    'parameters_list',
  ].includes(child.type)) || null
}

function operationalBehavior(relative, node, source, definitionKeys) {
  const parameters = parameterContainer(node)
  const declaredInputs = (parameters?.namedChildren || []).map(parameter => {
    const bytes = nodeBytes(source, parameter)
    return {
      text: nodeText(source, parameter),
      name: null,
      syntaxKind: parameter.type,
      ...nodeSpan(parameter),
      sourceSha256: sha256(bytes),
    }
  })
  const events = []
  const syntaxNodeCounts = new Map()
  function visit(current) {
    if (current !== node && definitionKeys.has(nodeKey(current))) return
    syntaxNodeCounts.set(current.type, (syntaxNodeCounts.get(current.type) || 0) + 1)
    const kind = eventKindForNodeType(current.type)
    if (kind) {
      const subjectNode = eventSubjectNode(current, kind)
      const bytes = nodeBytes(source, current)
      events.push({
        kind,
        subject: subjectNode ? nodeText(source, subjectNode) : null,
        syntaxKind: current.type,
        ...nodeSpan(current),
        sourceSha256: sha256(bytes),
      })
    }
    for (const child of current.namedChildren) visit(child)
  }
  visit(node)
  const eventCounts = Object.fromEntries(OPERATION_EVENT_KINDS.map(kind => [kind, 0]))
  for (const event of events) eventCounts[event.kind] += 1
  const bodySha256 = sha256(nodeBytes(source, node))
  return {
    schemaVersion: 'arc-atlas-operational-syntax-v1',
    status: 'exact-parser-derived',
    sourceSpan: { path: relative, ...nodeSpan(node), bodySha256 },
    declaredInputs,
    eventCounts,
    events,
    syntaxNodeCounts: Object.fromEntries([...syntaxNodeCounts].sort(([left], [right]) => left.localeCompare(right))),
    plainLanguage: operationalPlainLanguage({ declaredInputs, eventCounts }),
    resolutionCeiling: 'syntax-only-no-binding-runtime-effect-or-author-intent',
    authority: 'exact-syntax-only-not-runtime-effect-or-author-intent',
  }
}

function wholeFileSourceSites(relative, language, rootNode, source, policy) {
  const sites = []
  function visit(node) {
    const kind = eventKindForNodeType(node.type)
    if (kind === 'call' || kind === 'construct') {
      const subjectNode = eventSubjectNode(node, kind)
      const bytes = nodeBytes(source, node)
      sites.push({
        path: relative,
        language,
        syntaxKind: node.type,
        ...nodeSpan(node),
        sourceSha256: sha256(bytes),
        roles: [kind],
        spelling: subjectNode ? nodeText(source, subjectNode) : null,
        literalSpecifier: null,
        specifierState: 'not-applicable',
        parserAdapter: 'tree-sitter-policy-v1',
        parserPolicy: {
          grammarSha256: policy.grammar.sha256,
          definitionQuerySha256: policy.query.sha256,
        },
        authority: 'hash-pinned-tree-sitter-whole-file-node-type-observation',
      })
    }
    for (const child of node.namedChildren) visit(child)
  }
  visit(rootNode)
  return sites.sort((left, right) => left.start.line - right.start.line
    || left.start.column - right.start.column
    || left.end.line - right.end.line
    || left.end.column - right.end.column
    || left.roles.join(',').localeCompare(right.roles.join(',')))
}

function symbolFromMatch(relative, language, source, match, policy, definitionKeys) {
  const primary = match.captures.find(capture => capture.name.startsWith('definition.'))
  if (!primary) return null
  const nameCapture = match.captures.find(capture => capture.name === 'name' || capture.name.startsWith('name.'))
  const nameNode = nameCapture?.node || primary.node
  const name = String(nameNode.text || '').trim()
  if (!name) return null
  const node = primary.node
  const body = nodeBytes(source, node)
  const kind = primary.name.slice('definition.'.length)
  const start = { line: node.startPosition.row + 1, column: node.startPosition.column + 1 }
  const end = { line: node.endPosition.row + 1, column: node.endPosition.column + 1 }
  const bodySha256 = sha256(body)
  return {
    id: `symbol:${sha256(`${relative}\0${name}\0${start.line}\0${start.column}\0${bodySha256}`)}`,
    path: relative,
    name,
    qualifiedName: `${relative}#${name}@${start.line}:${start.column}`,
    language,
    kind,
    start,
    end,
    signature: body.toString('utf8').split(/[\n{]/, 1)[0].trim().slice(0, 1_000),
    bodySha256,
    exported: null,
    purpose: {
      status: 'source-addressed-unavailable',
      summary: 'The exact source bytes for this declaration do not contain a docstring, comment, or other source-authored purpose statement. The atlas refuses to guess intent from the identifier name. This purpose is explicitly unavailable until a human or reviewed decision assigns one; it is not unknown, inferred, or unclassified.',
      provenance: 'no-source-authored-purpose',
      authority: 'explicit-unavailable-not-inferred',
    },
    declaration: {
      callable: ['function', 'method', 'constructor', 'macro', 'predicate'].includes(kind),
      syntaxKind: node.type,
    },
    derivation: {
      adapter: 'tree-sitter-policy-v1',
      confidence: 'exact-syntax',
      semanticCeiling: policy.semanticCeiling,
      grammarSha256: policy.grammar.sha256,
      querySha256: policy.query.sha256,
    },
    operationalBehavior: operationalBehavior(relative, node, source, definitionKeys),
  }
}

async function main() {
  const input = readInput()
  await Parser.init()
  const byPath = {}
  const filesByLanguage = new Map()
  for (const file of input.files || []) {
    if (!filesByLanguage.has(file.language)) filesByLanguage.set(file.language, [])
    filesByLanguage.get(file.language).push(file)
  }
  for (const policy of input.languages || []) {
    const files = filesByLanguage.get(policy.language) || []
    if (files.length === 0) continue
    let language
    let query
    let sourceSiteQuery
    try {
      language = await Language.load(policy.grammar.absolute)
      query = new Query(language, readFileSync(policy.query.absolute, 'utf8'))
      sourceSiteQuery = policy.sourceSiteQuery
        ? new Query(language, readFileSync(policy.sourceSiteQuery.absolute, 'utf8'))
        : null
    } catch (error) {
      for (const file of files) {
        byPath[file.path] = {
          symbols: [],
          sourceSites: [],
          sourceSiteCoverage: { callSites: 'parser-error', dependencySites: 'parser-error', authority: 'none' },
          diagnostics: [{ code: 'TREE_SITTER_POLICY_LOAD_ERROR', message: String(error?.message || error).slice(0, 4_000) }],
          parserState: 'error',
        }
      }
      continue
    }
    for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
      const parser = new Parser()
      try {
        parser.setLanguage(language)
        const sourceBytes = readFileSync(file.absolute)
        const source = sourceBytes.toString('utf8')
        const tree = parser.parse(source)
        const dedupe = new Map()
        const matches = query.matches(tree.rootNode)
        const definitionKeys = new Set(matches.map(match => {
          const primary = match.captures.find(capture => capture.name.startsWith('definition.'))
          return primary ? nodeKey(primary.node) : null
        }).filter(Boolean))
        for (const match of matches) {
          const symbol = symbolFromMatch(file.path, file.language, source, match, policy, definitionKeys)
          if (symbol) dedupe.set(symbol.id, symbol)
        }
        const diagnostics = tree.rootNode.hasError
          ? [{ code: 'TREE_SITTER_PARSE_ERROR', message: 'syntax tree contains an ERROR or missing node' }]
          : []
        byPath[file.path] = {
          symbols: [...dedupe.values()].sort((a, b) => a.start.line - b.start.line || a.start.column - b.start.column || a.name.localeCompare(b.name)),
          sourceSites: mergeSourceSites(
            wholeFileSourceSites(file.path, file.language, tree.rootNode, source, policy),
            queriedSourceSites(file.path, file.language, tree.rootNode, source, policy, sourceSiteQuery),
          ),
          sourceSiteCoverage: {
            callSites: sourceSiteQuery ? 'hash-pinned-relationship-query-v1' : 'hash-pinned-grammar-node-type-set-v1',
            dependencySites: sourceSiteQuery ? 'hash-pinned-relationship-query-v1' : 'not-observed-no-hash-pinned-relationship-query',
            authority: sourceSiteQuery
              ? 'hash-pinned-tree-sitter-source-site-query'
              : 'hash-pinned-tree-sitter-whole-file-node-type-observation',
          },
          diagnostics,
          parserState: diagnostics.length ? 'parsed-with-diagnostics' : 'parsed',
        }
        tree.delete()
      } catch (error) {
        byPath[file.path] = {
          symbols: [],
          sourceSites: [],
          sourceSiteCoverage: { callSites: 'parser-error', dependencySites: 'parser-error', authority: 'none' },
          diagnostics: [{ code: 'TREE_SITTER_PARSE_ERROR', message: String(error?.message || error).slice(0, 4_000) }],
          parserState: 'error',
        }
      } finally {
        parser.delete()
      }
    }
    query.delete()
    sourceSiteQuery?.delete()
    language.delete?.()
  }
  process.stdout.write(JSON.stringify({ schemaVersion: 'arc-atlas-tree-sitter-observation-v1', byPath }))
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exit(1)
})
