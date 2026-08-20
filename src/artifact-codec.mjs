import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function artifactPath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) {
    throw new Error('atlas artifact path must be one non-empty relative path')
  }
  const normalized = path.posix.normalize(relative.replaceAll(path.sep, '/'))
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('atlas artifact path escapes its root')
  const absolute = path.resolve(root, normalized)
  const containment = path.relative(path.resolve(root), absolute)
  if (!containment || containment === '.' || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
    throw new Error('atlas artifact path must name a file below its root')
  }
  return { absolute, relative: normalized }
}

export function writeBinaryArtifact({ root, path: logicalPath, bytes: decodedInput, contentEncoding = null, mediaType = 'application/octet-stream' }) {
  const decoded = Buffer.from(decodedInput)
  if (![null, 'br'].includes(contentEncoding)) throw new Error('atlas artifact content encoding is unsupported')
  const physical = contentEncoding === 'br'
    ? brotliCompressSync(decoded, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: decoded.length,
      },
    })
    : decoded
  const physicalPath = contentEncoding === 'br' ? `${logicalPath}.br` : logicalPath
  const target = artifactPath(root, physicalPath)
  mkdirSync(path.dirname(target.absolute), { recursive: true })
  writeFileSync(target.absolute, physical)
  return {
    path: target.relative,
    bytes: physical.length,
    sha256: sha256(physical),
    contentEncoding,
    decodedBytes: decoded.length,
    decodedSha256: sha256(decoded),
    mediaType,
  }
}

export function writeJsonArtifact({ root, path: logicalPath, value, contentEncoding = null }) {
  return writeBinaryArtifact({
    root,
    path: logicalPath,
    bytes: Buffer.from(`${JSON.stringify(value)}\n`),
    contentEncoding,
    mediaType: 'application/json',
  })
}

export function describeUnencodedArtifact({ root, path: relativePath, mediaType = 'application/octet-stream' }) {
  const target = artifactPath(root, relativePath)
  const size = statSync(target.absolute).size
  const digest = createHash('sha256')
  const handle = openSync(target.absolute, 'r')
  const chunk = Buffer.allocUnsafe(1024 * 1024)
  try {
    let offset = 0
    while (offset < size) {
      const bytesRead = readSync(handle, chunk, 0, Math.min(chunk.length, size - offset), offset)
      if (bytesRead === 0) throw new Error(`atlas artifact ended before its physical byte denominator: ${relativePath}`)
      digest.update(chunk.subarray(0, bytesRead))
      offset += bytesRead
    }
  } finally {
    closeSync(handle)
  }
  const observedSha256 = digest.digest('hex')
  return {
    path: target.relative,
    bytes: size,
    sha256: observedSha256,
    contentEncoding: null,
    decodedBytes: size,
    decodedSha256: observedSha256,
    mediaType,
  }
}

export function readArtifactBytes({ root, descriptor }) {
  if (!descriptor || typeof descriptor.path !== 'string' || !Number.isInteger(descriptor.bytes)
    || typeof descriptor.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) {
    throw new Error('atlas artifact descriptor is invalid')
  }
  const target = artifactPath(root, descriptor.path)
  const physical = readFileSync(target.absolute)
  if (physical.length !== descriptor.bytes || sha256(physical) !== descriptor.sha256) {
    throw new Error(`atlas artifact physical digest mismatch: ${descriptor.path}`)
  }
  const decoded = descriptor.contentEncoding === 'br'
    ? brotliDecompressSync(physical)
    : descriptor.contentEncoding == null
      ? physical
      : (() => { throw new Error(`atlas artifact content encoding is unsupported: ${descriptor.contentEncoding}`) })()
  if (descriptor.decodedBytes != null && decoded.length !== descriptor.decodedBytes) {
    throw new Error(`atlas artifact decoded byte denominator mismatch: ${descriptor.path}`)
  }
  if (descriptor.decodedSha256 != null && sha256(decoded) !== descriptor.decodedSha256) {
    throw new Error(`atlas artifact decoded digest mismatch: ${descriptor.path}`)
  }
  return decoded
}

export function readJsonArtifact({ root, descriptor }) {
  return JSON.parse(readArtifactBytes({ root, descriptor }).toString('utf8'))
}
