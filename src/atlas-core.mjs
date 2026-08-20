import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'
import { compileRepositoryScope } from './repository-scope.mjs'
import { applyComponentOrganReviews, compileComponentOrganReviewBasisV1 } from './component-organ-review.mjs'
import { compileVisibleTranscript } from './transcript-corpus.mjs'
import { compileUiProjection } from './ui-projection.mjs'
import { compileGovernanceCorpus } from './governance-corpus.mjs'
import { compileTreeSitterPolicyBatch } from './tree-sitter-policy-adapter.mjs'
import { applyRelationshipBindingObservations, compileExactReferenceSites, compileExactRelationshipCorpus } from './exact-relationship-corpus.mjs'
import { compileTypescriptBindingObservationsIsolated } from './typescript-binding-adapter.mjs'
import { compilePythonBindingObservations } from './python-binding-adapter.mjs'
import { compileTreeSitterBindingObservations } from './tree-sitter-binding-adapter.mjs'
import { compileTypescriptDeclarationFallbackObservations } from './typescript-binding-declaration-fallback.mjs'
import { readJsonArtifact, writeJsonArtifact } from './artifact-codec.mjs'
import { createNavigationIndexBuilder } from './navigation-index.mjs'
import {
  captureAtlasBuildBasisV2,
  compileAtlasBuildProfileV2,
  finalizeAtlasBuildBasisV2,
  observeAtlasSnapshotFreshnessV1,
  verifyAtlasBuildBasisCurrentV2,
} from './build-input-authority.mjs'

export const ATLAS_SCHEMA_VERSION = 'arc-repository-atlas-v3'
export const ATLAS_AUTHORITY = 'read-only-derived-projection'

const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const PYTHON_EXTENSIONS = new Set(['.py', '.pyi'])
const CODE_LANGUAGES = new Set(['JavaScript', 'TypeScript', 'Python', 'Rust', 'Bash', 'Go', 'Java', 'Ruby', 'Elixir', 'C#', 'Scala', 'Lua', 'C', 'C++', 'PHP', 'CodeQL'])
const EXACT_PARSER_ADAPTERS = new Set(['typescript-ast', 'python-ast', 'tree-sitter-policy-v1'])

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

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function runGit(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding,
    maxBuffer: 256 * 1024 * 1024,
  })
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '')
}

function relativeIfInside(root, candidate) {
  const relative = path.relative(root, candidate)
  if (!relative || relative === '.') return ''
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return normalizeRelative(relative)
}

function visiblePaths(repoRoot, outputRoot) {
  const raw = runGit(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], 'buffer')
  const excludedOutput = relativeIfInside(repoRoot, outputRoot)
  return raw.toString('utf8').split('\0').filter(Boolean).map(normalizeRelative)
    .filter(relative => !excludedOutput || (relative !== excludedOutput && !relative.startsWith(`${excludedOutput}/`)))
    .sort((a, b) => a.localeCompare(b))
}

function languageFor(relative, bytes = null) {
  const extension = path.extname(relative).toLowerCase()
  if (JAVASCRIPT_EXTENSIONS.has(extension)) return extension.includes('ts') ? 'TypeScript' : 'JavaScript'
  if (PYTHON_EXTENSIONS.has(extension)) return 'Python'
  if (extension === '.rs') return 'Rust'
  if (extension === '.sh' || extension === '.bash') return 'Bash'
  if (extension === '.go') return 'Go'
  if (extension === '.java') return 'Java'
  if (extension === '.rb') return 'Ruby'
  if (extension === '.ex' || extension === '.exs') return 'Elixir'
  if (extension === '.cs') return 'C#'
  if (extension === '.scala') return 'Scala'
  if (extension === '.lua') return 'Lua'
  if (extension === '.c' || extension === '.h') return 'C'
  if (['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'].includes(extension)) return 'C++'
  if (extension === '.php') return 'PHP'
  if (extension === '.ql' || extension === '.qll') return 'CodeQL'
  if (extension === '.md' || extension === '.mdx') return 'Markdown'
  if (extension === '.json' || extension === '.jsonl') return 'JSON'
  if (extension === '.yaml' || extension === '.yml') return 'YAML'
  if (extension === '.toml') return 'TOML'
  if (extension === '.txt') return 'Plain text'
  if (extension === '.scm') return 'Tree-sitter query'
  if (extension === '.patch' || extension === '.diff') return 'Patch or diff'
  if (extension === '.bundle') return 'Git bundle'
  if (extension === '.conf') return 'Configuration'
  if (extension === '.png') return 'PNG image'
  if (extension === '.lock') return 'Lockfile'
  if (extension === '.html') return 'HTML'
  if (extension === '.service') return 'systemd unit'
  if (extension === '.desktop') return 'Desktop entry'
  if (extension === '.pdf') return 'PDF'
  if (extension === '.in') return 'Template input'
  if (extension === '.jsonc') return 'JSON with comments'
  if (extension === '.done') return 'Completion marker'
  if (extension === '.proptest-regressions') return 'Rust proptest regression ledger'
  const basename = path.basename(relative)
  if (basename === 'Makefile') return 'Makefile'
  if (basename === '.gitignore' || basename === '.cbmignore') return 'Ignore rules'
  if (!extension && bytes) {
    const firstLine = bytes.toString('utf8', 0, Math.min(bytes.length, 512)).split('\n', 1)[0]
    if (/^#!.*\b(?:node|deno|bun)\b/.test(firstLine)) return 'JavaScript'
    if (/^#!.*\bpython(?:[0-9.]*)?\b/.test(firstLine)) return 'Python'
    if (/^#!.*\b(?:bash|sh|zsh|dash)\b/.test(firstLine)) return 'Bash'
    return bytes.includes(0) ? 'Extensionless binary' : 'Extensionless text'
  }
  return extension ? `Other source or data (${extension})` : 'Extensionless entry'
}

function symbolPurpose(_name, docstring = '') {
  const normalizedDoc = docstring.trim().replace(/\s+/g, ' ')
  if (normalizedDoc) {
    return {
      status: 'source-authored',
      summary: normalizedDoc,
      provenance: 'source-docstring',
      authority: 'source-bytes',
    }
  }
  return {
    status: 'source-addressed-unavailable',
    summary: 'The exact source bytes for this declaration do not contain a docstring, comment, or other source-authored purpose statement. The atlas refuses to guess intent from the identifier name. This purpose is explicitly unavailable until a human or reviewed decision assigns one; it is not unknown, inferred, or unclassified.',
    provenance: 'no-source-authored-purpose',
    authority: 'explicit-unavailable-not-inferred',
  }
}

function exactStructuralExplanation(symbol) {
  const exactParserEntity = EXACT_PARSER_ADAPTERS.has(symbol.derivation?.adapter)
  const callable = symbol.declaration?.callable === true
  const unit = callable ? `executable ${symbol.kind}` : `${symbol.kind} declaration`
  const visibility = symbol.exported === true
    ? 'exported'
    : symbol.exported === false
      ? 'not parser-marked as exported'
      : 'export status unavailable from this parser'
  const signature = symbol.signature?.trim() || 'no compact signature was emitted by the parser'
  return {
    schemaVersion: 'arc-atlas-structural-explanation-v1',
    status: exactParserEntity ? 'exact-parser-derived' : 'advisory-source-span-observation',
    summary: `This source span declares an ${unit} named ${symbol.name} in ${symbol.path}; it is ${visibility}. The parser-recorded declaration is: ${signature}. This describes syntax, not author intent.`,
    sourceSpan: {
      path: symbol.path,
      start: symbol.start,
      end: symbol.end,
      bodySha256: symbol.bodySha256,
    },
    facts: {
      language: symbol.language,
      kind: symbol.kind,
      callable,
      exported: symbol.exported,
      signature,
      parserAdapter: symbol.derivation?.adapter || null,
      parserConfidence: symbol.derivation?.confidence || null,
    },
    authority: exactParserEntity
      ? 'exact-syntax-derived-projection-not-semantic-intent'
      : 'advisory-observation-not-exact-parser-entity',
  }
}

function unavailableOperationalBehavior(symbol) {
  return {
    schemaVersion: 'arc-atlas-operational-syntax-v1',
    status: 'unavailable-advisory-node-not-exact-parser-entity',
    sourceSpan: {
      path: symbol.path,
      start: symbol.start,
      end: symbol.end,
      bodySha256: symbol.bodySha256,
    },
    declaredInputs: [],
    eventCounts: emptyOperationEventCounts(),
    events: [],
    syntaxNodeCounts: {},
    plainLanguage: 'This node came from an advisory graph rather than an exact native parser entity, so the atlas refuses to invent operational behavior for it.',
    resolutionCeiling: 'advisory-node-requires-exact-parser-reconciliation',
    authority: 'none',
  }
}

const OPERATION_EVENT_KINDS = ['call', 'construct', 'branch', 'loop', 'return', 'throw', 'await', 'yield', 'mutation', 'guard']

function emptyOperationEventCounts() {
  return Object.fromEntries(OPERATION_EVENT_KINDS.map(kind => [kind, 0]))
}

function plainCount(value) {
  if (value === 0) return 'no'
  if (value === 1) return 'one'
  return String(value)
}

function operationalPlainLanguage({ declaredInputs, eventCounts }) {
  return `The parser observed ${plainCount(declaredInputs.length)} declared input${declaredInputs.length === 1 ? '' : 's'}, ${plainCount(eventCounts.call + eventCounts.construct)} call or construction site${eventCounts.call + eventCounts.construct === 1 ? '' : 's'}, ${plainCount(eventCounts.branch)} branch${eventCounts.branch === 1 ? '' : 'es'}, ${plainCount(eventCounts.loop)} loop${eventCounts.loop === 1 ? '' : 's'}, ${plainCount(eventCounts.return)} return${eventCounts.return === 1 ? '' : 's'}, ${plainCount(eventCounts.throw)} thrown exception${eventCounts.throw === 1 ? '' : 's'}, and ${plainCount(eventCounts.mutation)} mutation site${eventCounts.mutation === 1 ? '' : 's'} inside this exact declaration. These are source-syntax facts, not a claim about author intent or runtime effects.`
}

function jsSourceSpan(sourceFile, node) {
  return {
    start: lineAndColumn(sourceFile, node.getStart(sourceFile)),
    end: lineAndColumn(sourceFile, node.getEnd()),
  }
}

function jsOperationalEvent(node, sourceFile) {
  let kind = null
  let subject = null
  if (ts.isCallExpression(node)) {
    kind = 'call'
    subject = node.expression.getText(sourceFile)
  } else if (ts.isNewExpression(node)) {
    kind = 'construct'
    subject = node.expression.getText(sourceFile)
  } else if (ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isSwitchStatement(node)) {
    kind = 'branch'
  } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
    kind = 'loop'
  } else if (ts.isReturnStatement(node)) {
    kind = 'return'
  } else if (ts.isThrowStatement(node)) {
    kind = 'throw'
  } else if (ts.isAwaitExpression(node)) {
    kind = 'await'
  } else if (ts.isYieldExpression(node)) {
    kind = 'yield'
  } else if (ts.isTryStatement(node) || ts.isCatchClause(node)) {
    kind = 'guard'
  } else if (ts.isBinaryExpression(node)
    && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
    kind = 'mutation'
    subject = node.left.getText(sourceFile)
  } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
    && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
    kind = 'mutation'
    subject = node.operand.getText(sourceFile)
  } else if (ts.isDeleteExpression(node)) {
    kind = 'mutation'
    subject = node.expression.getText(sourceFile)
  }
  if (!kind) return null
  const text = node.getText(sourceFile)
  return {
    kind,
    subject,
    syntaxKind: ts.SyntaxKind[node.kind],
    ...jsSourceSpan(sourceFile, node),
    sourceSha256: sha256(text),
  }
}

function jsOperationalBehavior(node, sourceFile, bodySha256) {
  const declaredInputs = (node.parameters || []).map(parameter => {
    const text = parameter.getText(sourceFile)
    return {
      text,
      name: parameter.name.getText(sourceFile),
      syntaxKind: ts.SyntaxKind[parameter.kind],
      ...jsSourceSpan(sourceFile, parameter),
      sourceSha256: sha256(text),
    }
  })
  const events = []
  const syntaxNodeCounts = new Map()
  function visit(current) {
    if (current !== node && isJsDeclarationNode(current)) return
    const syntaxKind = ts.SyntaxKind[current.kind]
    syntaxNodeCounts.set(syntaxKind, (syntaxNodeCounts.get(syntaxKind) || 0) + 1)
    const event = jsOperationalEvent(current, sourceFile)
    if (event) events.push(event)
    ts.forEachChild(current, visit)
  }
  visit(node)
  const eventCounts = emptyOperationEventCounts()
  for (const event of events) eventCounts[event.kind] += 1
  return {
    schemaVersion: 'arc-atlas-operational-syntax-v1',
    status: 'exact-parser-derived',
    sourceSpan: {
      path: sourceFile.fileName,
      ...jsSourceSpan(sourceFile, node),
      bodySha256,
    },
    declaredInputs,
    eventCounts,
    events,
    syntaxNodeCounts: Object.fromEntries([...syntaxNodeCounts].sort(([left], [right]) => left.localeCompare(right))),
    plainLanguage: operationalPlainLanguage({ declaredInputs, eventCounts }),
    resolutionCeiling: 'syntax-only-no-binding-runtime-effect-or-author-intent',
    authority: 'exact-syntax-only-not-runtime-effect-or-author-intent',
  }
}

function jsLiteralSpecifier(node) {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
}

function jsWholeFileSourceSites(sourceFile) {
  const sites = []
  const push = (node, roles, { spelling = null, literalSpecifier = null } = {}) => {
    const text = node.getText(sourceFile)
    sites.push({
      path: sourceFile.fileName,
      language: path.extname(sourceFile.fileName).toLowerCase().includes('ts') ? 'TypeScript' : 'JavaScript',
      syntaxKind: ts.SyntaxKind[node.kind],
      ...jsSourceSpan(sourceFile, node),
      sourceSha256: sha256(text),
      roles: [...new Set(roles)].sort(),
      spelling,
      literalSpecifier,
      specifierState: roles.some(role => ['static-import', 're-export-from', 'dynamic-import', 'require', 'require-resolve'].includes(role))
        ? literalSpecifier == null ? 'nonliteral' : 'literal'
        : 'not-applicable',
      parserAdapter: 'typescript-ast',
      authority: 'exact-whole-file-typescript-ast-syntax',
    })
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      push(node, ['static-import'], { spelling: node.moduleSpecifier.getText(sourceFile), literalSpecifier: jsLiteralSpecifier(node.moduleSpecifier) })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      push(node, ['re-export-from'], { spelling: node.moduleSpecifier.getText(sourceFile), literalSpecifier: jsLiteralSpecifier(node.moduleSpecifier) })
    } else if (ts.isCallExpression(node)) {
      const roles = ['call']
      let literalSpecifier = null
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        roles.push('dynamic-import')
        literalSpecifier = jsLiteralSpecifier(node.arguments[0])
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        roles.push('require')
        literalSpecifier = jsLiteralSpecifier(node.arguments[0])
      } else if (ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'require'
        && node.expression.name.text === 'resolve') {
        roles.push('require-resolve')
        literalSpecifier = jsLiteralSpecifier(node.arguments[0])
      }
      push(node, roles, { spelling: node.expression.getText(sourceFile), literalSpecifier })
    } else if (ts.isNewExpression(node)) {
      push(node, ['construct'], { spelling: node.expression.getText(sourceFile) })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return sites.sort((left, right) => left.start.line - right.start.line
    || left.start.column - right.start.column
    || left.end.line - right.end.line
    || left.end.column - right.end.column
    || left.roles.join(',').localeCompare(right.roles.join(',')))
}

function lineAndColumn(sourceFile, position) {
  const point = sourceFile.getLineAndCharacterOfPosition(position)
  return { line: point.line + 1, column: point.character + 1 }
}

function jsSymbolName(node) {
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  if (node.name && ts.isStringLiteralLike(node.name)) return node.name.text
  if (node.name && (ts.isNumericLiteral(node.name) || ts.isPrivateIdentifier(node.name))) return node.name.getText()
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
    return node.parent.name.getText()
  }
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isPropertyAssignment(node.parent)) {
    return node.parent.name.getText().replace(/^['"]|['"]$/g, '')
  }
  return `<anonymous@${node.pos}>`
}

function jsSymbolKind(node) {
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return 'method'
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  if (ts.isArrowFunction(node)) return 'arrow-function'
  if (ts.isFunctionExpression(node)) return 'function-expression'
  if (ts.isFunctionDeclaration(node)) return 'function'
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return 'class'
  if (ts.isInterfaceDeclaration(node)) return 'interface'
  if (ts.isTypeAliasDeclaration(node)) return 'type-alias'
  if (ts.isEnumDeclaration(node)) return 'enum'
  if (ts.isEnumMember(node)) return 'enum-member'
  if (ts.isModuleDeclaration(node)) return 'namespace'
  if (ts.isVariableDeclaration(node)) return 'variable'
  if (ts.isPropertyDeclaration(node)) return 'property'
  if (ts.isPropertySignature(node)) return 'property-signature'
  if (ts.isMethodSignature(node)) return 'method-signature'
  if (ts.isParameter(node)) return 'parameter-property'
  return null
}

function isJsDeclarationNode(node) {
  if (ts.isVariableDeclaration(node) && node.initializer
    && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return false
  if (ts.isParameter(node)) {
    return ts.isConstructorDeclaration(node.parent)
      && Boolean(node.modifiers?.some(modifier => [
        ts.SyntaxKind.PublicKeyword,
        ts.SyntaxKind.PrivateKeyword,
        ts.SyntaxKind.ProtectedKeyword,
        ts.SyntaxKind.ReadonlyKeyword,
      ].includes(modifier.kind)))
  }
  return jsSymbolKind(node) !== null
}

function jsNodeExported(node) {
  let candidate = node
  while (candidate && !ts.isSourceFile(candidate)) {
    if (candidate.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return true
    if (ts.isVariableStatement(candidate) || ts.isClassDeclaration(candidate)
      || ts.isInterfaceDeclaration(candidate) || ts.isTypeAliasDeclaration(candidate)
      || ts.isEnumDeclaration(candidate) || ts.isModuleDeclaration(candidate)
      || ts.isFunctionDeclaration(candidate)) break
    candidate = candidate.parent
  }
  return false
}

function jsDocstring(node) {
  const docs = node.jsDoc || []
  return docs.map(doc => typeof doc.comment === 'string' ? doc.comment : '').filter(Boolean).join('\n')
}

function parseJavaScript(relative, bytes, language) {
  const sourceText = bytes.toString('utf8')
  const extension = path.extname(relative).toLowerCase()
  const scriptKind = extension === '.tsx' ? ts.ScriptKind.TSX
    : extension === '.ts' || extension === '.mts' || extension === '.cts' ? ts.ScriptKind.TS
      : extension === '.jsx' ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS
  const sourceFile = ts.createSourceFile(relative, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  const symbols = []
  function visit(node) {
    if (isJsDeclarationNode(node)) {
      const name = jsSymbolName(node)
      const start = lineAndColumn(sourceFile, node.getStart(sourceFile))
      const end = lineAndColumn(sourceFile, node.getEnd())
      const text = sourceText.slice(node.getStart(sourceFile), node.getEnd())
      const bodySha256 = sha256(text)
      const exported = jsNodeExported(node)
      const kind = jsSymbolKind(node)
      symbols.push({
        id: `symbol:${sha256(`${relative}\0${name}\0${start.line}\0${start.column}\0${sha256(text)}`)}`,
        path: relative,
        name,
        qualifiedName: `${relative}#${name}@${start.line}:${start.column}`,
        language,
        kind,
        start,
        end,
        signature: node.getText(sourceFile).split(/[\n{]/, 1)[0].trim(),
        bodySha256,
        exported,
        purpose: symbolPurpose(name, jsDocstring(node)),
        declaration: {
          callable: ['function', 'method', 'constructor', 'arrow-function', 'function-expression', 'method-signature'].includes(kind),
          syntaxKind: ts.SyntaxKind[node.kind],
        },
        derivation: { adapter: 'typescript-ast', confidence: 'exact-syntax' },
        operationalBehavior: jsOperationalBehavior(node, sourceFile, bodySha256),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  const diagnostics = sourceFile.parseDiagnostics.map(diagnostic => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }))
  return {
    symbols,
    diagnostics,
    sourceSites: jsWholeFileSourceSites(sourceFile),
    sourceSiteCoverage: {
      callSites: 'full-language-ast-v1',
      dependencySites: 'full-language-ast-v1',
      authority: 'exact-whole-file-typescript-ast-syntax',
    },
  }
}

const PYTHON_AST_PROGRAM = String.raw`
import ast, hashlib, json, pathlib, sys
p = pathlib.Path(sys.argv[1])
source = p.read_text(encoding='utf-8')
tree = ast.parse(source, filename=str(p), type_comments=True)
rows = []
parents = []
class Visitor(ast.NodeVisitor):
    def visit_ClassDef(self, node):
        segment = ast.get_source_segment(source, node) or ''
        qualified = '.'.join(parents + [node.name]) if parents else node.name
        rows.append({
            'name': node.name,
            'qualifiedLocalName': qualified,
            'kind': 'class',
            'start': {'line': node.lineno, 'column': node.col_offset + 1},
            'end': {'line': getattr(node, 'end_lineno', node.lineno), 'column': getattr(node, 'end_col_offset', node.col_offset) + 1},
            'signature': source.splitlines()[node.lineno - 1].strip(),
            'bodySha256': hashlib.sha256(segment.encode()).hexdigest(),
            'docstring': ast.get_docstring(node, clean=True) or '',
        })
        parents.append(node.name)
        self.generic_visit(node)
        parents.pop()
    def _function(self, node, async_kind=False):
        segment = ast.get_source_segment(source, node) or ''
        kind = 'method' if parents else ('async-function' if async_kind else 'function')
        name = node.name
        qualified = '.'.join(parents + [name]) if parents else name
        doc = ast.get_docstring(node, clean=True) or ''
        rows.append({
            'name': name,
            'qualifiedLocalName': qualified,
            'kind': kind,
            'start': {'line': node.lineno, 'column': node.col_offset + 1},
            'end': {'line': getattr(node, 'end_lineno', node.lineno), 'column': getattr(node, 'end_col_offset', node.col_offset) + 1},
            'signature': source.splitlines()[node.lineno - 1].strip(),
            'bodySha256': hashlib.sha256(segment.encode()).hexdigest(),
            'docstring': doc,
        })
        parents.append(name)
        self.generic_visit(node)
        parents.pop()
    def visit_FunctionDef(self, node): self._function(node, False)
    def visit_AsyncFunctionDef(self, node): self._function(node, True)
Visitor().visit(tree)
print(json.dumps(rows, separators=(',', ':')))
`

function parsePython(relative, absolute) {
  const observed = JSON.parse(execFileSync('python3', [path.join(import.meta.dirname, 'python-syntax-worker.py'), absolute, relative], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }))
  if (observed?.schemaVersion !== 'arc-atlas-python-syntax-observation-v2'
    || !Array.isArray(observed.declarations) || !Array.isArray(observed.sourceSites)) {
    throw new Error('python syntax worker returned an unsupported observation schema')
  }
  return {
    symbols: observed.declarations.map(row => ({
      id: `symbol:${sha256(`${relative}\0${row.qualifiedLocalName}\0${row.start.line}\0${row.start.column}\0${row.bodySha256}`)}`,
      path: relative,
      name: row.name,
      qualifiedName: `${relative}#${row.qualifiedLocalName}@${row.start.line}:${row.start.column}`,
      language: 'Python',
      kind: row.kind,
      start: row.start,
      end: row.end,
      signature: row.signature,
      bodySha256: row.bodySha256,
      exported: null,
      purpose: symbolPurpose(row.name, row.docstring),
      declaration: {
        callable: ['function', 'method', 'async-function', 'async-method', 'lambda'].includes(row.kind),
        syntaxKind: row.kind === 'class' ? 'ClassDef' : row.kind === 'async-function' ? 'AsyncFunctionDef' : 'FunctionDef',
      },
      derivation: { adapter: 'python-ast', confidence: 'exact-syntax' },
      operationalBehavior: row.operationalBehavior,
    })),
    diagnostics: [],
    sourceSites: observed.sourceSites,
    sourceSiteCoverage: observed.sourceSiteCoverage,
  }
}

function inspectFile(repoRoot, relative) {
  const absolute = path.join(repoRoot, relative)
  if (!existsSync(absolute)) {
    return {
      file: {
        id: `file:${sha256(`${relative}\0missing`)}`,
        path: relative,
        fileClass: 'missing',
        language: languageFor(relative),
        bytes: 0,
        sha256: null,
        parser: { state: 'missing', adapter: null, diagnostics: [] },
      },
      symbols: [],
      sourceSites: [],
    }
  }
  const stat = lstatSync(absolute)
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(absolute)
    return {
      file: {
        id: `file:${sha256(`${relative}\0symlink\0${target}`)}`,
        path: relative,
        fileClass: 'symlink',
        language: 'Symbolic link',
        bytes: Buffer.byteLength(target),
        sha256: sha256(target),
        symlinkTarget: target,
        parser: { state: 'not-applicable', adapter: null, diagnostics: [] },
      },
      symbols: [],
      sourceSites: [],
    }
  }
  if (!stat.isFile()) {
    return {
      file: {
        id: `file:${sha256(`${relative}\0non-regular`)}`,
        path: relative,
        fileClass: 'non-regular',
        language: 'Directory or special entry',
        bytes: stat.size,
        sha256: sha256(`${relative}\0non-regular`),
        parser: { state: 'not-applicable', adapter: null, diagnostics: [] },
      },
      symbols: [],
      sourceSites: [],
    }
  }
  const bytes = readFileSync(absolute)
  const language = languageFor(relative, bytes)
  const extension = path.extname(relative).toLowerCase()
  let parsed = null
  let adapter = null
  let parserState = null
  try {
    if (JAVASCRIPT_EXTENSIONS.has(extension)) {
      adapter = 'typescript-ast'
      parsed = parseJavaScript(relative, bytes, language)
    } else if (PYTHON_EXTENSIONS.has(extension)) {
      adapter = 'python-ast'
      parsed = parsePython(relative, absolute)
    }
  } catch (error) {
    parserState = 'error'
    parsed = {
      symbols: [],
      diagnostics: [{
        code: error.code || 'PARSER_ERROR',
        message: String(error.stderr || error.message || error).slice(0, 4_000),
      }],
    }
  }
  return {
    file: {
      id: `file:${sha256(`${relative}\0${sha256(bytes)}`)}`,
      path: relative,
      fileClass: 'regular',
      language,
      bytes: bytes.length,
      sha256: sha256(bytes),
      parser: parsed
        ? { state: parserState || (parsed.diagnostics.length ? 'parsed-with-diagnostics' : 'parsed'), adapter, diagnostics: parsed.diagnostics }
        : { state: 'not-applicable', adapter: null, diagnostics: [] },
      sourceSiteCoverage: parsed?.sourceSiteCoverage || {
        callSites: parsed ? 'parser-error' : 'not-applicable',
        dependencySites: parsed ? 'parser-error' : 'not-applicable',
        authority: 'none',
      },
    },
    symbols: parsed?.symbols || [],
    sourceSites: parsed?.sourceSites || [],
  }
}

function parseProperties(value) {
  try { return value ? JSON.parse(value) : {} } catch { return {} }
}

function symbolDedupeKey(pathValue, name, line) {
  return `${pathValue}\0${name}\0${line}`
}

// Synthetic advisory paths (e.g. "<python-builtins>") are a fixed, intentional
// set of non-file-backed nodes. They are not stale observations: they never
// correspond to a repository file, so they must not fail the freshness gate.
function isSyntheticGraphPath(relative) {
  return relative.startsWith('<') && relative.endsWith('>')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function loadCodeGraph({ databasePath, project, repository, fileByPath, symbols }) {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  const projectRow = db.prepare('SELECT * FROM projects WHERE name = ?').get(project)
  if (!projectRow) {
    db.close()
    throw new Error(`code graph project not found: ${project}`)
  }
  const rows = db.prepare(`
    SELECT id, label, name, qualified_name, file_path, start_line, end_line, properties
    FROM nodes
    WHERE project = ? AND label IN ('Function', 'Method')
    ORDER BY id
  `).all(project)
  const existing = new Map(symbols.map(symbol => [symbolDedupeKey(symbol.path, symbol.name, symbol.start.line), symbol.id]))
  const externalToAtlas = new Map()
  let matchedNodes = 0
  let staleNodes = 0
  let deduplicatedNodes = 0
  let importedNodes = 0
  let invalidSymbolNodes = 0
  for (const row of rows) {
    const relative = normalizeRelative(row.file_path || '')
    const file = fileByPath.get(relative)
    if (!file) {
      if (isSyntheticGraphPath(relative)) continue
      staleNodes += 1
      continue
    }
    matchedNodes += 1
    const line = Number(row.start_line) || 1
    const key = symbolDedupeKey(relative, row.name, line)
    const exactId = existing.get(key)
    if (exactId) {
      externalToAtlas.set(row.id, exactId)
      deduplicatedNodes += 1
      continue
    }
    const properties = parseProperties(row.properties)
    const sourceLines = file.fileClass === 'regular'
      ? readFileSync(path.join(repository, relative), 'utf8').split('\n').slice(Math.max(0, line - 1), Math.max(line, Number(row.end_line) || line)).join('\n')
      : ''
    const identifierName = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(row.name)
    const nameAppears = !identifierName || new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(row.name)}([^A-Za-z0-9_$]|$)`).test(sourceLines)
    if (!sourceLines || !nameAppears) {
      invalidSymbolNodes += 1
      continue
    }
    const bodySha256 = sourceLines ? sha256(sourceLines) : null
    const symbolId = `symbol:${sha256(`${relative}\0${row.name}\0${line}\0${bodySha256 || row.qualified_name}`)}`
    const symbol = {
      id: symbolId,
      path: relative,
      name: row.name,
      qualifiedName: row.qualified_name,
      language: file.language,
      kind: row.label === 'Method' ? 'method' : 'function',
      start: { line, column: 1 },
      end: { line: Number(row.end_line) || line, column: 1 },
      signature: properties.signature || '',
      bodySha256,
      exported: Boolean(properties.is_exported),
      purpose: symbolPurpose(row.name, properties.docstring || ''),
      metrics: {
        complexity: properties.complexity ?? null,
        cognitive: properties.cognitive ?? null,
        lines: properties.lines ?? null,
        fanIn: properties.in_degree ?? null,
        fanOut: properties.out_degree ?? null,
      },
      derivation: {
        adapter: 'codebase-memory-graph',
        confidence: 'advisory-structural-observation',
        graphProject: project,
        externalNodeId: row.id,
      },
    }
    symbols.push(symbol)
    existing.set(key, symbolId)
    externalToAtlas.set(row.id, symbolId)
    importedNodes += 1
  }
  const edgeRows = db.prepare(`
    SELECT id, source_id, target_id, type, properties
    FROM edges
    WHERE project = ?
    ORDER BY id
  `).all(project)
  const edges = []
  for (const row of edgeRows) {
    const source = externalToAtlas.get(row.source_id)
    const target = externalToAtlas.get(row.target_id)
    if (!source || !target) continue
    const properties = parseProperties(row.properties)
    edges.push({
      id: `edge:${sha256(`${source}\0${target}\0${row.type}\0${row.id}`)}`,
      source,
      target,
      kind: row.type.toLowerCase().replaceAll('_', '-'),
      observation: {
        adapter: 'codebase-memory-graph',
        graphProject: project,
        externalEdgeId: row.id,
        confidence: properties.confidence ?? null,
        line: properties.line ?? null,
        strategy: properties.strategy ?? null,
      },
    })
  }
  const hasFileHashes = Boolean(db.prepare(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'file_hashes'
  `).get())
  const fileHashRows = hasFileHashes
    ? db.prepare(`
      SELECT rel_path, sha256, size
      FROM file_hashes
      WHERE project = ?
      ORDER BY rel_path
    `).all(project)
    : []
  let hashed = 0
  let matchedCurrent = 0
  let mismatchedCurrent = 0
  let staleRows = 0
  for (const row of fileHashRows) {
    const relative = normalizeRelative(row.rel_path || '')
    const digestValid = /^[a-f0-9]{64}$/.test(row.sha256 || '')
    if (digestValid) hashed += 1
    const file = fileByPath.get(relative)
    if (!file) {
      staleRows += 1
    } else if (digestValid && file.sha256 === row.sha256) {
      matchedCurrent += 1
    } else if (digestValid) {
      mismatchedCurrent += 1
    }
  }
  const rootMatchesRepository = projectRow.root_path
    ? path.resolve(projectRow.root_path) === path.resolve(repository)
    : false
  db.close()
  return {
    edges,
    source: {
      state: 'observed',
      databasePath: path.resolve(databasePath),
      project,
      indexedAt: projectRow.indexed_at || null,
      rootPath: projectRow.root_path || null,
      rootMatchesRepository,
      candidateNodes: rows.length,
      matchedNodes,
      staleNodes,
      deduplicatedNodes,
      importedNodes,
      importedEdges: edges.length,
      invalidSymbolNodes,
      fileHashes: {
        total: fileHashRows.length,
        hashed,
        matchedCurrent,
        mismatchedCurrent,
        staleRows,
      },
      authority: 'advisory-not-freshness-authority',
    },
  }
}

function globExpression(pattern) {
  let expression = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*' && pattern[index + 1] === '*') {
      expression += '.*'
      index += 1
    } else if (character === '*') {
      expression += '[^/]*'
    } else if (character === '?') {
      expression += '[^/]'
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`${expression}$`)
}

function matchesOrgan(relative, organ) {
  const include = organ.match?.include || []
  const exclude = organ.match?.exclude || []
  return include.some(pattern => globExpression(pattern).test(relative))
    && !exclude.some(pattern => globExpression(pattern).test(relative))
}

function compileOntology({ ontologyPath, repository, files, repositoryHead, componentReviewPaths = [] }) {
  if (!ontologyPath) {
    return {
      projection: null,
      components: [],
      source: { state: 'not-requested', authority: 'none' },
      unclassifiedFiles: files.length,
    }
  }
  const sourceBytes = readFileSync(ontologyPath)
  const source = JSON.parse(sourceBytes.toString('utf8'))
  if (source.schemaVersion !== 'arc-atlas-ontology-source-v1') {
    throw new Error('ontology must use schemaVersion arc-atlas-ontology-source-v1')
  }
  if (!Array.isArray(source.organs) || !Array.isArray(source.pitfalls) || !Array.isArray(source.journeys)) {
    throw new Error('ontology must contain organs, pitfalls, and journeys arrays')
  }
  const organIds = new Set()
  for (const organ of source.organs) {
    if (!organ.id || organIds.has(organ.id)) throw new Error(`ontology organ id is missing or duplicated: ${organ.id}`)
    organIds.add(organ.id)
  }
  const fileByPath = new Map(files.map(file => [file.path, file]))
  const sourceReferences = [
    ...source.organs.flatMap(organ => organ.sourceRefs || []),
    ...source.pitfalls.flatMap(pitfall => pitfall.sourceRefs || []),
    ...source.journeys.flatMap(journey => journey.sourceRefs || []),
    ...(source.constitutionalKernels || []).flatMap(kernel => kernel.sourceRefs || []),
    ...(source.graphFacets || []).flatMap(facet => facet.sourceRefs || []),
    ...(source.membranes || []).flatMap(membrane => membrane.sourceRefs || []),
    ...(source.lenses || []).flatMap(lens => lens.sourceRefs || []),
  ]
  let resolvedReferences = 0
  for (const reference of sourceReferences) {
    const file = fileByPath.get(normalizeRelative(reference.path || ''))
    if (!file || file.fileClass !== 'regular') {
      throw new Error(`ontology source reference is not a current regular file: ${reference.path}`)
    }
    const line = Number(reference.line)
    const lineCount = readFileSync(path.join(repository, file.path), 'utf8').split('\n').length
    if (!Number.isInteger(line) || line < 1 || line > lineCount) {
      throw new Error(`ontology source reference line is outside the current file: ${reference.path}:${reference.line}`)
    }
    resolvedReferences += 1
  }
  for (const journey of source.journeys) {
    for (const step of journey.steps || []) {
      for (const organId of step.organIds || []) {
        if (!organIds.has(organId)) throw new Error(`journey references unknown organ: ${organId}`)
      }
    }
  }
  let components = files.map(file => {
    const matched = source.organs.filter(organ => matchesOrgan(file.path, organ)).map(organ => organ.id)
    return {
      id: `component:${sha256(`${file.id}\0${matched.join('\0')}`)}`,
      fileId: file.id,
      path: file.path,
      primaryOrganId: matched[0] || null,
      organIds: matched,
      authority: ATLAS_AUTHORITY,
    }
  })
  const unclassifiedFiles = components.filter(component => !component.primaryOrganId).length
  const fallbackOrganIds = new Set(source.organs.filter(organ => {
    const include = organ.match?.include || []
    const exclude = organ.match?.exclude || []
    const structurallyCatchAll = include.some(pattern => ['**', '**/*'].includes(pattern)) && exclude.length === 0
    return organ.fallback === true || structurallyCatchAll
  }).map(organ => organ.id))
  const fallbackReviewBasis = compileComponentOrganReviewBasisV1({
    repositoryHead,
    ontologySha256: sha256(sourceBytes),
    files,
    components,
    organs: source.organs,
    fallbackOrganIds,
  })
  const componentReviews = applyComponentOrganReviews({
    reviewPaths: componentReviewPaths,
    repository,
    repositoryHead,
    files,
    components,
    organs: source.organs,
    fallbackOrganIds,
    fallbackReviewBasis,
  })
  components = componentReviews.components
  const fallbackPrimaryFiles = components.filter(component => fallbackOrganIds.has(component.primaryOrganId)).length
  const semanticDenominatorPresent = sourceReferences.length > 0
    && source.organs.length > 0
    && source.organs.every(organ => (organ.sourceRefs || []).length > 0)
    && source.pitfalls.length > 0
    && source.pitfalls.every(pitfall => (pitfall.sourceRefs || []).length > 0)
    && source.journeys.length > 0
    && source.journeys.every(journey => (journey.sourceRefs || []).length > 0)
  const projection = {
    schemaVersion: 'arc-atlas-ontology-v1',
    authority: ATLAS_AUTHORITY,
    sourceSha256: sha256(sourceBytes),
    title: source.title,
    northStar: source.northStar,
    constitutionalKernels: source.constitutionalKernels || [],
    graphFacets: source.graphFacets || [],
    membranes: source.membranes || [],
    proofLadder: source.proofLadder || [],
    lenses: source.lenses || [],
    organs: source.organs.map(organ => ({
      ...organ,
      fileCount: components.filter(component => component.organIds.includes(organ.id)).length,
    })),
    pitfalls: source.pitfalls,
    journeys: source.journeys,
    sourceReferences: {
      total: sourceReferences.length,
      resolved: resolvedReferences,
    },
    coverage: {
      files: components.length,
      unclassifiedFiles,
      fallbackPrimaryFiles,
      componentReviews: componentReviews.source,
      fallbackReviewBasisSha256: fallbackReviewBasis.sha256,
      semanticDenominatorPresent,
    },
  }
  return {
    projection,
    components,
    source: {
      state: 'observed',
      path: path.resolve(ontologyPath),
      sha256: projection.sourceSha256,
      authority: 'curated-source-addressed-derived-projection',
      componentReviews: componentReviews.source,
    },
    unclassifiedFiles,
    fallbackPrimaryFiles,
    semanticDenominatorPresent,
  }
}

function gitSnapshot(repoRoot, outputRoot) {
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']).trim()
  let branch = null
  try { branch = runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD']).trim() } catch {}
  const excludedOutput = relativeIfInside(repoRoot, outputRoot)
  const statusArgs = ['status', '--porcelain=v1', '--untracked-files=normal']
  if (excludedOutput) {
    statusArgs.push(
      '--',
      '.',
      `:(exclude,top)${excludedOutput}`,
      `:(exclude,top)${excludedOutput}/**`,
    )
  }
  const status = runGit(repoRoot, statusArgs)
  return { head, branch, dirty: Boolean(status.trim()), statusSha256: sha256(status) }
}

function writeJson(absolute, value) {
  mkdirSync(path.dirname(absolute), { recursive: true })
  const bytes = `${JSON.stringify(value, null, 2)}\n`
  writeFileSync(absolute, bytes)
  return { bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) }
}

function writeJsonCompact(absolute, value) {
  mkdirSync(path.dirname(absolute), { recursive: true })
  const bytes = `${JSON.stringify(value)}\n`
  writeFileSync(absolute, bytes)
  return { bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) }
}

function writeBytes(absolute, bytes) {
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, bytes)
  return { bytes: bytes.length, sha256: sha256(bytes) }
}

function traceBuildPhase(phase, details = {}) {
  if (process.env.ARC_ATLAS_TRACE_PHASES !== '1') return
  const memory = process.memoryUsage()
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 'arc-atlas-build-phase-diagnostic-v1',
    authority: 'process-local-diagnostic-not-corpus-truth',
    phase,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    rss: memory.rss,
    ...details,
  })}\n`)
}

const RELATIONSHIP_SEQUENCE_PATHS = {
  relationships: 'relationships',
  referenceSites: 'reference-sites',
  advisoryRelationships: 'advisory-relationships',
  externalEntities: 'external-entities',
  bindingSources: 'binding-sources',
}

function writeRelationshipCorpusArtifacts(output, corpus, { onShard = null } = {}) {
  const shardArtifacts = []
  const sequences = {}
  const targetShardBytes = 2_000_000
  for (const [field, directory] of Object.entries(RELATIONSHIP_SEQUENCE_PATHS)) {
    const values = corpus[field] || []
    const shards = []
    let pending = []
    let estimatedBytes = 3
    const flush = () => {
      if (pending.length === 0) return
      const shardNumber = shards.length
      const artifactPath = `data/relationships/${directory}/${String(shardNumber).padStart(6, '0')}.json`
      const artifact = writeJsonArtifact({ root: output, path: artifactPath, value: pending, contentEncoding: 'br' })
      const descriptor = {
        ...artifact,
        count: pending.length,
        firstId: pending[0]?.id || null,
        lastId: pending.at(-1)?.id || null,
      }
      if (artifact.decodedBytes > 4_500_000) {
        throw new Error(`relationship artifact shard exceeds its decoded byte ceiling: ${artifactPath}`)
      }
      shards.push(descriptor)
      shardArtifacts.push({ path: artifactPath, ...artifact })
      if (onShard) onShard(field, pending, descriptor)
      pending = []
      estimatedBytes = 3
    }
    for (const value of values) {
      const itemBytes = Buffer.byteLength(JSON.stringify(value, null, 2)) + 4
      if (pending.length > 0 && estimatedBytes + itemBytes > targetShardBytes) flush()
      pending.push(value)
      estimatedBytes += itemBytes
    }
    flush()
    sequences[field] = {
      ...corpus.sequenceCommitments[field],
      shards,
    }
  }
  const manifest = {
    schemaVersion: 'arc-atlas-relationship-artifact-manifest-v1',
    authority: corpus.authority,
    physicalEncoding: 'brotli-minified-json-utf8-v1',
    corpus: {
      schemaVersion: corpus.schemaVersion,
      digestSchemaVersion: corpus.digestSchemaVersion,
      corpusSha256: corpus.corpusSha256,
      denominators: corpus.denominators,
      gates: corpus.gates,
    },
    sequences,
  }
  const rootArtifact = writeJson(path.join(output, 'data', 'relationships.json'), manifest)
  return {
    manifest,
    artifacts: [
      { path: 'data/relationships.json', ...rootArtifact },
      ...shardArtifacts,
    ],
  }
}

function canonicalSequenceCommitment(field, values) {
  const digest = createHash('sha256')
  digest.update('arc-atlas-canonical-sequence-sha256-v1\0')
  digest.update(field)
  digest.update('\0')
  for (const value of values) {
    const bytes = Buffer.from(canonicalJson(value))
    const length = Buffer.allocUnsafe(8)
    length.writeBigUInt64BE(BigInt(bytes.length))
    digest.update(length)
    digest.update(bytes)
  }
  return {
    schemaVersion: 'arc-atlas-canonical-sequence-commitment-v1',
    field,
    count: values.length,
    sha256: digest.digest('hex'),
  }
}

function writeSymbolCorpusArtifacts(output, symbols, snapshotSha256) {
  const shardArtifacts = []
  const shards = []
  const locators = new Map()
  const targetShardBytes = 1_500_000
  let pending = []
  let estimatedBytes = 3
  const flush = () => {
    if (pending.length === 0) return
    const artifactPath = `data/symbols/${String(shards.length).padStart(6, '0')}.json`
    const artifact = writeJsonArtifact({ root: output, path: artifactPath, value: pending, contentEncoding: 'br' })
    if (artifact.decodedBytes > 4_500_000) throw new Error(`symbol artifact shard exceeds its decoded byte ceiling: ${artifactPath}`)
    shards.push({
      ...artifact,
      count: pending.length,
      firstId: pending[0]?.id || null,
      lastId: pending.at(-1)?.id || null,
    })
    pending.forEach((symbol, recordIndex) => {
      locators.set(symbol.id, {
        manifestPath: 'data/symbols.json',
        shardPath: artifact.path,
        shardSha256: artifact.sha256,
        shardDecodedSha256: artifact.decodedSha256,
        recordIndex,
      })
    })
    shardArtifacts.push({ path: artifactPath, ...artifact })
    pending = []
    estimatedBytes = 3
  }
  for (const symbol of symbols) {
    const itemBytes = Buffer.byteLength(JSON.stringify(symbol, null, 2)) + 4
    if (pending.length > 0 && estimatedBytes + itemBytes > targetShardBytes) flush()
    pending.push(symbol)
    estimatedBytes += itemBytes
  }
  flush()
  const sequence = canonicalSequenceCommitment('symbols', symbols)
  const manifest = {
    schemaVersion: 'arc-atlas-symbol-artifact-manifest-v1',
    authority: 'exact-parser-and-explicitly-advisory-symbol-projection',
    physicalEncoding: 'brotli-minified-json-utf8-v1',
    snapshotSha256,
    sequence: { ...sequence, shards },
  }
  const rootArtifact = writeJson(path.join(output, 'data', 'symbols.json'), manifest)
  return {
    manifest,
    locators,
    artifacts: [
      { path: 'data/symbols.json', ...rootArtifact },
      ...shardArtifacts,
    ],
  }
}

function forEachSnapshotSymbol(snapshotRoot, visit) {
  const absolute = path.join(snapshotRoot, 'data', 'symbols.json')
  const root = JSON.parse(readFileSync(absolute, 'utf8'))
  if (Array.isArray(root)) {
    for (const symbol of root) visit(symbol)
    return root.length
  }
  if (root?.schemaVersion !== 'arc-atlas-symbol-artifact-manifest-v1') {
    throw new Error('atlas symbol artifact schema is unsupported')
  }
  let observed = 0
  for (const shard of root.sequence.shards) {
    const symbols = readJsonArtifact({ root: snapshotRoot, descriptor: shard })
    if (!Array.isArray(symbols) || symbols.length !== shard.count) {
      throw new Error(`atlas symbol shard denominator mismatch: ${shard.path}`)
    }
    observed += symbols.length
    for (const symbol of symbols) visit(symbol)
  }
  if (observed !== root.sequence.count) throw new Error('atlas symbol artifact denominator mismatch')
  return observed
}

export function buildAtlasSnapshot({ repoRoot, outputRoot, buildInputManifestPath = null, graphDbPath = null, graphProject = null, ontologyPath = null, componentReviewPaths = [], transcriptPath = null, transcriptReviewPath = null, scopePolicyPath = null, documentPolicyPath = null, languageParserPolicyPath = null }) {
  const repository = realpathSync(repoRoot)
  const output = path.resolve(outputRoot)
  const repositoryFromOutput = path.relative(output, repository)
  const outputCanContainRepository = repositoryFromOutput === ''
    || (repositoryFromOutput !== '..'
      && !repositoryFromOutput.startsWith(`..${path.sep}`)
      && !path.isAbsolute(repositoryFromOutput))
  if (outputCanContainRepository) {
    throw new Error('atlas output must be a strict descendant or external directory, never the repository root or its ancestor')
  }
  const git = gitSnapshot(repository, output)
  const builderRoot = path.resolve(import.meta.dirname, '..')
  let buildInputAuthority = null
  let buildBasis = null
  if (buildInputManifestPath) {
    buildInputAuthority = compileAtlasBuildProfileV2({
      profilePath: buildInputManifestPath,
      builderRoot,
      repositoryOverride: repository,
      supplied: {
        graphDbPath,
        graphProject,
        ontologyPath,
        componentReviewPaths,
        transcriptPath,
        transcriptReviewPath,
        scopePolicyPath,
        documentPolicyPath,
        languageParserPolicyPath,
      },
    })
    graphDbPath = graphDbPath ?? buildInputAuthority.resolved.graphDbPath
    graphProject = graphProject ?? buildInputAuthority.resolved.graphProject
    ontologyPath = ontologyPath ?? buildInputAuthority.resolved.ontologyPath
    componentReviewPaths = componentReviewPaths.length
      ? componentReviewPaths
      : buildInputAuthority.resolved.componentReviewPaths
    transcriptPath = transcriptPath ?? buildInputAuthority.resolved.transcriptPath
    transcriptReviewPath = transcriptReviewPath ?? buildInputAuthority.resolved.transcriptReviewPath
    scopePolicyPath = scopePolicyPath ?? buildInputAuthority.resolved.scopePolicyPath
    documentPolicyPath = documentPolicyPath ?? buildInputAuthority.resolved.documentPolicyPath
    languageParserPolicyPath = languageParserPolicyPath ?? buildInputAuthority.resolved.languageParserPolicyPath
    buildBasis = finalizeAtlasBuildBasisV2({
      capture: captureAtlasBuildBasisV2({ authority: buildInputAuthority, outputRoot: output }),
      derived: { componentReviewBasisSha256: null },
    })
  }
  const scope = compileRepositoryScope({ repository, output, policyPath: scopePolicyPath })
  const paths = visiblePaths(repository, output)
  const files = []
  const symbols = []
  const sourceSites = []
  for (const relative of paths) {
    const observed = inspectFile(repository, relative)
    files.push(observed.file)
    symbols.push(...observed.symbols)
    sourceSites.push(...observed.sourceSites)
  }
  traceBuildPhase('native-source-inspection-complete', { files: files.length, symbols: symbols.length })
  const treeSitter = compileTreeSitterPolicyBatch({
    policyPath: languageParserPolicyPath,
    repository,
    files: files
      .filter(file => file.fileClass === 'regular' && file.parser.state === 'not-applicable')
      .map(file => ({ ...file, absolute: path.join(repository, file.path) })),
  })
  const fileByPathBeforeGraph = new Map(files.map(file => [file.path, file]))
  for (const [relative, observed] of Object.entries(treeSitter.byPath)) {
    const file = fileByPathBeforeGraph.get(relative)
    if (!file || file.fileClass !== 'regular' || file.parser.state !== 'not-applicable') {
      throw new Error(`tree-sitter observation does not join one unparsed regular file: ${relative}`)
    }
    file.parser = {
      state: observed.parserState,
      adapter: 'tree-sitter-policy-v1',
      semanticCeiling: 'syntax',
      diagnostics: observed.diagnostics,
    }
    file.sourceSiteCoverage = observed.sourceSiteCoverage || {
      callSites: observed.parserState === 'error' ? 'parser-error' : 'not-observed',
      dependencySites: observed.parserState === 'error' ? 'parser-error' : 'not-observed',
      authority: 'none',
    }
    symbols.push(...observed.symbols)
    sourceSites.push(...(observed.sourceSites || []))
  }
  traceBuildPhase('tree-sitter-inspection-complete', { files: files.length, symbols: symbols.length })
  const fileByPath = new Map(files.map(file => [file.path, file]))
  const graph = graphDbPath
    ? loadCodeGraph({
      databasePath: graphDbPath,
      project: graphProject || path.basename(repository),
      repository,
      fileByPath,
      symbols,
    })
    : { edges: [], source: { state: 'not-requested', authority: 'none' } }
  traceBuildPhase('advisory-graph-load-complete', { advisoryEdges: graph.edges.length, symbols: symbols.length })
  const governance = compileGovernanceCorpus({ repository, files, documentPolicyPath })
  const ontology = compileOntology({ ontologyPath, repository, files, repositoryHead: git.head, componentReviewPaths })
  if (transcriptReviewPath && !transcriptPath) throw new Error('transcript reviews require an exact transcript source')
  const transcript = transcriptPath
    ? compileVisibleTranscript(transcriptPath, transcriptReviewPath, { canonicalIntentIds: governance.intentNodes.map(intent => intent.id) })
    : null
  traceBuildPhase('governance-ontology-transcript-complete', {
    governanceDocuments: governance.documents.length,
    ontologyComponents: ontology.components.length,
    transcriptMessages: transcript?.messages.length || 0,
  })
  for (const symbol of symbols) {
    symbol.structuralExplanation = exactStructuralExplanation(symbol)
    if (!symbol.operationalBehavior) symbol.operationalBehavior = unavailableOperationalBehavior(symbol)
  }
  symbols.sort((a, b) => a.path.localeCompare(b.path) || a.start.line - b.start.line || a.start.column - b.start.column)
  traceBuildPhase('symbol-enrichment-complete', { symbols: symbols.length })
  const referenceSites = compileExactReferenceSites({ files, symbols, sourceSites })
  traceBuildPhase('reference-site-denominator-complete', { referenceSites: referenceSites.length })
  const typescriptBindings = compileTypescriptBindingObservationsIsolated({
    repository,
    files,
    symbols,
    referenceSites,
  })
  traceBuildPhase('typescript-binding-complete', {
    observations: typescriptBindings.observations.length,
    externalEntities: typescriptBindings.externalEntities.length,
  })
  const pythonBindings = compilePythonBindingObservations({
    repository,
    files,
    symbols,
    referenceSites,
  })
  traceBuildPhase('python-binding-complete', {
    observations: pythonBindings.observations.length,
    externalEntities: pythonBindings.externalEntities.length,
  })
  const treeSitterBindings = compileTreeSitterBindingObservations({
    files,
    symbols,
    referenceSites,
  })
  traceBuildPhase('tree-sitter-binding-complete', {
    observations: treeSitterBindings.observations.length,
    externalEntities: treeSitterBindings.externalEntities.length,
  })
  const typescriptDeclarationFallback = compileTypescriptDeclarationFallbackObservations({
    repository,
    files,
    symbols,
    referenceSites,
    primaryBindings: typescriptBindings,
  })
  traceBuildPhase('typescript-declaration-fallback-complete', {
    observations: typescriptDeclarationFallback.observations.length,
    externalEntities: typescriptDeclarationFallback.externalEntities.length,
  })
  const unboundRelationshipCorpus = compileExactRelationshipCorpus({ files, symbols, advisoryEdges: graph.edges, referenceSites })
  traceBuildPhase('unbound-relationship-corpus-complete', { ...unboundRelationshipCorpus.denominators })
  const relationshipCorpus = applyRelationshipBindingObservations(unboundRelationshipCorpus, [typescriptBindings, pythonBindings, treeSitterBindings, typescriptDeclarationFallback])
  traceBuildPhase('bound-relationship-corpus-complete', { ...relationshipCorpus.denominators })
  typescriptBindings.observations.length = 0
  typescriptBindings.externalEntities.length = 0
  pythonBindings.observations.length = 0
  pythonBindings.externalEntities.length = 0
  treeSitterBindings.observations.length = 0
  treeSitterBindings.externalEntities.length = 0
  typescriptDeclarationFallback.observations.length = 0
  typescriptDeclarationFallback.externalEntities.length = 0

  const codeFiles = files.filter(file => CODE_LANGUAGES.has(file.language) && file.fileClass === 'regular')
  const parseEligible = codeFiles.filter(file => file.parser.state !== 'not-applicable')
  const parseUnaccounted = parseEligible.filter(file => !['parsed', 'parsed-with-diagnostics', 'error'].includes(file.parser.state))
  const parserErrors = parseEligible.filter(file => file.parser.state === 'error').length
  const nativeParserMissing = codeFiles.filter(file => file.parser.state === 'not-applicable')
  const nativeParserMissingByLanguage = Object.fromEntries(
    [...new Set(nativeParserMissing.map(file => file.language))]
      .sort()
      .map(language => [language, nativeParserMissing.filter(file => file.language === language).length]),
  )
  const syntaxDiagnostics = parseEligible.reduce((total, file) => total + file.parser.diagnostics.length, 0)
  const snapshotSha256 = sha256(canonicalJson({
    git,
    files: files.map(file => ({ path: file.path, sha256: file.sha256, fileClass: file.fileClass })),
    symbols: symbols.map(symbol => ({ id: symbol.id, bodySha256: symbol.bodySha256 })),
    edges: graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.kind })),
    relationships: relationshipCorpus.corpusSha256,
    ontology: ontology.projection
      ? { sourceSha256: ontology.projection.sourceSha256, components: ontology.components.map(component => ({ id: component.id, primaryOrganId: component.primaryOrganId })) }
      : null,
    transcript: transcript ? { sourceSha256: transcript.source.sha256, transcriptSha256: transcript.transcriptSha256 } : null,
    governance: { governanceSha256: governance.governanceSha256 },
    scope: { scopeSha256: scope.scopeSha256, ignoredPaths: scope.ignored.entries.map(entry => entry.path) },
    buildInputs: { basisSha256: buildBasis?.basisSha256 ?? null },
  }))

  mkdirSync(path.join(output, 'data'), { recursive: true })
  const sourceEntries = []
  const sourceBlobArtifacts = []
  const writtenSourceBlobs = new Set()
  for (const file of files) {
    if (file.fileClass !== 'regular') continue
    const bytes = readFileSync(path.join(repository, file.path))
    if (sha256(bytes) !== file.sha256) throw new Error(`source bytes drifted during atlas build: ${file.path}`)
    const blobPath = `source/blobs/${file.sha256}`
    sourceEntries.push({ fileId: file.id, path: file.path, sha256: file.sha256, bytes: bytes.length, blobPath })
    if (writtenSourceBlobs.has(file.sha256)) continue
    writtenSourceBlobs.add(file.sha256)
    sourceBlobArtifacts.push({ path: blobPath, ...writeBytes(path.join(output, blobPath), bytes) })
  }
  const sourceIndex = {
    schemaVersion: 'arc-atlas-source-cas-v1',
    authority: 'exact-snapshot-source-bytes',
    snapshotSha256,
    denominator: { regularFiles: sourceEntries.length, uniqueBlobs: sourceBlobArtifacts.length },
    entries: sourceEntries,
  }
  const sourceIndexArtifact = writeJson(path.join(output, 'data', 'source-index.json'), sourceIndex)
  const fileArtifact = writeJson(path.join(output, 'data', 'files.json'), files)
  const symbolArtifacts = writeSymbolCorpusArtifacts(output, symbols, snapshotSha256)
  const edgeArtifact = writeJson(path.join(output, 'data', 'edges.json'), graph.edges)
  const navigationBuilder = createNavigationIndexBuilder({
    outputRoot: output,
    snapshotSha256,
    symbols,
    symbolLocators: symbolArtifacts.locators,
    symbolManifest: symbolArtifacts.manifest,
    components: ontology.components,
    relationshipCorpusSha256: relationshipCorpus.corpusSha256,
  })
  const relationshipArtifacts = writeRelationshipCorpusArtifacts(output, relationshipCorpus, {
    onShard: navigationBuilder.observeRelationshipShard,
  })
  const navigation = navigationBuilder.finalize()
  const scopeArtifact = writeJson(path.join(output, 'data', 'scope.json'), scope)
  const governanceArtifact = writeJson(path.join(output, 'data', 'governance.json'), governance)
  const buildBasisArtifact = writeJson(
    path.join(output, 'data', 'build-basis.json'),
    buildBasis ?? { schemaVersion: 'arc-atlas-build-basis-v2', state: 'not-configured', basisSha256: null },
  )
  const buildInputArtifact = writeJson(path.join(output, 'data', 'build-inputs.json'), buildBasis
    ? {
      schemaVersion: 'arc-atlas-build-inputs-summary-v1',
      basisSha256: buildBasis.basisSha256,
      profile: { sha256: buildBasis.profile.sha256, path: buildBasis.profile.path },
      source: {
        git: buildBasis.source.git,
        visibleInventoryCount: buildBasis.source.visibleInventory.count,
        visibleInventorySha256: buildBasis.source.visibleInventory.sha256,
      },
      builder: { sha256: buildBasis.builder.sha256 },
      inputs: {
        codeGraph: buildBasis.inputs.codeGraph.state,
        ontology: buildBasis.inputs.ontology.state,
        componentReviews: buildBasis.inputs.componentReviews.length,
        transcript: buildBasis.inputs.transcript.state,
        scopePolicy: buildBasis.inputs.scopePolicy.state,
        documentPolicy: buildBasis.inputs.documentPolicy.state,
        languageParserPolicy: buildBasis.inputs.parserPolicy.state,
      },
    }
    : { schemaVersion: 'arc-atlas-build-inputs-summary-v1', state: 'not-configured', basisSha256: null })
  const ontologyArtifacts = []
  if (ontology.projection) {
    ontologyArtifacts.push(
      { path: 'data/ontology.json', ...writeJson(path.join(output, 'data', 'ontology.json'), ontology.projection) },
      { path: 'data/components.json', ...writeJson(path.join(output, 'data', 'components.json'), ontology.components) },
    )
  }
  const transcriptArtifacts = transcript
    ? [{ path: 'data/transcript.json', ...writeJson(path.join(output, 'data', 'transcript.json'), transcript) }]
    : []
  const parserOutcomes = Object.fromEntries(
    [...new Set(parseEligible.map(file => file.parser.state))]
      .sort()
      .map(state => [state, parseEligible.filter(file => file.parser.state === state).length]),
  )
  const exactParserSymbols = symbols.filter(symbol => EXACT_PARSER_ADAPTERS.has(symbol.derivation?.adapter))
  const advisorySymbols = symbols.filter(symbol => !EXACT_PARSER_ADAPTERS.has(symbol.derivation?.adapter))
  const sourceAuthoredPurpose = exactParserSymbols.filter(symbol => symbol.purpose.status === 'source-authored').length
  const reviewedPurpose = exactParserSymbols.filter(symbol => symbol.purpose.status === 'source-addressed-review').length
  const unavailablePurpose = exactParserSymbols.filter(symbol => symbol.purpose.status === 'source-addressed-unavailable').length
  const unresolvedPurpose = exactParserSymbols.length - sourceAuthoredPurpose - reviewedPurpose - unavailablePurpose
  const structurallyExplained = exactParserSymbols.filter(symbol => symbol.structuralExplanation?.status === 'exact-parser-derived').length
  const operationallyExplained = exactParserSymbols.filter(symbol => symbol.operationalBehavior?.status === 'exact-parser-derived').length
  const graphHashCoverageComplete = graph.source.state === 'observed'
    && graph.source.rootMatchesRepository === true
    && graph.source.fileHashes.total > 0
    && graph.source.fileHashes.total === graph.source.fileHashes.hashed
    && graph.source.fileHashes.total === graph.source.fileHashes.matchedCurrent
    && graph.source.fileHashes.mismatchedCurrent === 0
    && graph.source.fileHashes.staleRows === 0
    && graph.source.invalidSymbolNodes === 0
  const completenessReceipt = {
    schemaVersion: 'arc-atlas-completeness-receipt-v1',
    authority: ATLAS_AUTHORITY,
    snapshotSha256,
    denominators: {
      files: {
        visible: paths.length,
        accounted: files.length,
        regular: files.filter(file => file.fileClass === 'regular').length,
        nonRegular: files.filter(file => !['regular', 'missing'].includes(file.fileClass)).length,
        missing: files.filter(file => file.fileClass === 'missing').length,
      },
      parseEligibleFiles: parseEligible.length,
      parserOutcomes: {
        total: parseEligible.length,
        byState: parserOutcomes,
      },
      syntaxDiagnostics,
      parserErrors,
      codeFiles: {
        total: codeFiles.length,
        nativeParserCovered: codeFiles.length - nativeParserMissing.length,
        nativeParserMissing: nativeParserMissing.length,
        nativeParserMissingByLanguage,
      },
      symbols: {
        total: symbols.length,
        exactParserEntities: exactParserSymbols.length,
        advisoryCandidates: advisorySymbols.length,
        structurallyExplained,
        operationallyExplained,
        sourceAuthoredPurpose,
        reviewedPurpose,
        unavailablePurpose,
        unresolvedPurpose,
        inferredPurpose: 0,
      },
      edges: graph.edges.length,
      relationships: relationshipCorpus.denominators,
      ontology: ontology.projection
        ? {
          files: ontology.components.length,
          unclassifiedFiles: ontology.unclassifiedFiles,
          fallbackPrimaryFiles: ontology.fallbackPrimaryFiles,
        }
        : { files: 0, unclassifiedFiles: files.length },
      transcript: transcript
        ? transcript.coverage
        : { messages: 0, userMessages: 0, assistantMessages: 0, decisionReviewPending: 0 },
      repositoryScope: {
        ignored: scope.ignored.total,
        ignoredCodeLike: scope.ignored.codeLike,
        policyReviewed: scope.ignored.policyReviewed,
        reviewRequired: scope.ignored.reviewRequired,
      },
      governance: governance.denominators,
    },
    sources: {
      codeGraph: graph.source,
      typescriptBindings: typescriptBindings.source,
      pythonBindings: pythonBindings.source,
      treeSitterBindings: treeSitterBindings.source,
      typescriptDeclarationFallback: typescriptDeclarationFallback.source,
      languageParsers: treeSitter.source,
      ontology: ontology.source,
      transcript: transcript
        ? { state: 'observed', path: transcript.source.path, sha256: transcript.source.sha256, authority: transcript.authority }
        : { state: 'not-requested', authority: 'none' },
      governance: governance.sources,
      buildInputs: buildBasis
        ? {
          state: 'observed',
          basisSha256: buildBasis.basisSha256,
          profileSha256: buildBasis.profile.sha256,
          builderSha256: buildBasis.builder.sha256,
        }
        : { state: 'not-configured', authority: 'none' },
    },
    gates: {
      fileDenominator: {
        status: files.length === paths.length ? 'pass' : 'fail',
        reason: files.length === paths.length ? 'every-visible-entry-accounted' : 'visible-entry-gap',
      },
      buildInputProvenance: buildBasis && buildInputAuthority
        ? (() => {
          const freshness = verifyAtlasBuildBasisCurrentV2(buildBasis, { authority: buildInputAuthority, outputRoot: output })
          return freshness.state === 'current-at-verified-at'
            ? { status: 'pass', reason: 'current-exact-build-basis-verified-at-finalization' }
            : { status: 'fail', reason: 'build-basis-freshness-blocked', blockers: freshness.blockers }
        })()
        : { status: 'fail', reason: 'closed-build-profile-required', nextAction: 'atlas build --build-inputs <profile.json>' },
      filePresence: {
        status: files.some(file => file.fileClass === 'missing') ? 'fail' : 'pass',
        reason: files.some(file => file.fileClass === 'missing')
          ? 'tracked-or-visible-entries-missing-from-worktree'
          : 'every-visible-entry-is-physically-present',
      },
      parserOutcomes: {
        status: parseUnaccounted.length === 0 ? 'pass' : 'fail',
        reason: parseUnaccounted.length === 0 ? 'every-parse-eligible-file-has-an-outcome' : 'parse-eligible-files-unaccounted',
      },
      syntaxHealth: {
        status: syntaxDiagnostics === 0 ? 'pass' : 'fail',
        reason: syntaxDiagnostics === 0 ? 'no-native-parser-syntax-diagnostics' : 'native-parser-syntax-diagnostics-present',
      },
      symbolDenominator: {
        status: parseUnaccounted.length > 0 || parserErrors > 0
          ? 'fail'
          : nativeParserMissing.length > 0 || syntaxDiagnostics > 0
            ? 'partial'
            : 'pass',
        reason: parseUnaccounted.length > 0
          ? 'native-parser-outcomes-missing'
          : parserErrors > 0
            ? 'native-parser-errors-present'
          : nativeParserMissing.length > 0
            ? 'native-parser-coverage-incomplete'
            : syntaxDiagnostics > 0
              ? 'native-parser-syntax-diagnostics-present'
              : 'all-recognized-code-languages-have-clean-native-parser-coverage',
      },
      codeGraphFreshness: {
        status: graphHashCoverageComplete && graph.source.staleNodes === 0 ? 'pass' : 'fail',
        reason: graph.source.state !== 'observed'
          ? 'advisory-code-graph-not-requested'
          : graph.source.rootMatchesRepository !== true
            ? 'advisory-code-graph-root-mismatch'
          : graph.source.invalidSymbolNodes > 0
            ? 'advisory-code-graph-symbol-source-binding-invalid'
          : !graphHashCoverageComplete
            ? 'advisory-code-graph-has-no-complete-content-hash-denominator'
            : graph.source.staleNodes
              ? 'advisory-code-graph-contains-stale-file-observations'
              : 'advisory-code-graph-current-against-content-hash-denominator',
      },
      semanticPurpose: {
        status: unresolvedPurpose === 0 ? 'pass' : 'fail',
        reason: unresolvedPurpose === 0
          ? `every-symbol-purpose-is-source-authored, source-addressed-reviewed, or explicitly-unavailable (${sourceAuthoredPurpose} authored / ${reviewedPurpose} reviewed / ${unavailablePurpose} explicit-unavailable)`
          : 'symbols-require-source-addressed-purpose-review',
      },
      structuralExplanation: {
        status: structurallyExplained === exactParserSymbols.length ? 'pass' : 'fail',
        reason: structurallyExplained === exactParserSymbols.length
          ? 'every-syntax-entity-has-an-exact-parser-derived-structural-explanation'
          : 'syntax-entities-lack-exact-structural-explanations',
      },
      relationshipObservation: relationshipCorpus.gates.observation,
      relationshipResolution: relationshipCorpus.gates.resolution,
      operationalBehavior: {
        status: operationallyExplained === exactParserSymbols.length ? 'pass' : 'fail',
        reason: operationallyExplained === exactParserSymbols.length
          ? 'every-exact-parser-entity-has-source-bound-operational-syntax-facts'
          : 'exact-parser-entities-lack-source-bound-operational-syntax-facts',
      },
      ontology: {
        status: !ontology.projection || ontology.unclassifiedFiles > 0 || !ontology.semanticDenominatorPresent
          ? 'fail'
          : ontology.fallbackPrimaryFiles > 0
            ? 'partial'
            : 'pass',
        reason: !ontology.projection
          ? 'ontology-not-requested'
          : !ontology.semanticDenominatorPresent
            ? 'ontology-has-no-source-addressed-semantic-denominator'
          : ontology.unclassifiedFiles
            ? 'visible-files-remain-unclassified'
            : ontology.fallbackPrimaryFiles
              ? 'visible-files-remain-only-fallback-classified'
            : 'every-visible-file-has-a-source-addressed-primary-organ',
      },
      transcriptCoverage: {
        status: transcript && transcript.coverage.messages > 0 ? 'pass' : 'fail',
        reason: !transcript
          ? 'visible-transcript-not-requested'
          : transcript.coverage.messages === 0
            ? 'visible-transcript-contains-no-user-or-assistant-messages'
            : 'every-included-visible-message-is-content-addressed',
      },
      transcriptSemantics: {
        status: transcript && transcript.coverage.decisionReviewPending === 0 ? 'pass' : 'fail',
        reason: !transcript
          ? 'visible-transcript-not-requested'
          : transcript.coverage.decisionReviewPending > 0
            ? 'visible-messages-await-source-addressed-decision-review'
            : 'every-owner-message-has-a-source-addressed-decision-review',
      },
      repositoryScope: {
        status: scope.ignored.reviewRequired === 0 ? 'pass' : 'fail',
        reason: scope.ignored.reviewRequired === 0
          ? 'every-ignored-entry-has-a-source-addressed-scope-policy'
          : 'ignored-entries-await-source-addressed-scope-policy',
      },
      governanceDocuments: governance.gates.documentClassification,
      governanceCanon: governance.gates.canonicalDocuments,
      governanceIntent: governance.gates.intentMap,
      governanceFindings: governance.gates.findings,
      governanceAuthorityEvents: governance.gates.authorityEvents,
      governanceTeaching: governance.gates.teachingCoverage,
      productProof: {
        status: 'not-claimed',
        reason: 'repository-structure-projection-cannot-establish-product-outcomes',
      },
    },
  }
  const uiProjection = compileUiProjection({
    snapshotSha256,
    files,
    symbols,
    symbolLocators: symbolArtifacts.locators,
    edges: graph.edges,
    relationshipCorpus,
    ontology: ontology.projection,
    components: ontology.components,
    gates: completenessReceipt.gates,
    scope,
    transcript,
    governance,
    navigation,
  })
  completenessReceipt.gates.uiProjection = {
    status: uiProjection.manifest.loading.initialBytes <= 1_500_000 ? 'pass' : 'fail',
    reason: uiProjection.manifest.loading.initialBytes <= 1_500_000
      ? 'initial-human-interface-projection-is-bounded-and-symbol-details-are-lazy'
      : 'initial-human-interface-projection-exceeds-1500000-byte-budget',
  }
  const compactUiArtifact = artifactPath => artifactPath.startsWith('data/ui/entities/')
    || artifactPath.startsWith('data/ui/relations/')
    || artifactPath.startsWith('data/ui/scope/groups/')
    || artifactPath.startsWith('data/ui/transcript/pages/')
    || artifactPath === 'data/ui/search-index.json'
    || artifactPath === 'data/ui/governance.json'
  const uiArtifacts = uiProjection.artifacts.map(artifact => ({
    path: artifact.path,
    ...(compactUiArtifact(artifact.path)
      ? writeJsonCompact(path.join(output, artifact.path), artifact.value)
      : writeJson(path.join(output, artifact.path), artifact.value)),
  }))
  const completenessArtifact = writeJson(path.join(output, 'data', 'completeness.json'), completenessReceipt)
  const artifacts = [
    { path: 'data/files.json', ...fileArtifact },
    { path: 'data/source-index.json', ...sourceIndexArtifact },
    ...symbolArtifacts.artifacts,
    { path: 'data/edges.json', ...edgeArtifact },
    ...relationshipArtifacts.artifacts,
    { path: navigation.artifact.path, ...navigation.artifact },
    { path: 'data/scope.json', ...scopeArtifact },
    { path: 'data/governance.json', ...governanceArtifact },
    { path: 'data/build-basis.json', ...buildBasisArtifact },
    { path: 'data/build-inputs.json', ...buildInputArtifact },
    { path: 'data/completeness.json', ...completenessArtifact },
    ...ontologyArtifacts,
    ...transcriptArtifacts,
    ...uiArtifacts,
    ...sourceBlobArtifacts,
  ]
  const manifest = {
    schemaVersion: ATLAS_SCHEMA_VERSION,
    authority: ATLAS_AUTHORITY,
    generatedAt: new Date().toISOString(),
    build: {
      basisSha256: buildBasis?.basisSha256 ?? null,
      buildInputSha256: buildBasis?.basisSha256 ?? null,
      builderSourceSha256: buildBasis?.builder?.source?.sha256 ?? null,
      builderFileCount: buildBasis?.builder?.source?.files?.length ?? null,
      nodeVersion: buildBasis?.builder?.runtime?.node?.version ?? null,
      platform: buildBasis?.builder?.runtime?.platform ?? null,
      architecture: buildBasis?.builder?.runtime?.architecture ?? null,
    },
    snapshot: {
      repositoryRoot: repository,
      git,
      snapshotSha256,
      basisSha256: buildBasis?.basisSha256 ?? null,
    },
    coverage: {
      files: { visible: paths.length, accounted: files.length, ratio: paths.length ? files.length / paths.length : 1 },
      parseEligibleFiles: { total: parseEligible.length, accounted: parseEligible.length - parseUnaccounted.length, unaccounted: parseUnaccounted.length },
      symbols: { total: symbols.length },
      codeFiles: {
        total: codeFiles.length,
        nativeParserCovered: codeFiles.length - nativeParserMissing.length,
        nativeParserMissing: nativeParserMissing.length,
      },
      edges: { total: graph.edges.length },
      relationships: relationshipCorpus.denominators,
      repositoryScope: {
        ignored: scope.ignored.total,
        ignoredCodeLike: scope.ignored.codeLike,
        policyReviewed: scope.ignored.policyReviewed,
        reviewRequired: scope.ignored.reviewRequired,
      },
      governance: governance.denominators,
      ontology: {
        organs: ontology.projection?.organs.length || 0,
        pitfalls: ontology.projection?.pitfalls.length || 0,
        journeys: ontology.projection?.journeys.length || 0,
        files: ontology.components.length,
        unclassifiedFiles: ontology.unclassifiedFiles,
        fallbackPrimaryFiles: ontology.fallbackPrimaryFiles || 0,
      },
      ui: uiProjection.manifest.counts,
    },
    sources: completenessReceipt.sources,
    gates: completenessReceipt.gates,
    completeness: {
      inventory: files.length === paths.length ? 'complete' : 'incomplete',
      parseEligibleFiles: parseUnaccounted.length ? 'incomplete' : 'complete',
      semanticPurpose: unresolvedPurpose === 0
        ? 'source-authored-source-addressed-reviewed-or-explicitly-unavailable'
        : 'incomplete-source-addressed-purpose-denominator',
      symbols: parseUnaccounted.length > 0 || parserErrors > 0 || nativeParserMissing.length > 0 || syntaxDiagnostics > 0
        ? 'incomplete-exact-denominator'
        : 'exact-native-parser-denominator',
      codeGraph: graph.source.state === 'not-requested'
        ? 'not-requested'
        : graph.source.staleNodes ? 'contains-stale-observations' : 'matched-current-file-universe',
      ontology: !ontology.projection
        ? 'not-requested'
        : !ontology.semanticDenominatorPresent
          ? 'structurally-present-but-semantically-incomplete'
          : ontology.unclassifiedFiles
          ? 'contains-unclassified-files'
          : ontology.fallbackPrimaryFiles
            ? 'source-addressed-with-fallback-classification-gaps'
          : 'source-addressed-and-file-complete',
      transcript: !transcript
        ? 'not-requested'
        : transcript.coverage.decisionReviewPending > 0
          ? 'verbatim-complete-semantic-review-incomplete'
          : 'verbatim-and-source-addressed-reviewed',
      repositoryScope: scope.ignored.reviewRequired > 0
        ? 'ignored-entries-await-source-addressed-scope-policy'
        : 'complete-source-addressed-scope-ledger',
      governance: Object.entries(governance.gates).every(([, gate]) => gate.status === 'pass')
        ? 'source-addressed-and-taught'
        : 'structurally-inventoried-with-open-governance-or-teaching-gates',
    },
    artifacts,
  }
  writeJson(path.join(output, 'manifest.json'), manifest)
  return manifest
}

export function buildAgentPacket({ snapshotRoot, query, limit = 25, mode = 'current' }) {
  const normalized = String(query || '').trim().toLowerCase()
  if (!normalized) throw new Error('atlas packet query must contain non-whitespace text')
  if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
    throw new Error('atlas packet limit must be an integer between 1 and 250')
  }
  if (mode !== 'current' && mode !== 'historical') {
    throw new Error("atlas packet mode must be 'current' or 'historical'")
  }
  const manifest = JSON.parse(readFileSync(path.join(snapshotRoot, 'manifest.json'), 'utf8'))
  for (const artifact of manifest.artifacts || []) {
    const absolute = path.join(snapshotRoot, artifact.path)
    const observed = existsSync(absolute) ? sha256(readFileSync(absolute)) : null
    if (observed !== artifact.sha256) {
      throw new Error(`atlas artifact physical digest mismatch: ${artifact.path}`)
    }
  }
  const freshness = observeAtlasSnapshotFreshnessV1({
    snapshotRoot,
    manifest,
    builderRoot: path.resolve(import.meta.dirname, '..'),
  })
  if (mode === 'current' && freshness.status !== 'current-at-verified-at') {
    const reason = freshness?.nextReview?.requiredEvidence || freshness?.status || 'freshness-could-not-be-verified'
    throw new Error(`atlas current-serving requires a fresh closed build basis; use mode: 'historical' for a frozen snapshot (reason: ${reason})`)
  }
  const files = JSON.parse(readFileSync(path.join(snapshotRoot, 'data', 'files.json'), 'utf8'))
  const edges = JSON.parse(readFileSync(path.join(snapshotRoot, 'data', 'edges.json'), 'utf8'))
  const componentsPath = path.join(snapshotRoot, 'data', 'components.json')
  const ontologyPath = path.join(snapshotRoot, 'data', 'ontology.json')
  const components = existsSync(componentsPath) ? JSON.parse(readFileSync(componentsPath, 'utf8')) : []
  const ontology = existsSync(ontologyPath) ? JSON.parse(readFileSync(ontologyPath, 'utf8')) : null
  const fileByPath = new Map(files.map(file => [file.path, file]))
  const componentByPath = new Map(components.map(component => [component.path, component]))
  const organById = new Map((ontology?.organs || []).map(organ => [organ.id, organ]))
  const rankOrder = (left, right) => right.score - left.score
    || left.symbol.path.localeCompare(right.symbol.path)
    || left.symbol.start.line - right.symbol.start.line
    || left.symbol.start.column - right.symbol.start.column
  const ranked = []
  let totalMatches = 0
  forEachSnapshotSymbol(snapshotRoot, symbol => {
    const name = symbol.name.toLowerCase()
    const qualifiedName = symbol.qualifiedName.toLowerCase()
    const searchable = [
      symbol.name,
      symbol.qualifiedName,
      symbol.path,
      symbol.signature,
      symbol.purpose.summary || '',
    ].join(' ').toLowerCase()
    const score = name === normalized ? 400
      : name.startsWith(normalized) ? 300
        : qualifiedName.includes(normalized) ? 200
          : searchable.includes(normalized) ? 100
            : 0
    if (score === 0) return
    totalMatches += 1
    ranked.push({ symbol, score })
    ranked.sort(rankOrder)
    if (ranked.length > limit) ranked.pop()
  })
  const selectedIds = new Set(ranked.map(candidate => candidate.symbol.id))
  const neighborIds = new Set()
  for (const edge of edges) {
    if (selectedIds.has(edge.source)) neighborIds.add(edge.target)
    if (selectedIds.has(edge.target)) neighborIds.add(edge.source)
  }
  const symbolById = new Map(ranked.map(candidate => [candidate.symbol.id, candidate.symbol]))
  if (neighborIds.size > 0) {
    forEachSnapshotSymbol(snapshotRoot, symbol => {
      if (neighborIds.has(symbol.id)) symbolById.set(symbol.id, symbol)
    })
  }
  const matches = ranked
    .map(symbol => {
      const rankedSymbol = symbol
      symbol = rankedSymbol.symbol
      const file = fileByPath.get(symbol.path)
      const absolutePath = path.join(manifest.snapshot.repositoryRoot, symbol.path)
      const sourceBlobPath = path.join(snapshotRoot, 'source', 'blobs', file?.sha256 || '')
      const sourceBytes = mode === 'current'
        ? existsSync(absolutePath) && lstatSync(absolutePath).isFile()
          ? readFileSync(absolutePath)
          : null
        : existsSync(sourceBlobPath) && lstatSync(sourceBlobPath).isFile()
          ? readFileSync(sourceBlobPath)
          : null
      const observedSha256 = sourceBytes ? sha256(sourceBytes) : null
      if (!file || observedSha256 !== file.sha256) {
        throw new Error(mode === 'current'
          ? `atlas source drift: ${symbol.path}`
          : `atlas historical source blob is unavailable or drifted: ${symbol.path}`)
      }
      const sourceText = sourceBytes.toString('utf8')
      const excerpt = sourceText.split(/\r?\n/).slice(symbol.start.line - 1, symbol.end.line).join('\n')
      const relationCandidates = edges.filter(edge => edge.source === symbol.id || edge.target === symbol.id)
      const relationLimit = 50
      const relationItems = relationCandidates.slice(0, relationLimit).map(edge => {
        const direction = edge.source === symbol.id ? 'outbound' : 'inbound'
        const neighborId = direction === 'outbound' ? edge.target : edge.source
        const neighbor = symbolById.get(neighborId)
        return {
          id: edge.id,
          kind: edge.kind,
          direction,
          neighbor: neighbor ? {
            id: neighbor.id,
            name: neighbor.name,
            kind: neighbor.kind,
            path: neighbor.path,
            start: neighbor.start,
          } : { id: neighborId, unavailable: true },
          observation: edge.observation,
        }
      })
      const component = componentByPath.get(symbol.path) || null
      return {
        symbol,
        rank: { score: rankedSymbol.score, method: 'exact-name-then-prefix-then-text-v1' },
        source: {
          path: symbol.path,
          absolutePath: mode === 'current' ? absolutePath : null,
          snapshotBlobPath: mode === 'historical' ? `source/blobs/${file.sha256}` : null,
          sourceState: mode === 'current' ? 'current-source-file-exactly-matches-snapshot' : 'snapshot-captured-source-file',
          sha256: file.sha256,
          start: symbol.start,
          end: symbol.end,
          excerpt,
          excerptSha256: sha256(excerpt),
        },
        relations: {
          total: relationCandidates.length,
          returned: relationItems.length,
          truncated: relationItems.length < relationCandidates.length,
          items: relationItems,
        },
        ontology: component ? {
          componentId: component.id,
          primaryOrganId: component.primaryOrganId,
          organIds: component.organIds,
          organs: component.organIds.map(id => organById.get(id)).filter(Boolean),
        } : null,
      }
    })
  const packet = {
    schemaVersion: 'arc-atlas-agent-packet-v2',
    authority: ATLAS_AUTHORITY,
    snapshotSha256: manifest.snapshot.snapshotSha256,
    query,
    snapshot: {
      git: manifest.snapshot.git,
      gates: manifest.gates,
      completeness: manifest.completeness,
      sources: manifest.sources,
      servingMode: mode,
      freshness,
    },
    resultSet: {
      totalMatches,
      returnedMatches: matches.length,
      limit,
      truncated: matches.length < totalMatches,
      ranking: 'exact-name-then-prefix-then-text-v1',
    },
    matches,
    caveats: [
      'This packet is a derived read-only projection, not intent, truth, effect, or completion authority.',
      'No purpose text is guessed from identifiers; absent source-authored or reviewed semantics remains an explicit release-blocking gap.',
      'Artifact hashes establish snapshot self-consistency, not authenticity against a principal able to rewrite the snapshot and manifest together.',
    ],
  }
  return { ...packet, packetSha256: sha256(canonicalJson(packet)) }
}
