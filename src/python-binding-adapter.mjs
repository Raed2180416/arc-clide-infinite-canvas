import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PYTHON_EXTENSIONS = new Set(['.py', '.pyi'])

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

function callableReferenceSite(reference) {
  return reference.roles?.some(role => ['call', 'construct'].includes(role))
    || ['call-site', 'construction-site'].includes(reference.kind)
}

export function compilePythonBindingObservations({ repository, files, symbols, referenceSites }) {
  const sourceFilePaths = new Set(files
    .filter(file => file.fileClass === 'regular' && PYTHON_EXTENSIONS.has(path.extname(file.path).toLowerCase()))
    .map(file => file.path))
  const pythonReferences = referenceSites.filter(reference => sourceFilePaths.has(reference.path) && callableReferenceSite(reference))
  const pythonSymbols = symbols.filter(symbol => symbol.derivation?.adapter === 'python-ast')
  if (pythonReferences.length === 0) {
    return {
      schemaVersion: 'arc-atlas-python-binding-observation-v1',
      source: { state: 'not-applicable', authority: 'none', compilerPackage: 'python', compilerVersion: 'ast' },
      observations: [],
      externalEntities: [],
    }
  }
  const workRoot = mkdtempSync(path.join(tmpdir(), 'arc-atlas-python-binding-'))
  try {
    const manifest = {
      schemaVersion: 'arc-atlas-python-binding-worker-input-v1',
      repository: path.resolve(repository),
      referenceSites: pythonReferences.map(reference => ({
        id: reference.id,
        path: reference.path,
        sourceSha256: reference.sourceSha256,
        spelling: reference.spelling || null,
      })),
      symbols: pythonSymbols.map(symbol => ({
        id: symbol.id,
        path: symbol.path,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        start: symbol.start,
        end: symbol.end,
        bodySha256: symbol.bodySha256,
        derivation: { adapter: symbol.derivation.adapter },
      })),
    }
    const manifestPath = path.join(workRoot, 'manifest.json')
    const outputPath = path.join(workRoot, 'output.json')
    writeFileSync(manifestPath, Buffer.from(JSON.stringify(manifest)))
    const workerPath = fileURLToPath(new URL('./python-binding-worker.py', import.meta.url))
    execFileSync('python3', [workerPath, manifestPath, outputPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const result = JSON.parse(readFileSync(outputPath, 'utf8'))
    if (result?.schemaVersion !== 'arc-atlas-python-binding-observation-v1') {
      throw new Error('Python binding worker returned an unsupported observation schema')
    }
    if (result.observations.length !== pythonReferences.length) {
      throw new Error(`Python binding worker denominator mismatch: expected ${pythonReferences.length}, observed ${result.observations.length}`)
    }
    const observedIds = new Set(result.observations.map(observation => observation.referenceSiteId))
    for (const reference of pythonReferences) {
      if (!observedIds.has(reference.id)) {
        throw new Error(`Python binding worker omitted a reference site: ${reference.id}`)
      }
    }
    return {
      ...result,
      source: {
        ...result.source,
        inputFileSetSha256: sha256(canonicalJson(pythonReferences.map(reference => ({ path: reference.path, sourceSha256: reference.sourceSha256 })))),
        executionIsolation: 'separate-process-bounded-projection-v1',
        workerScriptSha256: sha256(readFileSync(workerPath)),
        workerInputProjectionSha256: sha256(canonicalJson(manifest)),
        workerInputDenominator: {
          files: sourceFilePaths.size,
          symbols: pythonSymbols.length,
          referenceSites: pythonReferences.length,
        },
      },
    }
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }
}