# Atlas Release Readiness — 2026-08-20

## Decision

The **Atlas source project** can be handed to another engineer as a tested,
committed source release once the checks in this document pass. The **complete
Atlas artifact** is **not yet a portable, current release**. It is a large,
locally stored historical snapshot whose inputs have changed since capture.

That is a deliberate distinction, not a failure hidden behind a green test
count:

| Question | Honest answer |
| --- | --- |
| Can the next engineer build, test, and extend the Atlas compiler/UI? | Yes, from the source release; the default suite is deterministic. |
| Can they browse the existing local snapshot as historical evidence? | Yes, explicitly with `--mode historical`. |
| Can anyone call that snapshot a map of the current Agentic OS tree? | No. The default `current` path now refuses it. |
| Does the Atlas prove ARC/CLIDE's product outcome? | No. `productProof` remains intentionally unclaimed. |
| Does every symbol have a toddler-level semantic explanation? | No. Every symbol is structurally inventoried, but many are explicitly marked semantically unavailable rather than guessed. |

## What is genuinely present

The local historical snapshot was built from a closed profile and recorded:

- 3,949 visible repository entries, all accounted for;
- 2,729 parse-eligible files with an explicit parser outcome;
- 186,166 symbols with exact structural/parser provenance;
- whole-file call and dependency-site observations plus binding evidence;
- 18 architecture organs, 62 named LLM/product pitfalls, and 9 end-to-end
  journeys;
- 1,415 captured transcript messages and 121 reviewed owner messages at its
  cutoff;
- 884 governance documents, 105 findings, and 1,031 reviewed teaching
  concepts;
- an optional visual explorer, 2D orientation, bounded 3D orientation, source
  inspector, and agent packet.

Those counts describe the snapshot capture, not today's source checkout.

## Verification performed for this source release

- A clean worktree was created from `main`, with no inherited Atlas dependencies
  or generated snapshot.
- `npm ci` completed from `package-lock.json`.
- The deterministic source suite passed: **62 passing, 0 failing, 1 explicit
  skip**. The skipped test is the mutable, whole-Agentic-OS integration lane.
- The browser suite passed: **8 passing**.
- Production web build and JavaScript/Python syntax checks passed.
- The actual historical snapshot was checked through both modes: `current`
  refused it as stale; `historical` returned only snapshot-captured source
  bytes.

The full Agentic OS rebuild is intentionally opt-in:

```bash
ARC_ATLAS_RUN_REAL_REPOSITORY=1 node --test tests/atlas-real-repository.test.mjs
```

It must not be interpreted as a routine unit test or as proof that the mutable
product checkout is clean.

At this release boundary, that opt-in lane is known **not** to be green: it
observed 3,868 matching code-graph file hashes out of 3,895, leaving 27 stale
graph observations in the mutable Agentic OS checkout. This is an honest
integration refusal, not a failure of the deterministic Atlas source suite.

## The critical safety repair in this release

Before this release, the Atlas server's health receipt could report a snapshot
as stale while `atlas browse` still announced `serving-verified-snapshot`; the
packet path likewise had no full build-input freshness admission. That made a
stale map too easy to mistake for current truth.

The release now has two explicit modes:

1. `current` — default. It requires an exact closed build basis and rechecks
   it before serving snapshot data or building an agent packet. Any changed
   source, builder, policy, graph, review, or transcript cutoff returns a typed
   refusal.
2. `historical` — explicit. It serves digest-verified snapshot bytes and labels
   them historical. Agent packets read source excerpts from captured blobs, not
   today's changed checkout.

This is the minimum truthful boundary for a long-lived self-model.

The basis is also now admitted only when `data/build-basis.json` and
`data/build-inputs.json` are each declared exactly once in the snapshot's
artifact set, their bytes match their descriptors, and their basis/profile/
builder identities agree with the manifest's build, snapshot, source-summary,
and passing provenance gate. A copied fresh basis beside unrelated snapshot
bytes therefore cannot make that snapshot look current.

## Why the local snapshot is historical now

The current local snapshot's build basis no longer matches its inputs:

- the Agentic OS working-tree inventory and status changed;
- Atlas compiler source changed during the release repair;
- the Codex transcript source is append-only and has grown after the captured
  review cutoff.

The live transcript path is useful for active work but is a bad release input:
every new conversation event can stale the snapshot. A portable, current Atlas
needs an **immutable, content-addressed transcript cutoff artifact** (or a
separately governed artifact store), then a fresh build against that cutoff.

## Deliberately excluded from the source commit

`node_modules/`, `dist/`, and `snapshots/` are ignored. This prevents a source
commit from quietly including local dependencies or a 649 MB generated snapshot
(whose SQLite navigation index alone is about 127 MB). The source branch must
stay reviewable and Git-hostable.

To ship a browsable production Atlas, choose and document one artifact route:

1. a governed release-artifact store with a signed manifest and retention;
2. Git LFS with an explicit storage/quota decision; or
3. a server that builds/serves a verified snapshot from an immutable source
   cutoff.

Do not add the current `snapshots/` directory to normal Git just to make the
tree look complete.

## Public GitHub Pages boundary

The public Pages release is a separate, narrower artifact from both the source
project and any local snapshot. Its deterministic builder is
`bin/build-public-pages.mjs`. It publishes only a static, sanitised historical
reference: the component map, compact symbol digests, and selected orientation
documents. It rejects local file locators and GitHub-token-shaped values before
writing a digest-bound public manifest.

That makes the Page useful for discovery without implying that its historical
records describe the current mutable Agentic OS checkout. It deliberately does
not publish source blobs, the local SQLite navigation index, transcript pages,
machine-local paths, or any product/effect/completion authority. A successful
Pages deployment proves that the public static artifact is reachable; it does
not discharge the current-snapshot, semantic-explanation, or product gaps
described above.

These checks establish a self-consistent local release boundary. They do not
turn a writable local filesystem into an independent authenticity authority;
the signed-manifest artifact route remains necessary if hostile-writer
tampering is in scope.

## How a next engineer should start

1. Read [`README.md`](./README.md), then
   [`ARC-CLIDE-TODDLER-NARRATIVE.md`](./ARC-CLIDE-TODDLER-NARRATIVE.md), then
   [`COMPLETE-ARCHITECTURE-BOOK.md`](./COMPLETE-ARCHITECTURE-BOOK.md).
2. Run `npm ci`, `npm test`, and `npm run build:web` in this repository.
3. Treat all static map files and any supplied `snapshots/` directory as
   **historical** until the current-mode verifier says otherwise.
4. For one source question, use an explicit packet query. If it returns no
   conceptual match, navigate by organ/journey/source reference rather than
   inventing a semantic match.
5. Before claiming the Atlas complete, create an immutable input cutoff, rebuild
   it, perform a real visual/user journey, and conduct an independent cold-reader
   audit against the exact release artifact.

## Remaining completion gaps

### Atlas-as-understanding gap

The Atlas has an exact structural denominator, not omniscience. It refuses to
invent meaning for symbols with no source-authored or explicitly reviewed
purpose. That is epistemically correct, but it means the founder's strongest
criterion — *a toddler understands every function's purpose* — remains
unfinished until those symbols receive human/source-grounded explanations or
are split into meaningful code units with documented contracts.

### Continuation/agent gap

The packet currently ranks exact names, qualified names, paths, signatures, and
available purpose summaries. Broad conceptual phrases can return no result. An
agent should start with an organ/journey or a known surface, then request a
bounded packet. A future release should add reviewed concept-to-symbol entry
points without turning semantic retrieval into inference.

### Product gap

The map is not the system's live product proof. The Agentic OS worktree itself
has unresolved dirty-state/canon/hygiene work; it must be reconciled in that
repository, with its own tests and findings protocol, before anyone labels the
whole product clean or ready to ship.

## Non-negotiable rules for follow-on work

- Never make a stale map look current.
- Never turn an inferred label into a source-grounded explanation.
- Preserve all zero/unknown/unavailable states; they are evidence, not clutter.
- Keep the Atlas read-only: it cannot mint product truth, effects, completion,
  or intent authority.
- Keep the source project, generated artifacts, and the primary Agentic OS
  product checkout as separate release boundaries.
