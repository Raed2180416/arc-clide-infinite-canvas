# ARC / CLIDE Repository Atlas

This is the source project for a provenance-aware, visual and machine-readable
map of the Agentic OS repository. It is designed for two readers at once:

- a new engineer who needs a guided explanation of what every major part does;
- a coding agent that needs bounded, source-addressed continuation context.

The Atlas does not claim that ARC/CLIDE is product-complete. It maps what was
observed in a particular repository state, shows the evidence for each map
claim, and keeps missing product proof visibly unclaimed.

## What is in this repository

| Surface | What it provides |
| --- | --- |
| `web/` | A progressive visual explorer: guided start, search, organs, journeys, evidence, source references, governance, and a bounded optional 3D orientation view. |
| `src/` + `bin/atlas.mjs` | The deterministic Atlas compiler, verifier, snapshot reader, HTTP server, and agent-packet producer. |
| `atlas/` | Closed input profiles, ontology, policies, reviewed fallback classifications, transcript-decision review, and grammar/query pins. |
| `tests/` | Red/green tests for denominators, parser coverage, relationships, stale/tampered inputs, server behavior, accessibility, and packets. |
| `ARC-CLIDE-TODDLER-NARRATIVE.md` | The beginner-first explanation of the complete intended system. |
| `COMPLETE-ARCHITECTURE-BOOK.md`, `COMPLETE-COMPONENT-MAP.*`, and `MODULE-DIGESTS.*` | The deep static map and file/symbol digests. |

## Truth model

There are deliberately two serving modes:

- `current` is the default. It serves only when a closed build profile and
  basis prove that the source tree, semantic inputs, builder, and transcript
  cutoff still exactly match the snapshot. It fails closed when they do not.
- `historical` serves a frozen, digest-verified snapshot and labels it as
  historical. It never pretends the current source tree is identical.

This distinction matters: a beautiful map that silently drifts becomes a
beautiful lie.

## Local development

```bash
npm ci
npm test
npm run build:web
```

The default suite is deterministic and local. The full mutable Agentic OS
integration rebuild is deliberately opt-in because it can take many minutes and
depends on the live repository plus its code-graph database:

```bash
ARC_ATLAS_RUN_REAL_REPOSITORY=1 node --test tests/atlas-real-repository.test.mjs
```

Build a fresh Atlas snapshot from a closed profile. Put the output outside the
source checkout or in an ignored local artifact directory.

```bash
node bin/atlas.mjs build \
  --repo /home/raed/.agentic-os \
  --out /home/raed/.local/state/agentic-os/atlas/snapshots/current \
  --build-inputs atlas/agentic-os-build-profile.json
```

Browse a freshly verified snapshot:

```bash
node bin/atlas.mjs browse \
  --snapshot /home/raed/.local/state/agentic-os/atlas/snapshots/current \
  --mode current
```

Open a frozen snapshot only when you intentionally want historical context:

```bash
node bin/atlas.mjs browse --snapshot /path/to/snapshot --mode historical
node bin/atlas.mjs packet --snapshot /path/to/snapshot --query "TaskRuntime" --mode historical
```

## Release status — 2026-08-20

The compiler and web application are source-release candidates after their
tests pass. The local `snapshots/` directory is intentionally ignored: its
current Agentic OS snapshot is about 649 MB and includes a 127 MB SQLite index,
which cannot be safely committed to ordinary Git/GitHub by accident.

That local snapshot is also **historical**, not current: its source-tree,
builder, and live transcript inputs have moved since it was built. The command
above will refuse `--mode current` for it; `--mode historical` remains the
truthful way to inspect it.

The complete release and continuation boundary is recorded in
[`ATLAS-RELEASE-READINESS-2026-08-20.md`](./ATLAS-RELEASE-READINESS-2026-08-20.md).
Read that before using this Atlas as authority for a new engineering task.

## Important limits

- The Atlas is a read-only projection, not intent, truth, effect, or completion
  authority.
- Structural facts are extracted from exact files/parsers. Semantic explanations
  must be source-authored, explicitly reviewed, or explicitly unavailable; they
  are never inferred from identifiers.
- A snapshot's hashes prove self-consistency, not authenticity against someone
  who can rewrite both a snapshot and its manifest. Keep release artifacts in a
  separately governed artifact store when authenticity matters.
- `productProof` is intentionally not claimed by a repository map. A complete
  user journey, physical effects, and causal experiments need their own evidence.
