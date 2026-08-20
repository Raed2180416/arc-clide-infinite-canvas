import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { compileTreeSitterPolicyBatch } from '../src/tree-sitter-policy-adapter.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const repository = process.env.AGENTIC_OS_ROOT || '/home/raed/.agentic-os'
const policyPath = path.join(projectRoot, 'atlas', 'agentic-os-language-parsers.json')
const dependencyRoles = new Set([
  'alias', 'include', 'load', 'module-declaration', 'require', 'source', 'static-import', 'use',
])

test('hash-pinned Tree-sitter source-site queries cover every configured language family', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'arc-atlas-language-sites-'))
  const samples = [
    ['Bash', 'sample.sh', 'source ./common.sh\n. ./extra.sh\nrun_task\n', [['call', 'source'], ['call', 'source']]],
    ['Rust', 'sample.rs', 'use crate::util::run;\nmod helper;\ninclude!("generated.rs");\nfn main(){run();}\n', [['use'], ['module-declaration'], ['call', 'include']]],
    ['Go', 'sample.go', 'package main\nimport "fmt"\nfunc main(){fmt.Println()}\n', [['static-import']]],
    ['C', 'sample.c', '#include <stdio.h>\nint main(){foo();}\n', [['include']]],
    ['C++', 'sample.cpp', '#include "local.h"\nint main(){foo();}\n', [['include']]],
    ['Java', 'Sample.java', 'import java.util.List; class Sample { void run(){new Sample(); go();} }\n', [['static-import']]],
    ['C#', 'Sample.cs', 'using System; class Sample { void Run(){new Sample(); Go();} }\n', [['use']]],
    ['Elixir', 'sample.ex', 'alias Foo.Bar\nuse Baz\nimport Qux\nrun()\n', [['alias', 'call'], ['call', 'use'], ['call', 'static-import']]],
    ['Lua', 'sample.lua', 'local x=require("foo")\nlocal y=loadfile("bar.lua")\n', [['call', 'require'], ['call', 'load']]],
    ['Ruby', 'sample.rb', 'require "foo"\nrequire_relative "bar"\nload "baz.rb"\n', [['call', 'require'], ['call', 'source'], ['call', 'load']]],
    ['Scala', 'Sample.scala', 'import foo.bar.Baz\nclass Sample { def run = go() }\n', [['static-import']]],
    ['PHP', 'sample.php', '<?php use Bar\\Baz; include "x.php"; require_once "y.php"; f(); new A();\n', [['use'], ['include'], ['require']]],
    ['CodeQL', 'sample.ql', 'import javascript\nfrom Function f select f\n', [['static-import']]],
  ]
  const files = samples.map(([language, name, bytes]) => {
    const absolute = path.join(root, name)
    writeFileSync(absolute, bytes)
    return { path: `samples/${name}`, absolute, language }
  })
  try {
    const observed = compileTreeSitterPolicyBatch({ policyPath, repository, files })
    for (const [language, name, _bytes, expectedRoles] of samples) {
      const result = observed.byPath[`samples/${name}`]
      assert.ok(result, `${language} must have one parser result`)
      assert.equal(result.parserState, 'parsed', `${language} must parse without diagnostics`)
      assert.deepEqual(result.sourceSiteCoverage, {
        callSites: 'hash-pinned-relationship-query-v1',
        dependencySites: 'hash-pinned-relationship-query-v1',
        authority: 'hash-pinned-tree-sitter-source-site-query',
      })
      const actualRoles = result.sourceSites
        .filter(site => site.roles.some(role => dependencyRoles.has(role)))
        .map(site => site.roles)
      assert.deepEqual(actualRoles, expectedRoles, `${language} dependency roles must match its exact grammar query`)
      assert.equal(result.sourceSites.every(site => /^[a-f0-9]{64}$/.test(site.sourceSha256)), true)
      assert.equal(result.sourceSites.every(site => site.parserPolicy.sourceSiteQuerySha256?.length === 64), true)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
