# ARC / CLIDE infinite canvas prototype

Question answered: can the complete E2E system remain navigable without pretending that future
task-specific graphs can be statically enumerated? This is a throwaway, read-only UI prototype with
no persistence and no authority.

The embedded data records whether it came from a clean committed HEAD or from HEAD plus a live dirty
overlay. Dirty-overlay nodes are measured current substrate, not committed baseline truth and never
cleanup authority.

Open directly:

- [A — system planes](./arc-clide-infinite-canvas-prototype.html?variant=A)
- [B — causal river](./arc-clide-infinite-canvas-prototype.html?variant=B)
- [C — complete module universe](./arc-clide-infinite-canvas-prototype.html?variant=C)

Controls:

- drag to pan;
- wheel or trackpad to zoom around the pointer;
- click to inspect exact interfaces, status, files and neighbours;
- double-click an architecture component to reveal its implementation files;
- search any component, path, TaskEvent, lever, model or domain;
- toggle live modules, tests/verifiers, dark/orphan modules, events, all 430 levers, catalogues and
  import edges;
- use **Reveal everything** for the literal measured universe;
- use **Materialize task** to add an in-memory task-specific runtime graph. It intentionally ends in
  unresolved oracle/effect/completion nodes because the current product has not earned those edges.

Generated checkpoint contents:

- 204 architecture organs;
- 2,171 implementation and proof files, including every one of the 2,125 scanned script modules and
  all discovered CLIDE Rust modules/referenced non-JavaScript implementations;
- 58 TaskEvent types;
- 430 registered levers;
- 19 specialist models and 40 discovered weight artifacts of at least 1 MiB;
- 57 domain routes;
- seven measured memory stores;
- ten runtime GraphProgram instance slots;
- 6,189 measured architecture, implementation, import, event, catalogue and configuration edges.

The canvas is extensible rather than metaphysically finite: static organs and implementation files
are measured at generation time; task-specific nodes are materialized per EventKernel/TaskRuntime
epoch. Production should consume a read-only authoritative projection and virtualize deeper symbol
graphs on demand. It must never become a second checkpoint, effect or completion authority.

Regenerate after the repository changes:

```bash
node /home/raed/.codex/visualizations/2026/08/09/019fe5dd-07df-7132-bdae-222b2a2457cf/generate-complete-atlas.mjs
node /home/raed/.codex/visualizations/2026/08/09/019fe5dd-07df-7132-bdae-222b2a2457cf/generate-infinite-canvas-prototype.mjs
```
