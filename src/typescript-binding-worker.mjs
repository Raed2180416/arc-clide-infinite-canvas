import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { compileTypescriptBindingObservations } from './typescript-binding-adapter.mjs'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function readShards(descriptors) {
  const values = []
  for (const descriptor of descriptors) {
    const bytes = readFileSync(descriptor.path)
    if (bytes.length !== descriptor.bytes || sha256(bytes) !== descriptor.sha256) {
      throw new Error(`TypeScript binding worker input shard drifted: ${descriptor.path}`)
    }
    const shard = JSON.parse(bytes)
    if (!Array.isArray(shard) || shard.length !== descriptor.count) {
      throw new Error(`TypeScript binding worker input shard has the wrong denominator: ${descriptor.path}`)
    }
    values.push(...shard)
  }
  return values
}

const [manifestPath, outputPath] = process.argv.slice(2)
if (!manifestPath || !outputPath) throw new Error('TypeScript binding worker requires input manifest and output paths')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.schemaVersion !== 'arc-atlas-typescript-binding-worker-input-v1') {
  throw new Error('TypeScript binding worker input schema is unsupported')
}
const rootPaths = new Set(manifest.rootPaths || [])
if (rootPaths.size === 0) throw new Error('TypeScript binding worker requires a non-empty bounded root denominator')
const files = readShards(manifest.files).filter(file => rootPaths.has(file.path))
const referenceSites = readShards(manifest.referenceSites).filter(reference => rootPaths.has(reference.path))
if (files.length !== rootPaths.size) throw new Error('TypeScript binding worker root denominator does not match its exact files')
const result = compileTypescriptBindingObservations({
  repository: manifest.repository,
  files,
  symbols: readShards(manifest.symbols),
  referenceSites,
})
writeFileSync(outputPath, JSON.stringify(result))
