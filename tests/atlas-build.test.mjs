import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { readJsonArtifact } from '../src/artifact-codec.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const atlasCli = path.join(projectRoot, 'bin', 'atlas.mjs')

function write(relative, bytes, root) {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, bytes)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function readRelationshipCorpus(output) {
  const manifest = JSON.parse(readFileSync(path.join(output, 'data', 'relationships.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 'arc-atlas-relationship-artifact-manifest-v1')
  const sequences = Object.fromEntries(Object.entries(manifest.sequences).map(([field, sequence]) => {
    const values = sequence.shards.flatMap(shard => {
      const items = readJsonArtifact({ root: output, descriptor: shard })
      assert.equal(items.length, shard.count)
      return items
    })
    assert.equal(values.length, sequence.count)
    return [field, values]
  }))
  return {
    schemaVersion: manifest.corpus.schemaVersion,
    authority: manifest.authority,
    digestSchemaVersion: manifest.corpus.digestSchemaVersion,
    corpusSha256: manifest.corpus.corpusSha256,
    denominators: manifest.corpus.denominators,
    gates: manifest.corpus.gates,
    ...sequences,
  }
}

function readSymbols(output) {
  const root = JSON.parse(readFileSync(path.join(output, 'data', 'symbols.json'), 'utf8'))
  if (Array.isArray(root)) return root
  assert.equal(root.schemaVersion, 'arc-atlas-symbol-artifact-manifest-v1')
  const symbols = root.sequence.shards.flatMap(shard => {
    const values = readJsonArtifact({ root: output, descriptor: shard })
    assert.equal(values.length, shard.count)
    return values
  })
  assert.equal(symbols.length, root.sequence.count)
  return symbols
}

function makeFixtureRepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-fixture-'))
  write('src/main.mjs', [
    "import { formatName } from './names.mjs'",
    'export function greet(name) { return `Hello ${formatName(name)}` }',
    'const localArrow = value => value.trim()',
    '',
  ].join('\n'), root)
  write('src/names.mjs', 'export function formatName(value) { return value.toUpperCase() }\n', root)
  write('src/tool.py', 'def calculate_answer(value: int) -> int:\n    return value * 2\n', root)
  write('README.md', '# Fixture\n', root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: root })
  execFileSync('git', ['add', 'src/main.mjs', 'src/names.mjs', 'README.md'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

function makeTreeSitterPolicy({ sourceSiteQueries = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-parser-policy-'))
  const grammarRoot = path.join(process.env.AGENTIC_OS_ROOT || '/home/raed/.agentic-os', 'grammars')
  const rustGrammar = readFileSync(path.join(grammarRoot, 'tree-sitter-rust.wasm'))
  const bashGrammar = readFileSync(path.join(grammarRoot, 'tree-sitter-bash.wasm'))
  copyFileSync(path.join(grammarRoot, 'tree-sitter-rust.wasm'), path.join(root, 'tree-sitter-rust.wasm'))
  copyFileSync(path.join(grammarRoot, 'tree-sitter-bash.wasm'), path.join(root, 'tree-sitter-bash.wasm'))
  const rustQuery = [
    '(struct_item name: (type_identifier) @name) @definition.struct',
    '(enum_item name: (type_identifier) @name) @definition.enum',
    '(trait_item name: (type_identifier) @name) @definition.trait',
    '(function_item name: (identifier) @name) @definition.function',
  ].join('\n')
  const bashQuery = '(function_definition name: (word) @name) @definition.function\n'
  const rustSourceSiteQuery = [
    '(call_expression) @source.site.call',
    '(use_declaration argument: (_) @source.specifier.literal.use) @source.site.use',
    '(mod_item name: (identifier) @source.specifier.literal.module-declaration) @source.site.module-declaration',
    '(macro_invocation macro: (identifier) @source.form (token_tree (string_literal) @source.specifier.literal.include) (#eq? @source.form "include")) @source.site.include',
  ].join('\n')
  const bashSourceSiteQuery = [
    '(command) @source.site.call',
    '(command name: (command_name (word) @source.form) argument: (word) @source.specifier.literal.source (#any-of? @source.form "source" ".")) @source.site.source',
    '',
  ].join('\n')
  write('rust.tags.scm', rustQuery, root)
  write('bash.tags.scm', bashQuery, root)
  if (sourceSiteQueries) {
    write('rust.source-sites.scm', rustSourceSiteQuery, root)
    write('bash.source-sites.scm', bashSourceSiteQuery, root)
  }
  const policy = {
    schemaVersion: sourceSiteQueries ? 'arc-atlas-tree-sitter-policy-v2' : 'arc-atlas-tree-sitter-policy-v1',
    runtime: { package: 'web-tree-sitter', version: '0.26.9', license: 'MIT' },
    languages: [
      {
        language: 'Rust',
        extensions: ['.rs'],
        grammar: {
          path: 'tree-sitter-rust.wasm',
          sha256: sha256(rustGrammar),
          upstream: 'https://github.com/tree-sitter/tree-sitter-rust/releases/tag/v0.23.2',
          version: 'v0.23.2',
          license: 'MIT',
        },
        query: { path: 'rust.tags.scm', sha256: sha256(rustQuery) },
        ...(sourceSiteQueries ? { sourceSiteQuery: { path: 'rust.source-sites.scm', sha256: sha256(rustSourceSiteQuery) } } : {}),
        semanticCeiling: 'syntax',
      },
      {
        language: 'Bash',
        extensions: ['.sh', '.bash'],
        grammar: {
          path: 'tree-sitter-bash.wasm',
          sha256: sha256(bashGrammar),
          upstream: 'https://github.com/tree-sitter/tree-sitter-bash',
          version: 'local-pinned-grammar',
          license: 'MIT',
        },
        query: { path: 'bash.tags.scm', sha256: sha256(bashQuery) },
        ...(sourceSiteQueries ? { sourceSiteQuery: { path: 'bash.source-sites.scm', sha256: sha256(bashSourceSiteQuery) } } : {}),
        semanticCeiling: 'syntax',
      },
    ],
  }
  write('policy.json', JSON.stringify(policy), root)
  return path.join(root, 'policy.json')
}

test('atlas uses hash-pinned Tree-sitter policies for unsupported language declarations', () => {
  const repository = makeFixtureRepository()
  write('src/lib.rs', [
    '// Unicode π before declarations must not corrupt byte-addressed source spans.',
    'pub struct Engine { value: i32 }',
    'impl Engine { pub fn run(&self) -> i32 { self.value } }',
    'pub fn rust_entry() -> i32 { 42 }',
    '',
  ].join('\n'), repository)
  write('scripts/release.sh', [
    'function build_atlas() { printf "%s\\n" build; }',
    'publish_atlas() { printf "%s\\n" publish; }',
    '',
  ].join('\n'), repository)
  const policyPath = makeTreeSitterPolicy()
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--language-parsers', policyPath,
  ], { cwd: projectRoot })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const files = JSON.parse(readFileSync(path.join(output, 'data', 'files.json'), 'utf8'))
  const symbols = readSymbols(output)
  assert.deepEqual(
    symbols.filter(symbol => ['src/lib.rs', 'scripts/release.sh'].includes(symbol.path))
      .map(symbol => `${symbol.path}:${symbol.kind}:${symbol.name}`)
      .sort(),
    [
      'scripts/release.sh:function:build_atlas',
      'scripts/release.sh:function:publish_atlas',
      'src/lib.rs:function:run',
      'src/lib.rs:function:rust_entry',
      'src/lib.rs:struct:Engine',
    ],
  )
  assert.equal(files.find(file => file.path === 'src/lib.rs').parser.adapter, 'tree-sitter-policy-v1')
  assert.equal(files.find(file => file.path === 'src/lib.rs').parser.semanticCeiling, 'syntax')
  assert.equal(manifest.coverage.codeFiles.nativeParserMissing, 0)
  assert.equal(manifest.gates.symbolDenominator.status, 'pass')
  assert.equal(manifest.sources.languageParsers.state, 'observed')
  assert.equal(manifest.sources.languageParsers.languages.length, 2)
  assert.equal(manifest.sources.languageParsers.languages.every(language => /^[a-f0-9]{64}$/.test(language.grammarSha256)), true)
  assert.equal(manifest.gates.operationalBehavior.status, 'pass')
  const buildBehavior = symbols.find(symbol => symbol.path === 'scripts/release.sh' && symbol.name === 'build_atlas').operationalBehavior
  assert.equal(buildBehavior.status, 'exact-parser-derived')
  assert.deepEqual(buildBehavior.events.map(event => [event.kind, event.subject]), [['call', 'printf']])
  const rustEntry = symbols.find(symbol => symbol.path === 'src/lib.rs' && symbol.name === 'rust_entry')
  const rustSource = readFileSync(path.join(repository, 'src/lib.rs'), 'utf8')
  const exactRustEntryBytes = rustSource.slice(rustSource.indexOf('pub fn rust_entry'), rustSource.indexOf('pub fn rust_entry') + 'pub fn rust_entry() -> i32 { 42 }'.length)
  assert.equal(rustEntry.bodySha256, sha256(exactRustEntryBytes))
  assert.equal(rustEntry.operationalBehavior.sourceSpan.bodySha256, rustEntry.bodySha256)
})

test('atlas refuses a Tree-sitter policy whose grammar query bytes drift after review', () => {
  const repository = makeFixtureRepository()
  write('src/lib.rs', 'pub fn rust_entry() -> i32 { 42 }\n', repository)
  const policyPath = makeTreeSitterPolicy()
  writeFileSync(path.join(path.dirname(policyPath), 'rust.tags.scm'), '(function_item) @definition.function\n')
  const output = path.join(repository, '.atlas-output')

  assert.throws(() => execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--language-parsers', policyPath,
  ], { cwd: projectRoot, stdio: 'pipe' }), /query bytes do not match their declared SHA-256/)
})

test('atlas refuses a Tree-sitter source-site query whose bytes drift after review', () => {
  const repository = makeFixtureRepository()
  write('src/lib.rs', 'pub fn rust_entry() -> i32 { helper() }\n', repository)
  const policyPath = makeTreeSitterPolicy({ sourceSiteQueries: true })
  writeFileSync(path.join(path.dirname(policyPath), 'rust.source-sites.scm'), '(call_expression function: (_) @source.form) @source.site.call\n')

  assert.throws(() => execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', path.join(repository, '.atlas-output'),
    '--language-parsers', policyPath,
  ], { cwd: projectRoot, stdio: 'pipe' }), /sourceSiteQuery bytes do not match their declared SHA-256/)
})

test('atlas Tree-sitter policy v2 accounts for hash-pinned Rust and Bash dependency sites', () => {
  const repository = makeFixtureRepository()
  write('src/lib.rs', [
    'use crate::util::run;',
    'mod helper;',
    'include!("generated.rs");',
    'fn run_now() { run(); }',
    '',
  ].join('\n'), repository)
  write('scripts/run.sh', [
    'source ./common.sh',
    '. ./extra.sh',
    'run_task',
    '',
  ].join('\n'), repository)
  const output = path.join(repository, '.atlas-output')
  const policyPath = makeTreeSitterPolicy({ sourceSiteQueries: true })

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output, '--language-parsers', policyPath], {
    cwd: projectRoot,
  })

  const corpus = readRelationshipCorpus(output)
  const rustDependencies = corpus.referenceSites.filter(site => site.path === 'src/lib.rs' && site.bindings.module !== null)
  const bashDependencies = corpus.referenceSites.filter(site => site.path === 'scripts/run.sh' && site.bindings.module !== null)
  assert.deepEqual(rustDependencies.map(site => [site.roles, site.literalSpecifier]), [
    [['use'], 'crate::util::run'],
    [['module-declaration'], 'helper'],
    [['include'], 'generated.rs'],
  ])
  assert.deepEqual(bashDependencies.map(site => [site.roles, site.literalSpecifier]), [
    [['call', 'source'], './common.sh'],
    [['call', 'source'], './extra.sh'],
  ])
  assert.equal(corpus.denominators.callSites, 7)
  assert.equal(corpus.denominators.dependencySites, 6)
  assert.equal(corpus.gates.observation.status, 'pass')
})

test('atlas assigns deterministic types to extensionless files, symlinks, and special entries', () => {
  const repository = makeFixtureRepository()
  write('Makefile', 'all:\n\t@true\n', repository)
  write('.githooks/pre-commit', '#!/usr/bin/env bash\nrun_checks() { :; }\n', repository)
  write('.cbmignore', 'dist/\n', repository)
  symlinkSync('src/main.mjs', path.join(repository, 'linked-main'))
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], { cwd: projectRoot })
  const files = JSON.parse(readFileSync(path.join(output, 'data', 'files.json'), 'utf8'))
  const byPath = Object.fromEntries(files.map(file => [file.path, file.language]))
  assert.equal(byPath.Makefile, 'Makefile')
  assert.equal(byPath['.githooks/pre-commit'], 'Bash')
  assert.equal(byPath['.cbmignore'], 'Ignore rules')
  assert.equal(byPath['linked-main'], 'Symbolic link')
  assert.equal(files.some(file => file.language.includes('Unknown')), false)
})

test('atlas build accounts for every visible file and every fixture function with provenance', () => {
  const repository = makeFixtureRepository()
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
    encoding: 'utf8',
  })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const files = JSON.parse(readFileSync(path.join(output, 'data', 'files.json'), 'utf8'))
  const symbols = readSymbols(output)
  const sourceIndex = JSON.parse(readFileSync(path.join(output, 'data', 'source-index.json'), 'utf8'))
  const relationshipManifest = JSON.parse(readFileSync(path.join(output, 'data', 'relationships.json'), 'utf8'))
  const relationships = readRelationshipCorpus(output)

  assert.equal(relationshipManifest.schemaVersion, 'arc-atlas-relationship-artifact-manifest-v1')
  assert.equal(relationshipManifest.corpus.schemaVersion, 'arc-atlas-relationship-corpus-v2')
  assert.equal(relationshipManifest.sequences.relationships.count > 0, true)
  assert.equal(relationshipManifest.sequences.relationships.shards.length > 0, true)
  assert.equal(relationshipManifest.sequences.relationships.shards.every(shard => shard.bytes <= 4_500_000), true)

  assert.equal(manifest.schemaVersion, 'arc-repository-atlas-v3')
  assert.equal(manifest.authority, 'read-only-derived-projection')
  assert.equal(manifest.snapshot.git.dirty, true)
  assert.equal(manifest.coverage.files.visible, 4)
  assert.equal(manifest.coverage.files.accounted, 4)
  assert.equal(manifest.coverage.files.ratio, 1)
  assert.deepEqual(files.map(file => file.path), [
    'README.md',
    'src/main.mjs',
    'src/names.mjs',
    'src/tool.py',
  ])
  assert.deepEqual(
    symbols.filter(symbol => ['function', 'method', 'arrow-function'].includes(symbol.kind))
      .map(symbol => `${symbol.path}:${symbol.name}`)
      .sort(),
    [
      'src/main.mjs:greet',
      'src/main.mjs:localArrow',
      'src/names.mjs:formatName',
      'src/tool.py:calculate_answer',
    ],
  )
  assert.equal(manifest.coverage.parseEligibleFiles.unaccounted, 0)
  assert.equal(manifest.completeness.inventory, 'complete')
  assert.match(manifest.snapshot.snapshotSha256, /^[a-f0-9]{64}$/)
  assert.ok(manifest.artifacts.every(artifact => /^[a-f0-9]{64}$/.test(artifact.sha256)))
  assert.equal(symbols.some(symbol => symbol.purpose.provenance === 'identifier-derived-placeholder'), false)
  assert.deepEqual(symbols.find(symbol => symbol.name === 'localArrow').purpose, {
    status: 'source-addressed-unavailable',
    summary: 'The exact source bytes for this declaration do not contain a docstring, comment, or other source-authored purpose statement. The atlas refuses to guess intent from the identifier name. This purpose is explicitly unavailable until a human or reviewed decision assigns one; it is not unknown, inferred, or unclassified.',
    provenance: 'no-source-authored-purpose',
    authority: 'explicit-unavailable-not-inferred',
  })
  assert.ok(symbols.every(symbol => symbol.structuralExplanation.schemaVersion === 'arc-atlas-structural-explanation-v1'))
  assert.ok(symbols.every(symbol => symbol.structuralExplanation.status === 'exact-parser-derived'))
  assert.ok(symbols.every(symbol => symbol.structuralExplanation.authority === 'exact-syntax-derived-projection-not-semantic-intent'))
  assert.match(symbols.find(symbol => symbol.name === 'localArrow').structuralExplanation.summary, /executable arrow-function named localArrow/)
  assert.deepEqual(symbols.find(symbol => symbol.name === 'localArrow').structuralExplanation.sourceSpan, {
    path: 'src/main.mjs',
    start: symbols.find(symbol => symbol.name === 'localArrow').start,
    end: symbols.find(symbol => symbol.name === 'localArrow').end,
    bodySha256: symbols.find(symbol => symbol.name === 'localArrow').bodySha256,
  })
  assert.ok(symbols.every(symbol => symbol.operationalBehavior.schemaVersion === 'arc-atlas-operational-syntax-v1'))
  assert.ok(symbols.every(symbol => symbol.operationalBehavior.status === 'exact-parser-derived'))
  assert.ok(symbols.every(symbol => symbol.operationalBehavior.authority === 'exact-syntax-only-not-runtime-effect-or-author-intent'))
  const greetBehavior = symbols.find(symbol => symbol.name === 'greet').operationalBehavior
  assert.deepEqual(greetBehavior.declaredInputs.map(input => input.text), ['name'])
  assert.deepEqual(greetBehavior.events.map(event => [event.kind, event.subject]), [
    ['return', null],
    ['call', 'formatName'],
  ])
  assert.equal(greetBehavior.eventCounts.call, 1)
  assert.equal(greetBehavior.eventCounts.return, 1)
  assert.equal(greetBehavior.resolutionCeiling, 'syntax-only-no-binding-runtime-effect-or-author-intent')
  const pythonBehavior = symbols.find(symbol => symbol.name === 'calculate_answer').operationalBehavior
  assert.deepEqual(pythonBehavior.declaredInputs.map(input => input.text), ['value: int'])
  assert.equal(pythonBehavior.eventCounts.return, 1)
  assert.match(pythonBehavior.plainLanguage, /one declared input/i)
  assert.equal(manifest.gates.structuralExplanation.status, 'pass')
  assert.equal(manifest.gates.structuralExplanation.reason, 'every-syntax-entity-has-an-exact-parser-derived-structural-explanation')
  assert.equal(manifest.gates.operationalBehavior.status, 'pass')
  assert.equal(manifest.gates.operationalBehavior.reason, 'every-exact-parser-entity-has-source-bound-operational-syntax-facts')
  assert.equal(relationships.schemaVersion, 'arc-atlas-relationship-corpus-v2')
  assert.equal(relationships.denominators.exactParserEntities, 4)
  assert.equal(relationships.denominators.declarationRelationships, 4)
  assert.equal(relationships.denominators.callSites, 3)
  assert.equal(relationships.denominators.resolvedCallSites, 3)
  assert.equal(relationships.denominators.unresolvedCallSites, 0)
  assert.deepEqual(
    relationships.referenceSites.filter(reference => reference.roles.includes('call')).map(reference => reference.spelling).sort(),
    ['formatName', 'value.toUpperCase', 'value.trim'],
  )
  const importedNames = relationships.referenceSites.find(reference => reference.roles.includes('static-import'))
  assert.equal(importedNames.literalSpecifier, './names.mjs')
  assert.equal(importedNames.bindings.callable, null)
  assert.equal(importedNames.bindings.module.state, 'unresolved-module-specifier-no-resolver')
  assert.equal(relationships.relationships.filter(relation => relation.kind === 'declares').length, 4)
  const formatNameReference = relationships.referenceSites.find(reference => reference.spelling === 'formatName')
  assert.equal(formatNameReference.resolution.state, 'resolved-internal-compiler-binding')
  assert.equal(formatNameReference.resolution.targetId, symbols.find(symbol => symbol.name === 'formatName').id)
  assert.equal(relationships.referenceSites.find(reference => reference.spelling === 'value.trim').resolution.state, 'resolved-external-compiler-binding')
  assert.equal(relationships.referenceSites.find(reference => reference.spelling === 'value.toUpperCase').resolution.state, 'resolved-external-compiler-binding')
  assert.equal(manifest.gates.relationshipObservation.status, 'pass')
  assert.equal(manifest.gates.relationshipResolution.status, 'pass')
  assert.equal(manifest.gates.relationshipResolution.reason, 'every-observed-call-site-has-a-compiler-or-runtime-binding')
  assert.equal(manifest.sources.typescriptBindings.state, 'observed')
  assert.equal(manifest.sources.typescriptBindings.executionIsolation, 'separate-process-bounded-projection-v1')
  assert.equal(manifest.sources.typescriptBindings.partitioning.strategy, 'sorted-root-batches-v1')
  assert.equal(manifest.sources.typescriptBindings.partitioning.maxRootFiles, 32)
  assert.equal(manifest.gates.semanticPurpose.status, 'pass')
  assert.ok(manifest.gates.semanticPurpose.reason.startsWith('every-symbol-purpose-is'))
  assert.equal(sourceIndex.denominator.regularFiles, 4)
  const mainSource = sourceIndex.entries.find(entry => entry.path === 'src/main.mjs')
  assert.equal(readFileSync(path.join(output, mainSource.blobPath), 'utf8'), readFileSync(path.join(repository, 'src/main.mjs'), 'utf8'))
  assert.equal(manifest.artifacts.some(artifact => artifact.path === mainSource.blobPath && artifact.sha256 === mainSource.sha256), true)
})

test('atlas declaration denominator includes named TypeScript and Python declarations, not only functions', () => {
  const repository = makeFixtureRepository()
  write('src/declarations.ts', [
    'export interface Runner { run(value: string): RunResult }',
    'export type RunResult = { ok: boolean }',
    "export enum Mode { Safe = 'safe' }",
    'export const DEFAULT_MODE = Mode.Safe',
    'export class Engine {',
    '  constructor(readonly mode: Mode) {}',
    '  run(value: string): RunResult { return { ok: Boolean(value) } }',
    '}',
    'const helper = (value: string) => value.trim()',
    '',
  ].join('\n'), repository)
  write('src/worker.py', [
    'class Worker:',
    '    """Runs one deterministic unit of work."""',
    '    def run(self, value: int) -> int:',
    '        return value + 1',
    '',
  ].join('\n'), repository)
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const symbols = readSymbols(output)
  const declarations = symbols
    .filter(symbol => ['src/declarations.ts', 'src/worker.py'].includes(symbol.path))
    .map(symbol => `${symbol.path}:${symbol.kind}:${symbol.name}`)
    .sort()

  assert.deepEqual(declarations, [
    'src/declarations.ts:arrow-function:helper',
    'src/declarations.ts:class:Engine',
    'src/declarations.ts:constructor:constructor',
    'src/declarations.ts:enum-member:Safe',
    'src/declarations.ts:enum:Mode',
    'src/declarations.ts:interface:Runner',
    'src/declarations.ts:method-signature:run',
    'src/declarations.ts:method:run',
    'src/declarations.ts:parameter-property:mode',
    'src/declarations.ts:property-signature:ok',
    'src/declarations.ts:type-alias:RunResult',
    'src/declarations.ts:variable:DEFAULT_MODE',
    'src/worker.py:class:Worker',
    'src/worker.py:method:run',
  ])
  assert.equal(manifest.gates.symbolDenominator.status, 'pass')
  assert.equal(manifest.completeness.symbols, 'exact-native-parser-denominator')
})

test('atlas binds typed TypeScript calls to exact internal or content-addressed external declarations', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-typescript-binding-'))
  write('src/callee.ts', 'export function callee(value: string): string { return value.trim() }\n', repository)
  write('src/caller.ts', "import { callee } from './callee.js'\nexport function caller(value: string): string { return callee(value) }\n", repository)
  write('README.md', '# Typed binding fixture\n', repository)
  execFileSync('git', ['init', '-q'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: repository })
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository })
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], { cwd: projectRoot })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const symbols = readSymbols(output)
  const relationships = readRelationshipCorpus(output)
  const callee = symbols.find(symbol => symbol.name === 'callee')
  const internal = relationships.referenceSites.find(reference => reference.spelling === 'callee')
  const external = relationships.referenceSites.find(reference => reference.spelling === 'value.trim')
  assert.equal(internal.resolution.state, 'resolved-internal-compiler-binding')
  assert.equal(internal.resolution.targetId, callee.id)
  assert.equal(external.resolution.state, 'resolved-external-compiler-binding')
  assert.equal(relationships.externalEntities.some(entity => entity.id === external.resolution.targetId), true)
  assert.equal(relationships.denominators.resolvedCallSites, 2)
  assert.equal(relationships.denominators.unresolvedCallSites, 0)
  assert.equal(manifest.gates.relationshipResolution.status, 'pass')
})

test('atlas joins every nested TypeScript call by its full exact occurrence instead of a shared start point', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-typescript-nested-binding-'))
  write('src/chain.ts', [
    'class Chain {',
    '  update(): Chain { return this }',
    "  digest(): string { return 'done' }",
    '}',
    'function createChain(): Chain { return new Chain() }',
    "export const done = (): string => 'done'",
    'export function run(): string { return createChain().update().digest() }',
    'export function runArrow(): string { return done() }',
    '',
  ].join('\n'), repository)
  write('README.md', '# Nested binding fixture\n', repository)
  execFileSync('git', ['init', '-q'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: repository })
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository })
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], { cwd: projectRoot })

  const symbols = readSymbols(output)
  const symbolById = new Map(symbols.map(symbol => [symbol.id, symbol]))
  const relationships = readRelationshipCorpus(output)
  const nested = relationships.referenceSites.filter(reference => reference.path === 'src/chain.ts'
    && ['createChain', 'createChain().update', 'createChain().update().digest'].includes(reference.spelling))
  assert.equal(nested.length, 3)
  assert.deepEqual(Object.fromEntries(nested.map(reference => [reference.spelling, symbolById.get(reference.resolution.targetId)?.name])), {
    createChain: 'createChain',
    'createChain().update': 'update',
    'createChain().update().digest': 'digest',
  })
  assert.equal(new Set(nested.map(reference => `${reference.start.line}:${reference.start.column}`)).size, 1)
  assert.equal(new Set(nested.map(reference => `${reference.end.line}:${reference.end.column}:${reference.sourceSha256}`)).size, 3)
  const arrow = relationships.referenceSites.find(reference => reference.spelling === 'done')
  assert.equal(arrow.resolution.state, 'resolved-internal-compiler-binding')
  assert.equal(symbolById.get(arrow.resolution.targetId)?.name, 'done')
})

test('atlas relationship v2 accounts for whole-file calls and module-use sites outside declarations', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-file-sites-'))
  write('src/value.mjs', 'export function value() { return 42 }\n', repository)
  write('src/main.mjs', "import { value } from './value.mjs'\nconst observed = value()\nexport { observed }\n", repository)
  write('src/tool.py', "import pathlib\nfrom json import loads\nobserved = loads('{}')\n", repository)
  write('README.md', '# Whole-file source-site fixture\n', repository)
  execFileSync('git', ['init', '-q'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: repository })
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository })
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], { cwd: projectRoot })

  const corpus = readRelationshipCorpus(output)
  assert.equal(corpus.schemaVersion, 'arc-atlas-relationship-corpus-v2')
  const jsCall = corpus.referenceSites.find(site => site.path === 'src/main.mjs' && site.roles.includes('call'))
  const pythonCall = corpus.referenceSites.find(site => site.path === 'src/tool.py' && site.roles.includes('call'))
  const jsImport = corpus.referenceSites.find(site => site.path === 'src/main.mjs' && site.roles.includes('static-import'))
  const pythonImports = corpus.referenceSites.filter(site => site.path === 'src/tool.py' && site.roles.some(role => ['static-import', 'from-import'].includes(role)))
  assert.equal(jsCall.containingSymbolId, null)
  assert.equal(pythonCall.containingSymbolId, null)
  assert.match(jsCall.sourceFileId, /^file:/)
  assert.match(pythonCall.sourceFileId, /^file:/)
  assert.equal(jsImport.literalSpecifier, './value.mjs')
  assert.deepEqual(pythonImports.map(site => site.literalSpecifier).sort(), ['json', 'pathlib'])
  assert.equal(corpus.denominators.callSites, 2)
  assert.equal(corpus.denominators.topLevelCallSites, 2)
  assert.equal(corpus.denominators.dependencySites, 3)
  assert.equal(corpus.gates.observation.status, 'pass')
  assert.equal(corpus.relationships.filter(relation => relation.kind === 'contains-source-site').length, corpus.referenceSites.length)
})

test('atlas relationship v2 preserves every JavaScript module-use role without inventing module targets', () => {
  const repository = mkdtempSync(path.join(tmpdir(), 'arc-atlas-js-module-sites-'))
  write('src/value.mjs', 'export const value = 42\n', repository)
  write('src/lazy.mjs', 'export const lazy = true\n', repository)
  write('src/legacy.cjs', 'module.exports = 42\n', repository)
  write('src/main.mjs', [
    "import { value } from './value.mjs'",
    "export { value as echoed } from './value.mjs'",
    "const lazy = import('./lazy.mjs')",
    "const dynamicPath = './dynamic.mjs'",
    'const dynamic = import(dynamicPath)',
    "const loaded = require('./legacy.cjs')",
    "const resolved = require.resolve('./legacy.cjs')",
    'export { value, lazy, dynamic, loaded, resolved }',
    '',
  ].join('\n'), repository)
  write('README.md', '# JavaScript module source-site fixture\n', repository)
  execFileSync('git', ['init', '-q'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'atlas@example.invalid'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Atlas Fixture'], { cwd: repository })
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repository })
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], { cwd: projectRoot })

  const corpus = readRelationshipCorpus(output)
  const dependencySites = corpus.referenceSites.filter(site => site.bindings.module !== null)
  assert.equal(dependencySites.length, 6)
  assert.deepEqual(dependencySites.map(site => site.roles).sort((left, right) => left.join(',').localeCompare(right.join(','))), [
    ['call', 'dynamic-import'],
    ['call', 'dynamic-import'],
    ['call', 'require'],
    ['call', 'require-resolve'],
    ['re-export-from'],
    ['static-import'],
  ])
  assert.equal(dependencySites.filter(site => site.bindings.callable !== null).length, 4)
  assert.equal(corpus.bindingSources[0].referenceSites, 4)
  const nonliteral = dependencySites.find(site => site.specifierState === 'nonliteral')
  assert.equal(nonliteral.literalSpecifier, null)
  assert.equal(nonliteral.bindings.module.state, 'unresolved-dynamic-specifier')
  assert.equal(dependencySites.filter(site => site.specifierState === 'literal').every(site => (
    site.bindings.module.state === 'unresolved-module-specifier-no-resolver'
      && site.bindings.module.targets.length === 0
      && site.bindings.module.authority === 'none'
  )), true)
})

test('atlas packet returns a bounded source-addressed continuation packet', () => {
  const repository = makeFixtureRepository()
  const output = path.join(repository, '.atlas-output')
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  const packet = JSON.parse(execFileSync(process.execPath, [
    atlasCli,
    'packet',
    '--snapshot', output,
    '--query', 'calculate_answer',
    '--mode', 'historical',
    '--format', 'json',
  ], { cwd: projectRoot, encoding: 'utf8' }))

  assert.equal(packet.schemaVersion, 'arc-atlas-agent-packet-v2')
  assert.match(packet.packetSha256, /^[a-f0-9]{64}$/)
  assert.equal(packet.query, 'calculate_answer')
  assert.equal(packet.matches.length, 1)
  assert.equal(packet.matches[0].symbol.name, 'calculate_answer')
  assert.equal(packet.matches[0].symbol.path, 'src/tool.py')
  assert.match(packet.matches[0].source.sha256, /^[a-f0-9]{64}$/)
  assert.match(packet.matches[0].source.excerpt, /def calculate_answer/)
  assert.match(packet.matches[0].source.excerptSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(packet.resultSet, {
    totalMatches: 1,
    returnedMatches: 1,
    limit: 25,
    truncated: false,
    ranking: 'exact-name-then-prefix-then-text-v1',
  })
  assert.equal(packet.snapshot.gates.fileDenominator.status, 'pass')
  assert.equal(packet.snapshot.gates.semanticPurpose.status, 'pass')
  assert.deepEqual(packet.matches[0].relations, {
    total: 0,
    returned: 0,
    truncated: false,
    items: [],
  })
  assert.equal(packet.authority, 'read-only-derived-projection')
  assert.equal(packet.snapshot.freshness.status, 'historical-only')
  assert.equal(packet.snapshot.servingMode, 'historical')
})

test('atlas packet requires an explicit historical mode when a snapshot has no closed build basis', () => {
  const repository = makeFixtureRepository()
  const output = path.join(repository, '.atlas-output')
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  assert.throws(() => execFileSync(process.execPath, [
    atlasCli,
    'packet',
    '--snapshot', output,
    '--query', 'calculate_answer',
    '--format', 'json',
  ], { cwd: projectRoot, stdio: 'pipe' }), /atlas current-serving requires a fresh closed build basis; use mode: 'historical'/)
})

test('atlas packet refuses a blank query instead of returning arbitrary first symbols', () => {
  const repository = makeFixtureRepository()
  const output = path.join(repository, '.atlas-output')
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  assert.throws(() => execFileSync(process.execPath, [
    atlasCli,
    'packet',
    '--snapshot', output,
    '--query', '   ',
    '--format', 'json',
  ], { cwd: projectRoot, stdio: 'pipe' }), /atlas packet query must contain non-whitespace text/)
})

test('atlas build joins advisory code-graph functions without duplicating exact parser symbols', () => {
  const repository = makeFixtureRepository()
  write('src/lib.rs', 'pub fn rust_entry() -> i32 { 42 }\n', repository)
  const graphDb = path.join(mkdtempSync(path.join(tmpdir(), 'arc-atlas-graph-')), 'graph.db')
  const db = new DatabaseSync(graphDb)
  db.exec(`
    CREATE TABLE projects (name TEXT PRIMARY KEY, indexed_at TEXT);
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY,
      project TEXT NOT NULL,
      label TEXT NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      file_path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      properties TEXT
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY,
      project TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      properties TEXT
    );
  `)
  db.prepare('INSERT INTO projects VALUES (?, ?)').run('fixture', '2026-08-15T00:00:00.000Z')
  const insertNode = db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  insertNode.run(1, 'fixture', 'Function', 'rust_entry', 'fixture.src.lib.rust_entry', 'src/lib.rs', 1, 1, JSON.stringify({ signature: 'pub fn rust_entry() -> i32', docstring: 'Returns the fixture answer.' }))
  insertNode.run(2, 'fixture', 'Function', 'formatName', 'fixture.src.names.formatName', 'src/names.mjs', 1, 1, JSON.stringify({ signature: 'function formatName(value)' }))
  insertNode.run(3, 'fixture', 'Function', 'deleted_function', 'fixture.src.deleted.deleted_function', 'src/deleted.rs', 1, 1, '{}')
  db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?)').run(1, 'fixture', 1, 2, 'CALLS', JSON.stringify({ confidence: 1, line: 1 }))
  db.close()

  const output = path.join(repository, '.atlas-output')
  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--graph-db', graphDb,
    '--graph-project', 'fixture',
  ], { cwd: projectRoot })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const symbols = readSymbols(output)
  const edges = JSON.parse(readFileSync(path.join(output, 'data', 'edges.json'), 'utf8'))

  assert.equal(symbols.filter(symbol => symbol.name === 'formatName').length, 1)
  assert.equal(symbols.filter(symbol => symbol.name === 'rust_entry').length, 1)
  assert.equal(symbols.some(symbol => symbol.name === 'deleted_function'), false)
  assert.equal(edges.length, 1)
  assert.equal(edges[0].kind, 'calls')
  assert.equal(manifest.sources.codeGraph.matchedNodes, 2)
  assert.equal(manifest.sources.codeGraph.staleNodes, 1)
  assert.equal(manifest.completeness.codeGraph, 'contains-stale-observations')
})

test('atlas build compiles one source-addressed ontology across every visible file', () => {
  const repository = makeFixtureRepository()
  const ontologyPath = path.join(mkdtempSync(path.join(tmpdir(), 'arc-atlas-ontology-')), 'ontology.json')
  writeFileSync(ontologyPath, `${JSON.stringify({
    schemaVersion: 'arc-atlas-ontology-source-v1',
    title: 'Fixture engineering organism',
    northStar: 'Turn a fixture request into a verified answer.',
    constitutionalKernels: [{ id: 'truth', name: 'Truth', summary: 'Separates proposals from evidence.' }],
    graphFacets: [{ id: 'intent', name: 'Intent graph', summary: 'Preserves the request.' }],
    membranes: [{ id: 'authority', name: 'Authority membrane', summary: 'Constrains effects.' }],
    proofLadder: ['exists', 'reachable', 'default-live', 'observed', 'causal', 'product-proven'],
    lenses: [{ id: 'journey', name: 'Journey', summary: 'Shows the request end to end.' }],
    organs: [
      {
        id: 'runtime',
        name: 'Runtime',
        summary: 'Executes the fixture source paths.',
        match: { include: ['src/**'] },
        sourceRefs: [{ path: 'src/main.mjs', line: 2 }],
        mitigates: ['hallucinated-execution'],
      },
      {
        id: 'orientation',
        name: 'Orientation',
        summary: 'Explains the fixture repository.',
        match: { include: ['README.md'] },
        sourceRefs: [{ path: 'README.md', line: 1 }],
        mitigates: [],
      },
    ],
    pitfalls: [{
      id: 'hallucinated-execution',
      name: 'Hallucinated execution',
      failure: 'A proposal is reported as if it ran.',
      sourceRefs: [{ path: 'src/main.mjs', line: 2 }],
    }],
    journeys: [{
      id: 'request-to-answer',
      name: 'Request to answer',
      summary: 'Follow the fixture request through execution.',
      sourceRefs: [{ path: 'README.md', line: 1 }],
      steps: [
        { id: 'orient', name: 'Orient', organIds: ['orientation'] },
        { id: 'execute', name: 'Execute', organIds: ['runtime'] },
      ],
    }],
  }, null, 2)}\n`)
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--ontology', ontologyPath,
  ], { cwd: projectRoot })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const ontology = JSON.parse(readFileSync(path.join(output, 'data', 'ontology.json'), 'utf8'))
  const components = JSON.parse(readFileSync(path.join(output, 'data', 'components.json'), 'utf8'))

  assert.equal(ontology.schemaVersion, 'arc-atlas-ontology-v1')
  assert.equal(ontology.authority, 'read-only-derived-projection')
  assert.match(ontology.sourceSha256, /^[a-f0-9]{64}$/)
  assert.equal(ontology.sourceReferences.total, 4)
  assert.equal(ontology.sourceReferences.resolved, 4)
  assert.equal(ontology.constitutionalKernels[0].id, 'truth')
  assert.equal(ontology.graphFacets[0].id, 'intent')
  assert.equal(ontology.membranes[0].id, 'authority')
  assert.deepEqual(ontology.proofLadder, ['exists', 'reachable', 'default-live', 'observed', 'causal', 'product-proven'])
  assert.equal(ontology.lenses[0].id, 'journey')
  assert.equal(components.length, 4)
  assert.equal(components.every(component => component.primaryOrganId), true)
  assert.deepEqual(
    Object.fromEntries(components.map(component => [component.path, component.primaryOrganId])),
    {
      'README.md': 'orientation',
      'src/main.mjs': 'runtime',
      'src/names.mjs': 'runtime',
      'src/tool.py': 'runtime',
    },
  )
  assert.equal(manifest.coverage.ontology.unclassifiedFiles, 0)
  assert.equal(manifest.completeness.ontology, 'source-addressed-and-file-complete')
})

test('atlas build refuses to call a source-cited wildcard-only ontology semantically complete', () => {
  const repository = makeFixtureRepository()
  const ontologyPath = path.join(mkdtempSync(path.join(tmpdir(), 'arc-atlas-empty-ontology-')), 'ontology.json')
  writeFileSync(ontologyPath, `${JSON.stringify({
    schemaVersion: 'arc-atlas-ontology-source-v1',
    title: 'Beautiful lie',
    northStar: 'Pretend everything is understood.',
    organs: [{
      id: 'everything',
      name: 'Everything',
      summary: 'A wildcard with no semantics.',
      match: { include: ['**'] },
      sourceRefs: [{ path: 'README.md', line: 1 }],
      mitigates: [],
    }],
    pitfalls: [{
      id: 'pretend',
      name: 'Pretend completeness',
      failure: 'A citation is used as semantic proof.',
      sourceRefs: [{ path: 'README.md', line: 1 }],
    }],
    journeys: [{
      id: 'pretend',
      name: 'Pretend journey',
      summary: 'A vacuous journey.',
      sourceRefs: [{ path: 'README.md', line: 1 }],
      steps: [{ id: 'all', name: 'Everything', organIds: ['everything'] }],
    }],
  }, null, 2)}\n`)
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--ontology', ontologyPath,
  ], { cwd: projectRoot })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const receipt = JSON.parse(readFileSync(path.join(output, 'data', 'completeness.json'), 'utf8'))
  assert.equal(receipt.gates.ontology.status, 'partial')
  assert.equal(receipt.gates.ontology.reason, 'visible-files-remain-only-fallback-classified')
  assert.equal(manifest.completeness.ontology, 'source-addressed-with-fallback-classification-gaps')
})

test('atlas build rejects a rehashed advisory graph from the wrong repository root', () => {
  const repository = makeFixtureRepository()
  const graphDb = path.join(mkdtempSync(path.join(tmpdir(), 'arc-atlas-hostile-graph-')), 'graph.db')
  const db = new DatabaseSync(graphDb)
  db.exec(`
    CREATE TABLE projects (name TEXT PRIMARY KEY, indexed_at TEXT, root_path TEXT);
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY, project TEXT, label TEXT, name TEXT,
      qualified_name TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, properties TEXT
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY, project TEXT, source_id INTEGER, target_id INTEGER, type TEXT, properties TEXT
    );
    CREATE TABLE file_hashes (
      project TEXT, rel_path TEXT, sha256 TEXT, mtime_ns INTEGER, size INTEGER,
      PRIMARY KEY (project, rel_path)
    );
  `)
  db.prepare('INSERT INTO projects VALUES (?, ?, ?)').run('fixture', '1999-01-01T00:00:00.000Z', '/wrong/repository')
  db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    1, 'fixture', 'Function', 'formatName', 'fixture.src.names.formatName',
    'src/names.mjs', 1, 1, '{}',
  )
  db.prepare('INSERT INTO file_hashes VALUES (?, ?, ?, ?, ?)').run(
    'fixture', 'unrelated.mjs', 'f'.repeat(64), 1, 1,
  )
  db.close()
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--graph-db', graphDb,
    '--graph-project', 'fixture',
  ], { cwd: projectRoot })

  const receipt = JSON.parse(readFileSync(path.join(output, 'data', 'completeness.json'), 'utf8'))
  assert.equal(receipt.sources.codeGraph.rootMatchesRepository, false)
  assert.equal(receipt.sources.codeGraph.fileHashes.total, 1)
  assert.equal(receipt.sources.codeGraph.fileHashes.matchedCurrent, 0)
  assert.equal(receipt.gates.codeGraphFreshness.status, 'fail')
  assert.equal(receipt.gates.codeGraphFreshness.reason, 'advisory-code-graph-root-mismatch')
})

test('atlas build rejects a graph symbol whose declared name is absent from its current source span', () => {
  const repository = makeFixtureRepository()
  const graphDb = path.join(mkdtempSync(path.join(tmpdir(), 'arc-atlas-stale-symbol-')), 'graph.db')
  const db = new DatabaseSync(graphDb)
  db.exec(`
    CREATE TABLE projects (name TEXT PRIMARY KEY, indexed_at TEXT, root_path TEXT);
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY, project TEXT, label TEXT, name TEXT,
      qualified_name TEXT, file_path TEXT, start_line INTEGER, end_line INTEGER, properties TEXT
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY, project TEXT, source_id INTEGER, target_id INTEGER, type TEXT, properties TEXT
    );
    CREATE TABLE file_hashes (
      project TEXT, rel_path TEXT, sha256 TEXT, mtime_ns INTEGER, size INTEGER,
      PRIMARY KEY (project, rel_path)
    );
  `)
  db.prepare('INSERT INTO projects VALUES (?, ?, ?)').run('fixture', '2026-08-15T00:00:00.000Z', repository)
  db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    1, 'fixture', 'Function', 'deleted_function', 'fixture.src.names.deleted_function',
    'src/names.mjs', 1, 1, '{}',
  )
  const namesBytes = readFileSync(path.join(repository, 'src/names.mjs'))
  db.prepare('INSERT INTO file_hashes VALUES (?, ?, ?, ?, ?)').run(
    'fixture', 'src/names.mjs', sha256(namesBytes), 1, namesBytes.length,
  )
  db.close()
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
    '--graph-db', graphDb,
    '--graph-project', 'fixture',
  ], { cwd: projectRoot })

  const receipt = JSON.parse(readFileSync(path.join(output, 'data', 'completeness.json'), 'utf8'))
  const symbols = readSymbols(output)
  assert.equal(receipt.sources.codeGraph.invalidSymbolNodes, 1)
  assert.equal(receipt.gates.codeGraphFreshness.status, 'fail')
  assert.equal(receipt.gates.codeGraphFreshness.reason, 'advisory-code-graph-symbol-source-binding-invalid')
  assert.equal(symbols.some(symbol => symbol.name === 'deleted_function'), false)
})

test('atlas build separates parser accounting from syntax and exact symbol completeness', () => {
  const repository = makeFixtureRepository()
  write('src/broken.mjs', 'export function broken( {\n', repository)
  write('src/native.rs', 'pub fn native_answer() -> i32 { 42 }\n', repository)
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  const manifest = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  const receipt = JSON.parse(readFileSync(path.join(output, 'data', 'completeness.json'), 'utf8'))
  assert.equal(receipt.gates.parserOutcomes.status, 'pass')
  assert.equal(receipt.denominators.parserOutcomes.byState['parsed-with-diagnostics'], 1)
  assert.equal(receipt.gates.syntaxHealth.status, 'fail')
  assert.ok(receipt.denominators.syntaxDiagnostics > 0)
  assert.equal(receipt.denominators.codeFiles.nativeParserMissing, 1)
  assert.deepEqual(receipt.denominators.codeFiles.nativeParserMissingByLanguage, { Rust: 1 })
  assert.equal(receipt.gates.symbolDenominator.status, 'partial')
  assert.equal(receipt.gates.symbolDenominator.reason, 'native-parser-coverage-incomplete')
  assert.equal(manifest.completeness.symbols, 'incomplete-exact-denominator')
})

test('atlas build is content-stable when its output directory lives inside the repository', () => {
  const repository = makeFixtureRepository()
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })
  const first = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })
  const second = JSON.parse(readFileSync(path.join(output, 'manifest.json'), 'utf8'))

  assert.equal(second.snapshot.snapshotSha256, first.snapshot.snapshotSha256)
  assert.equal(second.snapshot.git.statusSha256, first.snapshot.git.statusSha256)
  assert.equal(second.coverage.files.visible, first.coverage.files.visible)
})

test('atlas build records a tracked deletion and still emits a fail-closed receipt', () => {
  const repository = makeFixtureRepository()
  unlinkSync(path.join(repository, 'src/names.mjs'))
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  const files = JSON.parse(readFileSync(path.join(output, 'data', 'files.json'), 'utf8'))
  const receipt = JSON.parse(readFileSync(path.join(output, 'data', 'completeness.json'), 'utf8'))
  const missing = files.find(file => file.path === 'src/names.mjs')
  assert.equal(missing.fileClass, 'missing')
  assert.equal(missing.sha256, null)
  assert.equal(missing.parser.state, 'missing')
  assert.equal(receipt.denominators.files.missing, 1)
  assert.equal(receipt.gates.fileDenominator.status, 'pass')
  assert.equal(receipt.gates.filePresence.status, 'fail')
  assert.equal(receipt.gates.filePresence.reason, 'tracked-or-visible-entries-missing-from-worktree')
})

test('atlas packet rejects tampered artifacts, refuses unproven current mode, and keeps historical source bytes explicit', () => {
  const repository = makeFixtureRepository()
  const tamperedOutput = path.join(repository, '.atlas-tampered')
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', tamperedOutput], {
    cwd: projectRoot,
  })
  const symbolsPath = path.join(tamperedOutput, 'data', 'symbols.json')
  const symbolManifest = JSON.parse(readFileSync(symbolsPath, 'utf8'))
  const targetShard = symbolManifest.sequence.shards.find(shard => {
    const symbols = readJsonArtifact({ root: tamperedOutput, descriptor: shard })
    return symbols.some(symbol => symbol.name === 'calculate_answer')
  })
  const targetPath = path.join(tamperedOutput, targetShard.path)
  const physical = readFileSync(targetPath)
  writeFileSync(targetPath, Buffer.concat([physical.subarray(0, -1), Buffer.from([physical.at(-1) ^ 1])]))

  assert.throws(() => execFileSync(process.execPath, [
    atlasCli,
    'packet',
    '--snapshot', tamperedOutput,
    '--query', 'calculate_answer',
    '--format', 'json',
  ], { cwd: projectRoot, stdio: 'pipe' }), /atlas artifact physical digest mismatch: data\/symbols\/000000\.json\.br/)

  const driftOutput = path.join(repository, '.atlas-drift')
  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', driftOutput], {
    cwd: projectRoot,
  })
  write('src/tool.py', 'def calculate_answer(value: int) -> int:\n    return value * 999\n', repository)
  assert.throws(() => execFileSync(process.execPath, [
    atlasCli,
    'packet',
    '--snapshot', driftOutput,
    '--query', 'calculate_answer',
    '--format', 'json',
  ], { cwd: projectRoot, stdio: 'pipe' }), /atlas current-serving requires a fresh closed build basis; use mode: 'historical'/)
  const historical = JSON.parse(execFileSync(process.execPath, [
    atlasCli,
    'packet',
    '--snapshot', driftOutput,
    '--query', 'calculate_answer',
    '--mode', 'historical',
    '--format', 'json',
  ], { cwd: projectRoot, encoding: 'utf8' }))
  assert.equal(historical.matches[0].source.sourceState, 'snapshot-captured-source-file')
  assert.equal(historical.matches[0].source.absolutePath, null)
  assert.match(historical.matches[0].source.excerpt, /return value \* 2/)
})

test('atlas build turns a native parser crash into a typed incomplete receipt', () => {
  const repository = makeFixtureRepository()
  write('src/invalid.py', 'def impossible(:\n    pass\n', repository)
  const output = path.join(repository, '.atlas-output')

  execFileSync(process.execPath, [atlasCli, 'build', '--repo', repository, '--out', output], {
    cwd: projectRoot,
  })

  const files = JSON.parse(readFileSync(path.join(output, 'data', 'files.json'), 'utf8'))
  const receipt = JSON.parse(readFileSync(path.join(output, 'data', 'completeness.json'), 'utf8'))
  const invalid = files.find(file => file.path === 'src/invalid.py')
  assert.equal(invalid.parser.state, 'error')
  assert.equal(invalid.parser.adapter, 'python-ast')
  assert.ok(invalid.parser.diagnostics.length > 0)
  assert.equal(receipt.denominators.parserOutcomes.byState.error, 1)
  assert.equal(receipt.gates.parserOutcomes.status, 'pass')
  assert.equal(receipt.gates.syntaxHealth.status, 'fail')
  assert.equal(receipt.gates.symbolDenominator.status, 'fail')
  assert.equal(receipt.gates.symbolDenominator.reason, 'native-parser-errors-present')
})

test('atlas build refuses an output directory that could overwrite the source repository', () => {
  const repository = makeFixtureRepository()
  assert.throws(() => execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', repository,
  ], { cwd: projectRoot, stdio: 'pipe' }), /atlas output must be a strict descendant or external directory, never the repository root or its ancestor/)
  assert.equal(readFileSync(path.join(repository, 'README.md'), 'utf8'), '# Fixture\n')
})

test('atlas build CLI reports incomplete whenever any corpus truth gate is not pass', () => {
  const repository = makeFixtureRepository()
  const output = path.join(repository, '.atlas-output')
  const result = JSON.parse(execFileSync(process.execPath, [
    atlasCli,
    'build',
    '--repo', repository,
    '--out', output,
  ], { cwd: projectRoot, encoding: 'utf8' }))

  assert.equal(result.status, 'built-incomplete')
  assert.ok(!result.blockingGates.includes('semanticPurpose'))
  assert.ok(result.blockingGates.includes('ontology'))
  assert.ok(result.blockingGates.includes('codeGraphFreshness'))
  assert.equal(result.blockingGates.includes('productProof'), false)
})
