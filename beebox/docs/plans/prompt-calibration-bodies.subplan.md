---
title: "Skill bodies and operational guidance: assessment and restructuring proposal"
status: partial
workstream: prompt-calibration
issues: []
---
# Skill bodies and operational guidance

Assess the next five instruction surfaces using purpose, necessity, compact wording, grouping, and document hierarchy. This continues [prompt calibration](prompt-calibration.md) after the description and root changes. The cross-model restructuring is applied locally; launch, bin, issues, and security-report remain proposals.

**Recommendation:** split only the two alternative runners in `cross-model`; keep launch decisions together with one optional briefing example reference; reorganize the bin manual around distinct operations; retain issues as one contract and security-report as one audit rubric. Smaller entrypoints should expose the right material, not make every task read more files.

**Done for this assessment:** each current section has a disposition, destinations distinguish current reference from history, operational contradictions are checked against source, and the assembled proposals undergo cross-model review. Actual skill activation and live launch behavior are not measured here.

## Stated preferences and OpenAI advice

The human requested: purpose → needed at all → compact form → logical grouping → hierarchy and links. Preserve the indirect connections that activate skills, repository-specific facts and impacts, and scaffolding in briefings authored for lesser subagents. Leading models from both families read this repository. Those requirements govern this proposal.

The human also explicitly invited OpenAI's suggestions and skills as advice. Sources used:

- [Rethinking skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): task-specific activation and conditional access to supporting material, with explicit recognition that other models consume repository skills.
- Installed OpenAI **skill-creator**, read 2026-09-12: put detailed procedures where correctness or fragile tooling needs them; avoid inventing reference layers for a simple workflow; preserve permission boundaries and scope; test realistic decisions when warranted.
- [Official prompting guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra): clarify completion, avoid redundant approval pauses when already authorized, and calibrate verification to the change.

These sources support four concrete choices here: runner-specific references for cross-model; no separate reference for each normal launch decision; completion and authority before mechanics; and no fragmentation of the security rubric. They do not justify dropping local safety rules, enlarging permissions, changing model defaults, or stripping reviewer/worker prompts.

## Smallest fix and budget

The smallest authorized deliverable is this assessment and its concrete document shapes. Only this subplan and a link from the parent change now. Future implementation is five independent editorial chunks, reviewed in order below; the bin split requires approval of its destinations before file moves. No new launch flags, scheduler behavior, issue fields, audit categories, model defaults, or evaluation subsystem are proposed. No source or test changes are necessary for the assessment.

Source line references below describe commit `c8c728285`. Line counts describe exposure, not quality: cross-model 494; launch 326; bin 910; issues 425; security-report 352.

## 1. Cross-model review

**Purpose:** produce independently checked findings from the other model family and have the driving agent adjudicate them against the human's request. Needed: yes. Most excess comes from duplicate persuasion, two unrelated runner manuals, and incident narratives around precise operational rules.

| Current section / source line | What it accomplishes | Needed at all? / compact form | Home after rewrite |
|---|---|---|---|
| Purpose, direction, when to use (7–41) | Select independent family and activate required reviews. | Keep once: "Use the other family; report inability rather than substituting your own." Keep explicit request and root-policy trigger. Drop arguments that same-family review manufactures confidence. | SKILL entrypoint |
| Modes and no-argument selection (43–52) | Choose plan, diff review, or challenge. | Keep table and current no-argument rule; do not silently replace its review-versus-challenge question. | SKILL entrypoint |
| Shared rules: orientation, scope, authority (54–83) | Give reviewer context and evidence criteria without a repo-wide crawl. | Keep origin request hierarchy, honest missing-authority case, named first reads, permitted relevant follow-ups, and citation verification. Shorten instructions around these facts; keep the prompt text sent to the reviewer. | SKILL entrypoint |
| Shared rules: execution and handoff (84–105) | Avoid dropped runs and inappropriate reviewer authority. | Keep stdin/foreground requirements as a brief execution contract; put runner traps at the actual command. Merge material-results-only handoff with the later adjudication section. | SKILL entrypoint + runner refs |
| Claude → Codex (108–207) | Run the other family using known command syntax and read-only access. | Keep exact command, boundary prefix including the skill-target exception, stdout extraction, supported flag placement, exact-PID recovery, and historical fallback observations. Remove repeated failure narration. | Proposed `references/codex-runner.md` |
| Codex → Claude (209–341) | Avoid project hooks, dropped yielded processes, and prompt parsing traps. | Keep `--setting-sources user` and its cleanup impact, read-only tools, stdin, model-by-mode rule, real completion polling, and no auth relocation. Retain the orchestration code example. | Proposed `references/claude-runner.md` |
| Required diff instructions (343–379) | Trace concrete states, test durable-fix claims, distinguish scope-expanding remedies. | Keep the three reviewer instructions and bounded-follow-up rule intact in substance. This is delegated prompt scaffolding, not persuasion to trim. | SKILL entrypoint, conditional diff subsection |
| Plan template (382–417) | Ground plan review in human authority and verified source claims. | Keep the template and priority order. Drop explanation of why another project's embedding approach was wrong. | SKILL entrypoint, conditional plan subsection |
| Challenge persona (419–423) | Add adversarial focus to the selected target. | Keep one sentence plus target-specific instructions; it does not replace review authority. | SKILL entrypoint |
| Review loops (425–448) | Bound review cost and scope growth. | Keep two rounds, verification-only afterward, residual risks mediated by human judgment, and existing over-engineering exclusions. State the impact once: repeated adversarial rounds can keep extending scope; fresh findings after round two do not reopen the loop. Drop the unsupported universal claim that every reviewer inevitably fills its cap. | SKILL entrypoint |
| Adjudication/handoff (450–468) | Driving agent verifies findings; report actual work outcome. | Keep one shared rule, the explicit-review-deliverable exception, and the prohibition on editorializing about the review's worth. Remove duplicated presentation instructions elsewhere. | SKILL entrypoint |
| gstack differences (470–494) | Preserve historical reasons for local divergences. | Active facts above remain. Comparative narrative is not needed in the operating skill; existing research/history remains available. No new history file needed. | Delete duplication |

### Grouped entrypoint

The entrypoint stays self-contained for shared policy and prompt construction. It links to exactly one execution reference; the runner references do not duplicate shared review authority or templates.

1. **Outcome and authority:** independent read-only evidence, human requirements first, driving agent adjudicates, done when material findings are handled or clearly presented as decisions.
2. **Select target and mode:** preserve the current mode table and no-argument behavior.
3. **Build the review prompt:** orientation and authority block, scope/follow-up rule, then conditional plan/diff/challenge material. Keep the required reviewer excerpts, including concrete-state tracing.
4. **Run the other family:** Claude reads `references/codex-runner.md`; Codex reads `references/claude-runner.md`. Each reference is complete for that runner, including its operational hazards and output/completion handling.
5. **Adjudicate and stop:** two-round bound, verification-only afterward even when new findings could prolong the work, scope decisions mediated by the driving agent, concise material handoff without editorializing about the review's worth.

Compact shared opening:

> Run a read-only review with the other model family. Ground it in the human's request and verify claims against source. The reviewer supplies evidence; the driving agent decides what to fix and which questions require the human. Complete the review by adjudicating material findings, verifying accepted fixes, and reporting remaining decisions or risks.

**Preserve rather than infer:** the current pinned runner models and explicit human overrides. Quota/fallback notes describe past account observations, not guaranteed present availability. This pass does not test or change those choices. The skill's stale "callback-specific" framing can become monorepo orientation; a review of `bin/` must not be told that every target belongs under `beebox/`.

## 2. Launch-worktree-session

**Purpose:** start an explicitly requested separate conversation carrying the context the recipient otherwise lacks. Needed: yes. Most route, model, base, and delivery decisions occur on every launch, so splitting each into a mandatory reference would add overhead.

| Current section / source line | What it accomplishes | Needed at all? / compact form | Home after rewrite |
|---|---|---|---|
| Purpose, invocation, flow confirmation (9–21, 95–97) | Require human intent to create a separate workstream. | Keep "Mirror the scope in one or two sentences; launch only after the human has approved it; ask about unresolved scope." Retain the mirror-back step. Prior approval of that scope still counts; do not invent a renewed approval requirement. | SKILL opening |
| Briefing contract, wrapper, worked example (23–49, 84–91, 283–309) | Transfer purpose, decisions, constraints, unknowns; preserve human authority. | Keep content requirements and approach-before-editing close. Launcher supplies the continuation wrapper; do not duplicate it. Preserve the worked example as optional supporting material. | Required contract in SKILL; optional `references/briefing-example.md` |
| Parent branch visibility (51–82) | Prevent launching without required unmerged context. | Keep main-by-default and committed-is-not-landed consequence. Prose can transfer findings; code dependencies need the correct base. Correct unsupported flag advice below. | SKILL, before launch |
| Route existing/new and delivery (99–119) | Avoid duplicate streams and false delivery claims. | Keep list-first, recent live/dormant preference, stale-age guidance, resume heredoc, leading-dash form, and manual-forwarding distinction. Concurrent creation remains allowed. | SKILL workflow |
| Name and issue ownership (121–135) | Choose stable identity and enroll responsibility. | Keep short kebab-case name, optional anchor `--issue`, cluster member paths in briefing, responsibility versus discovery provenance. | SKILL workflow |
| Agent/model selection (137–169) | Apply the human's cost/capability choice. | Keep explicit/standing preferences, skill's Codex default, required Claude model, and ask when materially ambiguous. Difficulty informs a question, not unilateral escalation. Remove quota/capability persuasion. | SKILL workflow |
| Briefing launch and report (171–213) | Execute safely and report actual result. | Keep no redundant briefing preview unless asked or scope unresolved; quoted heredoc, required description, agent-specific wording, repo-relative launcher, and actual agent/model/destination/delivery outcome. | SKILL execution |
| Script details (215–281) | Explain CLI forms, PATH, mirrors, Remote Control, cleanup. | Keep one normal command and exceptional-form pointers. Move repeated mechanics to existing bin sections only where the facts are actually present; retain unique exceptions until moved. | SKILL concise command; bin lifecycle reference |
| Common mistakes (311–326) | Restate failure boundaries. | The rules already have decision locations above. Delete duplicate list; preserve any distinct briefing failure example with the worked example. | Consolidate |

### Facts to correct before compression

- **Skill default versus executable default:** `bin/launch-worktree-session:66` sets `agent="claude"`. The skill intentionally passes `--agent codex`; that is its policy, not the executable's bare default. `bin/lib/launch-session.sh:20` supplies the Codex model when omitted. Compact form: "For this skill, pass `--agent codex` unless the human chose another agent."
- **Unsupported base flag:** the launcher parser at `bin/launch-worktree-session:80–96` has no `--base-ref`; `bin/workstreams:158–175` supports it on `create`. The skill's line 70 advice is not a usable launcher command. Keep the visibility warning, document the actual command owner, and use a verified create/attach workflow only if needed. Adding a launcher flag is a separate code change, not part of prose cleanup.
- **Codex teardown:** `bin/lib/launch-session.sh:193–195` invokes `bin/codex-session-end`; that script's lines 14–22 describe normal-exit cleanup and the tab-close gap. Replace "no hook fires, so it lingers" with "The launcher runs teardown after Codex returns; sweep covers exits that bypass it." Keep the safe-cleanup guards in the lifecycle reference.

### Grouped entrypoint

**Outcome/authorization and scope mirror-back → route existing work → ensure context visibility → choose name/issue/agent → write briefing → launch → report delivery.** Keep these as one workflow, with model policy at the choice point and the full brief's requirements at authoring time. One optional example reference is enough. Launch mechanics link to the existing bin lifecycle sections, later replaced atomically if the bin split is accepted.

The compact completion rule is: "Report the stream, agent/model, Terminal destination, and actual briefing delivery state. A focused live tab plus a forwarding file is not delivered context." Opening a session is not evidence that its task was implemented.

## 3. Bin manual

**Purpose:** guide changes to root tooling and shared operational infrastructure. Needed: yes, but its 910 lines conflate contributor rules, live contracts, CLI help, and incident history. Preserve pre-action hazards in the entrypoint; put distinct mechanisms in maintained topic docs. Do not use an implemented plan as the new canonical operating manual merely because it contains similar prose.

Proposed new destinations, only when their extraction is approved: `bin/docs/commit-guards.md`, `bin/docs/router-operations.md`, `bin/docs/worktree-lifecycle.md`, and `bin/docs/schedules.md`. Existing `bin/docs/router-protocol.md` remains the concurrency-invariant reference, not a dumping ground for unrelated operations.

| Current section / line | Purpose / needed? | Compact entrypoint form | Detail destination / removal |
|---|---|---|---|
| Tests (8) | Correct tier and cost; yes. | Root tooling uses dev doctests; router unit tests use their package. Keep circular-harness exception and legacy-test non-precedent. | Existing testing guides; no new test policy. |
| Path guard (22) | Prevent home-path leaks; yes. | Use relative/tilde paths; never widen the allowlist to fix a hit. | Commit guards: allowlist meaning and failure behavior; drop incident story. |
| Blocklist (35) | Configure private exclusions without leaking values; yes. | Absent=no-op; malformed/tracked=fail closed; staged additions; don't print matched values. | Commit guards: rule grammar, main-checkout fallback, setup, and limits of hook enforcement. |
| Provenance (64) | Trace work and reject invalid/private Issue trailers; yes. | Keep automatic/manual distinction, prepare-versus-check failure behavior, query form. | Commit guards: hook mechanics. Historical plan stays background. |
| Landing (93) | Safe main merge; yes. | Keep preconditions, refusal behavior, `--no-ff`, dry-run/list, and finish route. | Worktree lifecycle for mechanism; deployment consequences remain explicit. |
| Router architecture (121) | Find composition and protocol owner; yes. | Topology, composition root, read protocol before lifecycle edits. | Router operations: module map only where ownership is non-obvious. Drop dated extraction narration. |
| Authentication (173) | Prevent unauthorized access/cold start; yes. | Authenticated TCP, trusted local UDS, narrower browse-key scope, whole-router exposure and mandatory 401 probe. | Router operations: prefixed login/OAuth behavior and exposure mechanics. Preserve impact; remove old SPA failure narrative. |
| Environment (214) | Preserve checkout isolation; yes. | Exported-env precedence; per-checkout children; main router key; copy without `BOXES`. | Router operations: concrete loading paths and setup recipe. |
| Idle/self-healing (239) | Explain HTTP/WS and chat lifecycle; yes. | HTTP wakes/counts; WS does not; visible heartbeat; hidden active chats can idle-stop and recover. | Router operations: timeouts, heartbeat/HMR settings and recovery. |
| Staleness (259) | Distinguish reload mechanisms; yes. | Frontend HMR, hub source needs explicit down/restart, bundled box children drain/reload. | Router operations: identities, polling, bundle producers. Drop repair chronology. |
| Orphans (285) | Avoid killing active work/leaking abandoned children; yes. | Common tri-state liveness; unknown is spared. | Worktree lifecycle: boot/signal/orphan mechanisms; delete incident counts. |
| Workstreams ownership (315) | Keep all frontends on shared safe control surface; yes. | Hooks stay thin; CLI/libs own state; unknown/launching blocks destruction, including force. | Worktree lifecycle: roots, stdout contract, locking, dependency synchronization. |
| Lifecycle commands (371) | Route operations and isolated testing; yes. | Command families and shared-router prohibition; isolated-router environment requirements. | CLI help for flags; worktree lifecycle for state/ownership semantics and fixtures. Preserve quirks not documented by help. |
| Worktree hooks (491) | Creation/clone adapters; yes. | Managed creation uses CLI; test box outside monorepo. | Fold into lifecycle reference. |
| Codex sessions (507) | Harness parity and teardown safety; yes. | Canonical source/mirrors, launcher teardown, fail-closed missing mirrors, one cleanup implementation. | Lifecycle: model/argv ownership, generation, liveness oracle, auto-sweep, exact-PID process rules. Remove repeated history. |
| Schedules (644) | Persisted due-ness and durable outcome; yes. | Authoring skill route; CLI owns state; durable alerts; missing completion is itself visible. | Schedules: marked external store, cadence/catch-up, locks, heartbeats, record schemas. |
| Headless sessions (698) | Enforce agent-specific constraints and completion; yes. | Shared launcher; stdin; unsupported declared constraints fail closed; alert/done result required. | Schedules: exact argv and model differences; preserve worker prompts. |
| Schedule lint (715) | Author-side verification; yes. | Run schedules lint; changed schedules checked at commit. | Schedules/authoring skill for rule and ownership details. |
| Comments (737) | Receive human feedback; yes. | List/show/act/clear; external durable store and read-only worktree mounts. | Keep compact mechanism here; CLI help for forms. No new comments doc required. |
| Issue search (775) | Find work without hidden private egress; yes. | Text mode offline; embedding/cache behavior can include private data; public-only option. | Keep egress contract and index ownership here; CLI help for examples, code for derivable field/hash inventories. |
| Private repo (852) | Isolate data and avoid unsafe deletion; yes. | Symlink topology, derived/marked roots, serialized mutations, safe removal or orphaning, exact ignore boundary. | Content policy stays in issues; retain concise mechanism here. |
| Concurrent agents (885) | Avoid committing another agent's staging; yes. | Path-scoped commit rule and helper. | Keep near commit rules; remove incident repetition. |
| Dev serving (903) | Expose tracked docs without child startup; yes. | One router sentence plus `dev/README.md`. | Existing dev reference. |

### Grouped entrypoint and link compatibility

**Contribution/testing → commit safety → router contract → worktree lifecycle → schedules → feedback/search/private repo.** The entrypoint must say: "Before changing liveness or teardown code, read the worktree-lifecycle reference." That makes its exact-PID, process-detection, and nested-review hook hazards discoverable before an edit. Retain these five exact headings as compact linked entry points because root CLAUDE.md already uses their anchors:

- `Commit provenance trailers (`commit-provenance.ts`)`
- `Lifecycle commands`
- `Schedules (`bin/schedules`)`
- `Document comments (`bin/comments`)`
- `Private-issues shadow repo (`private-issues`)`

Keep hazards at those entries and again beside destructive or exposure commands when needed. The duplication is a short pre-action warning, not two copies of the mechanism. Scan other incoming links before moving additional headings; replace source and links together, regenerate mirrors, then check actual reference reachability.

Do not move operational details into `implemented-plans/`. Two existing references in bin use stale `plans/` locations for provenance and schedules; their targets now live in `implemented-plans/`. Repair those background links during implementation, without treating historical plans as current authority.

## 4. Issue contract

**Purpose:** define queue meaning, identity, human-owned signals, and privacy. Needed: yes as one canonical document. A routine filing or disposition needs several of these rules together, so separate files for each field/state would make the workflow harder to follow.

| Current section / line | Purpose / needed? | Compact form and grouping |
|---|---|---|
| Opening (1) | Separate unresolved tensions from authorization; yes. | One paragraph: retain worthwhile unresolved/out-of-scope work; filing is not permission to implement. |
| Layout/categories (12) | Classify and identify files; yes. | Keep exact seven categories, unique basename, search/reclassification; reduce category persuasion. |
| Deferred (41), closed (62) | Distinct lifecycle states; yes. | Preserve date/category fields and activation/link rules; short closed-state rule. Scheduler mechanics link to bin. |
| Titles/links (69) | Stable display and move repair; yes. | Keep title location, basename identity, link form and repair command; delete repeated explanation of why it works. |
| Frontmatter (94) | Closed machine-consumed schema; yes. | Keep schema and ignored/reported unknown-key consequence; remove incident anecdote. |
| Ownership/provenance/names (125–159) | Keep authorship and responsibility honest; yes. | Table for field meanings; one explicit names-only-in-metadata rule. Do not move the rule solely into beebox/CLAUDE.md, whose directory scope does not cover issues. |
| Needs/manual testing (161–204) | Human gate and ready-to-test state; yes. | Keep full transitions, who may clear, readiness, exact Manual testing heading, body placement, and stock-test-box constraints. Remove only repeated rationale. |
| Labels/priority (205–226) | Categorize without guessing human priority; yes. | Keep literal values, human ownership and omission semantics. Shorten UI sorting narrative. |
| Next-action (227–277) | Human/agent handoff; yes. | One table: literal token, authority, action, completion. Keep narrow discuss exception and released-gate semantics; verify-without-me never means blind closure. |
| Resolution (278) | Explain closure; yes. | Keep exact metadata and evidence note. |
| Body/research (281–311) | Make cold pickup useful and research state discoverable; yes. | Keep concrete context and exact sentinel headings. Shorten generic writing coaching and JTBD persuasion. |
| Private and real-box rules (313–371) | Prevent public disclosure and history leakage; yes. | Keep public/private choice before file creation, approval/scrubbing requirement for real boxes, structural-facts exception, one-way links and separate commits. Route command mechanics to bin only when verified present. |
| Re-encounter (373) | Handle rediscovery without duplicates or stale gates; yes. | Three-case decision table; keep exceptional permitted removal of manual-testing. |
| Taking work/filing (399–425) | Search and retain cluster accountability; yes. | Concise action checklist with current defaults, not another explanation of every field. |

### Grouped document

**Public/private and whether to file → category/identity → schema and authorship → human-owned signals → lifecycle/manual testing/re-encounter → pickup/filing checklist.** Privacy moves earlier, before the first file-creation instruction. Human-owned next-action values stay beside the transition table. Preserve all headings used as stable links or machine sentinels even if surrounding prose moves.

Compression here is mainly tables and removal of persuasive repetition, not progressive disclosure. Do not turn a small field schema into a new skill or introduce a new checklist hierarchy. A shorter final action checklist is intentional repetition for execution.

## 5. Security-report rubric

**Purpose:** define the reproducible process and coverage behind the public accounting and derived overview. Needed: yes. Keep it as one rubric; its algorithm, disclosure rules, surface map, and inventory must be considered together. This is the weakest candidate for a structural split.

| Current section / line | Purpose / needed? | Compact form and treatment |
|---|---|---|
| Artifact roles and process claim (6–33) | Distinguish reporting policy, structured report, overview, and draft approval; yes. | Keep roles, do-not-rewrite SECURITY.md rule and human review before commit. One sentence explains the process claim. |
| Provenance (35) | Define exact reviewed revision and author/reviewer state; yes. | Keep schema, ancestry/sign-off meaning. Reduce first-run anecdote to the anchor consequence. |
| Update/full regeneration (60) | Specify the audit algorithm; yes. | Preserve ancestry check, scoped diff plus unscoped new-surface discovery, explicit-path checks, private-tier scan, item reconciliation, DRAFT state and diff presentation. Ordered steps remain. |
| Triggers (123) | Decide when to refresh without unattended generation; yes. | Release, drift, on-demand. Replace the claim that reliable scheduling does not exist with the actual reason: writing requires judgment and human review. |
| Surface map (147) | Define coverage of review range; yes. | Keep exact map in this skill. Do not broaden path coverage as part of editorial cleanup. |
| Inventory schema/disclosure (162–216) | Make items comparable and keep acceptance/classification human-owned; yes. | Compact field table only if every value, fail-closed default, class-only disclosure and one-way-link restriction survives. |
| Sections 1–5 (218–260) | Ensure coverage of endpoints, credentials, egress, practices and operations; yes. | Keep every category and non-obvious check; trim repeated examples only. |
| Feature sections (262) | Cover specific threat stories; yes. | Keep synchronization with the structured report; no new categories. |
| Threats/accepted risks (278–312) | Prevent overstated guarantees and missed cross-box channels; yes. | Keep prompt-injection honesty, channels, named verifiers, reconciliation and risk roll-up. |
| Overview (314) | Derive a readable, selective summary; yes. | State selectivity once, cross-reference from update step 6. Keep outline and tone requirements. |
| README (347) | Keep downstream egress claims consistent; yes. | Retain the short linkage check. |

### Grouped rubric

**Outcome and human approval → provenance → update/full-regeneration procedure → triggers → coverage map and classification → complete inventory → derived overview and README checks.** This is mostly the existing order with a compact completion statement and less repeated rationale.

The no-cadence claim at `.claude/skills/security-report/SKILL.md:125–126` is stale alongside the implemented schedules framework. Correcting it does not authorize an unattended report writer. Keep read-only inventory subagent instructions and their detailed briefs.

## Could this be simpler?

Yes: shorten all five files in place. That works for launch, issues, and security. It does not solve the mutually exclusive runner material in cross-model or the unrelated workflows in bin. Two runner references and four bin operational references serve actual conditional reads; no other new reference layer is justified. Moving history into new files solely to preserve word count is also unnecessary: source history and existing research retain it.

## Failure modes and validation

| Failure | Prevention / verification |
|---|---|
| Essential command flag or authority exception disappears | Compare original obligations to each compact section; independently trace reviewer execution, live/dormant launch, private filing, manual-testing release, and report approval. |
| A smaller entrypoint merely forces more mandatory reads | List the files a normal task needs. Cross-model reads shared + one runner; normal launch can stay in one file; issue and security each remain one contract. |
| A proposed destination does not contain the moved fact | Transfer facts and callers in one edit; don't substitute a historical plan or a vague code pointer for current operational instructions. |
| Scope changes masquerade as compression | Explicitly preserve model policy, exposed surfaces, command behavior, tag values, privacy and completion gates; treat functionality changes as separate work. |
| New files are missed by generation/link checking | Keep skill refs inside their canonical folder; links work through Codex directory symlinks. Regenerate CLAUDE mirrors after source edits. Stage new docs before any tracked-only validation. |
| Static review mistaken for measured behavior | Report doc/YAML/link checks separately from future trigger or behavior evaluations. No box knowledge audit can test this dev-repo guidance. |

For actual skill rewrites, a bounded independent read-only exercise can check normal and exceptional decisions using the final skill plus a realistic task, without disclosing the intended answer. Do not launch real worktrees, mutate security reports, or remove anything to test prose. A full activation corpus remains the separate existing trigger-eval work.

## Implementation order and rollout

1. Apply the cross-model grouping and compact shared text; keep prompt excerpts and runner flags, then review normal plan/diff routes.
2. Condense launch in place with the one optional example; correct the three verified factual claims without adding launcher functionality.
3. Review the four bin destinations and anchor compatibility, then move and trim one topic at a time.
4. Reorder/compact issues without changing its field/state/privacy contract.
5. Trim security-report conservatively, preserving the rubric and correcting only the stale rationale.

Each chunk gets doc-check, whitespace validation, source/links review, and the applicable cross-model review. Test scripts only if scripts change. Only the cross-model editorial chunk has been undertaken; the remaining operating documents are unchanged.

## Assessment review and validation

The independent cross-model review verified the launcher citations, existing anchors, and stale historical-plan links. Its three findings were adjudicated as follows:

- Retain the launch scope mirror-back explicitly. Scope still needs human approval, but approval already given in the conversation remains valid; this follows the session's authorization rules and does not create a new launch permission. No second approval gate is proposed.
- Preserve the no-editorializing rule and explain the review-bound impact once. Keep the two-round bound even if fresh findings could extend the work; reject an inevitable-never-clean claim as an unsupported universal description of model behavior.
- Add a conditional read-before-edit pointer for liveness/teardown, matching the existing router-protocol pattern. Its supporting safety facts must not become discoverable only by accident.

Doc-check and whitespace checks pass for this planning artifact. At the assessment checkpoint, all five operating documents remained at `c8c728285`. That review covered the proposal, not measured skill activation.

## Cross-model implementation

Applied the shared contract plus conditional [Codex runner](../../../.claude/skills/cross-model/references/codex-runner.md) and [Claude runner](../../../.claude/skills/cross-model/references/claude-runner.md). The [entrypoint](../../../.claude/skills/cross-model/SKILL.md) retains authority, completion, mode selection, delegated prompt scaffolding, bounded review rounds, and material-result handoff. Runner selection follows the driving family for all four intended models; reviewer defaults are preserved. Historical quota observations are labeled as dated, not current guarantees.

The Claude runner now explicitly distinguishes committed branch diffs from working-tree/new-file review targets. Supporting references resolve through the existing Codex skill directory symlink; no mirror generator change is needed. Other four proposed rewrites remain unimplemented.

Validation: doc-check, whitespace, unchanged skill frontmatter, and all source/mirrored reference links pass. An independent Claude review traced plan/diff routing and stalled-run recovery across the four driving models. It prompted explicit moved-template references, restoration of the foreground-run consequence and delegated prompt clause, and removal of a newly added challenge-default sentence. Its proposed target-based model policy was not adopted: the original default and explicit plan-mode override remain. The literal diff-review prompt and authority block remain intact. These are static review traces, not empirical runs of all four models or an activation evaluation.

## Follow-on: reduce unnecessary reading and work

The human approved seven audit recommendations after the cross-model chunk
landed. These edits are applied locally:

| Instruction purpose | Change |
|---|---|
| Prove box guidance is usable | `bbx-context` selects knowledge-audit expectations by intended loading tier: recall, known reference, or discovery. |
| Establish a bug's cause | `bbx-debug` stops minimizing at a cheap diagnostic repro and tests plausible hypotheses without a fixed count. Its evidence-before-fix requirement remains. |
| Explain and verify a design | `bbx-plan` maps actual tradeoffs to preferences and verifies external premises the design depends on. Source citations remain required. |
| Keep tool output useful | Root guidance fixes introduced/relevant diagnostics and records pre-existing out-of-scope noise once for focused cleanup. |
| Close resolved issues | The finish agent starts with supplied and branch-added candidates; concrete sibling links or evidence of a missing issue justify expanding the search. |
| Make rules discoverable | Debug, context, and codehealth consolidate repeated rule summaries, preserving unique obligations in their relevant sections. |
| Teach doctest syntax when needed | The path rule becomes a pointer to the consolidated [syntax reference](../../../agent-doctest/docs/syntax.md), also linked from the doctest skill and beebox guidance. The generator stays unchanged. |

This is dev-repo guidance and a documentation-map label, not a change to
box-agent prompts or the audit harness. It does not require box knowledge-audit runs. The four larger editorial
proposals above remain future work; this pass does not change their scope.

Static validation: regenerated 18 AGENTS mirrors and verified the root source
and shortened doctest rule are reflected. The rule's body fell from 512 to 29
words; full grammar remains in the syntax reference. Skill descriptions and
frontmatter are unchanged, Markdown targets resolve, original rule details
survive consolidation, and doc-check/whitespace checks pass. These checks do
not claim empirical activation or behavior results across the four models.

Independent review confirmed the grammar transfer and retained obligations.
Corrections made: explicitly re-run after each repro reduction, retain bounded
inbound issue-slug searches, repoint older syntax references, and distinguish
the Bee Box fence-label convention from the shared runner's accepted syntax.
The documentation-map label passes focused ESLint; `pnpm test:changed` selected
zero tests because none import that changed source path. No full suite was run.
