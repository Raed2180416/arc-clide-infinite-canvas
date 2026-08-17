# ARC / CLIDE — The Whole Story, Told Simply

> **Who this is for:** anyone who knows nothing about this codebase. If you can read
> plain English, you can finish this and understand *what* ARC/CLIDE is, *why* it
> exists, *how* every piece fits, *what* each piece means, and *what* the whole thing
> is trying to solve. No code knowledge required. I explain every idea with an
> everyday analogy first, then show how it shows up in the real system.

---

## Part 0 — The one-sentence summary

**ARC is a brain you can run on a cheap computer.** It takes a small, not-very-smart
language model (the "9B") and wraps it in a huge, careful system of memory, planning,
verification, and honesty so that the small model can attempt big, frontier-level work
— coding, research, math, reasoning — **without ever lying about what it can actually do.**

**CLIDE is the face of that brain** — the screen you look at and talk to. It shows you
everything the brain is thinking, planning, and doing, and lets you steer it.

The whole thing is built on one stubborn rule: **never claim more than you can prove.**

---

## Part 1 — The problem it's trying to solve

### The everyday analogy

Imagine you have a very smart friend who is also a **terrible memory** and a **terrible
liar** — not on purpose, but because they get confused. If you ask them to build you a
shed, they might:

1. Forget what you asked for halfway through.
2. Invent a "fact" about wood that isn't true.
3. Say "done!" when the shed is actually missing a wall.
4. Not remember how they built it, so they can't fix it later.

A normal person would just... not trust that friend. But what if you could give that
friend a **notebook, a checklist, a measuring tape, a camera, and a rulebook** — and
train them to *always* write things down, *always* check their work, and *never* say
"done" until the checklist is actually complete? Now the friend is useful, even though
they're still not a genius.

**That is exactly what ARC does.** The "friend" is a small 9-billion-parameter language
model. The notebook, checklist, measuring tape, camera, and rulebook are the thousands
of scripts and systems in this repository.

### The real problem

Big frontier AI products (like the ones from big companies) run on enormous, expensive
cloud computers. ARC's owner wants the **same kind of experience** — conversation, coding,
research, planning, memory, proof — but on a **cheap local computer** with a small model.
That's a much harder problem, because the small model is genuinely less capable.

So ARC's bet is: **capability isn't just in the model. It's in the system around the
model.** A small model with a perfect memory, a perfect plan, a perfect verifier, and a
perfect honesty rule can outperform a big model that has none of those.

---

## Part 2 — The mission and the rules (the "constitution")

Every system needs a boss. In ARC, the boss is a file called the **Intent Map**
(`docs/canon/ARC-CLIDE-INTENT-MAP.json`). It's the **protected constitution** — the
highest authority. Nothing in the code is allowed to contradict it.

### The mission (one sentence, from the map)

> Build ARC, a local-first evidence-governed intelligence and execution system, and
> CLIDE, its complete product surface, so a hardware-bounded small-model system can
> pursue frontier-class outcomes across coding, research, reasoning, prose, learning,
> multimodal, domain, and tool-using work through better representation, context, tools,
> verification, memory, orchestration, and learning **without overstating unproven
> capability.**

Let me unpack that:

- **"local-first"** — runs on your own cheap computer, not a rented cloud brain.
- **"evidence-governed"** — every claim must be backed by evidence you can check.
- **"hardware-bounded small-model"** — the brain is small and the computer is cheap.
- **"frontier-class outcomes"** — it's aiming high: real coding, real research, real math.
- **"without overstating unproven capability"** — the honesty rule. It will never pretend.

### The rules (the constraints)

The Intent Map lists **protected constraints** — rules that can never be broken:

| Rule | What it means in plain English |
|---|---|
| **EVIDENCE** | You can't claim something works unless you can show the proof path. |
| **LOCAL_HARDWARE** | The baseline is a cheap computer with an 8GB GPU and a small 9B model. Cloud is a last resort, not the default. |
| **MODEL_FLOOR** | The small model's quality is the *minimum* bar. Everything must be at least that good. |
| **NO_MOCK_TRUTH** | A fake demo, a diagram, or a test is NOT a real capability. Don't pretend it is. |
| **OWNER_AUTHORITY** | The owner's intent is sacred. You can extend the plan, but never shrink or rewrite the mission. |
| **REVERSIBILITY** | Everything must be inspectable and undoable. No irreversible surprises. |
| **SIMPLICITY** | A fancy mechanism must actually beat a simple one, or it's not worth it. |
| **CRITICAL_PARTNERSHIP** | Treat every idea — even the owner's — as a hypothesis to challenge with evidence. |
| **CANONICAL_SURFACE** | Only registered, governed documents count as truth. Everything else is just context. |

These rules are why the codebase is so big and careful. Every script exists to enforce
one of these rules.

---

## Part 3 — The big picture: how the brain works

Think of ARC as a **factory** with a clear production line. Raw material (your request)
goes in one end, and a verified, honest result comes out the other. Between those two
points, the material passes through several **departments**, each with a specific job.

Here are the departments, in order:

```
YOU (the owner)
   │  you say: "build me X"
   ▼
[1] INTAKE & SANITIZATION   — understand you, clean the input, block attacks
   ▼
[2] INTENT COMPILER         — freeze exactly what you asked for (the "TaskSpec")
   ▼
[3] PLANNER                 — make a plan graph of what to do and in what order
   ▼
[4] DECISION LOOP           — decide what to do next, based on evidence
   ▼
[5] EXECUTOR & TOOLS        — actually do things (edit files, run code, search)
   ▼
[6] VERIFIER & ORACLE       — check the work independently, don't trust yourself
   ▼
[7] MEMORY & LEARNING       — remember what worked, so next time is better
   ▼
[8] CLIDE (the face)        — show you everything, let you steer, prove it's real
```

Every department is itself made of many small scripts. Let me walk through each one.

---

## Part 4 — Department by department

### Department 1: Intake & Sanitization (the front door)

**Analogy:** Before you let a stranger into your house, you check their ID and make sure
they're not carrying anything dangerous.

**What it does:**
- **`chat-turn-runner.mjs`** — the front desk. It takes your message and routes it to the
  right place.
- **`prompt-sanitizer.mjs`** + **`injection-defense.mjs`** — the security guard. It
  separates *instructions* (what the system should do) from *data* (what the user
  provided), so a malicious user can't trick the model into doing something bad by
  hiding instructions inside their data. This is called **prompt injection defense**.
- **`semantic-source-atoms-v1.mjs`** — the translator. It breaks your input into exact,
  addressable pieces (atoms) so the system can point at *exactly* which part of your
  message it's talking about.
- **`document-ingest-router.mjs`** — the mailroom. It handles attachments: images,
  documents, files. It figures out what kind of thing you gave it and routes it to the
  right reader.

**Why it matters:** If the front door is weak, everything downstream is poisoned. This
department protects the whole brain from garbage-in and from attacks.

---

### Department 2: Intent Compiler (the contract)

**Analogy:** When you hire a contractor, you sign a contract that says *exactly* what
they'll build, so there's no arguing later about what you meant.

**What it does:**
- **`intent-compiler.mjs`** — reads your request and produces a **Frozen TaskSpec V1**:
  a frozen, immutable contract of the task. It captures the goal, the facts, the
  constraints, and the acceptance criteria.
- **`proof-carrying-intent.mjs`** — wraps the goal in a **GoalCapsule**: the goal plus
  the checks that would prove it's done, plus the authority that's allowed to change it.
- **`obligation-compiler.mjs`** — turns the goal into a list of **obligations**: things
  that *must* be achieved, things that are *forbidden*, and checks that must pass.
- **`semantic-intent-ir-v2.mjs`** — a richer internal representation of the intent as a
  graph of sequences, alternatives, and conditions.
- **`semantic-intent-certificate-v2.mjs`** — a certificate that proves the intent was
  parsed correctly and matches the source.

**Why it matters:** This is the **anti-drift** department. Once the contract is frozen,
the system can't quietly change what you asked for. If it needs to change the plan, it
must record that as an explicit, append-only **delta** — never a silent rewrite.

---

### Department 3: Planner (the map)

**Analogy:** Before a road trip, you draw a map with stops. You don't drive randomly.

**What it does:**
- **`task-bootstrap-plan-v1.mjs`** — makes the first simple plan (the starting frontier).
- **`task-conditioned-workflow-v1.mjs`** — builds a **control hypergraph**: a graph of
  AND-obligations (must all happen), OR-tactics (pick one), guards (conditions), joins,
  and outcomes.
- **`graph-control-kernel-v2.mjs`** — the **GraphControl Kernel**: the engine that
  decides which plan node to work on next, bounded and shadowed so it can't run wild.
- **`decision-frontier-v1.mjs`** — tracks the open decision regions: what's still
  unknown and needs a decision.
- **`adaptive-plan-governor-v1.mjs`** — proposes new plan branches and schedules them,
  with budgets and ordering.
- **`dynamic-branch-invocation-v1.mjs`** — actually starts a branch, runs it, and joins
  the result back.

**Why it matters:** The small model can't hold the whole plan in its head. The planner
holds it *outside* the model, in a durable graph, so the model only ever needs to think
about one small step at a time. This is the **"better representation"** part of the
mission.

---

### Department 4: Decision Loop (the thinking)

**Analogy:** A detective doesn't guess. They gather clues, form a hypothesis, test it,
and only then conclude — and they keep track of what's *known*, *believed*, and *unknown*.

**What it does:**
- **`task-decision-state-v1.mjs`** — tracks the state of every claim: known, believed,
  contested, unknown, forbidden, or resource-limited.
- **`epistemic-graph-v1.mjs`** — the **epistemic graph**: a graph of claims and evidence,
  with edges for *supports*, *refutes*, *contradicts*, and *open-world absence*.
- **`epistemic-evaluation-frontier-v1.mjs`** — decides whether a claim needs more
  independent evidence before it can be accepted.
- **`author-action-admission-v1.mjs`** — decides what the system is allowed to do next:
  clarify, gather evidence, mark unresolved, or propose a candidate.
- **`research-entropy-trigger.mjs`** + **`mutation-oracle.mjs`** — the active experiment
  designer: when things are uncertain, it designs discriminating experiments to find out.

**Why it matters:** This is the **honesty engine**. The system never just *believes*
something because it sounds right. It tracks *why* it believes it, and it refuses to
treat an unverified claim as fact. This is the "evidence-governed" part of the mission.

---

### Department 5: Executor & Tools (the hands)

**Analogy:** The brain decides, but it needs hands to actually do things — and those
hands must be carefully controlled so they don't break anything.

**What it does:**
- **`governed-action-loop.mjs`** — the controlled loop that actually performs actions.
- **`capability-policy.mjs`** — the **capability registry**: a list of what tools are
  legal to use, and under what authority.
- **`bash-action-transport.mjs`** — runs terminal commands, but only through the
  governed gate.
- **`arc-os-sandbox.mjs`** + **`sandbox-engine.mjs`** — the **sandbox**: runs dangerous
  code in a contained box (bwrap, Landlock, seccomp, no network) so it can't hurt the
  real system.
- **`egress-gateway.mjs`** — controls what data is allowed to leave the machine (the
  **egress** policy), so secrets and private data don't leak out.
- **`host-commit-broker.mjs`** — the only thing allowed to make git commits, and it's
  governed.
- **`model-router.mjs`** + **`specialist-registry.mjs`** — decides which model or
  specialist handles which task, based on measured capability and cost.
- **`local-llama-server-transport.mjs`** — talks to the local 9B model.
- **`subagent-orchestrator.mjs`** — spawns and coordinates sub-agents for independent
  work.

**Why it matters:** This is the **"tools"** and **"execution"** part of the mission. The
system can actually *do* things — edit files, run code, search the web — but every
action is gated by policy, sandboxed for safety, and recorded for reversibility.

---

### Department 6: Verifier & Oracle (the referee)

**Analogy:** You never grade your own homework. You have a separate referee who checks
your work independently, and you don't get to say "done" until the referee passes it.

**What it does:**
- **`deterministic-verifier.mjs`** — runs deterministic checks (compilers, tests, SMT,
  CAS, simulation) to verify a candidate.
- **`verifier-capsule-v1.mjs`** — packages an executable verifier so it can be run in
  isolation.
- **`verifier-executor-v1.mjs`** — runs the verifier in a pinned, contained sandbox with
  no network.
- **`verifier-result-v1.mjs`** — records the verdict plus the exact runtime receipt
  (proof it actually ran).
- **`mutation-oracle.mjs`** + **`property-metamorphic-oracle.mjs`** — the **oracle**
  family: they test whether a candidate is *actually* correct by mutating it and seeing
  if the tests catch the mutation. If the tests don't catch a broken version, the tests
  are weak.
- **`oracle-construction-commitment-v1.mjs`** — seals a commitment *before* seeing the
  candidate, so the oracle can't be rigged after the fact.
- **`runtime-invocation-receipt-v1.mjs`** — signs the physical invocation, proving the
  verifier really ran on real hardware.

**Why it matters:** This is the **"verification"** part of the mission and the heart of
the honesty rule. The system refuses to claim a candidate works until an *independent*
referee proves it. This is what separates ARC from a model that just *says* it's done.

---

### Department 7: Memory & Learning (the notebook)

**Analogy:** A good worker keeps a notebook. They write down what worked, what didn't,
and why — so next time they don't repeat mistakes and they build on successes.

**What it does:**
- **`event-kernel.mjs`** — the **EventKernel**: an append-only, immutable history of
  every event. This is the system's episodic memory — the raw record of what happened.
- **`governed-memory.mjs`** — the **authoritative memory**: admitted claims that have
  been verified. (Currently empty, because nothing has been promoted yet — that's honest.)
- **`agent-memory.mjs`** — advisory memory: helpful but not authoritative.
- **`memory-harvest-producer.mjs`** + **`memory-surprise-gate.mjs`** — decide what's
  worth remembering, based on outcomes and surprise.
- **`memory-reconsolidation.mjs`** — revises or tombstones outdated memories.
- **`sleep-clock.mjs`** + **`memory-consolidation-scheduler.mjs`** — slow background
  consolidation, like sleep for the brain.
- **`reconstruction-self-model.mjs`** — generates a current census of the system itself,
  instead of relying on stale prose.

**Why it matters:** This is the **"memory"** and **"learning"** part of the mission. The
system gets better over time, but every memory is governed, attributable, and reversible
— it never just silently changes its mind.

---

### Department 8: CLIDE (the face)

**Analogy:** A brain is useless if you can't see what it's thinking. CLIDE is the
dashboard that shows you everything, in real time, and lets you steer.

**What it does:**
- **`arc-daemon.mjs`** — the background daemon that runs the brain and serves state.
- **`apps/arc-tui/`** — the **Rust TUI**: a terminal interface with panes for chat, work,
  code, research, project, and recovery.
- **`workspace/protocol.rs`** — the wire protocol that sends state to the UI.
- **`workspace/render.rs`** + **`layout.rs`** + **`panes.rs`** — how the UI is drawn.
- **`run-observability.mjs`** + **`telemetry-bus.mjs`** — observability: a timeline of
  events, receipts, and metrics so you can see what happened and why.
- **`watchdog-process.mjs`** + **`context-watchdog.mjs`** — health monitors that restart
  things if they hang.

**Why it matters:** This is the **"complete product surface"** part of the mission. CLIDE
isn't a demo — it's a faithful, recoverable projection of the real governed runtime
state. What you see is what's actually true.

---

## Part 5 — The cross-cutting systems (the glue)

Some systems touch every department. These are the "glue" that holds the brain together.

### The EventKernel and TaskRuntime (the spine)

- **`contracts.mjs`** — the **Contracts V9**: the exact schemas for every event and
  artifact. This is the language the whole system speaks.
- **`event-kernel.mjs`** — the **EventKernel**: the append-only history. Every event is
  recorded here, forever, in order. This is the system's ground truth.
- **`task-runtime.mjs`** — the **TaskRuntime**: the *only* thing allowed to interpret
  the event history and decide the current state, effects, and completion. It's the
  sole authority for "what is true right now."

**Why it matters:** Because everything is recorded as events, the system can **replay**
history to recover from a crash, and it can **prove** what happened. This is the
"reversibility" and "recovery" rules in action.

### The artifact stores (the filing cabinets)

Everything the system produces is stored as a **content-addressed artifact** — meaning
the file's name is a hash of its contents. If the contents change, the name changes.
This makes it impossible to silently alter a record.

- **`task-spec-artifact-store.mjs`** — frozen task specs.
- **`task-graph-artifact-store.mjs`** — plan/control artifacts.
- **`candidate-artifact-v1.mjs`** — candidate solutions.
- **`verifier-capsule-artifact-store.mjs`** — verifier packages.
- **`runtime-invocation-receipt-v1.mjs`** — signed execution receipts.

### The canon and findings (the law library)

- **`CODEX.md`** — the gateway to the protected intent map and the operating contract.
- **`docs/canon/CANONICAL-DOCS.json`** — the registry of canonical documents.
- **`scripts/canon-governance.mjs`** — governs the canon: what's registered, what's
  superseded, what's retired.
- **Findings** — when the system discovers something, it records a **finding** (a
  proposed plan delta). A finding can *propose* a change but can never rewrite the
  protected root intent.

### The context compiler (the attention economy)

- **`context-compiler.mjs`** — selects the *smallest sufficient* context for each step,
  with provenance and dereferenceable raw evidence. This is the "attention economy":
  don't waste the small model's limited attention on irrelevant stuff.
- **`symbol-call-graph.mjs`** + **`graph-query.mjs`** — the symbol/call/reference graph:
  definitions, callers, callees, and neighborhoods.
- **`hybrid-code-retrieval.mjs`** + **`listwise-rerank.mjs`** — hybrid retrieval that
  fuses lexical, graph, and embedding signals.
- **`token-count.mjs`** + **`prompt-budget-authority.mjs`** — exact token accounting and
  budget enforcement.

---

## Part 6 — The honesty ladder (how ARC proves things)

ARC has a **proof ladder** — a strict order of how much you can claim about something:

```
exists  →  reachable  →  default-live  →  observed  →  causal  →  product-proven
```

- **exists** — the code is there.
- **reachable** — you can get to it.
- **default-live** — it runs by default, not just in a test.
- **observed** — you've seen it actually work.
- **causal** — you've proven it *causes* the outcome, not just correlates.
- **product-proven** — it's proven on a real held-out product task.

ARC will never claim a higher rung than it has actually reached. This is the
**NO_MOCK_TRUTH** and **EVIDENCE** constraints made concrete. A diagram is "exists."
A passing test is "observed." Only a real, held-out, independently-verified product
outcome is "product-proven."

---

## Part 7 — What's real now vs. what's still missing

The system atlas (a machine-generated census) marks every module with a status:

- **SOLE AUTHORITY / CONSTITUTION** — the sacred core (intent map, contracts, event
  kernel, task runtime, canon).
- **LIVE / DEFAULT** — running by default.
- **LIVE / PARTIAL** — running but incomplete.
- **EXISTS / DARK OR NON-PROMOTIONAL** — the code exists but is deliberately not
  promoted as a real capability (it's a shadow/experiment).
- **MISSING / LAUNCH BLOCKER** — required but not built yet.
- **OPTIONAL EXTERNAL / PATTERN ONLY** — external tools we borrow patterns from, never
  peer authority.

**The honest truth:** a large number of modules are **MISSING / LAUNCH BLOCKER** —
especially the ones that would make the system *fully* general and *fully* product-proven
(the universal compilers, the computational homeostat, the complete candidate-effect
transaction, the measured competence graph). ARC is a **work in progress**, and it says
so. That honesty is the whole point.

---

## Part 8 — The repository atlas (what I just built)

The **Repository Atlas** is a machine-generated, content-addressed, gate-checked
projection of the entire repository. It's the "self-model" that answers: *what is
actually in this codebase, right now, and is it honest?*

It works like this:

1. **`atlas build`** scans every visible file, parses every code file with exact
   parsers (TypeScript, Python, tree-sitter for other languages), and records every
   symbol, call site, and dependency.
2. It computes **content hashes** for every file, so it can detect if anything drifts.
3. It runs a set of **completeness gates** — checks that must pass for the atlas to
   claim it's complete. For example:
   - **fileDenominator** — every visible file is accounted for.
   - **semanticPurpose** — every symbol's purpose is either source-authored or
     explicitly marked unavailable (never guessed).
   - **relationshipResolution** — every call site is bound to a real declaration or an
     external entity (never left dangling).
   - **codeGraphFreshness** — the advisory code graph matches the current files.
4. It produces a **completeness receipt** — an honest report of which gates pass and
   which fail. If any gate fails, the atlas says "built-incomplete" and lists the
   blockers. It never pretends to be complete when it isn't.
5. **`atlas packet`** produces a **continuation packet** — a bounded, source-addressed
   summary another agent can use to continue work with full understanding.

**Why it matters:** The atlas is the "architecture self-model" (workstream W17). Instead
of relying on stale prose descriptions, the system generates a fresh, honest census of
itself on demand. And because it's gate-checked and content-addressed, you can trust
that what it says is actually true of the current code.

---

## Part 9 — The complete end-to-end journey (one story)

Let me tell the whole story as one continuous journey, so you can see how every piece
fits together.

**You** open CLIDE and type: *"Fix the bug where the task graph crashes on empty input."*

1. **Intake** (`chat-turn-runner`) receives your message. The **sanitizer** separates
   your instruction from any data, and the **injection defense** makes sure you can't
   sneak a malicious instruction in. The **document router** handles any files you
   attached.

2. **Intent** (`intent-compiler`) freezes a **TaskSpec**: "Fix the bug where the task
   graph crashes on empty input." It records the goal, the constraints, and the
   acceptance criteria. This contract is now immutable.

3. **Plan** (`task-bootstrap-plan`, `graph-control-kernel`) builds a plan graph: first
   reproduce the bug, then find the cause, then fix it, then verify. The **decision
   frontier** tracks what's unknown.

4. **Context** (`context-compiler`) gathers the *smallest sufficient* context: the task
   graph code, its callers, its tests. It doesn't dump the whole repo into the model's
   head — just what's needed.

5. **Execute** (`governed-action-loop`) runs commands through the **sandbox** and
   **capability policy**. It edits files through the **governed patch generator**. Every
   action is recorded as an **event** in the **EventKernel**.

6. **Verify** (`deterministic-verifier`, `mutation-oracle`) runs the tests. The
   **oracle** mutates the fix to make sure the tests would actually catch a broken
   version. The **verifier executor** runs it in a contained sandbox and signs a
   **runtime receipt** proving it ran.

7. **Decide** (`epistemic-evaluation-frontier`) checks: is the fix *supported* by
   evidence? Is there a *contradiction*? If the evidence is solid, the candidate is
   accepted. If not, it goes back to the plan for another round.

8. **Remember** (`memory-harvest`) records what worked and why, so the next similar bug
   is easier.

9. **Show** (CLIDE) displays the whole journey: the plan, the actions, the evidence, the
   verdict. You can see *exactly* what happened and why, and you can steer or approve at
   any checkpoint.

10. **Prove** — the system only claims "done" if the **TaskRuntime** says the acceptance
    criteria are met, backed by the verifier receipt. It never says "done" on a guess.

That's the whole system. Every script in this repository is a cog in one of these ten
steps, and every cog exists to serve the mission: **a small model, made trustworthy and
capable by a careful system, that never overstates what it can prove.**

---

## Part 10 — The vocabulary cheat-sheet

| Term | Plain meaning |
|---|---|
| **ARC** | The brain: the whole evidence-governed intelligence system. |
| **CLIDE** | The face: the terminal UI that shows and steers the brain. |
| **9B / Qwen3.5-9B** | The small local language model that does the actual thinking. |
| **Intent Map** | The protected constitution: the mission and the rules. |
| **TaskSpec** | The frozen contract of what you asked for. |
| **GoalCapsule** | The goal plus the checks that prove it's done. |
| **Obligation** | A required achievement, prohibition, or check. |
| **PlanGraph / control hypergraph** | The map of what to do and in what order. |
| **GraphControl Kernel** | The engine that decides the next step, bounded and shadowed. |
| **Epistemic graph** | The graph of claims and evidence (supports/refutes/contradicts). |
| **EventKernel** | The append-only, immutable history of everything. |
| **TaskRuntime** | The sole interpreter of history: what is true right now. |
| **Candidate** | A proposed solution, stored immutably. |
| **Oracle** | An independent referee that tests whether a candidate is really correct. |
| **Verifier** | A deterministic checker (compiler, test, simulation) run in a sandbox. |
| **Runtime receipt** | Signed proof that a verifier actually ran on real hardware. |
| **Sandbox** | A contained box where dangerous code runs safely. |
| **Egress** | The policy controlling what data can leave the machine. |
| **Canon** | The registered, governed documents that count as truth. |
| **Finding** | A proposed plan delta; can extend but never rewrite protected intent. |
| **Content-addressed** | A file named by a hash of its contents, so it can't be silently altered. |
| **Atlas** | A machine-generated, gate-checked census of the repository. |
| **Completeness gate** | A check the atlas must pass before claiming completeness. |
| **Continuation packet** | A bounded summary another agent can use to continue work. |

---

## Part 11 — The one idea to remember

If you remember only one thing, remember this:

> **ARC is a small model wrapped in a system that makes it honest and capable.**
> The system's superpower is not intelligence — it's **evidence, memory, planning,
> verification, and the refusal to overstate what it can prove.** Every script in this
> repository exists to serve that one idea.

That's the whole story. Now you understand *what* ARC/CLIDE is, *why* it exists, *how*
every piece fits, *what* each piece means, and *what* it's all trying to solve.