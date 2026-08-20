#!/usr/bin/env node

import path from 'node:path'
import { buildAgentPacket, buildAtlasSnapshot } from '../src/atlas-core.mjs'
import { createAtlasServer } from '../src/atlas-server.mjs'

function option(args, name, fallback = null) {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

function options(args, name) {
  const values = []
  for (let index = 0; index < args.length; index += 1) if (args[index] === name && args[index + 1]) values.push(...args[index + 1].split(',').filter(Boolean))
  return values
}

function usage() {
  return [
    'Usage:',
    '  atlas build --repo <repository> --out <snapshot-directory> [--build-inputs <json>] [--graph-db <sqlite> --graph-project <name>] [--ontology <json> --component-reviews <json[,json...]>] [--transcript <rollout.jsonl> --transcript-reviews <json>] [--scope-policies <json>] [--document-policies <json>] [--language-parsers <json>]',
    "  atlas packet --snapshot <snapshot-directory> --query <text> [--mode current|historical] [--format json]",
    "  atlas browse --snapshot <snapshot-directory> [--mode current|historical] [--web <built-web-directory>] [--host 127.0.0.1] [--port 4317]",
  ].join('\n')
}

const [command, ...args] = process.argv.slice(2)

if (command === 'build') {
  const repoRoot = option(args, '--repo')
  const outputRoot = option(args, '--out')
  const graphDbPath = option(args, '--graph-db')
  const graphProject = option(args, '--graph-project')
  const buildInputManifestPath = option(args, '--build-inputs')
  const ontologyPath = option(args, '--ontology')
  const componentReviewPaths = options(args, '--component-reviews')
  const transcriptPath = option(args, '--transcript')
  const transcriptReviewPath = option(args, '--transcript-reviews')
  const scopePolicyPath = option(args, '--scope-policies')
  const documentPolicyPath = option(args, '--document-policies')
  const languageParserPolicyPath = option(args, '--language-parsers')
  if (!repoRoot || !outputRoot) throw new Error(usage())
  const manifest = buildAtlasSnapshot({ repoRoot, outputRoot, buildInputManifestPath, graphDbPath, graphProject, ontologyPath, componentReviewPaths, transcriptPath, transcriptReviewPath, scopePolicyPath, documentPolicyPath, languageParserPolicyPath })
  const blockingGates = Object.entries(manifest.gates || {})
    .filter(([name, gate]) => name !== 'productProof' && gate.status !== 'pass')
    .map(([name]) => name)
  process.stdout.write(`${JSON.stringify({
    status: blockingGates.length ? 'built-incomplete' : 'built-complete',
    blockingGates,
    snapshotSha256: manifest.snapshot.snapshotSha256,
    files: manifest.coverage.files,
    symbols: manifest.coverage.symbols,
    output: path.resolve(outputRoot),
  })}\n`)
} else if (command === 'packet') {
  const snapshotRoot = option(args, '--snapshot')
  const query = option(args, '--query')
  const format = option(args, '--format', 'json')
  const mode = option(args, '--mode', 'current')
  if (!snapshotRoot || !query || format !== 'json' || !['current', 'historical'].includes(mode)) throw new Error(usage())
  process.stdout.write(`${JSON.stringify(buildAgentPacket({ snapshotRoot, query, mode }), null, 2)}\n`)
} else if (command === 'browse') {
  const snapshotRoot = option(args, '--snapshot')
  const webRoot = option(args, '--web', path.resolve(import.meta.dirname, '..', 'dist'))
  const host = option(args, '--host', '127.0.0.1')
  const port = Number(option(args, '--port', '4317'))
  const mode = option(args, '--mode', 'current')
  if (!snapshotRoot || !Number.isInteger(port) || port < 0 || port > 65535 || !['current', 'historical'].includes(mode)) throw new Error(usage())
  const server = createAtlasServer({ snapshotRoot, webRoot, mode })
  server.listen(port, host, () => {
    const address = server.address()
    const observedPort = typeof address === 'object' && address ? address.port : port
    process.stdout.write(`${JSON.stringify({ status: mode === 'current' ? 'serving-current-verified-snapshot' : 'serving-historical-snapshot', servingMode: mode, origin: `http://${host}:${observedPort}`, snapshot: path.resolve(snapshotRoot), web: path.resolve(webRoot) })}\n`)
  })
  const stop = () => server.close(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
} else {
  process.stderr.write(`${usage()}\n`)
  process.exitCode = 2
}
