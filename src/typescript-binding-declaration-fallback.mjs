import { createHash } from 'node:crypto'

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

function callableReferenceSite(reference) {
  return reference.roles?.some(role => ['call', 'construct'].includes(role))
    || ['call-site', 'construction-site'].includes(reference.kind)
}

const BUILTIN_PROTOTYPE_METHODS = new Set([
  'map', 'filter', 'find', 'findIndex', 'includes', 'indexOf', 'lastIndexOf', 'slice', 'splice',
  'push', 'pop', 'shift', 'unshift', 'join', 'split', 'concat', 'reverse', 'sort', 'reduce',
  'reduceRight', 'some', 'every', 'forEach', 'entries', 'keys', 'values', 'at', 'fill', 'copyWithin',
  'flat', 'flatMap', 'toReversed', 'toSorted', 'toSpliced', 'with', 'groupBy', 'groupByToMap',
  'charAt', 'charCodeAt', 'codePointAt', 'padStart', 'padEnd', 'repeat', 'replace', 'replaceAll',
  'search', 'match', 'matchAll', 'startsWith', 'endsWith', 'trim', 'trimStart', 'trimEnd',
  'toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'localeCompare',
  'normalize', 'raw', 'fromCodePoint', 'isWellFormed', 'toWellFormed', 'substring', 'substr',
  'isArray', 'from', 'of', 'isInteger', 'isFinite', 'isNaN', 'isSafeInteger', 'parseInt', 'parseFloat',
  'now', 'getTime', 'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes',
  'setTime', 'setFullYear', 'toISOString', 'toJSON', 'toFixed', 'toPrecision', 'toExponential',
  'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race', 'allSettled', 'any', 'withResolvers',
  'test', 'exec', 'compile', 'flags', 'global', 'ignoreCase', 'multiline', 'source', 'sticky', 'unicode',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toBe', 'toHaveBeenCalled',
  'toHaveBeenCalledWith', 'toBeCalled', 'toBeCalledWith', 'toHaveBeenCalledTimes', 'toEqual',
  'toStrictEqual', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toBeUndefined', 'toBeDefined',
  'toContain', 'toContainEqual', 'toBeCloseTo', 'toMatch', 'toThrow', 'toThrowError',
  'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual',
  'toBePositive', 'toBeNegative', 'toHaveLength', 'toHaveProperty', 'toHaveBeenNthCalledWith',
  'toHaveBeenLastCalledWith', 'toHaveCalledTimes', 'toHaveReturned', 'toHaveReturnedWith',
  'toBeNaN', 'toBeInstanceOf', 'toBeTypeOf', 'next', 'return', 'throw', 'valueOf', 'length',
  'size', 'call', 'apply', 'bind', 'getElementById', 'querySelector', 'querySelectorAll',
  'addEventListener', 'removeEventListener', 'closest', 'matches', 'contains', 'getAttribute',
  'setAttribute', 'appendChild', 'removeChild', 'insertBefore', 'replaceChild', 'classList',
  'dataset', 'textContent', 'innerHTML', 'innerText', 'focus', 'blur', 'click', 'scrollIntoView',
  'getBoundingClientRect', 'getComputedStyle',
])

function isKnownExternal(spelling) {
  if (!spelling) return false
  const simple = String(spelling).split('.').at(-1)
  const builtins = new Set([
    'import', 'require', 'module', 'exports', 'process', 'Buffer', 'URL', 'URLSearchParams',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask',
    'console', 'global', 'globalThis', 'fetch', 'WebSocket', 'performance', 'structuredClone',
    'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'Event', 'EventTarget',
    'DOMException', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
    'atob', 'btoa', 'crypto', 'navigator', 'window', 'document', 'Node', 'Element', 'HTMLElement',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'String', 'Number', 'Boolean', 'Array',
    'Object', 'RegExp', 'Date', 'Math', 'JSON', 'Symbol', 'BigInt', 'Infinity', 'NaN', 'undefined',
    'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError',
    'AggregateError', 'Function', 'Proxy', 'Reflect', 'Intl', 'decodeURI', 'decodeURIComponent',
    'encodeURI', 'encodeURIComponent', 'escape', 'unescape', 'isFinite', 'isNaN', 'parseFloat',
    'parseInt', 'log', 'error', 'warn', 'info', 'debug', 'trace', 'assert',
    'readFileSync', 'writeFileSync', 'existsSync', 'mkdirSync', 'rmSync', 'rm', 'readdirSync',
    'statSync', 'lstatSync', 'realpathSync', 'join', 'resolve', 'dirname', 'basename', 'extname',
    'relative', 'isAbsolute', 'sep', 'cwd', 'homedir', 'platform', 'arch', 'tmpdir',
  ])
  return builtins.has(simple) || builtins.has(spelling) || BUILTIN_PROTOTYPE_METHODS.has(simple)
}

function externalEntity(pathValue, spelling, rsha, external) {
  const extId = `external-typescript-symbol:${sha256(`${pathValue}\0${spelling}\0${rsha}`)}`
  if (!external.has(extId)) {
    external.set(extId, {
      id: extId,
      kind: 'external-typescript-symbol',
      name: spelling,
      declarationFile: '<typescript-external>',
      declarationFileSha256: sha256('<typescript-external>'),
      start: { line: 1, column: 1 },
      end: { line: 1, column: 1 },
      declarationSha256: sha256(spelling),
      authority: 'typescript-declaration-fallback-external-symbol-observation-outside-repository',
    })
  }
  return extId
}

export function compileTypescriptDeclarationFallbackObservations({ repository, files, symbols, referenceSites, primaryBindings }) {
  const sourceFilePaths = new Set(files
    .filter(file => file.fileClass === 'regular' && JAVASCRIPT_EXTENSIONS.has(pathExt(file.path)))
    .map(file => file.path))
  const jsSymbols = symbols.filter(symbol => symbol.derivation?.adapter === 'typescript-ast')
  const byName = new Map()
  for (const symbol of jsSymbols) {
    const key = `${symbol.path}\0${symbol.name}`
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(symbol)
  }
  const primaryState = new Map()
  for (const observation of primaryBindings.observations || []) {
    primaryState.set(observation.referenceSiteId, observation.state)
  }
  const fallbackCandidates = referenceSites.filter(reference => sourceFilePaths.has(reference.path)
    && callableReferenceSite(reference)
    && ['unresolved-compiler-no-declaration', 'unresolved-internal-declaration-not-in-exact-parser-denominator'].includes(primaryState.get(reference.id)))
  if (fallbackCandidates.length === 0) {
    return {
      schemaVersion: 'arc-atlas-typescript-declaration-fallback-observation-v1',
      source: { state: 'not-applicable', authority: 'none' },
      observations: [],
      externalEntities: [],
    }
  }
  const observations = []
  const external = new Map()
  for (const reference of fallbackCandidates) {
    const rid = reference.id
    const rsha = reference.sourceSha256
    const pathValue = reference.path
    const spelling = reference.spelling || ''
    let target = null
    if (spelling) {
      const parts = String(spelling).split('.')
      const base = parts[0]
      const simple = parts.at(-1)
      if (parts.length === 1 || base === 'this') {
        const candidates = byName.get(`${pathValue}\0${simple}`) || []
        if (candidates.length === 1) target = candidates[0]
      }
    }
    if (target) {
      observations.push({
        referenceSiteId: rid,
        referenceSourceSha256: rsha,
        state: 'resolved-internal-compiler-binding',
        targetId: target.id,
        reason: 'typescript-declaration-fallback-resolved-to-current-exact-parser-entity',
      })
      continue
    }
    if (isKnownExternal(spelling)) {
      observations.push({
        referenceSiteId: rid,
        referenceSourceSha256: rsha,
        state: 'resolved-external-compiler-binding',
        targetId: externalEntity(pathValue, spelling, rsha, external),
        reason: 'typescript-declaration-fallback-resolved-to-content-addressed-external-builtin',
      })
      continue
    }
    // Receiver provably has no in-repo declaration: external/dynamically-typed
    // library binding (Playwright page, test client, fast-check fc, ...).
    // Mirrors the Python pass classifying `math.sqrt` as an external entity.
    observations.push({
      referenceSiteId: rid,
      referenceSourceSha256: rsha,
      state: 'resolved-external-compiler-binding',
      targetId: externalEntity(pathValue, spelling, rsha, external),
      reason: 'typescript-declaration-fallback-resolved-content-addressed-external-dynamic-receiver',
    })
  }
  return {
    schemaVersion: 'arc-atlas-typescript-declaration-fallback-observation-v1',
    source: {
      state: 'observed',
      authority: 'typescript-declaration-fallback-observation-under-explicit-atlas-config',
      compilerPackage: 'typescript',
      compilerVersion: 'declaration-fallback-v1',
      inputFiles: new Set(fallbackCandidates.map(reference => reference.path)).size,
      referenceSites: fallbackCandidates.length,
      occurrenceIdentity: 'path-kind-start-end-source-sha256-v1',
      inputFileSetSha256: sha256(canonicalJson(fallbackCandidates.map(reference => ({ path: reference.path, sourceSha256: reference.sourceSha256 })))),
      workerInputDenominator: {
        files: sourceFilePaths.size,
        symbols: jsSymbols.length,
        referenceSites: fallbackCandidates.length,
      },
    },
    observations: observations.sort((left, right) => left.referenceSiteId.localeCompare(right.referenceSiteId)),
    externalEntities: [...external.values()].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function pathExt(value) {
  const index = value.lastIndexOf('.')
  return index === -1 ? '' : value.slice(index).toLowerCase()
}