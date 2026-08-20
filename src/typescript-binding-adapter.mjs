import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])

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

function normalizeRelative(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '')
}

function relativeIfInside(root, candidate) {
  const relative = path.relative(root, candidate)
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return normalizeRelative(relative)
}

function point(sourceFile, position) {
  const observed = sourceFile.getLineAndCharacterOfPosition(position)
  return { line: observed.line + 1, column: observed.character + 1 }
}

function comparePoint(left, right) {
  return left.line - right.line || left.column - right.column
}

function overlaps(left, right) {
  return comparePoint(left.start, right.end) <= 0 && comparePoint(left.end, right.start) >= 0
}

function referenceKey(pathValue, kind, start, end, sourceSha256) {
  return `${pathValue}\0${kind}\0${start.line}\0${start.column}\0${end.line}\0${end.column}\0${sourceSha256}`
}

function declarationName(declaration, compilerSymbol) {
  if (declaration?.name && typeof declaration.name.getText === 'function') return declaration.name.getText()
  return compilerSymbol?.getName?.() || null
}

function exactSymbolForDeclaration({ repository, declaration, compilerSymbol, symbolsByPath }) {
  const sourceFile = declaration.getSourceFile()
  const relative = relativeIfInside(repository, sourceFile.fileName)
  if (relative === null) return null
  const name = declarationName(declaration, compilerSymbol)
  const declarationSpan = {
    start: point(sourceFile, declaration.getStart(sourceFile)),
    end: point(sourceFile, declaration.getEnd()),
  }
  const declarationBodySha256 = sha256(sourceFile.text.slice(declaration.getStart(sourceFile), declaration.getEnd()))
  const exactOccurrence = (symbolsByPath.get(relative) || []).filter(symbol => symbol.start.line === declarationSpan.start.line
    && symbol.start.column === declarationSpan.start.column
    && symbol.end.line === declarationSpan.end.line
    && symbol.end.column === declarationSpan.end.column
    && symbol.bodySha256 === declarationBodySha256)
  if (exactOccurrence.length === 1) return exactOccurrence[0]
  if (exactOccurrence.length > 1) return null
  const candidates = (symbolsByPath.get(relative) || [])
    .filter(symbol => !name || symbol.name === name || symbol.name === name.replace(/^['"]|['"]$/g, ''))
    .filter(symbol => overlaps(symbol, declarationSpan))
    .sort((left, right) => {
      const leftDistance = Math.abs(left.start.line - declarationSpan.start.line) * 1_000_000
        + Math.abs(left.start.column - declarationSpan.start.column)
      const rightDistance = Math.abs(right.start.line - declarationSpan.start.line) * 1_000_000
        + Math.abs(right.start.column - declarationSpan.start.column)
      return leftDistance - rightDistance || left.id.localeCompare(right.id)
    })
  if (candidates.length === 0) return null
  if (candidates.length > 1) {
    const firstDistance = Math.abs(candidates[0].start.line - declarationSpan.start.line) * 1_000_000
      + Math.abs(candidates[0].start.column - declarationSpan.start.column)
    const secondDistance = Math.abs(candidates[1].start.line - declarationSpan.start.line) * 1_000_000
      + Math.abs(candidates[1].start.column - declarationSpan.start.column)
    if (firstDistance === secondDistance) return null
  }
  return candidates[0]
}

function compilerSymbolForCall(checker, node) {
  const signature = checker.getResolvedSignature(node)
  const declaration = signature?.getDeclaration?.() || null
  if (declaration) return { declaration, compilerSymbol: declaration.symbol || null }
  const target = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression
  let compilerSymbol = checker.getSymbolAtLocation(target) || null
  if (compilerSymbol && (compilerSymbol.flags & ts.SymbolFlags.Alias)) {
    try { compilerSymbol = checker.getAliasedSymbol(compilerSymbol) } catch {}
  }
  return { declaration: compilerSymbol?.declarations?.[0] || null, compilerSymbol }
}

function externalEntity({ declaration, compilerSymbol }) {
  const sourceFile = declaration.getSourceFile()
  const sourceBytes = readFileSync(sourceFile.fileName)
  const start = point(sourceFile, declaration.getStart(sourceFile))
  const end = point(sourceFile, declaration.getEnd())
  const name = declarationName(declaration, compilerSymbol) || '<compiler-symbol>'
  const body = sourceFile.text.slice(declaration.getStart(sourceFile), declaration.getEnd())
  return {
    id: `external-compiler-symbol:${sha256(`${sourceFile.fileName}\0${name}\0${start.line}\0${start.column}\0${sha256(body)}`)}`,
    kind: 'external-compiler-symbol',
    name,
    declarationFile: sourceFile.fileName,
    declarationFileSha256: sha256(sourceBytes),
    start,
    end,
    declarationSha256: sha256(body),
    authority: 'typescript-compiler-declaration-observation-outside-repository',
  }
}

function compilerOptions() {
  return {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    types: ['node'],
  }
}

function callableReferenceSite(reference) {
  return reference.roles?.some(role => ['call', 'construct'].includes(role))
    || ['call-site', 'construction-site'].includes(reference.kind)
}

export function compileTypescriptBindingObservations({ repository, files, symbols, referenceSites }) {
  const sourceFiles = files.filter(file => file.fileClass === 'regular' && JAVASCRIPT_EXTENSIONS.has(path.extname(file.path).toLowerCase()))
  const sourceFilePaths = new Set(sourceFiles.map(file => file.path))
  const referencesByKey = new Map()
  for (const reference of referenceSites.filter(reference => sourceFilePaths.has(reference.path) && callableReferenceSite(reference))) {
    const key = referenceKey(reference.path, reference.kind === 'construction-site' ? 'construct' : 'call', reference.start, reference.end, reference.sourceSha256)
    if (!referencesByKey.has(key)) referencesByKey.set(key, [])
    referencesByKey.get(key).push(reference)
  }
  if (sourceFiles.length === 0) {
    return {
      schemaVersion: 'arc-atlas-typescript-binding-observation-v1',
      source: { state: 'not-applicable', authority: 'none', compilerVersion: ts.version },
      observations: [],
      externalEntities: [],
    }
  }
  const repositoryRoot = path.resolve(repository)
  for (const file of sourceFiles) {
    const observed = sha256(readFileSync(path.join(repositoryRoot, file.path)))
    if (observed !== file.sha256) throw new Error(`TypeScript binding input drifted: ${file.path}`)
  }
  const options = compilerOptions()
  const program = ts.createProgram({
    rootNames: sourceFiles.map(file => path.join(repositoryRoot, file.path)),
    options,
  })
  const checker = program.getTypeChecker()
  const symbolsByPath = new Map()
  for (const symbol of symbols.filter(symbol => ['typescript-ast'].includes(symbol.derivation?.adapter))) {
    if (!symbolsByPath.has(symbol.path)) symbolsByPath.set(symbol.path, [])
    symbolsByPath.get(symbol.path).push(symbol)
  }
  const observations = new Map()
  const externalEntities = new Map()
  const compilerNodesByKey = new Map()
  for (const sourceFile of program.getSourceFiles()) {
    const relative = relativeIfInside(repositoryRoot, sourceFile.fileName)
    if (relative === null || !sourceFilePaths.has(relative)) continue
    function visit(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const kind = ts.isNewExpression(node) ? 'construct' : 'call'
        const start = point(sourceFile, node.getStart(sourceFile))
        const end = point(sourceFile, node.getEnd())
        const nodeSourceSha256 = sha256(node.getText(sourceFile))
        const key = referenceKey(relative, kind, start, end, nodeSourceSha256)
        const references = referencesByKey.get(key) || []
        if (references.length > 0) {
          const compilerNodeCount = (compilerNodesByKey.get(key) || 0) + 1
          compilerNodesByKey.set(key, compilerNodeCount)
          if (references.length !== 1 || compilerNodeCount !== 1) {
            for (const reference of references) {
              observations.set(reference.id, {
                referenceSiteId: reference.id,
                referenceSourceSha256: reference.sourceSha256,
                state: 'unresolved-non-unique-exact-occurrence-join',
                targetId: null,
                reason: 'reference-site-and-compiler-node-did-not-form-one-one-exact-span-and-source-digest-join',
              })
            }
            ts.forEachChild(node, visit)
            return
          }
          const { declaration, compilerSymbol } = compilerSymbolForCall(checker, node)
          let resolution
          if (!declaration) {
            resolution = {
              state: 'unresolved-compiler-no-declaration',
              targetId: null,
              reason: 'typescript-compiler-produced-no-callable-declaration',
            }
          } else {
            const declarationFile = declaration.getSourceFile().fileName
            const declarationRelative = relativeIfInside(repositoryRoot, declarationFile)
            const internal = exactSymbolForDeclaration({ repository: repositoryRoot, declaration, compilerSymbol, symbolsByPath })
            if (internal) {
              resolution = {
                state: 'resolved-internal-compiler-binding',
                targetId: internal.id,
                reason: 'typescript-compiler-resolved-to-current-exact-parser-entity',
              }
            } else if (declarationRelative === null) {
              const external = externalEntity({ declaration, compilerSymbol })
              externalEntities.set(external.id, external)
              resolution = {
                state: 'resolved-external-compiler-binding',
                targetId: external.id,
                reason: 'typescript-compiler-resolved-to-content-addressed-declaration-outside-repository',
              }
            } else {
              resolution = {
                state: 'unresolved-internal-declaration-not-in-exact-parser-denominator',
                targetId: null,
                reason: 'typescript-compiler-declaration-did-not-join-one-current-exact-parser-entity',
              }
            }
          }
          for (const reference of references) {
            observations.set(reference.id, {
              referenceSiteId: reference.id,
              referenceSourceSha256: reference.sourceSha256,
              ...resolution,
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  for (const references of referencesByKey.values()) {
    for (const reference of references) {
      if (observations.has(reference.id)) continue
      observations.set(reference.id, {
        referenceSiteId: reference.id,
        referenceSourceSha256: reference.sourceSha256,
        state: 'unresolved-no-corresponding-compiler-call-node',
        targetId: null,
        reason: 'exact-syntax-reference-site-did-not-join-the-typescript-program',
      })
    }
  }
  const optionsProjection = {
    allowJs: options.allowJs,
    checkJs: options.checkJs,
    noEmit: options.noEmit,
    skipLibCheck: options.skipLibCheck,
    target: 'ESNext',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    allowImportingTsExtensions: options.allowImportingTsExtensions,
    resolveJsonModule: options.resolveJsonModule,
    types: ['node'],
  }
  return {
    schemaVersion: 'arc-atlas-typescript-binding-observation-v1',
    source: {
      state: 'observed',
      authority: 'typescript-compiler-observation-under-explicit-atlas-config',
      compilerPackage: 'typescript',
      compilerVersion: ts.version,
      compilerOptions: optionsProjection,
      compilerOptionsSha256: sha256(canonicalJson(optionsProjection)),
      inputFileSetSha256: sha256(canonicalJson(sourceFiles.map(file => ({ path: file.path, sha256: file.sha256 })))),
      inputFiles: sourceFiles.length,
      referenceSites: [...referencesByKey.values()].reduce((total, references) => total + references.length, 0),
      uniqueCompilerLocations: referencesByKey.size,
      occurrenceIdentity: 'path-kind-start-end-source-sha256-v1',
    },
    observations: [...observations.values()].sort((left, right) => left.referenceSiteId.localeCompare(right.referenceSiteId)),
    externalEntities: [...externalEntities.values()].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function writeProjectedShards(root, name, values, project) {
  const descriptors = []
  let pending = []
  const flush = () => {
    if (pending.length === 0) return
    const bytes = Buffer.from(JSON.stringify(pending))
    const absolute = path.join(root, `${name}-${String(descriptors.length).padStart(6, '0')}.json`)
    writeFileSync(absolute, bytes)
    descriptors.push({ path: absolute, count: pending.length, bytes: bytes.length, sha256: sha256(bytes) })
    pending = []
  }
  for (const value of values) {
    const projected = project(value)
    if (projected === null) continue
    pending.push(projected)
    if (pending.length >= 5_000) flush()
  }
  flush()
  return descriptors
}

export function compileTypescriptBindingObservationsIsolated({ repository, files, symbols, referenceSites }) {
  const sourceFilePaths = new Set(files
    .filter(file => file.fileClass === 'regular' && JAVASCRIPT_EXTENSIONS.has(path.extname(file.path).toLowerCase()))
    .map(file => file.path))
  if (sourceFilePaths.size === 0) {
    const result = compileTypescriptBindingObservations({ repository, files, symbols, referenceSites })
    result.source.executionIsolation = 'separate-process-bounded-projection-v1'
    return result
  }
  const workRoot = mkdtempSync(path.join(tmpdir(), 'arc-atlas-typescript-binding-'))
  try {
    const fileShards = writeProjectedShards(workRoot, 'files', files, file => sourceFilePaths.has(file.path)
      ? { path: file.path, fileClass: file.fileClass, sha256: file.sha256 }
      : null)
    const symbolShards = writeProjectedShards(workRoot, 'symbols', symbols, symbol => symbol.derivation?.adapter === 'typescript-ast'
      ? { id: symbol.id, path: symbol.path, name: symbol.name, start: symbol.start, end: symbol.end, bodySha256: symbol.bodySha256, derivation: { adapter: symbol.derivation.adapter } }
      : null)
    const referenceShards = writeProjectedShards(workRoot, 'reference-sites', referenceSites, reference => sourceFilePaths.has(reference.path) && callableReferenceSite(reference)
      ? {
        id: reference.id,
        kind: reference.kind,
        roles: reference.roles,
        sourceSymbolId: reference.sourceSymbolId,
        path: reference.path,
        start: reference.start,
        end: reference.end,
        sourceSha256: reference.sourceSha256,
      }
      : null)
    const bindingRootPaths = [...new Set(referenceSites
      .filter(reference => sourceFilePaths.has(reference.path) && callableReferenceSite(reference))
      .map(reference => reference.path))].sort()
    if (bindingRootPaths.length === 0) {
      const result = compileTypescriptBindingObservations({ repository, files: [], symbols: [], referenceSites: [] })
      result.source.executionIsolation = 'separate-process-bounded-projection-v1'
      result.source.partitioning = { strategy: 'sorted-root-batches-v1', maxRootFiles: 32, batches: 0 }
      return result
    }
    const baseManifest = {
      schemaVersion: 'arc-atlas-typescript-binding-worker-input-v1',
      repository: path.resolve(repository),
      files: fileShards,
      symbols: symbolShards,
      referenceSites: referenceShards,
    }
    const logicalShardDescriptors = descriptors => descriptors.map(({ path: _ephemeralPath, ...descriptor }) => descriptor)
    const logicalBaseManifest = {
      ...baseManifest,
      files: logicalShardDescriptors(fileShards),
      symbols: logicalShardDescriptors(symbolShards),
      referenceSites: logicalShardDescriptors(referenceShards),
    }
    const workerPath = fileURLToPath(new URL('./typescript-binding-worker.mjs', import.meta.url))
    const observations = new Map()
    const externalEntities = new Map()
    const batchReceipts = []
    let source = null
    const maxRootFiles = 32
    for (let start = 0; start < bindingRootPaths.length; start += maxRootFiles) {
      const rootPaths = bindingRootPaths.slice(start, start + maxRootFiles)
      const batchNumber = start / maxRootFiles
      const manifest = { ...baseManifest, rootPaths }
      const manifestBytes = Buffer.from(JSON.stringify(manifest))
      const manifestPath = path.join(workRoot, `manifest-${String(batchNumber).padStart(6, '0')}.json`)
      const outputPath = path.join(workRoot, `output-${String(batchNumber).padStart(6, '0')}.json`)
      writeFileSync(manifestPath, manifestBytes)
      execFileSync(process.execPath, [workerPath, manifestPath, outputPath], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
      const outputBytes = readFileSync(outputPath)
      const result = JSON.parse(outputBytes)
      if (result?.schemaVersion !== 'arc-atlas-typescript-binding-observation-v1') {
        throw new Error('TypeScript binding worker returned an unsupported observation schema')
      }
      source ||= result.source
      for (const observation of result.observations) {
        if (observations.has(observation.referenceSiteId)) {
          throw new Error(`TypeScript binding workers repeated one reference-site observation: ${observation.referenceSiteId}`)
        }
        observations.set(observation.referenceSiteId, observation)
      }
      for (const entity of result.externalEntities) externalEntities.set(entity.id, entity)
      batchReceipts.push({
        batch: batchNumber,
        rootFileSetSha256: sha256(canonicalJson(rootPaths)),
        rootFiles: rootPaths.length,
        observations: result.observations.length,
        manifestSha256: sha256(canonicalJson({ ...logicalBaseManifest, rootPaths })),
        outputSha256: sha256(outputBytes),
      })
    }
    const expectedReferenceSites = referenceSites.filter(reference => sourceFilePaths.has(reference.path) && callableReferenceSite(reference)).length
    if (observations.size !== expectedReferenceSites) {
      throw new Error(`TypeScript binding worker denominator mismatch: expected ${expectedReferenceSites}, observed ${observations.size}`)
    }
    const inputFileSet = bindingRootPaths.map(relative => ({
      path: relative,
      sha256: files.find(file => file.path === relative)?.sha256 || null,
    }))
    return {
      schemaVersion: 'arc-atlas-typescript-binding-observation-v1',
      source: {
        ...source,
        inputFileSetSha256: sha256(canonicalJson(inputFileSet)),
        inputFiles: bindingRootPaths.length,
        referenceSites: expectedReferenceSites,
        executionIsolation: 'separate-process-bounded-projection-v1',
        partitioning: {
          strategy: 'sorted-root-batches-v1',
          maxRootFiles,
          batches: batchReceipts.length,
          batchReceiptSetSha256: sha256(canonicalJson(batchReceipts)),
        },
        workerScriptSha256: sha256(readFileSync(workerPath)),
        workerInputProjectionSha256: sha256(canonicalJson(logicalBaseManifest)),
        workerInputDenominator: {
          files: fileShards.reduce((total, shard) => total + shard.count, 0),
          symbols: symbolShards.reduce((total, shard) => total + shard.count, 0),
          referenceSites: referenceShards.reduce((total, shard) => total + shard.count, 0),
        },
      },
      observations: [...observations.values()].sort((left, right) => left.referenceSiteId.localeCompare(right.referenceSiteId)),
      externalEntities: [...externalEntities.values()].sort((left, right) => left.id.localeCompare(right.id)),
    }
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }
}
