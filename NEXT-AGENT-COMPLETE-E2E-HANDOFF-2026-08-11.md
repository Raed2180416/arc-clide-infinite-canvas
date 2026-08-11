# ARC / CLIDE next-agent complete E2E handoff

Checkpoint: committed repository `00b9a49d679c31b169ee1962d68880aaa0357154` on branch
`codex/semantic-v2-product-splice-20260811`, measured 2026-08-11. The repository was visibly clean
when this packet was generated. Re-run every gate below; this paragraph is a checkpoint, not live
authority.

## Mission in one sentence

Build the local-first replacement for ChatGPT/Codex/Claude-style work: preserve the human's complete
intent, dynamically compile the right task-specific cognitive workflow, acquire only the right
context and evidence, create a typed candidate, independently prove it, perform the exact governed
effect, recover safely, learn reusable mechanisms, and expose the same authoritative state through
CLIDE—while returning `unresolved` whenever that chain is not earned.

Do not narrow the mission. Sequence it by causal dependency.

## Read this exact stack

1. `/home/raed/.agentic-os/CODEX.md` — canonical authority and evidence rules.
2. `/home/raed/.agentic-os/docs/canon/ARC-CLIDE-INTENT-MAP.json` — protected mission; do not rewrite
   it from findings or implementation convenience.
3. `/home/raed/.agentic-os/docs/bridge-program/2026-08-05/ARC-CLIDE-RECONSTRUCTION-REQUIREMENTS.md`
   — no-loss product requirements.
4. `/home/raed/.agentic-os/docs/bridge-program/2026-08-05/ARC-CLIDE-RECONSTRUCTION-ARCHITECTURE.md`
   — canonical reconstruction model.
5. `/home/raed/.agentic-os/docs/bridge-program/2026-08-11/UNIVERSAL-DYNAMIC-TASK-GRAPH-CONTEXT-AND-PRODUCT-ARCHITECTURE.md`
   — dynamic workflow, ContextProgram, routing and complete product composition.
6. `/home/raed/.agentic-os/docs/bridge-program/2026-08-11/ARC-CLIDE-THREE-WEEK-LAUNCH-HANDOFF.md`
   — current detailed execution plan, proof matrix, red corridor and stop laws.
7. `/home/raed/.codex/visualizations/2026/08/09/019fe5dd-07df-7132-bdae-222b2a2457cf/ARC-CLIDE-COMPLETE-SYSTEM-ATLAS-V2.md`
   — component-complete catalogue, every cross-plane relation, every TaskEvent, all live/dark/orphan
   module inventories, memory stores, models, domains and backing implementation links.
8. `/home/raed/.codex/visualizations/2026/08/09/019fe5dd-07df-7132-bdae-222b2a2457cf/arc-clide-complete-system-atlas-v2.svg`
   — zoomable color-coded visual map.
9. `/home/raed/.codex/visualizations/2026/08/09/019fe5dd-07df-7132-bdae-222b2a2457cf/arc-clide-infinite-canvas-prototype.html?variant=A`
   — read-only infinite canvas. A shows system planes, B shows the causal E2E river, and C reveals
   every measured module, dependency, event, lever, memory/model/domain catalogue and runtime slot.

`/home/raed/.agentic-os/docs/HANDOFF.md` is older historical context. It must not override the 2026-08-11
handoff or live code.

## Re-establish truth before touching code

```bash
cd /home/raed/.agentic-os
node .claude/bin/truth.mjs
holt status --strict-read-only --no-symbols --include-primary
npm run canon:check
npm run hygiene:status
git status --short
git rev-parse HEAD
```

Evidence ladder: `EXISTS -> REACHABLE -> DEFAULT-LIVE -> OBSERVED -> CAUSAL -> PRODUCT-PROVEN`.
Never promote a claim up this ladder from docs, a component test, a fixture, a self-hashed object, a
green command, an agent report or a receipt that does not discriminate the claim from a broken
control.

## Current measured shape

- 2,123 script modules scanned; 458 in the static live closure.
- 1,124 test drivers and 189 verifier drivers.
- 27 dark deep-research modules, 325 static orphan candidates and 15 dynamic-import uncertainties.
- 204 atlas components, 225 explicit cross-plane relations and 239 checked implementation-file
  references; zero referenced paths were missing when generated.
- 58 TaskEvent V9 types, seven memory stores, 38 model-weight artifacts, 57 domain routing
  configurations and three executable domain packs.
- 430 registered levers, 37 live at default on this checkpoint.
- The self-model verdict is `substrate-measured-product-capability-unproven`.
- The installed ARC binary was stale and both the demo daemon and 9B service were down at the
  checkpoint. Re-measure rather than repeating this as current.

## What is genuinely live

The public path can currently perform this bounded causal transaction:

```text
public WebSocket / CLIDE intent
  -> exact source and TaskSpec / GoalCapsule
  -> Semantic Intent V2 projection + physical counterparse + admission/refusal
  -> EventKernel / TaskRuntime
  -> bootstrap PlanGraph + TaskDecisionState
  -> bounded GraphControl epoch
  -> runtime-owned repository observation
  -> evidence-conditioned second epoch
  -> typed AuthorAction eligibility
  -> authority-zero author context
  -> real candidate author
  -> exact CandidateProposed
  -> immutable CandidateMaterialized workspace
  -> OracleEvaluationRecorded(state=unresolved, authority=none)
  -> hard stop before effect or completion
```

The important causal result is bounded: admitted repository evidence can change whether an
unverified typed candidate is reachable. This is more than prompt decoration. It is not yet proof
that the candidate is correct, safe to apply, or complete.

## The exact red corridor

The next product-completing dependency chain is:

```text
runtime-signed candidate-author receipt
  -> private pre-candidate evaluator plan commitment
  -> frozen candidate and exposure ledger
  -> runtime-owned sealed semantic oracle/control batch
  -> candidate-bound tri-state OracleEvaluationRecorded
  -> candidate-specific effect reservation
  -> exact immutable effect execution
  -> EffectObserved or EffectInDoubt + reconciliation
  -> post-effect acceptance under the same candidate/evaluator lineage
  -> completeCandidate
  -> exact TaskCompleted
```

Today the safe default is red at independent semantic evaluation, effect and completion. Do not
revive the legacy generic completion path, do not accept a caller-supplied test command as an
oracle, and do not turn `unresolved` into success.

## First implementation packet

### Objective

Make one tiny deterministic code candidate earn a replayable candidate-bound `supported`
evaluation through a runtime-owned evaluator transaction. Stop before repository effect. Attack
that claim before continuing.

### Reuse, do not rebuild

- `scripts/task-runtime.mjs` and `scripts/event-kernel.mjs`
- `scripts/candidate-artifact-v1.mjs`
- `scripts/candidate-workspace-router-v1.mjs`
- `scripts/candidate-workspace-v1.mjs`
- `scripts/patch-candidate-workspace-v1.mjs`
- `scripts/oracle-construction-commitment-store-v1.mjs`
- `scripts/admitted-verifier-execution-v1.mjs`
- `scripts/runtime-invocation-receipt-v1.mjs`
- `scripts/runtime-attested-verifier-v1.mjs`
- `scripts/patch-safety-case-v1.mjs`
- `scripts/patch-safety-runtime-observation-v1.mjs`
- `scripts/patch-safety-case-attestation-v1.mjs`
- `scripts/runtime-attested-oracle-batch-v1.mjs` only as integrity/projection substrate; its current
  caller-key evidence is not promotional authority.

### Public API law

The evaluator API may accept only the exact `candidateMaterializedEventId`. Callers may not supply
cases, commands, expected outputs, outcomes, labels, receipts, evaluator keys, opening handles,
denominators, policies, verdicts, authority or completion booleans. TaskRuntime chooses and owns the
adapter and private plan.

### Required control matrix

For every exact obligation/region/fault family:

1. known-good candidate x base oracle: pass;
2. known-bad candidate mutant x base oracle: fail at the candidate layer;
3. known-good candidate x oracle mutant: fail at the oracle layer;
4. candidate mutant x oracle mutant: detect double-fault cancellation, never pass;
5. submitted candidate: evaluated only after all controls conform.

Every planned cell needs one unique runtime-attested receipt bound to task, intent epoch, plan,
candidate, workspace, case, evaluator, implementation, runtime, environment, role and time window.
Missing, duplicate, reused, forged, stale, correlated-but-undisclosed, partial or in-doubt evidence
means `unresolved`.

### Transaction and recovery law

Use a write-once private state machine:

```text
not-planned -> committed|unavailable -> candidate-frozen -> reserved
  -> prepared|in-doubt -> evaluation-recorded
```

Crash before commitment may replan. Crash after commitment must reuse the exact sealed plan. A
reservation without a prepared result is in doubt and must be reconciled, never blindly executed
again. A prepared result without an event is recovered by appending that exact result.

### Must-red adversarial tests

- plan created after candidate exposure;
- opening/cases leak into author prompt, context, memory, tool output, logs or CLIDE;
- wrong task, intent epoch, candidate, workspace, plan, case, evaluator or environment;
- missing, extra, duplicated, transplanted or replayed receipt;
- one actor claiming all supposedly independent roles;
- incomplete denominator or an unmodelled obligation region;
- oracle/candidate double-fault cancellation;
- runtime or evaluator bytes drift after commitment;
- interruption at every transaction boundary;
- projection-only adequacy/tensor/co-mutation report attempts to promote;
- cross-candidate evaluation transplant;
- cold replay performs any new model/evaluator work.

### Exit gate

One materialized code candidate earns `supported` only from the runtime-owned physical batch; all
controls conform; every planned cell has one unique bound receipt; zero cells are unresolved; cold
replay performs zero work. A wrong candidate, wrong oracle, partial run, duplicate receipt or
transplant cannot earn support.

Then run an adversarial review. Only after it survives should the next packet implement the exact
candidate-specific effect and promotion transaction.

## Second packet: effect and completion

1. Reserve one effect keyed to the exact supported candidate materialization and evaluation.
2. Strictly revalidate the current repository/base immediately before effect.
3. Apply only the immutable candidate bytes in the governed workspace.
4. Persist `EffectStarted`, then `EffectObserved` or `EffectInDoubt`.
5. Reconcile interruption; never blindly repeat an external effect.
6. Re-run acceptance after the observed effect under the same evaluator/candidate lineage.
7. Promote only via `completeCandidate`; exact EventKernel identity checks must bind every parent.
8. Prove wrong candidate, global-latest evaluation, repo drift, command substitution, target
   substitution, crash windows and replay all fail safely.

Exit only when one real public task earns one exact candidate-bound `TaskCompleted` and one broken
control cannot.

## Third packet: whole-product stress and generality

After the vertical transaction is real:

- drive public WebSocket and the rebuilt CLIDE binary with the actual local GPU runtime;
- project the same TaskId, candidate, evaluator, effect and completion lineage in the TUI;
- cold-restart with zero repeated model/evaluator/effect calls;
- run ambiguity, negation, stale context, poisoned memory, missing dependency, malformed tool
  output, timeout, daemon crash, source drift and user-interruption arms;
- run the preregistered evidence-mediation campaign with blank, neutral, sufficient, masked and
  polarity-mutated arms at sufficient K and matched compute;
- make the black-hole task the second evaluator transfer: preserve the correct physics kernel, but
  require tri-state event semantics, convergence, exact separatrix-side binding and a physically
  attested independent numerical route;
- run answer-free held-out transfer across coding, math, physics, research and cross-domain
  synthesis;
- prove installer, model setup, update/rollback, budget, privacy and fresh-machine journeys.

## How every graph fits

EventKernel is the sole durable history. TaskRuntime is the sole lifecycle/effect/completion
interpreter. Every other graph is a typed replay-derived facet or authority-zero proposal:

1. protected intent/value graph;
2. semantic source and reference graph;
3. obligation/acceptance/inhibition graph;
4. task-local belief/epistemic graph;
5. evidence/contradiction/absence graph;
6. capability, authority and information-flow graph;
7. task-conditioned control hypergraph;
8. runtime execution/effect/recovery graph;
9. context/exposure/retrieval graph;
10. candidate/workspace lineage graph;
11. oracle/verifier/control graph;
12. memory/procedural-learning/plasticity graph;
13. competence/independence/cost graph;
14. CLIDE/product/observability projection graph.

Dynamic graph engineering means compiling a finite task-specific graph from mandatory semantic
achievements and legal capabilities. AND edges represent obligations; OR branches are alternative
tactics. New observations can create a bounded next epoch. Models may propose typed deltas; they
never own durable state, effects or completion. The long-term target is recursive graph synthesis
across arbitrary tasks, not a fixed coding workflow.

The largest missing deep modules are the cross-graph binding compiler, universal ContextProgram,
universal GraphProgram compiler, measured competence/independence graph, unified computational
homeostat, representation bridge, runtime-owned oracle foundry and reversible mechanism-learning
governor. Preserve their ports in the vertical transaction; do not build them as disconnected
architectural sidecars.

## Model, context, memory and OSS laws

- The model receives a task-conditioned, typed working set assembled from the brain. It does not
  receive the entire brain or evaluator-private material.
- Exact source spans, repository/symbol graphs, structured queries, lexical retrieval, temporal and
  provenance filters are first-class. Embeddings remain one noisy proposer lane, never truth.
- Memory retrieval is advisory until bound to scope, provenance, freshness and authority. Promotion
  must prove a downstream causal benefit under held-out and negative-transfer controls.
- Multiple agents count as independent only to the extent their models, prompts, sources, tools,
  evaluators and failure mechanisms differ.
- LangGraph, Temporal and n8n patterns may help scheduling but cannot own durable state.
- OpenKB patterns are useful for file/tree/citation views; generated knowledge remains proposal.
- Langfuse may be a one-way off-box observability sink only.
- iii engine integration would duplicate authority; borrow catalog/schema/console ideas only.
- SOTA and OSS are launch points. Add an adapter only when a red product edge requires it and a
  mutation/negative control can prove it improves the selected action or artifact.

## Non-negotiable operating laws

- Preserve dirty work; never reset, clean, purge or delete from approximate scans.
- Run Holt immediately before any destructive worktree/branch action.
- No naked text crosses a critical seam: compile it into a typed object with task/epoch, authority,
  lineage, expected effect, falsifier and evidence.
- No model output becomes fact, tool authority, effect or completion without deterministic/runtime
  admission.
- No oracle is trusted because it is executable or green; it must discriminate its fault model.
- No context or memory item is trusted because it was retrieved.
- No causal claim from a prompt/hash difference alone; the reachable action or selected artifact
  must change under controls.
- No campaign number without an independently audited denominator and receipt set.
- Keep `unresolved` as a successful epistemic outcome, not task success.
- Record a finding or explicit no-delta attestation after material work; rerun truth, canon and
  hygiene before handoff.

## Final handoff criterion

The next agent should be able to say, with exact evidence:

> This public task preserved the human's intent, selected a task-conditioned workflow, acquired the
> required evidence, created this exact candidate, evaluated it with this preregistered independent
> physical control matrix, executed this exact effect once, reconciled uncertainty, reverified the
> observed state, projected the same lineage into CLIDE, and appended TaskCompleted—and these
> deliberate broken controls could not do so.

Anything less is an intermediate proof slice, not the complete E2E product.
