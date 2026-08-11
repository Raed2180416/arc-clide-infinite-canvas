#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = '/home/raed/.agentic-os'
const outDir = path.dirname(fileURLToPath(import.meta.url))
mkdirSync(outDir, { recursive: true })

const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
const gitStatusLines = execFileSync('git', ['status', '--porcelain=v1'], { cwd: repo, encoding: 'utf8' })
  .trimEnd().split('\n').filter(Boolean)
const gitDirtyPaths = gitStatusLines.map(line => {
  const value = line.slice(3)
  return value.includes(' -> ') ? value.split(' -> ').at(-1) : value
}).sort()
const sourceState = gitDirtyPaths.length ? 'committed-head-plus-live-working-tree-overlay' : 'committed-head'

const runJson = (script, args = []) => JSON.parse(execFileSync('node', [script, ...args], {
  cwd: repo,
  encoding: 'utf8',
  maxBuffer: 128 * 1024 * 1024,
}))

const selfModel = runJson('scripts/reconstruction-self-model.mjs', ['--json'])
const moduleCensus = runJson('scripts/verify/live-module-census.mjs', ['--json'])
const truth = execFileSync('node', ['.claude/bin/truth.mjs'], { cwd: repo, encoding: 'utf8' }).trim()
const { EVENT_TYPES } = await import(pathToFileURL(path.join(repo, 'scripts/contracts.mjs')).href)

const S = {
  authority: { label: 'SOLE AUTHORITY / CONSTITUTION', fill: '#6a1b9a', font: '#ffffff', stroke: '#ab47bc' },
  live: { label: 'LIVE / DEFAULT', fill: '#1b5e20', font: '#ffffff', stroke: '#66bb6a' },
  partial: { label: 'LIVE / PARTIAL', fill: '#f9a825', font: '#111111', stroke: '#ffd54f' },
  substrate: { label: 'EXISTS / DARK OR NON-PROMOTIONAL', fill: '#1565c0', font: '#ffffff', stroke: '#64b5f6' },
  blocked: { label: 'MISSING / LAUNCH BLOCKER', fill: '#b71c1c', font: '#ffffff', stroke: '#ef5350' },
  external: { label: 'OPTIONAL EXTERNAL / PATTERN ONLY', fill: '#424242', font: '#ffffff', stroke: '#9e9e9e' },
}

const n = (id, name, status, iface, modules = [], detail = '') => ({ id, name, status, iface, modules, detail })
const clusters = [
  {
    id: 'surfaces', label: '00 · HUMAN, PRODUCT, AND MODALITY SURFACES',
    nodes: [
      n('owner', 'Owner intent, values, constraints', 'authority', 'Human instruction and approval', [], 'Protected mission and live interjection source.'),
      n('clide', 'CLIDE Rust TUI', 'partial', 'Chat, work, code, research, project and recovery panes', ['apps/arc-tui/src/main.rs', 'apps/arc-tui/src/workspace/mod.rs']),
      n('cli', 'Agentic OS CLI / one-shot', 'partial', 'Task invocation and local administration', ['scripts/agentic-os.mjs', 'apps/arc-tui/src/oneshot.rs']),
      n('ws', 'Public WebSocket ingress', 'live', 'Versioned client frames', ['scripts/arc-daemon.mjs']),
      n('chat_modes', 'Mode, permission and route selection', 'partial', 'basic, auto, research, execute, plan', ['scripts/chat-turn-runner.mjs', 'scripts/deep-research/task-mode-router.mjs']),
      n('attachments', 'Attachments and multimodal ingress', 'partial', 'Typed document/image/browser sources', ['scripts/document-ingest-router.mjs', 'scripts/specialist-consult.mjs']),
      n('operator_ui', 'Questions, approvals, cancellation, steering', 'partial', 'Typed operator checkpoints', ['scripts/operator-question-bus.mjs', 'scripts/operator-question-classifier.mjs', 'scripts/interactive-approval-transport.mjs']),
      n('artifacts_ui', 'Diff, candidate, evidence and receipt views', 'partial', 'Read-only authoritative projections', ['apps/arc-tui/src/workspace/diff.rs', 'apps/arc-tui/src/workspace/cognitive_projection.rs']),
      n('automation', 'Automations, long-horizon and heartbeat entry', 'partial', 'Scheduled task triggers', ['scripts/autonomous-loop-runner.mjs', 'scripts/multihour-loop-runner.mjs', 'scripts/task-heartbeat.mjs']),
      n('delivery', 'User-visible answer, artifact, effect or unresolved result', 'partial', 'Typed final surface', ['scripts/chat-turn-runner.mjs', 'apps/arc-tui/src/workspace/protocol.rs']),
    ],
  },
  {
    id: 'normative', label: '01 · NORMATIVE, LANGUAGE, INTENT, AND ACCEPTANCE PLANE',
    nodes: [
      n('intent_map', 'Protected hierarchical intent map', 'authority', 'Immutable root mission and workstreams', ['docs/canon/ARC-CLIDE-INTENT-MAP.json']),
      n('raw_source', 'Exact prompt and conversation prefix', 'live', 'Byte-preserving source', ['scripts/chat-turn-runner.mjs']),
      n('sanitizer', 'Prompt sanitiser and instruction/data fence', 'partial', 'Taint-preserving source zones', ['scripts/prompt-sanitizer.mjs', 'scripts/injection-defense.mjs']),
      n('source_atoms', 'Semantic Source Atoms V1', 'partial', 'Exact Unicode spans and opaque zones', ['scripts/semantic-source-atoms-v1.mjs']),
      n('ud_lane', 'Physical UD counterparser', 'partial', 'Pinned CPU subprocess observation', ['scripts/semantic-ud-counterparser-v1.mjs', 'scripts/semantic-ud-counterparser-v1.py']),
      n('intent_compiler', 'Intent compiler / objective analyser', 'partial', 'Task facts, constraints and shaping', ['scripts/intent-compiler.mjs', 'scripts/objective-analyser.mjs']),
      n('intent_program', 'IntentProgram V1 compatibility IR', 'partial', 'Typed work occurrences and topology', ['scripts/intent-program-v1.mjs']),
      n('semantic_ir', 'Semantic Intent IR V2', 'partial', 'Sequence, alternative, conditional and reference graph', ['scripts/semantic-intent-ir-v2.mjs']),
      n('semantic_projection', 'Semantic Intent V2 projection', 'partial', 'Source-bound V2 plus V1 compatibility view', ['scripts/semantic-intent-v2-projection-v1.mjs']),
      n('semantic_certificate', 'Semantic Intent Certificate V2', 'partial', 'Physical counterparse plus internal controls', ['scripts/semantic-intent-certificate-v2.mjs']),
      n('semantic_admission', 'GraphControl semantic admission', 'partial', 'Admitted or explicit refusal before GraphControl', ['scripts/semantic-intent-graph-control-admission-v1.mjs']),
      n('taskspec', 'Frozen TaskSpec V1', 'live', 'Task identity, facts, constraints and acceptance', ['scripts/intent-compiler.mjs', 'scripts/task-spec-artifact-store.mjs']),
      n('goal_capsule', 'GoalCapsule / proof-carrying intent', 'live', 'Goal, checks, invariants and authority', ['scripts/proof-carrying-intent.mjs']),
      n('goal_refinement', 'Append-only GoalRefinement', 'partial', 'Versioned refinement without rewriting V1', ['scripts/goal-refinement-v1.mjs', 'scripts/goal-refinement-artifact-store-v1.mjs']),
      n('obligations', 'Obligation and acceptance graph', 'partial', 'Required achievements, prohibitions and checks', ['scripts/obligation-compiler.mjs', 'scripts/obligation-coverage.mjs', 'scripts/intent-as-tests.mjs']),
      n('repo_grounding_req', 'Repository grounding requirement', 'live', 'Required versus optional governed evidence', ['scripts/repository-grounding-requirement-v1.mjs']),
      n('clarification_tx', 'Typed ambiguity / clarification transaction', 'substrate', 'Question, alternatives, scope and resume binding', ['scripts/operator-question-bus.mjs']),
      n('epistemic_compiler', 'Universal epistemic compiler', 'blocked', 'Compile instruction, observation, claim, evidence, adversarial text and unknown', [], 'Required to generalise beyond current semantic task lane.'),
    ],
  },
  {
    id: 'authority', label: '02 · AUTHORITY, IDENTITY, EVENT, ARTIFACT, AND RECOVERY PLANE',
    nodes: [
      n('contracts', 'Contracts V9', 'authority', 'Exact TaskEvent and artifact schemas', ['scripts/contracts.mjs']),
      n('event_kernel', 'EventKernel', 'authority', 'Append-only cognitive history and replay brand', ['scripts/event-kernel.mjs']),
      n('task_runtime', 'TaskRuntime', 'authority', 'Sole lifecycle, effect and completion interpreter', ['scripts/task-runtime.mjs']),
      n('binding_bus', 'Cross-graph binding compiler', 'blocked', 'Task, entity, scope, time, epoch, lineage and permitted influence', [], 'Current bindings are distributed across compilers rather than one deep module.'),
      n('task_delta', 'TaskDelta V2', 'live', 'Append-only authority-zero graph/artifact proposals', ['scripts/task-delta-v2.mjs']),
      n('leases', 'Task, worktree, model and authoring leases', 'live', 'Exclusive ownership, heartbeat and expiry', ['scripts/task-runtime.mjs', 'scripts/task-heartbeat.mjs']),
      n('checkpoints', 'Durable checkpoints and handoffs', 'live', 'Restart and exact resume identity', ['scripts/durable-checkpoint.mjs', 'scripts/model-handoff.mjs', 'scripts/arc-checkpoints.mjs']),
      n('effect_ledger', 'Effect request/commit/in-doubt ledger', 'partial', 'Reservation, observation and reconciliation', ['scripts/task-runtime.mjs', 'scripts/governed-action-loop.mjs']),
      n('capability_policy', 'Capability and authority policy', 'partial', 'Legal tool/effect surface', ['scripts/capability-policy.mjs', 'scripts/operator-surface-governance.mjs']),
      n('taint_policy', 'Taint, privacy, egress and secret policy', 'partial', 'Information-flow membrane', ['scripts/prompt-sanitizer.mjs', 'scripts/egress-gateway.mjs', 'scripts/data-retention-policy.mjs']),
      n('task_store', 'TaskSpec and epoch artifact stores', 'live', 'Content-addressed task parents', ['scripts/task-spec-artifact-store.mjs', 'scripts/task-epoch-artifact-store-v1.mjs']),
      n('graph_store', 'TaskGraph artifact store', 'live', 'Content-addressed plan/control artifacts', ['scripts/task-graph-artifact-store.mjs']),
      n('candidate_store', 'Candidate artifact store', 'live', 'Immutable typed candidate bytes', ['scripts/candidate-artifact-v1.mjs']),
      n('verifier_stores', 'Verifier/oracle artifact stores', 'substrate', 'Capsule, experiment, result, commitment and adequacy bytes', ['scripts/verifier-capsule-artifact-store.mjs', 'scripts/verifier-experiment-artifact-store-v1.mjs', 'scripts/verifier-result-artifact-store.mjs', 'scripts/oracle-construction-commitment-store-v1.mjs']),
      n('runtime_receipts', 'RuntimeInvocationReceipt store', 'partial', 'Signed physical invocation identity', ['scripts/runtime-invocation-receipt-v1.mjs']),
      n('state_root', 'External mutable state root', 'live', 'XDG state outside checkout', ['scripts/path-resolver.mjs']),
      n('recovery_baseline', 'Recovery baseline and rescue ref', 'live', 'Private full visible-state and Git recovery', ['scripts/recovery-baseline-v1.mjs']),
      n('hygiene', 'Worktree hygiene and Holt', 'live', 'Stable-boundary and preservation gates', ['scripts/worktree-hygiene-v1.mjs']),
      n('canon', 'Canon registry, findings and authority events', 'authority', 'Protected intent versus measured implementation truth', ['CODEX.md', 'docs/canon/CANONICAL-DOCS.json', 'scripts/canon-governance.mjs']),
    ],
  },
  {
    id: 'belief_control', label: '03 · BELIEF, EVIDENCE, EXPERIMENT, AND DYNAMIC CONTROL PLANE',
    nodes: [
      n('decision_state', 'TaskDecisionState V1', 'partial', 'Known, believed, contested, unknown, forbidden and resources', ['scripts/task-decision-state-v1.mjs']),
      n('epistemic_graph', 'Epistemic claim/evidence graph', 'partial', 'Support, refute, contradiction and open-world absence', ['scripts/epistemic-graph-v1.mjs']),
      n('absence_graph', 'Absence, inhibition and invalidation graph', 'partial', 'Unavailable, stale, forbidden, omitted and unsafe', ['scripts/task-decision-state-v1.mjs']),
      n('bootstrap_plan', 'Semantic bootstrap PlanGraph', 'live', 'Single authority-free starting frontier', ['scripts/task-bootstrap-plan-v1.mjs']),
      n('work_profile', 'Task-conditioned workflow profile', 'partial', 'Work kinds, required achievements and legal operators', ['scripts/task-conditioned-workflow-v1.mjs']),
      n('control_hypergraph', 'Control hypergraph', 'partial', 'AND obligations, OR tactics, guards, joins and outcomes', ['scripts/task-conditioned-workflow-v1.mjs']),
      n('decision_frontier', 'Decision frontier plan', 'partial', 'Open decision regions and branch candidates', ['scripts/decision-frontier-v1.mjs']),
      n('graph_control', 'GraphControl Kernel V2', 'partial', 'Bounded shadow decision and cycle compiler', ['scripts/graph-control-kernel-v2.mjs']),
      n('evidence_cycle', 'Evidence-conditioned GraphControl cycle', 'partial', 'Exactly one bounded retry after a typed observation', ['scripts/graph-control-evidence-cycle-v1.mjs']),
      n('repo_probe', 'Epistemic repository probe', 'partial', 'Code-owned bounded repository observation', ['scripts/epistemic-repository-probe-v1.mjs']),
      n('evidence_condition', 'GraphControl evidence condition', 'partial', 'Exact baseline/observation/relevance/context binding', ['scripts/graph-control-evidence-condition-v1.mjs']),
      n('candidate_eligibility', 'Candidate eligibility law', 'partial', 'Typed evidence opens only unverified candidate lifecycle', ['scripts/graph-control-candidate-eligibility-v1.mjs']),
      n('adaptive_plan', 'Adaptive plan proposal and schedule', 'partial', 'Authority-zero branches, budget and ordering', ['scripts/adaptive-plan-governor-v1.mjs', 'scripts/dynamic-branch-schedule-v1.mjs']),
      n('branch_invocation', 'Dynamic branch invocation', 'partial', 'Request, start, result and join identity', ['scripts/dynamic-branch-invocation-v1.mjs', 'scripts/dynamic-branch-execution-ledger-v1.mjs']),
      n('branch_output', 'Typed branch model output', 'partial', 'Claims/hypotheses only, never effects', ['scripts/dynamic-branch-model-output-v1.mjs', 'scripts/dynamic-branch-model-output-rejection-v1.mjs']),
      n('epistemic_eval', 'Epistemic evaluation frontier', 'partial', 'Independent-evidence need and next decision', ['scripts/epistemic-evaluation-frontier-v1.mjs']),
      n('author_action', 'AuthorAction admission', 'partial', 'Clarify, gather evidence, unresolved or typed candidate proposal', ['scripts/author-action-admission-v1.mjs']),
      n('experiment_designer', 'Active experiment/counterexample designer', 'partial', 'Hypothesis, discriminating action, cost, risk and stop law', ['scripts/research-entropy-trigger.mjs', 'scripts/mutation-oracle.mjs']),
      n('homeostat', 'Computational homeostat', 'blocked', 'Expected decision-loss reduction per token/GPU/time/money/risk', [], 'Budgets exist but are not one decision controller.'),
      n('graph_program', 'Universal GraphProgram compiler', 'blocked', 'Compile any task into recursive finite typed epochs', [], 'The current controller covers a bounded subset.'),
    ],
  },
  {
    id: 'context', label: '04 · CONTEXT, REPOSITORY, RETRIEVAL, EXPOSURE, AND COMPACTION PLANE',
    nodes: [
      n('context_program', 'Universal ContextProgram', 'blocked', 'Per-node required facts, selectors, budgets, visibility and loss ledger', [], 'Current context paths remain fragmented.'),
      n('context_compiler', 'ContextCompiler', 'partial', 'Bounded repository context packets', ['scripts/context-compiler.mjs']),
      n('repo_index', 'Repository index readiness', 'partial', 'Head-bound index state', ['scripts/ensure-repo-index.mjs']),
      n('symbol_graph', 'Symbol/call/reference graph', 'partial', 'Definitions, callers, callees and neighbourhoods', ['scripts/graph-query.mjs', 'scripts/repo-graph/build-repo-graph.mjs']),
      n('scip', 'SCIP index lane', 'partial', 'Cross-language semantic edges', ['scripts/scip-indexer.mjs', 'scripts/scip-context-discovery.mjs']),
      n('lsp', 'LSP semantic lane', 'partial', 'Definitions, references and diagnostics', ['scripts/lsp-semantic-index.mjs', 'scripts/lsp-diagnostics.mjs']),
      n('static_analysis', 'AST/CFG/call-graph lanes', 'partial', 'Language-specific structure and FFI', ['scripts/ast-extractor.mjs', 'scripts/symbol-call-graph.mjs']),
      n('code_rag', 'Lexical/codebase RAG lane', 'partial', 'Text overlap proposer', ['scripts/codebase-rag.mjs']),
      n('hybrid_retrieval', 'Hybrid retrieval and RRF', 'partial', 'Lexical, graph and embedding fusion', ['scripts/hybrid-code-retrieval.mjs', 'scripts/listwise-rerank.mjs']),
      n('vector_lane', 'Embedding/vector lane', 'partial', 'Noisy similarity proposer only', ['scripts/lib/embeddings.mjs']),
      n('structural_context', 'Structural target context', 'partial', 'Imports, definitions, signatures and neighbours', ['scripts/structural-context-facts.mjs']),
      n('memory_join', 'Repo-graph memory join', 'partial', 'Target-bound recalled conventions and facts', ['scripts/repo-graph/repo-graph-memory-join.mjs']),
      n('reference_facts', 'Reference facts grounding', 'partial', 'Coverage-aware source facts', ['scripts/reference-facts-grounding.mjs']),
      n('installed_deps', 'Installed dependency context', 'partial', 'Package/library definitions', ['scripts/installed-dep-context.mjs']),
      n('skills_context', 'Skills and practice-pack context', 'partial', 'Task-conditioned procedural instructions', ['scripts/skills-registry.mjs', 'scripts/practice-packs.mjs']),
      n('working_set', 'Dynamic branch working set', 'partial', 'Exact model-visible evidence and token budget', ['scripts/dynamic-branch-working-set-v1.mjs']),
      n('context_manifest', 'Context and exposure manifest', 'partial', 'Physical, visible, citable and evaluator-only refs', ['scripts/dynamic-branch-context-manifest-v1.mjs', 'scripts/candidate-exposure-manifest-v1.mjs']),
      n('token_budget', 'Token and prompt budget authority', 'partial', 'Exact tokenization, narrowing and overflow policy', ['scripts/token-count.mjs', 'scripts/prompt-budget-authority.mjs', 'scripts/symbol-span-narrowing.mjs']),
      n('compaction', 'Semantic no-loss compaction', 'substrate', 'Representation change with residual/loss accounting', ['scripts/prompt-compressor.mjs', 'scripts/phase-compaction.mjs']),
      n('freshness', 'Context freshness controller/watchdog', 'partial', 'Index staleness and refresh plan', ['scripts/freshness-controller.mjs', 'scripts/context-watchdog.mjs']),
    ],
  },
  {
    id: 'routing_tools', label: '05 · MODEL, SPECIALIST, SUBAGENT, TOOL, SANDBOX, AND EFFECT ROUTING',
    nodes: [
      n('route_policy', 'Competence/independence-aware route policy', 'blocked', 'Hard legality filter then robust value selection', [], 'Current routing is rule/catalog based, not held-out competence based.'),
      n('model_router', 'Model router and escalation', 'partial', 'Task class to model/runtime', ['scripts/model-router.mjs', 'scripts/model-escalation-policy.mjs', 'scripts/calibrated-routing.mjs']),
      n('specialists', 'Specialist registry', 'partial', '19 specialist identities and capability classes', ['scripts/specialist-registry.mjs']),
      n('local_llama', 'Local llama-server transport', 'partial', 'Pinned local completion transport', ['scripts/local-llama-server-transport.mjs', 'scripts/runtime-attested-local-model-v1.mjs']),
      n('qwen9b', 'Qwen3.5 9B local model', 'partial', 'Primary local author/deliberator', ['scripts/start-9b-server.sh']),
      n('ollama', 'Ollama compatibility runtime', 'partial', 'Compatibility serving adapter', ['scripts/local-models.mjs']),
      n('cloud_providers', 'Cloud provider transports', 'substrate', 'OpenRouter, DeepSeek and Cerebras adapters', ['scripts/provider-gateway.mjs', 'scripts/governed-openrouter-transport.mjs', 'scripts/governed-deepseek-transport.mjs', 'scripts/governed-cerebras-transport.mjs']),
      n('multi_agent', 'Bounded multi-agent orchestration', 'partial', 'Independent packets, joins and shared-cache laws', ['scripts/subagent-orchestrator.mjs', 'scripts/sequential-subagent-coordinator.mjs', 'scripts/multi-agent-orchestration.mjs']),
      n('tool_registry', 'Capability/tool registry', 'partial', 'Typed tool identities and grants', ['scripts/mcp-federation-manifest.mjs', 'scripts/capability-policy.mjs']),
      n('terminal_tool', 'Governed terminal/file operations', 'partial', 'Command, read, write and patch effects', ['scripts/bash-action-transport.mjs', 'scripts/governed-action-loop.mjs']),
      n('browser_tool', 'Browser and web adapters', 'partial', 'Browser session and governed retrieval', ['scripts/arc-browser.mjs', 'scripts/searxng-web-search.mjs']),
      n('research_tools', 'Research/MCP connectors', 'partial', 'Search, crawl, academic and docs sources', ['scripts/research-crawler.mjs', 'scripts/mcp-federation-policy.mjs']),
      n('solver_tools', 'Compilers, tests, SMT/CAS and simulation', 'partial', 'Deterministic domain operators', ['scripts/deterministic-verifier.mjs', 'scripts/environment-provisioner.mjs']),
      n('sandbox', 'Sandbox and containment', 'partial', 'bwrap, Landlock, seccomp, no-network and allowlists', ['scripts/arc-os-sandbox.mjs', 'scripts/sandbox-engine.mjs', 'scripts/verifier-executor-v1.mjs']),
      n('egress', 'Egress gateway', 'partial', 'Network/data exfiltration policy', ['scripts/egress-gateway.mjs']),
      n('host_commit', 'Host commit broker', 'partial', 'Governed host-side Git effects', ['scripts/host-commit-broker.mjs']),
      n('competence_graph', 'Measured competence graph', 'blocked', 'Success, calibration, cost, latency and failure mechanisms by route', [], 'Must be learned from held-out outcomes.'),
      n('independence_graph', 'Mechanism independence graph', 'blocked', 'Shared model, prompt, source, verifier, tool and failure roots', [], 'Required before confidence aggregation.'),
    ],
  },
  {
    id: 'work', label: '06 · CODING, RESEARCH, REASONING, REPRESENTATION, AND DOMAIN WORK',
    nodes: [
      n('chat_turn', 'Chat turn runner', 'live', 'Product routing and response/candidate orchestration', ['scripts/chat-turn-runner.mjs']),
      n('coordinator', 'Chat loop coordinator', 'partial', 'Repo/test discovery, context and coding coordination', ['scripts/chat-loop-coordinator.mjs']),
      n('decomposition', 'Multi-target decomposition', 'partial', 'Per-target pipelines and joins', ['scripts/chat-loop-decomposition.mjs']),
      n('frontier_coding', 'Frontier coding runner', 'partial', 'Localization, context, generation, selection and verification', ['scripts/frontier-coding-runner.mjs']),
      n('beam', 'Verifier-guided beam search', 'partial', 'Candidate diversity, ranking and selection', ['scripts/verifier-guided-beam-search.mjs']),
      n('coding_loop', 'ReliableCodingLoop legacy executor', 'partial', 'Provision, edit, apply, test and telemetry', ['scripts/reliable-coding-loop.mjs']),
      n('patch_generator', 'Governed patch generator', 'partial', 'Typed patch generation seam', ['scripts/governed-patch-generator.mjs']),
      n('patch_repair', 'Patch parse/reanchor/salvage ladder', 'partial', 'Deterministic recovery without widening authority', ['scripts/deterministic-diff-reanchor.mjs', 'scripts/fastapply-safety-gate.mjs', 'scripts/fabrication-salvage.mjs']),
      n('acceptance', 'Existing-repo acceptance and obligations', 'partial', 'Behavioral acceptance checks', ['scripts/existing-repo-acceptance.mjs', 'scripts/obligation-oracle.mjs']),
      n('mutation_property', 'Mutation/property/metamorphic probes', 'partial', 'Candidate fault discrimination', ['scripts/mutation-oracle.mjs', 'scripts/property-metamorphic-oracle.mjs', 'scripts/ast-metamorphic-oracle.mjs']),
      n('research_entry', 'Deep research specialist', 'partial', 'TaskSpec-bound research entry', ['scripts/deep-research-specialist.mjs']),
      n('research_pipeline', 'Research V2 pipeline', 'partial', 'Plan, retrieve, gap loop, synthesis and validation', ['scripts/deep-research/research-v2-pipeline.mjs']),
      n('gap_ledger', 'Gap ledger', 'partial', 'Typed unknowns, budgets and convergence', ['scripts/deep-research/gap-ledger.mjs']),
      n('evidence_bank', 'Evidence bank', 'partial', 'Sources, claims and outline structure', ['scripts/deep-research/evidence-bank.mjs']),
      n('research_dep_graph', 'Research dependency/contradiction graph', 'partial', 'Claim dependencies and contradictions', ['scripts/deep-research/dependency-graph.mjs']),
      n('research_checkpoint', 'Research checkpoint/continuation', 'partial', 'Crash and budget resume', ['scripts/deep-research/research-checkpoint.mjs', 'scripts/deep-research/research-continuation-packet.mjs']),
      n('source_validation', 'Source, citation, FACT/CoVe/RARR checks', 'partial', 'Research evidence quality and abstention', ['scripts/deep-research/source-validator.mjs', 'scripts/deep-research/research-citations.mjs']),
      n('domain_routes', '57 domain routing configurations', 'partial', 'Domain signals, sources and negatives', ['scripts/domain-source-registry.mjs']),
      n('domain_packs', '3 executable domain packs', 'partial', 'Physics, pure mathematics and theoretical CS', ['scripts/deep-research/domain-packs.mjs']),
      n('representation_bridge', 'Prose/code/equation/proof/table/media bridge', 'blocked', 'Semantics-preserving representation transformations', [], 'Needed for open-world generality.'),
      n('black_hole', 'Black-hole scientific transfer', 'blocked', 'Tri-state events, convergence and independent reference', ['scripts/black-hole-hidden-experiment-v1.mjs', 'scripts/black-hole-semantic-protocol-v2.mjs']),
    ],
  },
  {
    id: 'candidate', label: '07 · AUTHORING, CANDIDATE, WORKSPACE, AND EXPOSURE LINEAGE',
    nodes: [
      n('author_context', 'GraphControl AuthorContext', 'live', 'Typed authority-zero hypotheses and evidence', ['scripts/graph-control-author-context-v1.mjs']),
      n('greenfield_author', 'Greenfield candidate author', 'partial', 'Frozen TaskSpec plus author context to packet', ['scripts/greenfield-candidate-author-v1.mjs']),
      n('patch_author', 'Existing-repo patch author', 'partial', 'Governed patch prompt and receipt binding', ['scripts/governed-patch-generator.mjs']),
      n('author_receipt', 'Runtime-signed candidate-author receipt', 'blocked', 'Exact author prompt, model, runtime, response and candidate binding', [], 'GraphControl calls are signed; candidate-author coverage remains launch work.'),
      n('greenfield_packet', 'Greenfield candidate packet V2', 'live', 'Typed multi-file candidate payload', ['scripts/greenfield-candidate-packet-v2.mjs']),
      n('patch_packet', 'Patch candidate packet V1', 'live', 'Exact unified diff, targets and source lineage', ['scripts/patch-candidate-packet-v1.mjs']),
      n('candidate_artifact', 'CandidateArtifact V1', 'live', 'Content-addressed candidate identity', ['scripts/candidate-artifact-v1.mjs']),
      n('exposure_manifest', 'Candidate exposure manifest', 'partial', 'Author-visible and evaluator-hidden lineage', ['scripts/candidate-exposure-manifest-v1.mjs']),
      n('candidate_proposed', 'CandidateProposed event', 'live', 'Exact task/candidate/oracle parent', ['scripts/task-runtime.mjs']),
      n('workspace_router', 'CandidateWorkspaceRouter V1', 'live', 'Source-derived greenfield/patch dispatch', ['scripts/candidate-workspace-router-v1.mjs']),
      n('greenfield_workspace', 'Greenfield workspace store', 'live', 'Immutable file materialization', ['scripts/candidate-workspace-v1.mjs']),
      n('patch_workspace', 'Patch workspace store', 'live', 'Repo-base-bound patch materialization', ['scripts/patch-candidate-workspace-v1.mjs']),
      n('candidate_materialized', 'CandidateMaterialized event', 'live', 'Exact workspace manifest and candidate lineage', ['scripts/task-runtime.mjs']),
      n('current_workspace_check', 'Strict-current workspace verification', 'live', 'Refuse source/repository drift before effects', ['scripts/task-runtime.mjs']),
    ],
  },
  {
    id: 'verification', label: '08 · ORACLE FOUNDRY, HIDDEN EVALUATION, VERIFIER, MUTATION, AND TRI-STATE',
    nodes: [
      n('oracle_commitment', 'Oracle construction commitment', 'substrate', 'Pre-candidate sealed public commitment', ['scripts/oracle-construction-commitment-v1.mjs', 'scripts/oracle-construction-commitment-store-v1.mjs']),
      n('oracle_adequacy', 'Oracle portfolio adequacy', 'substrate', 'Fault families, controls, witnesses and transfer', ['scripts/oracle-portfolio-adequacy-v1.mjs']),
      n('coverage_tensor', 'Oracle coverage tensor', 'substrate', 'Diagnostic applicability/coverage projection', ['scripts/oracle-coverage-tensor-v1.mjs']),
      n('co_mutation', 'Oracle co-mutation projections', 'substrate', 'Candidate and oracle mutation diagnostics', ['scripts/oracle-co-mutation-v1.mjs', 'scripts/oracle-joint-co-mutation-v1.mjs']),
      n('verifier_template', 'Verifier template binding', 'substrate', 'Task/candidate/oracle verifier contract', ['scripts/verifier-template-binding-v1.mjs']),
      n('verifier_capsule', 'VerifierCapsule V1', 'substrate', 'Exact executable verifier admission packet', ['scripts/verifier-capsule-v1.mjs']),
      n('verifier_experiment', 'Verifier experiment and discrimination', 'substrate', 'Positive, negative and mutation controls', ['scripts/verifier-experiment-v1.mjs', 'scripts/verifier-discrimination-v1.mjs']),
      n('execution_store', 'Admitted verifier execution store', 'substrate', 'Reservation, prepared result and in-doubt recovery', ['scripts/admitted-verifier-execution-v1.mjs']),
      n('contained_executor', 'Contained verifier executor', 'substrate', 'Pinned bwrap/runtime/executable with no network', ['scripts/verifier-executor-v1.mjs', 'scripts/runtime-attested-verifier-v1.mjs']),
      n('verifier_result', 'VerifierResult artifact/event', 'substrate', 'Verdict plus exact runtime receipt lineage', ['scripts/verifier-result-v1.mjs', 'scripts/verifier-result-artifact-store.mjs']),
      n('oracle_batch', 'Runtime-attested sealed oracle batch', 'blocked', 'Code-owned cases, controls, receipts and exact denominator', ['scripts/runtime-attested-oracle-batch-v1.mjs'], 'Integrity projection exists; promotional runtime transaction is not installed.'),
      n('private_evaluator', 'Private semantic evaluator store', 'substrate', 'Encrypted private plans, attempts and reconciliation', ['scripts/private-semantic-evaluator-v1.mjs']),
      n('mutation_matrix', 'Candidate × oracle × fault matrix', 'blocked', 'Base, candidate mutant, oracle mutant and double-fault cancellation', [], 'Must be derived from physical signed executions.'),
      n('tri_state', 'Supported / refuted / unresolved law', 'blocked', 'Exact controls, coverage, receipts and abstention', [], 'Current daemon evaluation records unresolved only.'),
      n('oracle_evaluation', 'Candidate-bound OracleEvaluationRecorded', 'blocked', 'Promotional candidate-specific evaluation', ['scripts/task-runtime.mjs'], 'Current producer is deliberately unresolved and non-promotional.'),
      n('blackhole_reference', 'Black-hole independent numerical reference', 'blocked', 'Tri-state event/convergence/exact-binding witness', ['scripts/black-hole-verifier-calibration-v1.mjs']),
    ],
  },
  {
    id: 'effects', label: '09 · CANDIDATE-SPECIFIC EFFECT, RECONCILIATION, POST-VERIFY, AND COMPLETION',
    nodes: [
      n('effect_admission', 'Candidate-specific effect admission', 'blocked', 'Exact supported evaluation plus current workspace', ['scripts/product-task-terminal-bridge-v1.mjs'], 'Bridge deliberately refuses because transaction is absent.'),
      n('effect_reservation', 'Effect reservation', 'blocked', 'Idempotency key and exact candidate bytes', [], 'Must precede external mutation.'),
      n('apply_effect', 'Governed patch/app effect', 'blocked', 'Apply exact immutable candidate in isolated worktree', [], 'Legacy apply exists but is not candidate-bound promotion authority.'),
      n('effect_observation', 'EffectObserved / EffectInDoubt', 'blocked', 'Physical state, receipt and uncertainty', [], 'Required for crash-safe reconciliation.'),
      n('reconciliation', 'External effect reconciliation', 'blocked', 'Inspect before retry; compensate where legal', [], 'No blind exactly-once claim.'),
      n('post_effect_verify', 'Post-effect candidate-bound verification', 'blocked', 'Same oracle lineage against observed state', [], 'Required before promotion.'),
      n('complete_candidate', 'completeCandidate transaction', 'blocked', 'Exact candidate/evaluation/effect promotion', ['scripts/task-runtime.mjs'], 'Projection-only fixture completion is quarantined.'),
      n('task_completed', 'TaskCompleted event', 'blocked', 'Final authoritative product success', ['scripts/event-kernel.mjs']),
      n('terminal_bridge', 'Product terminal bridge', 'partial', 'Exact lineage/current-source check then honest refusal', ['scripts/product-task-terminal-bridge-v1.mjs']),
    ],
  },
  {
    id: 'memory_learning', label: '10 · EPISODIC MEMORY, CLAIM MEMORY, PROCEDURAL LEARNING, COMPETENCE, AND PLASTICITY',
    nodes: [
      n('episodic_memory', 'EventKernel episodic history', 'live', 'Immutable task episodes', ['scripts/event-kernel.mjs']),
      n('governed_memory', 'Governed memory store', 'partial', 'Authoritative admitted claims', ['scripts/governed-memory.mjs'], 'Available but currently empty in the measured self-model.'),
      n('agent_memory', 'Agent advisory memory', 'partial', 'Advisory task memories', ['scripts/agent-memory.mjs']),
      n('project_intent_memory', 'Project intent store', 'partial', 'Active feature and project facts', ['scripts/project-intent-store.mjs']),
      n('semantic_cache', 'Semantic cache', 'partial', 'Advisory derived context', ['scripts/semantic-cache.mjs']),
      n('research_memory', 'Research memory', 'partial', 'Advisory evidence-backed research records', ['scripts/deep-research/research-context-mount.mjs']),
      n('vector_store', 'Vector memory store', 'substrate', 'Experimental similarity index', ['scripts/memory-vector-index.mjs']),
      n('letta_archive', 'Letta archival memory', 'substrate', 'Experimental advisory archive', ['scripts/letta-kernel.mjs']),
      n('memory_recall', 'Recall, anchor, budget and signals', 'partial', 'Task-conditioned advisory retrieval', ['scripts/memory-intent-anchor.mjs', 'scripts/memory-retrieval-budget.mjs', 'scripts/memory-recall-signals.mjs']),
      n('memory_write', 'Harvest, surprise and utility events', 'partial', 'Outcome-conditioned nominations', ['scripts/memory-harvest-producer.mjs', 'scripts/memory-surprise-gate.mjs', 'scripts/memory-utility-events.mjs']),
      n('reconsolidation', 'Reconsolidation, contradiction and supersession', 'partial', 'Revise or tombstone scoped memory', ['scripts/memory-reconsolidation.mjs']),
      n('scope_promotion', 'Cross-task/repo scope promotion', 'substrate', 'Bounded promotion with counter-triggers', ['scripts/memory-scope-promotion.mjs']),
      n('sleep_consolidation', 'Sleep clock and consolidation', 'partial', 'Slow background nomination/consolidation', ['scripts/sleep-clock.mjs', 'scripts/memory-consolidation-scheduler.mjs']),
      n('procedural_memory', 'Mechanism-level procedural memory', 'blocked', 'Reusable scoped intervention, trigger, falsifier and rollback', [], 'Outcome hoarding must not replace mechanism learning.'),
      n('plasticity', 'Reversible plasticity governor', 'blocked', 'Held-out causal benefit, negative transfer and rollback', [], 'Promotion law remains design.'),
      n('self_model', 'Repository/runtime self-model', 'live', 'Generated current substrate census', ['scripts/reconstruction-self-model.mjs']),
    ],
  },
  {
    id: 'product_ops', label: '11 · CLIDE PROJECTION, OBSERVABILITY, SECURITY, OPERATIONS, ONBOARDING, AND RELEASE',
    nodes: [
      n('readonly_projection', 'Verified read-only TaskRuntime snapshot', 'live', 'Task/event/candidate/decision projection', ['scripts/task-runtime.mjs', 'scripts/arc-daemon.mjs']),
      n('tui_protocol', 'CLIDE wire protocol', 'partial', 'Frames and versioned projections', ['apps/arc-tui/src/workspace/protocol.rs', 'apps/arc-tui/src/workspace/daemon.rs']),
      n('tui_state', 'CLIDE workspace state/input/selection', 'partial', 'User navigation and task state', ['apps/arc-tui/src/workspace/state.rs', 'apps/arc-tui/src/workspace/input.rs', 'apps/arc-tui/src/workspace/selection.rs']),
      n('tui_render', 'CLIDE render/layout/panes/markdown/diff', 'partial', 'User-visible product experience', ['apps/arc-tui/src/workspace/render.rs', 'apps/arc-tui/src/workspace/layout.rs', 'apps/arc-tui/src/workspace/panes.rs', 'apps/arc-tui/src/workspace/markdown.rs']),
      n('tui_core', 'Terminal/backend/clipboard/thumbnail', 'partial', 'Local terminal and media substrate', ['apps/arc-tui/src/core/backend.rs', 'apps/arc-tui/src/core/terminal.rs', 'apps/arc-tui/src/core/clipboard.rs', 'apps/arc-tui/src/core/thumbnail.rs']),
      n('tui_onboarding', 'Onboarding and file browser', 'partial', 'Project/model setup and navigation', ['apps/arc-tui/src/onboarding/screens.rs', 'apps/arc-tui/src/onboarding/file_browser.rs']),
      n('observability', 'Run observability and telemetry', 'partial', 'Timeline, events, receipts and metrics', ['scripts/run-observability.mjs', 'scripts/telemetry-bus.mjs', 'scripts/observability-governance.mjs']),
      n('watchdogs', 'Daemon/context/model watchdogs', 'partial', 'Health, liveness and backpressure', ['scripts/watchdog-process.mjs', 'scripts/context-watchdog.mjs']),
      n('storage_retention', 'Storage, retention and lifecycle', 'partial', 'Quota, deletion law, archival and retirement', ['scripts/storage-manager.mjs', 'scripts/data-retention-policy.mjs', 'scripts/lifecycle-retirement-policy.mjs']),
      n('model_onboarding', 'Hardware/model recommender and installer', 'partial', 'Catalog to artifact/runtime setup', ['scripts/onboarding/model-installer.mjs', 'scripts/local-models.mjs']),
      n('service_start', 'Model/daemon service launch', 'partial', 'Pinned local processes and roots', ['scripts/start-9b-server.sh', 'scripts/dev-live.sh']),
      n('budgets', 'Token/GPU/time/money budgets', 'partial', 'Resource ceilings and provider economics', ['scripts/token-enforcer.mjs', 'scripts/model-pricing.mjs', 'scripts/research-budget.mjs']),
      n('failure_ecology', 'Failure ecology and chaos campaigns', 'substrate', 'Restart, stale context, poisoned memory, wrong oracle and malformed tool arms', ['scripts/full-system-stress-harness.mjs', 'scripts/hard-stress-campaign.mjs']),
      n('grand_challenge', 'Answer-free Grand Challenge factory', 'substrate', 'Cross-domain held-out product proof', ['docs/canon/GRAND-CHALLENGE-PROTOCOL.md']),
      n('packaging_release', 'Packaging, signed release and rollback', 'blocked', 'Fresh-machine reproducible launch', ['scripts/packaging-reproducibility.mjs']),
    ],
  },
  {
    id: 'external', label: '12 · EXTERNAL OSS AND SERVICES — ADAPTERS OR PATTERNS, NEVER PEER AUTHORITY',
    nodes: [
      n('ext_langgraph', 'LangGraph / Temporal / n8n', 'external', 'Borrow scheduling, activities and UI patterns', []),
      n('ext_openkb', 'OpenKB', 'external', 'Borrow file/tree/citation/read-only skill patterns', []),
      n('ext_langfuse', 'Langfuse', 'external', 'One-way off-box OTLP/read model', []),
      n('ext_iii', 'iii', 'external', 'Borrow catalog/schema/console patterns only', []),
      n('ext_vector', 'Vector databases', 'external', 'Rebuildable similarity proposer', []),
      n('ext_graphdb', 'FalkorDB / graph databases', 'external', 'Optional derived query projection', ['scripts/falkordb-engine.mjs']),
      n('ext_models', 'Model providers and local runtimes', 'external', 'Adapters behind governed route policy', []),
      n('ext_mcp', 'MCP/connectors/browser/office ecosystem', 'external', 'Phase-gated capability adapters', []),
    ],
  },
]

const e = (from, to, label = '', kind = 'flow') => ({ from, to, label, kind })
const edges = [
  e('owner', 'intent_map', 'protects'), e('owner', 'ws', 'task/interjection'), e('clide', 'ws', 'frames'), e('cli', 'chat_modes'), e('ws', 'chat_modes'), e('attachments', 'sanitizer'),
  e('chat_modes', 'raw_source'), e('intent_map', 'taskspec', 'normative parent', 'durable'), e('raw_source', 'sanitizer'), e('sanitizer', 'source_atoms'), e('source_atoms', 'ud_lane'),
  e('source_atoms', 'semantic_ir'), e('ud_lane', 'semantic_certificate'), e('intent_compiler', 'taskspec'), e('intent_program', 'semantic_projection'), e('semantic_ir', 'semantic_projection'),
  e('semantic_projection', 'semantic_certificate'), e('semantic_certificate', 'semantic_admission'), e('semantic_admission', 'task_runtime', 'admit/refuse', 'durable'), e('taskspec', 'goal_capsule'), e('goal_capsule', 'obligations'),
  e('goal_capsule', 'goal_refinement'), e('taskspec', 'repo_grounding_req'), e('semantic_admission', 'clarification_tx', 'unsupported', 'advisory'), e('epistemic_compiler', 'semantic_ir', 'future', 'missing'),

  e('contracts', 'event_kernel', 'validates', 'durable'), e('event_kernel', 'task_runtime', 'replay state', 'durable'), e('task_runtime', 'event_kernel', 'private append', 'durable'),
  e('binding_bus', 'event_kernel', 'future complete join', 'missing'), e('task_delta', 'event_kernel', 'shadow proposal', 'durable'), e('leases', 'task_runtime'), e('checkpoints', 'task_runtime'),
  e('capability_policy', 'task_runtime'), e('taint_policy', 'capability_policy'), e('effect_ledger', 'event_kernel'), e('task_store', 'event_kernel'), e('graph_store', 'event_kernel'),
  e('candidate_store', 'event_kernel'), e('verifier_stores', 'event_kernel'), e('runtime_receipts', 'event_kernel'), e('state_root', 'event_kernel'), e('recovery_baseline', 'hygiene'),
  e('hygiene', 'canon', 'stable boundary'), e('canon', 'intent_map', 'registers authority', 'durable'),

  e('task_runtime', 'decision_state'), e('taskspec', 'decision_state'), e('goal_capsule', 'decision_state'), e('epistemic_graph', 'decision_state'), e('absence_graph', 'decision_state'),
  e('decision_state', 'bootstrap_plan'), e('bootstrap_plan', 'work_profile'), e('work_profile', 'control_hypergraph'), e('control_hypergraph', 'decision_frontier'), e('decision_frontier', 'graph_control'),
  e('semantic_admission', 'graph_control'), e('graph_control', 'adaptive_plan'), e('adaptive_plan', 'branch_invocation'), e('branch_invocation', 'working_set'), e('working_set', 'branch_output'),
  e('branch_output', 'epistemic_eval'), e('epistemic_eval', 'author_action'), e('epistemic_eval', 'repo_probe', 'evidence request'), e('repo_probe', 'evidence_condition'), e('evidence_condition', 'evidence_cycle'),
  e('evidence_cycle', 'graph_control', 'epoch N+1'), e('evidence_condition', 'candidate_eligibility'), e('candidate_eligibility', 'author_action'), e('experiment_designer', 'epistemic_graph'),
  e('homeostat', 'adaptive_plan', 'future VOI', 'missing'), e('graph_program', 'control_hypergraph', 'future universal compile', 'missing'),

  e('repo_grounding_req', 'context_program'), e('context_compiler', 'working_set'), e('repo_index', 'context_compiler'), e('symbol_graph', 'context_compiler'), e('scip', 'symbol_graph'), e('lsp', 'symbol_graph'),
  e('static_analysis', 'symbol_graph'), e('code_rag', 'hybrid_retrieval'), e('vector_lane', 'hybrid_retrieval'), e('symbol_graph', 'hybrid_retrieval'), e('hybrid_retrieval', 'context_compiler'),
  e('structural_context', 'context_compiler'), e('memory_join', 'context_compiler'), e('reference_facts', 'context_compiler'), e('installed_deps', 'context_compiler'), e('skills_context', 'context_compiler'),
  e('context_manifest', 'working_set'), e('token_budget', 'working_set'), e('compaction', 'working_set'), e('freshness', 'repo_index'), e('context_program', 'working_set', 'future unified compile', 'missing'),

  e('decision_state', 'route_policy'), e('homeostat', 'route_policy', 'future'), e('competence_graph', 'route_policy', 'future', 'missing'), e('independence_graph', 'route_policy', 'future', 'missing'),
  e('route_policy', 'model_router', 'future selection', 'missing'), e('model_router', 'local_llama'), e('local_llama', 'qwen9b'), e('model_router', 'ollama'), e('model_router', 'cloud_providers'),
  e('model_router', 'specialists'), e('model_router', 'multi_agent'), e('capability_policy', 'tool_registry'), e('tool_registry', 'terminal_tool'), e('tool_registry', 'browser_tool'), e('tool_registry', 'research_tools'),
  e('tool_registry', 'solver_tools'), e('sandbox', 'terminal_tool'), e('sandbox', 'contained_executor'), e('egress', 'browser_tool'), e('egress', 'research_tools'), e('host_commit', 'effect_admission'),

  e('chat_modes', 'chat_turn'), e('chat_turn', 'coordinator'), e('coordinator', 'decomposition'), e('coordinator', 'frontier_coding'), e('decomposition', 'frontier_coding'), e('context_compiler', 'frontier_coding'),
  e('frontier_coding', 'beam'), e('beam', 'coding_loop'), e('coding_loop', 'patch_generator'), e('patch_generator', 'patch_repair'), e('patch_repair', 'acceptance'), e('mutation_property', 'beam'),
  e('chat_turn', 'research_entry'), e('research_entry', 'research_pipeline'), e('research_pipeline', 'gap_ledger'), e('research_pipeline', 'evidence_bank'), e('gap_ledger', 'research_dep_graph'),
  e('source_validation', 'evidence_bank'), e('research_checkpoint', 'research_pipeline'), e('research_tools', 'research_pipeline'), e('domain_routes', 'research_pipeline'), e('domain_packs', 'solver_tools'),
  e('representation_bridge', 'domain_packs', 'future', 'missing'), e('black_hole', 'oracle_batch', 'transfer', 'missing'), e('evidence_bank', 'epistemic_graph', 'typed plan delta', 'advisory'),

  e('author_action', 'author_context'), e('author_context', 'greenfield_author'), e('author_context', 'patch_author'), e('model_router', 'greenfield_author'), e('model_router', 'patch_author'),
  e('greenfield_author', 'author_receipt', 'missing receipt', 'missing'), e('patch_author', 'author_receipt', 'missing receipt', 'missing'), e('greenfield_author', 'greenfield_packet'), e('patch_author', 'patch_packet'),
  e('greenfield_packet', 'candidate_artifact'), e('patch_packet', 'candidate_artifact'), e('exposure_manifest', 'candidate_artifact'), e('candidate_artifact', 'candidate_proposed', 'append', 'durable'),
  e('candidate_proposed', 'workspace_router'), e('workspace_router', 'greenfield_workspace'), e('workspace_router', 'patch_workspace'), e('greenfield_workspace', 'candidate_materialized'), e('patch_workspace', 'candidate_materialized'),
  e('candidate_materialized', 'current_workspace_check'),

  e('oracle_commitment', 'candidate_proposed', 'pre-candidate parent', 'durable'), e('oracle_adequacy', 'coverage_tensor'), e('oracle_adequacy', 'co_mutation'), e('oracle_commitment', 'oracle_batch'),
  e('candidate_materialized', 'oracle_batch'), e('private_evaluator', 'oracle_batch'), e('verifier_template', 'verifier_capsule'), e('verifier_capsule', 'execution_store'), e('verifier_experiment', 'execution_store'),
  e('execution_store', 'contained_executor'), e('contained_executor', 'runtime_receipts'), e('runtime_receipts', 'verifier_result'), e('verifier_result', 'oracle_batch'), e('mutation_matrix', 'oracle_batch', 'required', 'missing'),
  e('oracle_batch', 'tri_state', 'derive', 'missing'), e('tri_state', 'oracle_evaluation', 'append', 'missing'), e('blackhole_reference', 'oracle_batch', 'transfer witness', 'missing'),

  e('oracle_evaluation', 'effect_admission', 'supported only', 'missing'), e('current_workspace_check', 'effect_admission'), e('terminal_bridge', 'effect_admission', 'currently refuses'), e('effect_admission', 'effect_reservation', '', 'missing'),
  e('effect_reservation', 'apply_effect', '', 'missing'), e('apply_effect', 'effect_observation', '', 'missing'), e('effect_observation', 'reconciliation', 'if in doubt', 'missing'),
  e('effect_observation', 'post_effect_verify', 'if observed', 'missing'), e('post_effect_verify', 'complete_candidate', '', 'missing'), e('complete_candidate', 'task_completed', 'append', 'missing'), e('task_completed', 'delivery'),

  e('event_kernel', 'episodic_memory'), e('epistemic_graph', 'governed_memory'), e('project_intent_memory', 'taskspec', 'advisory parent'), e('semantic_cache', 'context_compiler'), e('research_memory', 'research_pipeline'),
  e('vector_store', 'memory_recall'), e('letta_archive', 'memory_recall'), e('governed_memory', 'memory_recall'), e('memory_recall', 'memory_join'), e('task_completed', 'memory_write', 'outcome'),
  e('memory_write', 'reconsolidation'), e('reconsolidation', 'scope_promotion'), e('sleep_consolidation', 'reconsolidation'), e('scope_promotion', 'plasticity', 'future', 'missing'),
  e('plasticity', 'procedural_memory', 'future', 'missing'), e('procedural_memory', 'skills_context', 'future', 'missing'), e('self_model', 'competence_graph', 'future evidence', 'missing'),

  e('event_kernel', 'readonly_projection'), e('readonly_projection', 'tui_protocol'), e('tui_protocol', 'tui_state'), e('tui_state', 'tui_render'), e('tui_core', 'tui_render'), e('tui_onboarding', 'clide'),
  e('tui_render', 'clide'), e('event_kernel', 'observability'), e('runtime_receipts', 'observability'), e('watchdogs', 'service_start'), e('storage_retention', 'state_root'), e('model_onboarding', 'service_start'),
  e('service_start', 'qwen9b'), e('budgets', 'homeostat', 'future unified control', 'missing'), e('failure_ecology', 'grand_challenge'), e('grand_challenge', 'packaging_release', 'after product proof', 'missing'),

  e('ext_langgraph', 'adaptive_plan', 'borrow patterns', 'external'), e('ext_openkb', 'context_program', 'borrow patterns', 'external'), e('ext_langfuse', 'observability', 'one-way export', 'external'),
  e('ext_iii', 'tool_registry', 'borrow catalog', 'external'), e('ext_vector', 'vector_lane', 'adapter', 'external'), e('ext_graphdb', 'symbol_graph', 'derived projection', 'external'),
  e('ext_models', 'model_router', 'adapter', 'external'), e('ext_mcp', 'tool_registry', 'phase-gated adapter', 'external'),
]

const allNodes = clusters.flatMap(cluster => cluster.nodes)
const ids = new Set(allNodes.map(node => node.id))
if (ids.size !== allNodes.length) throw new Error('duplicate atlas node id')
for (const edge of edges) {
  if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`edge references unknown node: ${edge.from} -> ${edge.to}`)
}

const escapeDot = value => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
const dotLines = [
  'digraph ARC_CLIDE_COMPLETE_ATLAS {',
  `  graph [rankdir=TB, compound=true, newrank=true, splines=polyline, nodesep=0.16, ranksep=0.34, pad=0.2, bgcolor="#0b1020", fontname="Inter,DejaVu Sans", fontcolor="#ffffff", fontsize=28, label="ARC / CLIDE COMPLETE END-TO-END SYSTEM ATLAS\\nHEAD ${gitHead.slice(0, 8)} · ${sourceState} · ${gitDirtyPaths.length} visible dirty paths · scalable SVG", labelloc=t];`,
  '  node [shape=box, style="rounded,filled", fontname="Inter,DejaVu Sans", fontsize=9, margin="0.08,0.05", penwidth=1.4];',
  '  edge [fontname="Inter,DejaVu Sans", fontsize=7, color="#b0bec5", fontcolor="#eceff1", arrowsize=0.55, penwidth=1.0];',
]

for (const cluster of clusters) {
  dotLines.push(`  subgraph cluster_${cluster.id} {`)
  dotLines.push(`    label="${escapeDot(cluster.label)}"; color="#455a64"; fontcolor="#ffffff"; fontsize=15; style="rounded,dashed"; penwidth=1.3; margin=12;`)
  for (const node of cluster.nodes) {
    const status = S[node.status]
    const impl = node.modules.length ? `\\n${node.modules.join(' · ')}` : ''
    const label = `[${status.label}]\\n${node.name}\\nInterface: ${node.iface}${impl}`
    dotLines.push(`    ${node.id} [label="${escapeDot(label)}", fillcolor="${status.fill}", fontcolor="${status.font}", color="${status.stroke}"${node.status === 'blocked' ? ', penwidth=2.6' : ''}${node.status === 'authority' ? ', shape=doubleoctagon' : ''}];`)
  }
  dotLines.push('  }')
}

for (const edge of edges) {
  const attrs = []
  if (edge.label) attrs.push(`label="${escapeDot(edge.label)}"`)
  if (edge.kind === 'durable') attrs.push('color="#ce93d8"', 'fontcolor="#e1bee7"', 'penwidth=1.8')
  if (edge.kind === 'advisory') attrs.push('color="#64b5f6"', 'fontcolor="#90caf9"', 'style=dashed')
  if (edge.kind === 'missing') attrs.push('color="#ef5350"', 'fontcolor="#ef9a9a"', 'style=dotted', 'penwidth=2.2')
  if (edge.kind === 'external') attrs.push('color="#9e9e9e"', 'fontcolor="#bdbdbd"', 'style=dashed')
  dotLines.push(`  ${edge.from} -> ${edge.to}${attrs.length ? ` [${attrs.join(', ')}]` : ''};`)
}
dotLines.push('}')

const dot = `${dotLines.join('\n')}\n`
const dotPath = path.join(outDir, 'arc-clide-complete-system-atlas-v2.dot')
writeFileSync(dotPath, dot)

const statusCounts = Object.fromEntries(Object.keys(S).map(status => [status, allNodes.filter(node => node.status === status).length]))
const referencedModules = [...new Set(allNodes.flatMap(node => node.modules))].sort()
const missingModuleRefs = referencedModules.filter(relative => !existsSync(path.join(repo, relative)))
const nodeById = new Map(allNodes.map(node => [node.id, node]))

const md = []
md.push('# ARC / CLIDE complete end-to-end system atlas')
md.push('')
md.push(`Generated from repository HEAD \`${gitHead}\` on 2026-08-11 with source state \`${sourceState}\` and ${gitDirtyPaths.length} visible dirty path(s). This is a component-complete atlas for the current canonical architecture plus the measured live working-tree overlay and a generated file-level module appendix. It does not claim that every future task-specific adapter or operator can be enumerated in advance.`)
if (gitDirtyPaths.length) {
  md.push('')
  md.push('**Provenance warning:** this generation includes concurrent uncommitted work. Those files are visible measured substrate, not committed baseline truth and not safe to delete or overwrite.')
}
md.push('')
md.push(`![Complete ARC CLIDE system atlas](${path.join(outDir, 'arc-clide-complete-system-atlas-v2.svg')})`)
md.push('')
md.push(`Interactive surface: [open the scrollable infinite-canvas prototype](${path.join(outDir, 'arc-clide-infinite-canvas-prototype.html')}?variant=A) (variants A/B/C).`)
md.push('')
md.push(`Execution continuation: [next-agent complete E2E handoff](${path.join(outDir, 'NEXT-AGENT-COMPLETE-E2E-HANDOFF-2026-08-11.md')}).`)
md.push('')
md.push('## Status legend')
md.push('')
for (const [status, spec] of Object.entries(S)) md.push(`- **${spec.label}**: ${statusCounts[status]} atlas modules.`)
md.push('')
md.push('Edge law: solid = current flow or binding; purple = durable authority/history; blue dashed = advisory proposal; red dotted = missing required connection; gray dashed = optional external adapter/pattern.')
md.push('')
md.push('## Measured repository scale')
md.push('')
md.push('| Surface | Current measured value |')
md.push('|---|---:|')
md.push(`| Atlas modules | ${allNodes.length} |`)
md.push(`| Atlas cross-module relations | ${edges.length} |`)
md.push(`| Referenced implementation files | ${referencedModules.length} |`)
md.push(`| Missing referenced implementation files | ${missingModuleRefs.length} |`)
md.push(`| Script modules scanned | ${moduleCensus.totals.scanned} |`)
md.push(`| Static live closure | ${moduleCensus.totals.live} |`)
md.push(`| Test drivers | ${moduleCensus.totals.test} |`)
md.push(`| Verification drivers | ${moduleCensus.totals.verify} |`)
md.push(`| Dark deep-research modules | ${moduleCensus.totals.deepResearch} |`)
md.push(`| Orphan candidates | ${moduleCensus.totals.orphan} |`)
md.push(`| Unresolved dynamic-import modules | ${selfModel.modules.unresolvedDynamicImportModuleCount} |`)
md.push(`| Registered levers | ${selfModel.levers.registryCount} |`)
md.push(`| Live-at-default levers | ${selfModel.levers.liveAtDefaults.length} |`)
md.push(`| TaskEvent V9 event types | ${EVENT_TYPES.length} |`)
md.push(`| Memory stores | ${selfModel.memory.storeCount} |`)
md.push(`| Model weight artifacts | ${selfModel.models.artifacts.weightFileCount} |`)
md.push(`| Domain routing configurations | ${selfModel.domains.researchRouting.packCount} |`)
md.push(`| Executable domain packs | ${selfModel.domains.executablePacks.count} |`)
md.push('')
md.push('## Complete module catalogue')
md.push('')
for (const cluster of clusters) {
  md.push(`### ${cluster.label}`)
  md.push('')
  md.push('| Module | Status | Interface | Implementations | Detail |')
  md.push('|---|---|---|---|---|')
  for (const node of cluster.nodes) {
    const modules = node.modules.map(relative => `[${relative}](${path.join(repo, relative)})`).join('<br>') || 'future/deep module'
    md.push(`| **${node.name}** | ${S[node.status].label} | ${node.iface} | ${modules} | ${node.detail || ''} |`)
  }
  md.push('')
}

md.push('## Cross-plane flow catalogue')
md.push('')
md.push('| From | Relation | To | Edge class |')
md.push('|---|---|---|---|')
for (const edge of edges) md.push(`| ${nodeById.get(edge.from).name} | ${edge.label || 'flows to'} | ${nodeById.get(edge.to).name} | ${edge.kind} |`)
md.push('')

md.push('## TaskEvent V9 event vocabulary')
md.push('')
md.push(EVENT_TYPES.map(type => `- \`${type}\``).join('\n'))
md.push('')

md.push('## Measured memory stores')
md.push('')
md.push('| Store | Class | Status | Total | Evidence-backed |')
md.push('|---|---|---|---:|---:|')
for (const store of selfModel.memory.stores) md.push(`| ${store.storeName} | ${store.storeClass} | ${store.status} | ${store.counts.total} | ${store.counts.evidenceBacked} |`)
md.push('')

md.push('## Model and domain state laws')
md.push('')
md.push(`Model: ${selfModel.models.stateLaw.map(value => `\`${value}\``).join(' -> ')}`)
md.push('')
md.push(`Domain: ${selfModel.domains.stateLaw.map(value => `\`${value}\``).join(' -> ')}`)
md.push('')

md.push('<details>')
md.push(`<summary>All ${moduleCensus.partition.live.length} statically live script modules</summary>`)
md.push('')
for (const relative of moduleCensus.partition.live) md.push(`- [${relative}](${path.join(repo, relative)})`)
md.push('')
md.push('</details>')
md.push('')

md.push('<details>')
md.push(`<summary>All ${moduleCensus.partition.deepResearch.length} dark deep-research modules</summary>`)
md.push('')
for (const relative of moduleCensus.partition.deepResearch) md.push(`- [${relative}](${path.join(repo, relative)})`)
md.push('')
md.push('</details>')
md.push('')

md.push('<details>')
md.push(`<summary>All ${moduleCensus.partition.orphan.length} static orphan candidates</summary>`)
md.push('')
md.push('These are static-census candidates, not deletion authorization; computed dynamic imports can hide reachability.')
md.push('')
for (const relative of moduleCensus.partition.orphan) md.push(`- [${relative}](${path.join(repo, relative)})`)
md.push('')
md.push('</details>')
md.push('')

md.push('## Current truth probe')
md.push('')
md.push('```text')
md.push(truth)
md.push('```')
md.push('')

md.push('## Completeness contract')
md.push('')
md.push('This atlas is complete at four explicit levels: (1) all canonical product planes; (2) every current deep module/interface needed to traverse ingress through completion; (3) every TaskEvent V9 type and every measured memory/model/domain state law; and (4) every statically live script module in the generated appendix. It deliberately does not flatten 1,124 tests and 189 verifier drivers into the main image, because those are proof surfaces rather than runtime organs. Their denominators are recorded above. It also does not invent future task-specific operators; GraphProgram must compile those behind typed interfaces when needed.')
md.push('')
md.push('The decisive open red path is still candidate-author receipt -> runtime-owned semantic oracle batch -> candidate-bound tri-state evaluation -> effect reservation/apply/observation/reconciliation -> post-effect verification -> exact TaskCompleted. Blue/dark modules cannot be treated as live merely because they appear in this atlas.')
md.push('')

if (missingModuleRefs.length) {
  md.push('## Referenced paths absent from the committed checkout')
  md.push('')
  for (const relative of missingModuleRefs) md.push(`- \`${relative}\``)
  md.push('')
}

const markdown = `${md.join('\n')}\n`
const mdPath = path.join(outDir, 'ARC-CLIDE-COMPLETE-SYSTEM-ATLAS-V2.md')
writeFileSync(mdPath, markdown)

const manifest = {
  schemaVersion: 'arc-clide-system-atlas-v2',
  generatedAt: new Date().toISOString(),
  repository: {
    root: repo,
    head: gitHead,
    sourceState,
    visibleDirtyPathCount: gitDirtyPaths.length,
    visibleDirtyPaths: gitDirtyPaths,
  },
  counts: {
    atlasModules: allNodes.length,
    atlasRelations: edges.length,
    referencedImplementationFiles: referencedModules.length,
    missingReferencedImplementationFiles: missingModuleRefs.length,
    ...moduleCensus.totals,
    taskEventTypes: EVENT_TYPES.length,
  },
  statusCounts,
  sources: {
    selfModelReceiptSha256: selfModel.receiptSha256,
    dotSha256: createHash('sha256').update(dot).digest('hex'),
    markdownSha256: createHash('sha256').update(markdown).digest('hex'),
  },
  missingModuleRefs,
}
writeFileSync(path.join(outDir, 'arc-clide-complete-system-atlas-v2.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const atlasData = {
  schemaVersion: 'arc-clide-system-atlas-data-v2',
  generatedAt: manifest.generatedAt,
  repository: manifest.repository,
  statuses: S,
  clusters,
  edges,
  taskEventTypes: EVENT_TYPES,
  referencedModules,
  moduleCensus,
  measuredState: {
    evidenceLadder: selfModel.evidenceLadder,
    truth: selfModel.truth,
    levers: selfModel.levers,
    context: selfModel.context,
    memory: selfModel.memory,
    domains: selfModel.domains,
    models: selfModel.models,
    verdict: selfModel.verdict,
    receiptSha256: selfModel.receiptSha256,
  },
}
writeFileSync(path.join(outDir, 'arc-clide-complete-system-atlas-v2.data.json'), `${JSON.stringify(atlasData)}\n`)

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
