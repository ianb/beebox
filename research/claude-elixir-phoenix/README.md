# claude-elixir-phoenix — review

**Snapshot date:** 2026-07-30
**Subject:** [oliver-kriska/claude-elixir-phoenix](https://github.com/oliver-kriska/claude-elixir-phoenix)
(shallow clone, HEAD at time of writing; version ~2.12.x per its CHANGELOG)

A friend recommended this as "a library of Claude skills for Elixir/Phoenix." It
is that, but the Elixir content is the least interesting third of it. What it
actually is: **51 skills + 26 subagents + 23 hooks, wrapped in an unusual amount
of apparatus for measuring and maintaining a skill corpus** — a deterministic
structural scorer, an LLM trigger-accuracy eval, a description-optimizing
tournament, session-transcript analytics, a drift-checker against upstream
Claude Code docs, and a build pipeline that transpiles the corpus to Codex, Amp,
opencode and Pi.

We are TypeScript/Node, so none of the Ecto/LiveView/Oban/Ash/Tidewave/hexdocs
content transfers. This review is about the meta-layer.

## Documents

| Doc | Covers |
|---|---|
| [measurement.md](measurement.md) | The eval framework, trigger-accuracy scoring, the description tournament, session-transcript analytics, skill-monitor |
| [enforcement-and-hooks.md](enforcement-and-hooks.md) | Iron Laws, the 23-hook layer, sentinel-file gates, intent routing, compaction/crash survival |
| [workflow-and-orchestration.md](workflow-and-orchestration.md) | The plan→work→review→compound lifecycle, plans-as-state-machine, the subagent roster, context-supervisor, requirements-verifier |
| [authoring-craft.md](authoring-craft.md) | Description/CSO discipline, progressive disclosure, the plugin-cache distortion, a skill with a real test suite, their own research corpus |

## The one-paragraph version

Their most valuable contribution is not a skill — it's the observation, backed
by a real (if not-checked-in) measurement apparatus, that **skills and CLAUDE.md
prose mostly don't fire on their own**. Their instrumentation reports "zero
skill auto-loading" as a repeated finding across 137+ sessions, and their
CHANGELOG claims CLAUDE.md prose routing measured "~0% firing across 400
sessions," which is why they moved intent detection into a `UserPromptSubmit`
hook. Independently they found (via a competitive review of *Superpowers*) that
a `description` which *summarizes the workflow* gets acted on **instead of** the
skill body being loaded. We have 16 skills, several with descriptions that do
exactly that, and zero measurement of whether any of them ever trigger.

Second most valuable: they treat "did we deliver what the plan said" as a
**separate agent with its own narrow contract** (`requirements-verifier`),
distinct from code review. Our `finish` agent reconciles plan docs and closes
issues but never checks a plan's stated scope was actually delivered.

## Dispositions

Each tied to a concrete beebox file or skill. "Interesting" is not a
disposition; nothing below is left at praise.

### Adopt

| # | Idea | Ours | Why |
|---|---|---|---|
| A1 | **Descriptions carry triggering conditions only** — never a workflow summary, because the summary gets followed *in place of* the skill | All 16 `.claude/skills/*/SKILL.md`; worst offenders are the three `bbx-guide-*`, whose descriptions say what the skill explains and then point at the real doc | Direct, cheap, and we are demonstrably doing the anti-pattern. Filed: [issues/docs-and-chores/2026-07-30-skill-description-triggering-conditions.md](../../issues/closed/docs-and-chores/2026-07-30-skill-description-triggering-conditions.md) |
| A2 | **Actually run a trigger eval** on our skills | `.claude/skills/skill-creator/` — already vendored, ships `scripts/run_eval.py`, `improve_description.py`, and a trigger-eval query generator; we have never run it | This is a *routine* to adopt, not code to write. We already own a better tool than theirs and leave it idle. Filed: [issues/docs-and-chores/2026-07-30-run-skill-trigger-evals.md](../../issues/docs-and-chores/2026-07-30-run-skill-trigger-evals.md) |
| A3 | **A requirements-delivered gate** before merge — MET/PARTIAL/UNMET/UNCLEAR against `file:line` evidence, forbidden from fabricating evidence or straying into code quality | `.claude/agents/finish.md` steps 6 & 7b reconcile plan docs and close issues, but nothing checks the plan's *stated scope* landed | Clean, narrow, language-agnostic; fills a real gap in a file we already maintain. Filed: [issues/features/2026-07-30-requirements-delivered-gate.md](../../issues/closed/features/2026-07-30-requirements-delivered-gate.md) |

### Adapt

| # | Idea | Ours | Shape of the adaptation |
|---|---|---|---|
| B1 | **Mechanical failure-loop detection** — a hook counts consecutive failing build/test commands and escalates at attempt 3 from a hint to a consolidated error history + "stop retrying" instruction | `bbx-debug`'s 3-fix circuit-breaker (`SKILL.md:150`) is prose asking the agent to notice its own loop | Make it a `PostToolUseFailure` hook counting failing `pnpm test`/`tsc`/`pnpm lint`. **Do not copy their state design** — theirs lives in bare `/tmp` keyed only by command text, so an unrelated project's stale counter can trip the breaker on your first failure. Session-scope it. Filed: [issues/features/2026-07-30-failure-loop-hook.md](../../issues/features/2026-07-30-failure-loop-hook.md) |
| B2 | **Fan-out compression with a coverage invariant** — a cheap compressor between an orchestrator and N workers, where *every input file must appear in the output or be flagged as a COVERAGE GAP* | Our ad-hoc `Agent` fan-outs (this very review used six) dump full reports into the parent context | The coverage-check is the part worth stealing; it's what stops a summarizer silently dropping a worker. Filed: [issues/exploration/2026-07-30-subagent-fanout-compression.md](../../issues/exploration/2026-07-30-subagent-fanout-compression.md) |
| B3 | **Blame-aware content checks** — scan only the edit's `new_string`, never the whole file, so a check doesn't punish pre-existing violations | Our `PostToolUse` hook runs `vibe-check lint --hook` on the whole file | Not a change to the ESLint hook (whole-file is right for lint). It's the rule to follow for *any future* content check we bolt onto Edit/Write. Recorded here, not filed. |
| B4 | **Cross-model consensus as a confidence signal** — a finding flagged by *both* codex and a Claude reviewer is marked HIGH CONFIDENCE and never dropped as a duplicate | `.claude/skills/cross-model/` is a standalone manual pass; its findings are never cross-referenced against a Claude-side review | Cheap addition to the codex skill's triage step. Filed: [issues/features/2026-07-30-codex-consensus-confidence.md](../../issues/features/2026-07-30-codex-consensus-confidence.md) |

### Investigate

| # | Question | Why it's open |
|---|---|---|
| C1 | **Do our skills ever auto-fire?** Mine `~/.claude/projects/*/*.jsonl` for skill activations and classify each as explicit-slash vs model-initiated | The single most actionable measurement here. **Caveat we already know:** per `project_claude_code_jsonl_drop_bug`, blocks in the live stream sometimes never reach the `.jsonl` — so a naive count under-reports and the method needs validating before its numbers are trusted. Filed: [issues/exploration/2026-07-30-do-our-skills-auto-fire.md](../../issues/closed/exploration/2026-07-30-do-our-skills-auto-fire.md) |
| C2 | **Do our subagents inherit the monorepo CLAUDE.md?** They inject all 26 Iron Laws into every subagent via a `SubagentStart` hook specifically because subagents don't inherit the parent's loaded skills | If ours don't either, a large amount of our guidance is silently absent from every delegated task. Verify before building anything. Filed: [issues/exploration/2026-07-30-subagent-context-inheritance.md](../../issues/exploration/2026-07-30-subagent-context-inheritance.md) |
| C3 | **Scoped edit-locks** — a sentinel file + `PreToolUse` gate that restricts edits to listed path prefixes (or forbids all edits) | Genuinely new capability; `bbx-debug` and `bbx-plan` describe scope discipline only in prose. Honest limit: self-bypassable via Bash by design, so it catches drift, not misbehaviour. Filed: [issues/exploration/2026-07-30-scoped-edit-lock.md](../../issues/exploration/2026-07-30-scoped-edit-lock.md) |

### Decide

| # | Call to make | Stakes |
|---|---|---|
| D1 | **Should plans carry execution state?** Their load-bearing idea is "plan checkboxes ARE the state — no side state files," which makes a plan resumable after compaction or a crash by re-reading one markdown file. Our 25 docs in `beebox/docs/plans/` contain **zero** checkboxes — they are design artifacts, and execution state lives only in the conversation | This is a real fork, not an obvious win: `bbx-plan` deliberately produces design documents with a "Stated preferences this plan trades against" section, and turning plans into task ledgers could degrade that. Filed: [issues/decisions/2026-07-30-plans-as-execution-state.md](../../issues/decisions/2026-07-30-plans-as-execution-state.md) |

### Reject

| # | Idea | Why not |
|---|---|---|
| R1 | `compound` / `compound-docs` / `recall` — a `.claude/solutions/` corpus of solved problems with a YAML schema, searched by grep | Would fragment "where do I check what we already know" across `issues/`, `MEMORY.md`, `docs/`, and a fourth place. Their own retrieval is bare grep over free-form tags the schema explicitly lets you invent — the vocabulary-drift failure is designed in. Our `issues/` tree with its research-stub convention already carries this weight. |
| R2 | `investigate`, `audit`, `techdebt`, `review`, `challenge` as new skills | Near-total overlap with `bbx-debug`, `bbx-codehealth`, `codex`, and `/code-review`. `bbx-codehealth`'s module/interface/depth/seam vocabulary is sharper than `techdebt`'s three-strikes-duplication heuristic. Worth harvesting two *lines* from them, not five skills — see B1 and the anti-noise notes in [workflow-and-orchestration.md](workflow-and-orchestration.md). |
| R3 | Their skill size limits (~100-line SKILL.md, inline everything load-bearing, `${CLAUDE_SKILL_DIR}` paths) | Driven by a constraint we don't have: plugin skills install to `~/.claude/plugins/cache/`, where their agents can't reliably `Read` a `references/*.md` at runtime. Our skills are in-repo and readable. Copying their limits would make our skills worse for no reason. |
| R4 | A bespoke grep-based "Iron Law verifier" hook | Only 6 of their 26 laws have detectors, they're regex-only (defeated by reformatting or a helper-function wrapper), and one exemption is loose enough to be near-decorative. Our equivalent belongs in `personal-vibe-check` as AST-aware ESLint rules — which is also where our culture already puts it. |
| R5 | The multi-target port pipeline, `promote`, `codex-ab`, `intro`/`help`/`examples`/`init` | We ship to no other runtime and have no marketing channel. `codex-ab`'s own conclusion was "don't build it." |

### Later

- **`triage`** — batch `AskUserQuestion(multiSelect: true)` over a findings pile, auto-approving non-negotiable classes, emitting a fix queue. We produce findings lists (`codex`, `/code-review`) and then handle them ad hoc in chat. Real gap, low urgency.
- **`brief`** — a pre/post-mode walkthrough that explains a plan (or a landed change) in ~4 capped sections, one at a time, and is explicitly forbidden from executing anything. Would sit next to `bbx-plan`'s review mode.
- **`cc-changelog`** — fetch upstream Claude Code's CHANGELOG, diff against a stored last-checked version, classify entries BREAKING/OPPORTUNITY/DEPRECATION. Cheap. Only worth it if upstream CC changes have actually bitten our hooks or skills before; note that *they* never automated it either.

## Verification status of their headline claims

Stated plainly because two of these are load-bearing for the dispositions above:

- **"CLAUDE.md prose routing measured ~0% firing across 400 sessions."** Appears
  in their `CLAUDE.md` and CHANGELOG v2.12.0. The measurement *system* is real
  and present in the tree (`session-scan`, `session-deep-dive`, `skill-monitor`,
  a 1766-line metrics scorer). The measurement *result* is not: no
  `metrics.jsonl`, no report artifact, nothing to inspect. **Credible but
  unverified** — treat as a hypothesis worth testing on our own corpus (C1),
  not as an established number.
- **"Zero skill auto-loading in subagents."** Same status; it's the stated
  motivation for their `SubagentStart` injection hook. Hence C2 is *verify
  first*, build second.
- **Their description tournament worked.** This one has the best evidence: the
  CHANGELOG lists per-skill before/after trigger accuracy (e.g. `challenge`
  0.80→1.00, `n1-check` 0.70→0.90), and — more convincing — they found and
  disclosed a test-set contamination bug in their own harness (209 routing hints
  leaking the answer into eval prompts, inflating their scores). A project that
  catches itself cheating is a project actually reading its own numbers.
- **Point-release claims** (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` defaults
  changing at 2.1.219, `additionalContext` preserved on block at 2.1.110+, Stop
  hook `background_tasks[]` at 2.1.145) are stated as fact throughout and are
  not independently verifiable from the checkout. Don't port logic that depends
  on them without checking against the CC version we actually run.

## Honest assessment of the corpus

The eval framework is load-bearing: wired into CI, gates merges at composite
≥0.95, and has visibly iterated against its own failures. The session analytics
are sophisticated and **entirely manual** — every one of those skills is
`disable-model-invocation: true`, nothing runs them on a schedule, and grep
across their workflows and Makefile confirms none of it is automated. So the
part of their apparatus that produces the *interesting* findings is a research
instrument a human has to remember to run, not a running system. Worth knowing
before we copy the shape: the cheap, mechanical, always-on scorer is what
actually holds their corpus together.

Their 51-skill surface is also, by their own competitive analysis, the thing
they're least confident in — they cite oh-my-claudecode's 90k lines as "a
cautionary tale about scope." We have 16 skills. The lesson to take is their
measurement discipline, not their skill count.
