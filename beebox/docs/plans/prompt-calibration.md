---
title: "Calibrate skill discovery and the root agent instructions"
status: active
workstream: prompt-calibration
issues:
  - ../../../issues/docs-and-chores/2026-07-30-run-skill-trigger-evals.md
---
# Calibrate skill discovery and the root agent instructions

Shorten skill descriptions without losing the connections that make a skill discoverable. Reassemble the root agent instructions around the decisions an agent needs to make, preserving repository facts and constraints while removing persuasion and duplicate explanations.

The skill descriptions and root assembly have been approved. The descriptions were committed in `6fa206288`; the reviewed assembly is now applied to root `CLAUDE.md` in this worktree. The assembly below records the reviewed design; the root file is the active instruction source.

**Done for this pass:** descriptions retain meaningful triggers and exclusions; every root topic has a purpose, necessity decision, compact form, and destination; a complete proposed root demonstrates the grouping; links and generation paths are checked; an independent cross-model review is adjudicated. This does not claim measured improvement in skill activation.

**Issues addressed:** the description-rewrite portion of [Run trigger evals on our skills](../../../issues/docs-and-chores/2026-07-30-run-skill-trigger-evals.md). The issue stays open: empirical activation testing and its broader questions remain unfinished. [Documentation reorganization](docs-reorg.md) is prior in-repo work, not a mandate to execute that older plan.

## Smallest fix and budget

Two tracks: edit the 23 skill descriptions; assess and apply the root rewrite. This pass changes skill frontmatter, root `CLAUDE.md`, and this planning document. No runtime application behavior, hooks, generator source, or skill bodies change. Applying valid root links exposed a doc-check resolver defect: external targets outside its scanned directories were reported missing even when they exist. The implementation therefore also includes a narrow external-link resolution fix and a focused doctest, with no scan expansion or exemptions. Budget: 23 description replacements plus the canvas skill's canonical plugin source and roughly 300 lines of planning prose, the root replacement, and up to 100 lines for the resolver prerequisite and its test. The approved root implementation replaces the original 2,242-word root with roughly 800–1,100 words; clarity and preserved decisions take precedence over that estimate.

## Stated preferences this plan trades against

Direct human requirements govern this work:

- "when there's a non-obvious connection between the skill and what would activate it, we shouldn't just strip it down"; descriptions should "connect the dots."
- For each root item: identify its purpose, decide whether it is needed at all, write its compact form, then group the results into a holistic document and examine the documentation hierarchy.
- Keep information and described impacts; remove attempts to convince a capable reader. Repository instructions serve multiple leading models. Briefings written for less capable subagents retain the detail those workers need.
- Keep repository-specific safety boundaries and testing economics. Do not infer that newer models know local hazards.

## What already exists

Source references below are to the checkout at `6fa206288`, before the root rewrite:

- `CLAUDE.md:29`: "The router is shared across sessions" — keep this fact and the restart restriction in the root.
- `CLAUDE.md:35`: "Auto-deploy is `main`-only, and only for deployed paths." — keep the action consequence before an agent commits or merges.
- `CLAUDE.md:63`: "Public files must never link into it." — the private-issues boundary applies before writing public content, not only after entering `issues/`.
- `CLAUDE.md:75`: "NEVER disable or weaken a lint rule to make code pass. Ask first." — preserve the restriction and its existing narrow exception.
- `beebox/CLAUDE.md:11`: "an hourly schedule runs it on `main`; don't run it in a worktree without a reason." `.claude/skills/finish/SKILL.md:18` also says "no full suite". The handoff's full-suite-at-finish description is stale; reuse current guidance.
- `bin/generate-agents-md.ts:184` discovers tracked CLAUDE.md files; its generated content is a copy, not an alternate policy. `generateSkillLinks` at line 263 links tracked skill directories into `.agents/skills/`.

## Prior art (external)

[OpenAI's skills and prompts article](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) recommends precise activation descriptions and conditional access to supporting material, and explicitly notes that repository skills serve different models. Apply that distinction without treating the article as authority to remove local constraints.

## Tracks / scope

### Track 1: Skill descriptions

Change descriptions only. The canvas skill has a canonical plugin source at `canvas-loop/claude-plugin/skills/canvas-loop-sketch/SKILL.md`; edit that description and run its existing `sync:claude-skill` command to refresh the tracked repo copy. Keep the condition that leads from an ordinary task to the skill, even when the user never names it. Remove workflow summaries, implementation paths, and lists of equivalent phrases when they add no discovery value. Preserve names, bodies, tool permissions, and supporting resources.

Examples of connections that must survive:

| Task signal | Skill connection to retain |
|---|---|
| Old cards still parse but their meaning changes | `bbx-migration`: compatibility includes meaning, not only syntax. |
| Change upload, transcription, pairing, or bridge behavior on the web/backend | `bbx-ios-overlap`: the native companion shares these contracts. |
| Edit schema instructions or the generated box guide | `knowledge-audit`: test what a box agent absorbed; dev-repo instructions are excluded. |
| A phone-only timing bug needs evidence from the user | `field-probe`: inaccessible environment requires deployed instrumentation and human observation. |
| An ordinary change is larger than a small bug fix | `cross-model`: repository policy requires review even without an explicit request for it. |
| Repeated debugging exposes tangled architecture | `bbx-codehealth`: deliberate health work can be the next step after the debugging circuit breaker. |
| Change routes, credentials, egress, or publishing | `security-report`: security-relevant changes can make the accounting stale. The body's draft/review rules still govern actual updates. |

### Track 2: Root assessment, then proposed assembly

The table follows the original root's order. "Needed?" distinguishes whether information is useful anywhere from whether it belongs in the root. A move means retaining it at an existing destination, not deleting it from the operating manual. Source line numbers are audit references, not permanent links.

| Original topic | 1. Intended accomplishment | 2. Needed at all? | 3. Compact form and destination |
|---|---|---|---|
| Project count and merger history, line 3 | Explain why packages share a repository. | Shared-repo fact yes; dated merger story and stale "Four projects" count no. | Root: "This is one monorepo" followed by a selective responsibility map. |
| Main system and removed cardworks, line 5 | Find the app and prevent searching the retired library. | App route yes. Historical warning is conditional. | Root links `beebox/CLAUDE.md`; it already locates card primitives in `src/cards/`. Drop root's removal story. |
| Chrome extension, line 6 | Route extension work. | Yes, one entry. | "Chrome extension: `beebox-clerk/CLAUDE.md`." |
| Doctest package, line 7 | Distinguish harness code from app tests. | Yes; this connection is not obvious from ordinary testing work. | "Doctest framework: `agent-doctest/`; application tests live in their packages." |
| Shared lint preset, line 8 | Prevent editing the stale standalone checkout. | Yes, root: impacts every package. | "Edit shared ESLint/TS/Prettier rules in `personal-vibe-check/`, not its old standalone checkout." Link its CLAUDE.md. |
| Canvas library, line 9 | Route visual sandbox work and identify experimental status. | Yes; exports and render recipe need not be always loaded. | "Experimental deterministic Canvas2D sandbox: `canvas-loop/README.md`; use `canvas-loop-sketch` for sketches and gallery work." |
| Workstreams ownership, line 10 | Distinguish the router implementation from thin launchers. | Yes, root map. | "Dashboard and router: `workstreams-app/`; lifecycle launchers: `bin/`." |
| Native companion, line 11 | Expose the web/native contract to agents working on either side. | Yes, root: directory-local instructions alone miss web changes. | Name the shared HTTP/bridge contract and route to `bbx-ios-overlap`, iOS CLAUDE.md, and the mobile contract. |
| Research, dev, bin, issues map, line 13 | Route non-application work. | Yes; repeated issue categories and naming syntax no at root. | Place research in the map; dev, bin, and issues in the workflow groups below. |
| Schedule enrollment and catalog, lines 15–23 | Connect recurring work and missed runs to the supported scheduler. | Yes, root cue. | "For recurring work or missed runs, use `bbx-authoring-schedules`; `bin/schedules list` shows status." Keep directory/launchd/catch-up/alert mechanics in `bin/CLAUDE.md`. |
| Boxes, line 25 | Avoid inheriting dev instructions into boxes; find the isolated test clone. | Yes. | Root: boxes live outside the repo; name canonical and per-worktree test locations. Box isolation is information, not persuasion. |
| Managed worktrees, line 27 | Use the supported launcher and cleanup owner. | Yes. | Root: use `launch-worktree-session` when asked to spin work off; managed hooks own cleanup, so native Claude worktree creation is inappropriate. Installation details stay in bin docs. |
| Router contract, line 29 | Produce working URLs and avoid disrupting other sessions. | Yes. | Root keeps URL shape, short-name distinction, lazy HTTP wake-up, shared-router restriction. Cold-start timings and idle timeout stay in bin docs. |
| Dev/docs serving, line 31 | Let agents show tracked artifacts and let humans read repository docs. | Yes, discovery cue. | Root keeps `/<worktree>/dev/` and `/dev/docs/` routes; links `dev/README.md`. Rendering, filtering, and source implementation belong there or in bin docs. |
| Browser wrapper, line 33 | Pick the supported browser tool and correct worktree URL. | Yes. | "Use `bin/browse` via the `browse` skill; `/`-leading paths resolve in this worktree." |
| Deployment, line 35 | Explain the consequence of committing/merging to main. | Yes, root before action. | Keep the main-only condition and exact shipped-path set. Drop the inverse list of every non-deploying package. Route deployment mechanics to `beebox/deploy/README.md`. |
| Commit trailers, line 37 | Preserve issue attribution and avoid invalid or private trailer values. | Yes. | Root keeps automatic Workstream/Plan behavior, optional bare public Issue name, invalid-name rejection, and private-name prohibition. Search commands and merge history shape stay in bin docs. |
| Docs hooks and public paths, line 39 | Prevent bypassing inexpensive checks and leaking personal paths. | Yes. | Root: commit docs with hooks; use repo-relative or `~/` paths in tracked files. Name the doc/path/blocklist checks and link diagnostics. Remove elapsed-time estimate and guard history. |
| Husky, line 41 | Point hook/config edits at their actual owner. | Ownership yes; installation mechanics not root. | Combine with checks: "Hooks live in root `.husky/`." Keep `prepare`, git-lfs, and install wiring in bin docs. |
| Exhibits and screenshot handoff, lines 43–53 | Give the human coherent visual evidence or one answerable ask; distinguish temporary and durable artifacts. | Yes, combined. | One root paragraph: labeled exhibit, one ask with all four meanings, `fyi` for evidence, incidental-capture exception, share URL. Explain exhibits survive culling and do not merge; durable apps go in `dev/apps/`. Keep the `--permanent` command cue: the linked exhibit reference does not currently document that flag. Other storage/lint details remain in exhibits docs. |
| Document comments, lines 55–59 | Discover and act on asynchronous human feedback. | Yes, root before choosing work. | Keep list at pickup, show on commented docs, act then clear. Clarify external-to-git store in one clause. |
| Issue discovery and ownership, line 61 | Preserve out-of-scope finds without treating filing as implementation authority. | Yes. | Keep filing discretion, no automatic implementation, and offer to fix own finds at pauses/finish. Route formats, category lists, and re-encounter procedure to `issues` and issues CLAUDE.md. |
| Private issues, line 63 | Stop private data reaching public files; handle the separate repo correctly. | Yes, root before filing. | Keep private/public distinction, uncertainty boundary, separate commit location, no public links. Missing mount means no opt-in; setup instructions remain in the linked issues documentation. |
| Delegation, lines 65 and 69 | Balance capability and cost, with stronger orchestration by leading models. | Yes, one combined rule. | Keep discretion, lightest capable worker, stronger expectation for the most capable driving models, and tightly coupled exceptions. Preserve detailed subagent briefings; remove repeated cost arguments and historical qualifications. |
| Cross-model review, line 67 | Require independent review above the small-bug-fix threshold. | Yes. | State threshold, different family, skill, and material findings handoff once. Remove history explaining prior one-directional and model-specific mistakes. |
| Transient lint diagnostics, line 71 | Avoid chasing temporary intermediate-batch errors. | Yes; hidden hook timing is local knowledge. | "Finish coordinated edits before acting on per-edit lint output; verify diagnostics that remain." |
| Command noise, line 73 | Keep routine tools useful and affordable to read. | Yes, policy spans tooling. | "Treat unsolicited output, including warnings and deprecations, as a bug; fix the cause or silence it with a targeted configuration. Moving noise to stderr does not help." |
| Lint restrictions, line 75 | Prevent degrading deliberate rules to make a change pass. | Yes, root; enforcement cannot replace the agent decision. | Keep no weakening/disabling/options changes/suppressions without explicit permission, plus the justified single-line false-positive exception. Drop the incident narrative; the historical audit can remain discoverable from this plan without being required reading in the root. |

### 4. Assemble by the agent's decisions

Use five groups: **Where to work → Work safely in this checkout → Implement and verify → Record and show work → Commit and land.** Each combines related material that is currently separated. The map is selective, not a promise to enumerate every directory. Link labels name both a destination and why an agent should open it.

The root keeps pre-action constraints even when a deeper reference repeats them: privacy before writing, router ownership before restarting, and deployment effects before merging. Repetition of these short constraints at a hazardous operation is useful; repetition of command inventories and incident stories is not.

### 5. Hierarchy and links

| Layer | What it should own | Entry condition / link behavior |
|---|---|---|
| Root CLAUDE.md | Cross-package orientation, pre-action constraints, human feedback workflow, conditional routes. | Always available; no instruction to read every linked file first. |
| Package/nested CLAUDE.md | Rules specific to the files being edited. | Root names package entry points. Nested instructions refine scope; do not relocate global hazards into them. |
| Skill description | Recognizable task signals, including indirect ones and useful exclusions. | Discoverable before loading the skill; no assumption that the human names the skill. |
| Skill body and references | Workflow decisions and operational details for the selected task. | Read the applicable workflow. Keep exact recipes where order or harness behavior matters. |
| Existing reference docs | Mechanics, schemas, command catalogs, maintained contracts. | Link from the decision where needed; prefer a direct topic anchor over routing everything through the entire bin manual. |
| Plans and reports | Proposed changes or historical evidence. | Label as proposals/history. Do not make an old incident narrative a prerequisite for ordinary work. |
| Generated Codex surfaces | Harness mapping and copies of canonical guidance. | Edit tracked CLAUDE.md/rules; regenerate AGENTS.md. Skills are symlinks and retain their references/scripts. |
| Box-agent instructions | Guidance shipped into or maintained in boxes. | Separate audience and loading path. Dev-repo documentation edits cannot be validated by box knowledge audits. |

Concrete link choices for the root implementation:

- Replace vague "see its CLAUDE.md" references with actual relative Markdown links to each existing owner.
- Link the native contract directly from the web/native overlap cue; do not require an agent to enter `ios-app/` to discover the relationship.
- Link browser work to the `browse` skill and review work to `cross-model`. The directory symlink layout preserves relative skill resources for Codex.
- Link recurring work to `bbx-authoring-schedules`; link catalog/lifecycle details into the existing bin sections. Do not split the 910-line bin file in this pass.
- Link exhibits to `workstreams-app/docs/exhibits.md`, current behavior rather than its design plan. Link issue formats to `issues/CLAUDE.md` without repeating them.
- Remove the root's link to the [completed lint-suppression audit](../../../docs/eslint-rule-suppression-audit.md) from always-loaded prose because it is incident history, not a prerequisite for following the rule. The file exists and remains discoverable; the complete active restriction stays in the root.
- Keep generated preamble ownership in `bin/generate-agents-md.ts`; do not paste its session-specific worktree context into tracked root guidance. Regeneration affects files, not already-loaded session context or other worktrees.

### Reviewed root assembly

The following records the approved assembly, applied to root `CLAUDE.md`. Links here resolve from this plan; the root uses the corresponding root-relative links.

#### Where to work

Use the guidance for the area you are changing:

- **Main system:** [beebox/CLAUDE.md](../../../beebox/CLAUDE.md).
- **Chrome extension:** [beebox-clerk/CLAUDE.md](../../../beebox-clerk/CLAUDE.md).
- **Native iOS companion:** [ios-app/CLAUDE.md](../../../ios-app/CLAUDE.md). It shares an [HTTP/bridge contract](../../../beebox/docs/mobile-contract.md) with the web/backend; use [bbx-ios-overlap](../../../.claude/skills/bbx-ios-overlap/SKILL.md) when changing those shared surfaces.
- **Shared ESLint/TypeScript/Prettier preset:** [personal-vibe-check/CLAUDE.md](../../../personal-vibe-check/CLAUDE.md). Edit it here; the old standalone checkout is stale.
- **Doctest framework:** [agent-doctest/README.md](../../../agent-doctest/README.md); application tests live in their packages.
- **Experimental deterministic Canvas2D sandbox:** [canvas-loop/README.md](../../../canvas-loop/README.md); use [canvas-loop-sketch](../../../.claude/skills/canvas-loop-sketch/SKILL.md) for sketches and gallery work.
- **Dev dashboard and shared router:** `workstreams-app/`. Thin lifecycle launchers live in `bin/`; [bin/CLAUDE.md](../../../bin/CLAUDE.md) documents their mechanics.
- **External-tool research:** [research/CLAUDE.md](../../../research/CLAUDE.md).

#### Work safely in this checkout

Boxes live outside this repo at `~/src/boxes/` so they do not inherit dev-repo instructions. The primary test box is `~/src/boxes/test1/`; each managed worktree has an isolated clone at `~/src/box-worktrees/<name>/test1/`.

When asked to spin off work, use [launch-worktree-session](../../../.claude/skills/launch-worktree-session/SKILL.md). Managed worktrees live at `~/src/beebox-worktrees/<name>/` on `worktree-<name>` branches. Repository hooks own cleanup; do not use native `claude --worktree` for this workflow.

One shared dev router serves every checkout at `http://localhost:3210/<main|worktree>/<box>/...`. Use the worktree's short name, without the branch's `worktree-` prefix. HTTP requests wake idle worktrees; WebSockets do not. **Do not restart or `panic` the shared router from a worktree without asking the boxholder.** Lifecycle details: [bin/CLAUDE.md](../../../bin/CLAUDE.md#lifecycle-commands).

Use [browse](../../../.claude/skills/browse/SKILL.md) and `bin/browse` for browser work; `/`-leading paths resolve in this worktree. Tracked HTML and Markdown in `dev/` are served at `/<worktree>/dev/`; the repository doc browser is at `/<worktree>/dev/docs/`. See [dev/README.md](../../../dev/README.md).

For recurring work or missed scheduled runs, use [bbx-authoring-schedules](../../../.claude/skills/bbx-authoring-schedules/SKILL.md). `bin/schedules list` shows the catalog, last runs, and overdue work; [bin/CLAUDE.md](../../../bin/CLAUDE.md#schedules-binschedules) covers scheduling mechanics.

#### Implement and verify

Use the package's test guidance. For beebox changes, run change-selected tests; the full suite is scheduled hourly on `main`. See [beebox/CLAUDE.md](../../../beebox/CLAUDE.md#development) and [finish](../../../.claude/skills/finish/SKILL.md) for the applicable checks.

**Do not disable or weaken lint rules to make code pass without explicit permission for that change.** This includes rule removal, lower severity, looser options, and suppressions. Fix the code; ask if the rule needs changing. The existing exception is one `eslint-disable-next-line <rule> -- <concrete justification>` for a true, narrow false positive. Finish coordinated edits before reacting to per-edit lint output, then verify any diagnostics that remain.

Treat unsolicited tool output—including warnings, deprecations, ignored-build-script lists, and peer-dependency mismatches—as a bug. Fix the cause through dependency changes, allowlists, targeted configuration, or package removal. Stop non-actionable warnings from recurring; routine-success diagnostics belong behind debug. Moving noise to stderr does not help.

Delegate when useful without asking first, using the lightest capable worker: lightweight models for bounded searches, mid-tier models for most implementation/research, and stronger models for difficult reasoning. When a most-capable model drives, favor delegation for substantial independent work; trivial or tightly coupled work can stay inline. Give workers concrete tasks and the context, constraints, and completion criteria they need. Shorter repo instructions are not a reason to strip scaffolding from subagent briefings.

For anything beyond a small-scope bug fix, get [cross-model review](../../../.claude/skills/cross-model/SKILL.md) before declaring it done. The reviewer must use the other model family, regardless of the driving model. Adjudicate findings and report material changes, unresolved risks, or human decisions.

#### Record and show work

Human document comments live outside git. At pickup run `bin/comments list --workstream <name>`; use `bin/comments show <path>` when opening a document that may have comments. Read, act, then clear. [Comment mechanics](../../../bin/CLAUDE.md#document-comments-bincomments).

Use [issues](../../../.claude/skills/issues/SKILL.md) to retain worthwhile out-of-scope finds. Filing does not authorize implementation. Keep track of this workstream's own finds and offer to fix them at natural pauses and finish. Formats and re-encounter rules: [issues/CLAUDE.md](../../../issues/CLAUDE.md).

Private box content and personal/operational specifics belong in `private-issues/`, a separate gitignored repository mounted by symlink. Ask when unsure whether content is public-safe. Commit private changes from inside that repository; public files must never link into it. A missing mount means the developer has not opted in. [Privacy rules](../../../issues/CLAUDE.md#private-issues-private-issues--a-separate-repo) and [setup/mechanics](../../../bin/CLAUDE.md#private-issues-shadow-repo-private-issues).

Show useful UI screenshot evidence as one labeled exhibit and share its URL. Give it exactly one ask: `decide` (choose), `confirm` (veto if wrong), `react` (impressions), or `fyi` (evidence only). State what the figures demonstrate. A lone incidental debug capture does not need an exhibit. Use `bin/exhibits add` to create one and `bin/exhibits list` to check answers. Exhibits survive worktree culling and do not merge; durable apps belong in `dev/apps/<name>/` (`bin/exhibits add --permanent`). [Exhibit contract and commands](../../../workstreams-app/docs/exhibits.md).

#### Commit and land

Commit docs with hooks; do not use `--no-verify`. Root `.husky/` owns hooks, including package-check dispatch and git-lfs wrappers; subprojects opt out with `prepare: ":"`. Root `pnpm install` wires them up. Docs-only commits run fast doc, path-leak, and personal blocklist checks. Use repo-relative or `~/` paths in tracked content. [Doc-check guidance](../../../beebox/docs/README.md#enforcement-pnpm-doc-check) and [guard mechanics](../../../bin/CLAUDE.md).

Hooks add `Workstream` and, when exactly one plan matches, `Plan` trailers. An optional `Issue: <bare-basename>` identifies a public issue; omit directories and `.md`, repeat for multiple issues, and never name a private issue. A nonexistent issue name blocks the commit. [Provenance details](../../../bin/CLAUDE.md#commit-provenance-trailers-commit-provenancets).

When the human asks to finish or land work, use [finish](../../../.claude/skills/finish/SKILL.md). Auto-deploy runs only on `main` commits/merges touching shipped paths: `beebox/`, `agent-doctest/`, `personal-vibe-check/`, `patches/`, or root pnpm files. Worktree commits do not deploy. [Deployment operations](../../../beebox/deploy/README.md).

### Implementation prerequisite: valid external document targets

The root now uses direct Markdown links rather than plain-text mentions. On application, doc-check falsely rejected six existing targets outside its external source inventory: extension, iOS, shared preset, doctest framework, canvas, and exhibits documentation. The inventory identifies documents to scan; it must not limit which existing in-repo files those documents can link to. Fix external reference resolution narrowly, preserve existing precedence and incoming-link accounting, and verify valid, missing, and out-of-repository targets. This does not broaden scanning or relax broken-link checks.

## Could this be simpler?

Only shortening descriptions would leave the requested root analysis undone. A root containing only links would hide privacy, router, and deployment consequences until after an agent had selected a workflow. Keep short pre-action rules and route the mechanics. No new router document or reference-file split is needed for this pass.

## Subplans

None. A later bin/CLAUDE.md split needs its own concrete relocation proposal, not implementation as a side effect of this pass.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Short description loses an indirect activation signal | No measured cross-model baseline in this pass | Compare original/body intent, review concrete task signals, independent review | Silent; remaining empirical limitation is explicit |
| Compact root silently changes an obligation or exception | No semantic automated test | Item-by-item disposition and complete proposed assembly, human review before root edit | Silent without review |
| A moved fact has no discoverable destination | Doc-check validates paths, not routing judgment; external-target regression added with root implementation | Destination map and direct links at relevant decisions | Broken link can be clear; weak cue is silent |
| Codex reads stale copied guidance | Existing generator has safeguards; not changed here | Regenerate after root edits and inspect output; verify skill symlinks | Already-running contexts may remain stale |

## Agent-flow / user-flow edge cases

- **ADDRESSED:** indirect skill activation and overlapping siblings are compared using task signals, not just explicit skill invocations.
- **ADDRESSED:** shared hazards remain in root even when the code being edited lives elsewhere.
- **ADDRESSED:** source docs and generated copies have distinct ownership. Do not write AGENTS.md by hand or modify another active worktree.
- **DEFERRED:** behavior across real sessions and engines needs the existing trigger-eval work; a static review is not evidence of activation rates.
- **ADDRESSED:** the assembly is labeled as the reviewed design; root CLAUDE.md is identified as the active source.

## NOT in scope

- Rewriting skill bodies or delegated agent prompts; their procedures require separate judgments.
- Splitting bin/CLAUDE.md or issues/CLAUDE.md; destinations are assessed here but files do not move.
- Changing testing, deployment, privacy, lint, or authorization policy.
- Adding a prompt-evaluation subsystem or running broad application suites for prose edits.
- Rewriting instructions loaded by box agents.
- Hand-editing or committing generated mirrors, merging, or deploying this work. Regeneration of this checkout's gitignored mirrors is in scope.

## Open design questions

The human approved the root assembly. It keeps short global restrictions plus a selective map, with detailed mechanics at existing destinations. No design questions remain within this pass. A numeric compression target is deliberately not an acceptance gate.

## Knowledge audits

Not applicable: these are dev-repo instructions, not documents the box-agent harness loads. Running a box knowledge audit would test the wrong audience.

## What will hold this after it ships

Validate YAML and description-only changes, inspect source-to-mirror relationships, run doc-check and whitespace checks, and cross-model-review the description diff plus root proposal. Review must check concrete indirect task signals and preserve policy, not reward shorter text alone. The existing trigger-eval issue retains the empirical work.

## Implementation order

1. Complete and review description replacements (committed in `6fa206288`).
2. Present the purpose/necessity/compact-form assessment, hierarchy, and complete root proposal (approved).
3. Apply the approved root assembly and regenerate its Codex mirrors; validate links and preserved obligations.
4. Consider skill-body or large-document restructuring separately.

## Rollout shape

This is a local, incremental documentation change. Existing skill symlinks expose description edits to future readers in this checkout. The approved root is now applied locally. Regeneration refreshes this checkout's files; it does not reload active model contexts. Report static validation separately from empirical skill activation, and local edits separately from landing.

## Review and validation

The independent cross-model review identified five concrete corrections, applied before handoff: retain bulk-upload and literal issue-tag activation cues; preserve warnings/deprecations in the noise rule; retain the exhibit `--permanent` and Husky ownership details because the proposed destinations do not hold them; and correct the false claim that the historical lint-audit path was missing. Its removal from the proposed root is an editorial choice about history, not a broken-link repair. The delegation paragraph also retains explicit permission to delegate without asking.

The revised descriptions pass YAML and description-only scope checks. All 23 Codex skill links resolve to the canonical repo skills, and the canvas plugin source matches its synchronized copy. Doc-check and whitespace checks pass. Those checks validated the description/proposal checkpoint before root implementation. No empirical activation result or landing is claimed.

### Root implementation

Applied the reviewed root assembly exactly, rebasing its links and promoting section headings. The root is 850 words, down from 2,242. Regenerated all 18 gitignored AGENTS.md mirrors and 23 skill links with the worktree name; verified that the root mirror contains the exact source and retains worktree orientation. The link audit found all 29 root targets and anchors valid and no incoming root-heading links to repair.

The required resolver prerequisite is in `beebox/src/dev/doc-graph-data.ts`, covered by `beebox/test/dev/doc-graph-data.doctest.md`. The change-selected test run passed all three assertions, and focused lint/doc-check passed. No full suite was run; no runtime application behavior changed.

The second cross-model pass found no material root implementation defects and confirmed the first review's corrections remain intact. Its doc-check caveat was based on an earlier planning snapshot; the applied root now passes doc-check with the resolver fix. Both tracks are locally complete; landing and empirical trigger evaluation remain separate.
