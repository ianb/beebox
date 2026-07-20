# Documentation Graph Report

Generated: 2026-07-20T23:39:27Z
Total documents: 201

## Issues

### Orphaned Documents (no incoming references)

These documents are not referenced by any other document.

- **docker/README.md** — "Docker packaging" (28 lines)
- **docs/implemented-plans/agent-applied-migrations.md** — "Agent-applied migrations (via procedure checklists)" (544 lines)
- **docs/implemented-plans/architectural-review.review.md** — "Plan Engineering Review — architectural-review (codex cross-model pass)" (99 lines)
- **docs/implemented-plans/box-schema-reload.md** — "Box-local schema reload — design & implementation plan" (354 lines)
- **docs/implemented-plans/chat-composer-rerender.md** — "Plan: stop composer keystrokes from re-rendering chat history" (154 lines)
- **docs/implemented-plans/companion-pane-card-activity.md** — "Companion-pane card activity awareness for chat" (366 lines)
- **docs/implemented-plans/courseware-lesson-plan.md** — "Courseware: the `lesson-plan` card" (345 lines)
- **docs/implemented-plans/extfile-card.md** — "`extfile` Card — an In-Box Pointer to a Live External File" (714 lines)
- **docs/implemented-plans/input-extraction.review.md** — "Plan Engineering Review — input-extraction (codex cross-model pass)" (86 lines)
- **docs/implemented-plans/local-password-auth.review.md** — "Cross-model review — local-password-auth (Codex, 2026-07-19)" (81 lines)
- **docs/implemented-plans/markdoc-tags-plan.review-adapted-trial.md** — "Plan Engineering Review — Markdoc Tags Design" (129 lines)
- **docs/implemented-plans/markdoc-tags-plan.review.md** — "Plan Engineering Review — Markdoc Tags Design" (505 lines)
- **docs/implemented-plans/named-places.md** — "Named Places (`place` cards + `cb location mark`)" (465 lines)
- **docs/implemented-plans/normalize-chat-links.md** — "Normalize chat/card links" (690 lines)
- **docs/implemented-plans/open-chat-from-card.md** — "Open chat from a card browse page" (339 lines)
- **docs/implemented-plans/procedure-validation-completion.md** — "Procedure validation completion (D5)" (440 lines)
- **docs/implemented-plans/refresh-clerk.md** — "Refresh callback-clerk" (441 lines)
- **docs/implemented-plans/refresh-maps-convergence.review.md** — "Plan Engineering Review — refresh-maps convergence" (379 lines)
- **docs/implemented-plans/remove-box-shape-v1.core-review.md** — "1a+1b core review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)" (57 lines)
- **docs/implemented-plans/remove-box-shape-v1.final-review.md** — "Final review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)" (49 lines)
- **docs/implemented-plans/remove-cardworks-deletion.md** — "Remove cardworks — final deletion phase" (621 lines)
- **docs/implemented-plans/responsive-figures.md** — "Responsive Figures" (411 lines)
- **docs/implemented-plans/schema-validate-hook.md** — "Schema `validate` hook — co-locate non-Zod card validation with its schema" (373 lines)
- **docs/implemented-plans/semantic-search.md** — "Semantic search (box-search phase 3): hybrid BM25 + vector retrieval" (533 lines)
- **docs/implemented-plans/view-render-testing.md** — "Plan: testing agent-authored views" (544 lines)
- **docs/plans/ios-native-capture-mode.review.md** — "Plan Engineering Review — Native iOS capture mode" (470 lines)
- **src/frontend/dist/earcons/SOURCES.md** — "Earcon sources & attribution" (13 lines)
- **src/frontend/public/earcons/SOURCES.md** — "Earcon sources & attribution" (13 lines)
- **test/manual/README.md** — "Manual tests" (21 lines)

### Broken References

These references point to files that don't exist.

- **docs/implemented-plans/link-validation-fix.md:530** → `/store/foo/bar.md` (link)
  Context: `[x](/store/foo/bar.md)`. What does the leading slash mean?"*;
- **docs/knowledge-audits.md:76** → `MAP.md` (at-include)
  Context: - `context_dir` — box-relative subdirectory to run the agent from. Sets the SDK's `cwd` there and adds the box root to `
- **docs/reports/user-stories-audit-2026-06-26.md:5334** → `MAP.md` (at-include)
  Context: - Ensure per-dir CLAUDE.md includes are correct: IMPLEMENTED in finalize.ts lines 58-79 with `ensureClaudeMdInDir()` tha

## Document Inventory

### ./

#### CLAUDE.md

Title: "Callback Box" | 175 lines

Referenced by:
- CLAUDE.md:9 (mention) — **Dev server** — one shared router serves every checkout at `http://localhost:3210/<main|worktree>/<box>/...` (lazy star
- README.md:36 (mention) — `CLAUDE.md`) and the box itself under `content/` — directories, default
- code-style.md:41 (mention) — - **`console.debug`** — routine diagnostics; prefer none. Routine success prints nothing (per CLAUDE.md, noisy output is
- docs/README.md:38 (mention) — - **kebab-case filenames.** `README.md` and `CLAUDE.md` are exempt (fixed
- docs/activities-design.md:46 (mention) — Live at `<box>/activities/<name>/src/`. The `src/` subdirectory is deliberate — the activity directory isn't just code, 
- docs/activities-retrospective.md:21 (mention) — Each "activity-shaped" use case turned out to be better served by adding the specific capability (a card type, a schedul
- docs/adding-schemas.md:265 (mention) — 5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
- docs/box-layout.md:9 (mention) — A box is a directory marked by a `.cb-box` file. It's a git repository (`cb init` initialises one), and the working tree
- docs/design/extensibility.md:25 (mention) — prompts), don't build it. Small additions — a `CLAUDE.md` file with custom
- docs/design/identity.md:5 (mention) — and operating system built on Claude Code" (CLAUDE.md) is the identity;
- docs/glossary.md:20 (mention) — **boxholder** — The human a box belongs to. Used in shared prose where "the user" is ambiguous (since agents are also "u
- docs/implemented-plans/app-wide-csp.md:217 (mention) — `mode`. Lives in `src/lib/` per CLAUDE.md ("Cross-cutting helpers").
- docs/implemented-plans/architectural-review.md:68 (mention) — `CLAUDE.md`s, and the boxholder's stated preferences during this review. Where
- docs/implemented-plans/attach-directories-superseded.md:156 (mention) — Throughout prompts, generated docs, agent instructions, and `CLAUDE.md` mentions, the user-facing terminology is "card a
- docs/implemented-plans/box-retrospectives.md:46 (mention) — - "Treat noisy command output as a bug" (monorepo CLAUDE.md) — `cb retro`
- docs/implemented-plans/box-search.md:47 (mention) — - Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — search and
- docs/implemented-plans/boxes-as-packages-v2.md:54 (mention) — - Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — scaffold/upgrade commands
- docs/implemented-plans/capture-mode.md:140 (mention) — CLAUDE.md's time-discipline note.
- docs/implemented-plans/card-view-widgets.md:542 (mention) — CLAUDE.md's "don't add features beyond what the task requires."
- docs/implemented-plans/cards-as-markdown-rfc.md:234 (mention) — The explanation-length test (see Test results section) confirms this is modest, not dramatic: the full Cards section in 
- docs/implemented-plans/chat-stream-finalize-unify.md:338 (mention) — `CLAUDE.md` (`src/frontend/src/components/chat/CLAUDE.md`, shipped with the scroll
- docs/implemented-plans/clerk-webpage-capture.md:125 (mention) — - **callback-clerk `CLAUDE.md`** — *"domain code never imports React, WXT, or
- docs/implemented-plans/courseware-phase1.md:98 (mention) — "filename supplies the type — there is no `type:` field"** (`CLAUDE.md:39`), so templates
- docs/implemented-plans/extfile-card.md:39 (mention) — (CLAUDE.md exempts *"per-box config, throwaway replies, and personal
- docs/implemented-plans/ios-per-box-device-lock.md:24 (mention) — - `CLAUDE.md` requires reading existing formats before writing
- docs/implemented-plans/link-validation-fix.md:28 (mention) — - User-global rule (project CLAUDE.md) — *"NEVER disable or weaken a lint rule to
- docs/implemented-plans/local-password-auth.md:210 (mention) — serialize through `src/lib/file-lock.ts` per the CLAUDE.md lock rule.
- docs/implemented-plans/markdoc-tags-plan.md:177 (mention) — text in the compiled CLAUDE.md include (not lost); the warning surfaces
- docs/implemented-plans/markdoc-tags-plan.review-adapted-trial.md:9 (mention) — - **Card validation pipeline** — `cb validate` PostToolUse hook + pre-commit hook (per CLAUDE.md). Markdoc's `Markdoc.va
- docs/implemented-plans/markdoc-tags-plan.review.md:5 (mention) — source. Trace each to a stated preference in CLAUDE.md / code-style.md
- docs/implemented-plans/mobile-parity-sync.md:27 (mention) — - Root `CLAUDE.md` "new infrastructure isn't done until it's discoverable" — the
- docs/implemented-plans/mobile-token-handshake.md:378 (mention) — and the box's CLAUDE.md. A box agent never sees mobile auth code; the question above is a
- docs/implemented-plans/mvp-implementation-guide.md:3 (mention) — > still true in it is documented better in CLAUDE.md and the reference docs
- docs/implemented-plans/named-places.md:85 (mention) — (the CLAUDE.md parse-mutate-reserialize contract, faithful form). **Not**
- docs/implemented-plans/normalize-chat-links.md:80 (mention) — - **Monorepo `CLAUDE.md:` "NEVER disable or weaken a lint rule… Ask first."**
- docs/implemented-plans/open-chat-from-card.md:265 (mention) — pane; CLAUDE.md's "don't add features beyond what the task requires."
- docs/implemented-plans/procedure-validation-completion.md:33 (mention) — - *"Treat noisy command output as a bug"* (monorepo `CLAUDE.md`) — model calls and retries must stay quiet on the happy 
- docs/implemented-plans/questions-end-to-end.md:113 (mention) — the box `CLAUDE.md` via `src/core/docs-gen/claude-md.ts:20`). Reused as-is
- docs/implemented-plans/refresh-clerk.md:17 (mention) — - Monorepo `CLAUDE.md` — **"NEVER disable or weaken a lint rule to make code
- docs/implemented-plans/refresh-maps-convergence.md:77 (link) — - **[`CLAUDE.md`](../../CLAUDE.md)** — don't add features beyond the task;
- docs/implemented-plans/refresh-maps-convergence.review.md:216 (mention) — **Why it matters:** This fails *silently and universally on v2 boxes* — the only shape that exists per `CLAUDE.md` — whi
- docs/implemented-plans/remove-cardworks-and-xml.md:416 (mention) — pnpm-workspace entry. Update `callback-box/CLAUDE.md`, root `CLAUDE.md`,
- docs/implemented-plans/remove-cardworks-deletion.md:127 (mention) — CLAUDE.md "refs starting with `attach/` resolve into this scope").
- docs/implemented-plans/remove-cardworks-package.md:87 (mention) — - **`callback-box/CLAUDE.md`** — `CLAUDE.md:28` (current): *"Every built-in
- docs/implemented-plans/rest-to-trpc-consolidation.md:143 (mention) — already runs cross-origin-capable via `wsLink`/`splitLink` (`CLAUDE.md`).
- docs/implemented-plans/schema-validate-hook.md:242 (mention) — (`CLAUDE.md` Behavioral Notes). Designed-for, not built — see Open questions
- docs/implemented-plans/see-as-the-user.md:427 (mention) — CLAUDE.md).
- docs/implemented-plans/selection-commentary.md:445 (mention) — explained will be misread; CLAUDE.md's "improving these instructions" loop
- docs/implemented-plans/semantic-search.md:45 (mention) — - Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — degraded
- docs/implemented-plans/shared-frontend-backend-code.subplan.md:23 (mention) — `CLAUDE.md`. We share what Track 2 forces us to share. We do not
- docs/implemented-plans/user-location.md:255 (mention) — CLAUDE.md default; the raw-route carve-out doesn't apply. (An earlier
- docs/implemented-plans/view-render-testing.md:258 (mention) — of the orphan-prone dev machinery in CLAUDE.md — no router, no Vite, no Fastify,
- docs/implemented-plans/web-push-notifications.md:192 (mention) — prune both write it; CLAUDE.md *"All cross-process locks go through ...file-lock.ts"*).
- docs/implemented-plans/websocket-chat-transport.md:230 (mention) — and it reuses the framework we're already deep in (CLAUDE.md's "tRPC by
- docs/knowledge-audits.md:19 (mention) — - After touching CLAUDE.md, schemas, prompts, or anything that changes what an agent should know.
- docs/knowledge-taxonomy.md:7 (mention) — 1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CL
- docs/maintenance.md:7 (mention) — The system carries a lot of agent-facing surface: CLAUDE.md and rule files, schemas with embedded `instructions`, prompt
- docs/plans/box-commentary-surface.md:377 (mention) — (CLAUDE.md exempts "per-box config, throwaway replies, and personal memory"),
- docs/plans/design-reconciliation.md:84 (mention) — - **Reality/tension** — CLAUDE.md:1 (the sentence agents actually load): "A
- docs/plans/docs-reorg.gap-analysis.md:36 (mention) — `setTimeout` counts macOS sleep. CLAUDE.md covers the analogous
- docs/plans/docs-reorg.md:5 (mention) — convention docs → CLAUDE.md slimming → cb-guide-* skills → design
- docs/plans/ios-companion-app.md:25 (mention) — - `callback-box/CLAUDE.md` — the tRPC-vs-raw-Fastify boundary (`CLAUDE.md`: *"Raw Fastify routes … are only for … file u
- docs/plans/ios-companion-review-2026-07-09.md:56 (mention) — Every successful verify does a full read-modify-write of the shared JSON with no `withCardLock`/`file-lock` — the CLAUDE
- docs/plans/prompt-surface-ia-review.md:141 (mention) — empty in every box (only auto-generated `MAP.md`/`CLAUDE.md`, zero real items)
- docs/plans/publish-pages.md:154 (mention) — - **Preview:** a raw Fastify route inside the box auth wall (`server-box-scope.ts:59` preHandler applies) serving `box/p
- docs/plans/source-available-release.md:388 (mention) — it now adds features beyond the task (`CLAUDE.md` Behavioral Notes).
- docs/prompt-logging.md:3 (mention) — When agents run in a callback box (via `cb wakeup`, `cb reactor`, procedures, etc.), you can capture the full API traffi
- docs/questions.md:61 (mention) — # the box CLAUDE.md — see below)
- docs/reports/user-stories-audit-2026-06-26.md:1474 (mention) — > As a developer debugging an agent run, I want to capture full API traffic including system prompts, CLAUDE.md context,
- docs/stack-decisions.md:1183 (mention) — `CLAUDE.md` for the user-facing workflow. The old Overmind-based dev
- docs/unimplemented-plans/boxes-as-packages-v1-superseded.md:411 (mention) — The boxes are physically still at `~/src/boxes/<box>/` (outside the callback monorepo, so agents working inside a box do
- docs/unimplemented-plans/design-vision-superseded.md:61 (mention) — - Small additions like a `CLAUDE.md` file with custom prompts are preferred to elaborate new structures
- ../.claude/agents/finish.md:56 (mention) — root `CLAUDE.md`/`code-style.md` — also drops you to the full flow.
- ../.claude/memory/MEMORY.md:4 (mention) — Auto-memory (`~/.claude/projects/` path) is problematic: path-hash-based, machine-specific, not version-controlled, easi
- ../.claude/memory/feedback_files_over_external_trackers.md:24 (mention) — - Specific applicable cases: TODO/work-queue → `TODOS.md` or similar; design notes → `docs/`; architectural decisions → 
- ../.claude/skills/cb-codehealth/SKILL.md:29 (mention) — and a short usage doc at its root (a directory `CLAUDE.md` / README — like
- ../.claude/skills/cb-context/SKILL.md:3 (mention) — description: Use when engineering what a box agent knows — writing or curating a box's CLAUDE.md, a nested CLAUDE.md, a 
- ../.claude/skills/cb-frontend/SKILL.md:11 (mention) — read it before writing UI (`CLAUDE.md` already says so). This skill is the
- ../.claude/skills/cb-plan/SKILL.md:97 (mention) — - `callback-box/CLAUDE.md` — project conventions, validation contract,
- ../.claude/skills/cb-prompt-review/SKILL.md:22 (mention) — **Boxes go stale.** The box-side layers (CLAUDE.md, agent guide, skills, rules) are what `cb init` last wrote — re-run `
- ../.claude/skills/launch-worktree-session/SKILL.md:158 (mention) — CLAUDE.md, so `claude-fable-5` buys orchestration and cross-model review, not
- ../CLAUDE.md:5 (mention) — - **callback-box/** — Main system. See its CLAUDE.md for details. (Card primitives that used to live in the separate `ca
- ../bin/CLAUDE.md:5 (mention) — always-relevant summary lives in the root CLAUDE.md; this file is the mechanism.
- ../issues/bugs/2026-07-15-box-packageify-doubled-subtrees.md:45 (mention) — it holds files (e.g. per-directory `CLAUDE.md`) that have **no identical twin at
- ../issues/closed/code-quality/2026-07-04-fake-agent-single-export-split.md:14 (mention) — not a global weakening, per the CLAUDE.md lint policy). The blast radius was 6
- ../issues/closed/code-quality/2026-07-16-personal-vibe-check-typecheck-no-inputs.md:24 (mention) — failure for a loud one. Note `CLAUDE.md` claims "the repo lints itself", which
- ../issues/closed/docs-and-chores/2026-03-04-documentation-graph.md:7 (mention) — **Closed:** Implemented as `docs/doc-graph.md` (auto-generated cross-reference report, `src/dev/doc-graph-html.ts`). See
- ../issues/code-quality/2026-07-04-logging-consolidation.md:21 (mention) — Related: the noisy-output policy in the root CLAUDE.md (routine-success
- ../issues/code-quality/2026-07-06-engine-dev-knowledge-audits.md:7 (mention) — it spawns an agent with a box cwd and box CLAUDE.md context and checks
- ../issues/decisions/2026-05-27-bin-browse-wrapper-future.md:11 (mention) — - **Replace the rewriting with a `BASE_PATH.txt` file** that holds the current worktree's URL prefix (e.g. `http://local
- ../issues/decisions/2026-07-07-categorize-issues-into-subdirectories.md:79 (mention) — Note: `issues/CLAUDE.md` and the root `CLAUDE.md`'s "issue queue" pointer both
- ../issues/decisions/2026-07-07-cb-render-vs-bin-browse.md:48 (mention) — `suppressHydrationWarning`); and references in `CLAUDE.md`, `frontend.md`,
- ../issues/docs-and-chores/2026-05-21-fill-out-the-glossary.md:19 (mention) — Method: do one sweep through `CLAUDE.md`, `FRONTEND.md`, the schemas, and `docs/` collecting terms-of-art, then write en
- ../issues/docs-and-chores/2026-05-26-dev-scripts-into-bin.md:6 (mention) — `bin/` is the brand for the project's first-class dev tools — `bin/browse`, `bin/worktrees`, `bin/cb`. Anything an agent
- ../issues/docs-and-chores/2026-07-04-claude-md-review-docs-backlog.md:7 (mention) — Still-open items from the 2026-04-28 CLAUDE.md self-audit
- ../issues/docs-and-chores/2026-07-04-doc-refresh-cadence.md:20 (mention) — CLAUDE.mds) and spot-check their concrete claims against code —
- ../issues/docs-and-chores/2026-07-04-instruction-surface-size-budget.md:10 (mention) — Give each instruction surface (agent guide, box CLAUDE.md, guide cards,
- ../issues/docs-and-chores/2026-07-07-box-docs-reference-node-modules.md:29 (mention) — them). The box's CLAUDE.md already `@`-includes the agent guide by path
- ../issues/exploration/2026-03-04-claude-code-memory-concerns.md:10 (mention) — - Custom subagents don't inherit CLAUDE.md or `.claude/rules/` (only built-in subagents do)
- ../issues/exploration/2026-05-19-subagent-strategy.md:27 (mention) — Connected concern: subagents in callback-box don't inherit CLAUDE.md or rules (per [Claude Code Memory Concerns](2026-03
- ../issues/exploration/2026-05-28-before-you-build-this.md:11 (mention) — Convention to make it stick: a short rule in `CLAUDE.md` ("before writing a new component / helper / schema, run `cb reu
- ../issues/exploration/2026-05-28-doc-usage-mining.md:13 (mention) — - **High-read + outer-ring** → mis-classified by the rings. Should be promoted closer to always-loaded, or linked from a
- ../issues/exploration/2026-06-12-knowledge-budget-always-loaded-context.md:7 (mention) — The always-loaded layer (agent-guide.md, CLAUDE.md includes, system prompts) has no size discipline: every addition feel
- ../issues/exploration/2026-06-17-loading-eagerness-axis.md:8 (mention) — *instructions* (akin to CLAUDE.md), where should it land? Today the only home
- ../issues/exploration/2026-07-08-per-surface-agent-vs-boxwide-reactor.md:28 (mention) — simplicity bet (`callback-box/CLAUDE.md`). Note the cost is NOT "N standing agents":
- ../issues/exploration/2026-07-18-directory-scoped-rules-vs-generated-claude-md.md:2 (mention) — title: "Can directory-scoped rules replace generated CLAUDE.md / @-includes?"
- ../issues/features/2026-05-28-retrospective-session-scan.md:7 (mention) — Closely related to the doc-usage miner: instead of mining transcripts for *what was read*, mine them for *what the user 
- ../issues/features/2026-06-20-context-size-measurement-legibility.md:12 (mention) — - **Compositional breakdown.** The most *actionable* and the most work: split the baseline into system prompt vs. agent-
- ../issues/features/2026-07-15-admin-landmark-maintenance-owner.md:14 (mention) — and what else to sweep. The knowledge is scattered across box CLAUDE.md-equivalents,
- ../issues/features/2026-07-20-clerk-import-dispatch-by-url.md:55 (mention) — interface (`src/connectors/`, see its CLAUDE.md), or a separate resolver the
- ../research/backend-alternatives/2026-07-18-sdk-coupling-audit.md:132 (mention) — box's CLAUDE.md walk-up, `.claude/rules/`, skills/slash commands
- ../research/backend-alternatives/2026-07-18-synthesis.md:20 (mention) — CLAUDE.md/rules/skills auto-loading, the `claude_code` system-prompt preset, in-process
- ../research/external-skills-harvest.md:14 (mention) — of that in CLAUDE.md, code-style.md, frontend.md, the Laws, and our skills
- ../research/gstack/README.md:21 (mention) — 3. When something becomes a real change to our project, link out to where it landed (CLAUDE.md, a skill of our own, etc.
- ../research/gstack/notes/design-consultation.md:3 (mention) — Six-phase conversation that ends with a written DESIGN.md and a CLAUDE.md update telling the agent to always read it. Th
- ../research/gstack/notes/design-shotgun.md:52 (mention) — Basic good practice but worth codifying as a rule: **don't ask the user what you could find out from the code/files/rece
- ../research/gstack/notes/investigate.md:139 (mention) — A callback-specific debugging guide (in CLAUDE.md or a `docs/debugging.md`) with:
- ../research/gstack/notes/plan-eng-review.md:25 (mention) — **Worth borrowing.** A callback equivalent would write out your engineering preferences and have any code-review skill (
- ../research/gstack/notes/ship-pipeline.md:127 (mention) — If no `~/.gstack/projects/$SLUG/land-deploy-confirmed` marker → dry-run walkthrough first. Also hashes the `## Deploy Co
- ../research/gstack/overlap-with-ideas.md:23 (mention) — ↔ ideas.md §**"Retrospective session scan — surfacing CLAUDE.md and
- ../research/gstack/skills.md:73 (mention) — | [investigate](https://github.com/garrytan/gstack/blob/main/investigate/SKILL.md) | `integrate (parts)` | Read — see [n
- ../research/openclaw-hermes/README.md:28 (mention) — 4. **Layered, budgeted instruction files.** OpenClaw: 8 bootstrap files with per-file (20k) and total (60k) char budgets
- ../research/openclaw-hermes/compare-agent-core.md:126 (mention) — execution, permission modes, transcript persistence, CLAUDE.md auto-loading) to add this,
- ../research/openclaw-hermes/compare-channels.md:178 (mention) — `CLAUDE.md`/agent-guide, own connector configs, own chat-session state) — CBX
- ../research/openclaw-hermes/compare-context-memory.md:14 (mention) — | Mechanism | Claude Code CLI auto-loads `CLAUDE.md` (walked up from cwd) + `.claude/rules/*.md` (path-conditional) + `.
- ../research/openclaw-hermes/compare-letta.md:9 (mention) — `letta-code` is Claude Code re-imagined against that server: thin SSE client, projects don't own agents (pinned agents +
- ../research/openclaw-hermes/compare-skills-tools.md:33 (mention) — tool call, not a governed slash-command/index mechanism. Directory `CLAUDE.md` is the other
- ../research/openclaw-hermes/compare-ux-prompt.md:17 (mention) — | **Builder** | No single builder. Layers: Claude Code preset prompt + auto-loaded box `CLAUDE.md` (`@`-includes `agent-
- ../research/openclaw-hermes/deep-cbx-retro.md:398 (mention) — (per `CLAUDE.md`, only `src/lib/file-lock.ts`-based locks are sanctioned,
- ../research/openclaw-hermes/deep-letta-code.md:16 (mention) — - **`LocalBackend`** (`src/backend/local/local-backend.ts:287`) — experimental, gated by `LETTA_LOCAL_BACKEND_EXPERIMENT
- ../research/openclaw-hermes/scout-agent-zero.md:66 (mention) — - **Different, worth noting but not necessarily adopting:** (a) the entire framework directory is agent-writable with no
- ../research/openclaw-hermes/scout-goose.md:279 (mention) — `load_hints.rs:27-97`), similar to nested `CLAUDE.md`. This is pure static
- ../research/openclaw-hermes/scout-nanobot.md:37 (mention) — - **Memory architecture is the single most CBX-relevant finding**: nanobot converged on the same shape CBX already uses 
- ../research/pai/README.md:17 (mention) — | [prompts.md](./prompts.md) | The actual prompt text — system prompt, CLAUDE.md, Algorithm doctrine — quoted and annota
- ../research/pai/information-layout.md:17 (mention) — CLAUDE.md:
- ../research/pai/prompts.md:20 (mention) — > layer. CLAUDE.md defines operational procedures and format templates.
- ../research/pai/telos.md:36 (mention) — > | `PRINCIPAL_TELOS.md` | **Auto-generated summary** of all the above. Loaded into every session via CLAUDE.md. |

References:
- → CLAUDE.md (mention)
- → deploy/README.md (mention)
- → docs/chat-schedules.md (mention)
- → docs/card-validation.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/implemented-plans/cards-as-markdown-rfc.md (mention)
- → src/hub/CLAUDE.md (mention)
- → frontend.md (mention)
- → docs/box-layout.md (mention)
- → src/core/reactor/DESIGN.md (mention)
- → docs/scheduler.md (mention)
- → src/services/CLAUDE.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/client-debug-log.md (mention)
- → docs/example-names.md (mention)
- → code-style.md (mention)
- → docs/developer-install.md (mention)
- → docs/docker-install.md (mention)
- → docs/agent-install.md (mention)
- → docs/engineering-principles.md (mention)
- → docs/module-map.md (mention)
- → docs/design/README.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/testing.md (mention)
- → docs/tours.md (mention)
- → docs/migrations.md (mention)
- → docs/mobile-contract.md (mention)
- → docs/mobile-parity.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/connectors.md (mention)
- → docs/procedure-implementation.md (mention)
- → docs/health-checks.md (mention)
- → docs/prompt-logging.md (mention)
- → docs/triage.md (mention)
- → docs/questions.md (mention)
- → docs/server-operations.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/landmarks.md (mention)
- → docs/chat-session-lifecycle.md (mention)
- → docs/content-security-policy.md (mention)
- → docs/maintenance.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/ssr-render-testing.md (mention)
- → docs/calendar.md (mention)
- → docs/plans/pdf-intake-design.md (mention)
- → docs/plans/source-editor.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/glossary.md (mention)
- → code-style.md (at-include)

#### code-style.md

Title: "Code Style" | 114 lines

Referenced by:
- CLAUDE.md:120 (mention) — When you get corrected on a convention, pattern, or workflow that wasn't documented, update CLAUDE.md, code-style.md, fr
- CLAUDE.md:174 (at-include) — @code-style.md
- docs/engineering-principles.md:4 (link) — They sit above the mechanical rules: [`code-style.md`](../code-style.md) says
- docs/implemented-plans/agent-applied-migrations.md:84 (mention) — - `callback-box/code-style.md` — max 2 positional params (named options), no
- docs/implemented-plans/app-wide-csp.md:28 (mention) — - `callback-box/code-style.md:` no `any`, max 2 positional params, custom error
- docs/implemented-plans/architectural-review.md:67 (mention) — They come from three sources: `callback-box/code-style.md`, the monorepo
- docs/implemented-plans/box-retrospectives.md:39 (mention) — - `callback-box/code-style.md` — custom error classes; no silent error
- docs/implemented-plans/box-search.md:38 (mention) — - `callback-box/code-style.md`: max 2 positional params, no default
- docs/implemented-plans/boxes-as-packages-v2.md:48 (mention) — - `callback-box/code-style.md`: strict types, no `any`, custom error classes — the new
- docs/implemented-plans/canvas-loop-figure.md:28 (mention) — - `code-style.md`: max 2 positional params (the figure contract's
- docs/implemented-plans/capture-mode.md:39 (mention) — - `callback-box/code-style.md` — no `any`, named-params objects, custom
- docs/implemented-plans/card-view-widgets.md:22 (mention) — - `callback-box/code-style.md` — no default parameters, max 2 positional
- docs/implemented-plans/chat-scroll-redesign.md:46 (mention) — - `callback-box/code-style.md:36-37` — no default parameters; max 2 positional
- docs/implemented-plans/chat-stream-finalize-unify.md:48 (mention) — - `callback-box/code-style.md:37` — max 2 positional params; new/changed
- docs/implemented-plans/clerk-webpage-capture.md:122 (mention) — - **`callback-box/code-style.md`** — no `any`; no default parameters; max 2
- docs/implemented-plans/companion-pane-card-activity.md:36 (mention) — - `callback-box/code-style.md` — files ≤300 lines, no default parameters, max 2
- docs/implemented-plans/courseware-lesson-plan.md:23 (mention) — - `callback-box/code-style.md` — no `any`, no default params, max 2 positional params, files ≤300
- docs/implemented-plans/courseware-phase1.md:100 (mention) — - `callback-box/code-style.md` → **"No default parameters"**, **"Max 2 positional
- docs/implemented-plans/extfile-card.md:42 (mention) — - `callback-box/code-style.md` — no default parameters, max 2 positional params
- docs/implemented-plans/figure-card-type.md:75 (mention) — - **`callback-box/code-style.md`** — *"No default parameters"*, *"Max 2 positional
- docs/implemented-plans/ios-per-box-device-lock.md:29 (mention) — - `code-style.md` requires visible failure handling (`code-style.md:24-33`) and
- docs/implemented-plans/job-xml-purge.subplan.md:35 (mention) — - `callback-box/code-style.md` — no `any`, max-2 positional params, named-error
- docs/implemented-plans/link-validation-fix.md:31 (mention) — - `callback-box/code-style.md` — no `any`, double quotes, semicolons, max 2
- docs/implemented-plans/local-password-auth.md:38 (mention) — - `code-style.md` — custom error classes, no default params, named-params
- docs/implemented-plans/markdoc-tags-plan.review-adapted-trial.md:16 (mention) — Drawn from `CLAUDE.md` and `code-style.md`; referenced by name in findings below.
- docs/implemented-plans/markdoc-tags-plan.review.md:5 (mention) — source. Trace each to a stated preference in CLAUDE.md / code-style.md
- docs/implemented-plans/named-places.md:53 (mention) — - `callback-box/code-style.md` — no default parameters, max 2 positional params,
- docs/implemented-plans/normalize-chat-links.md:76 (mention) — - **`callback-box/code-style.md:` no default parameters; max 2 positional
- docs/implemented-plans/open-chat-from-card.md:53 (mention) — - `callback-box/code-style.md` — no default parameters, max 2 positional params (the new
- docs/implemented-plans/procedure-validation-completion.md:35 (mention) — - **`callback-box/code-style.md`** — no `any`; no default parameters; max 2 positional params (named-params objects); cu
- docs/implemented-plans/questions-end-to-end.md:72 (mention) — - `callback-box/code-style.md` — Result-vs-throw convention, `withCardLock`
- docs/implemented-plans/refresh-clerk.md:23 (mention) — - `callback-box/code-style.md` — no optional chaining, no default params, max
- docs/implemented-plans/refresh-maps-convergence.md:75 (link) — - **[`code-style.md`](../../code-style.md)** — logging levels, max 2 positional
- docs/implemented-plans/refresh-maps-convergence.review.md:124 (mention) — What the section does *not* trade against, and should: `code-style.md`'s
- docs/implemented-plans/remove-box-shape-v1.md:102 (mention) — - `callback-box/code-style.md` — no default params, exhaustiveness, strict casts.
- docs/implemented-plans/remove-cardworks-and-xml.md:51 (mention) — - **`callback-box/code-style.md`** — `code-style.md:25`: *"NEVER use
- docs/implemented-plans/remove-cardworks-deletion.md:100 (mention) — - **`callback-box/code-style.md:25`** (no `any`), **`:55`** (`as` is like Rust
- docs/implemented-plans/remove-cardworks-package.md:93 (mention) — - **`callback-box/code-style.md`** — `code-style.md:25` (no `any`),
- docs/implemented-plans/responsive-figures.md:43 (mention) — - `code-style.md` — no default parameters, explicit return types, teardown/
- docs/implemented-plans/rest-to-trpc-consolidation.md:43 (mention) — - **`callback-box/code-style.md`** — Zod-validated inputs, `only export what's
- docs/implemented-plans/schema-validate-hook.md:32 (mention) — - `callback-box/code-style.md` — *"as type assertions are like Rust's
- docs/implemented-plans/see-as-the-user.md:35 (mention) — - `callback-box/code-style.md` — mechanical rules (no default parameters,
- docs/implemented-plans/selection-commentary.md:88 (mention) — - `callback-box/code-style.md:36` — *"**No default parameters**: handle
- docs/implemented-plans/slopo-codehealth-adoption.md:42 (mention) — - **`callback-box/code-style.md`** — style preferences; the centralise-a-cast
- docs/implemented-plans/tailscale-expose-and-protect.md:57 (mention) — - `callback-box/code-style.md` — no default parameters, injected-deps
- docs/implemented-plans/user-location.md:60 (mention) — - `callback-box/code-style.md` — no default parameters, max 2 positional
- docs/implemented-plans/view-render-testing.md:28 (mention) — - `callback-box/code-style.md` — no `any`; custom error classes not
- docs/implemented-plans/webpage-card-and-commentary.md:48 (mention) — - `callback-box/code-style.md` — no optional chaining, no default params,
- docs/implemented-plans/websocket-chat-transport.md:72 (mention) — - `callback-box/code-style.md:` no `any`, no default params, max 2 positional
- docs/plans/android-companion-app.md:36 (mention) — - `code-style.md`: the box side of Track 0 (TypeScript) follows the usual
- docs/plans/box-commentary-surface.md:94 (mention) — - `callback-box/code-style.md` — no default parameters, max 2 positional
- docs/plans/ios-companion-app.md:26 (mention) — - `callback-box/code-style.md` — standard mechanical rules for the box-side TS.
- docs/plans/ios-input-plane-parity.md:58 (mention) — - `code-style.md`: TypeScript uses validated `unknown` boundaries, exhaustive
- docs/plans/ios-native-capture-mode.md:24 (mention) — - `code-style.md`: standard TypeScript validation, Result/error, exhaustiveness,
- docs/plans/prompt-surface-ia-review.md:375 (mention) — - **`callback-box/code-style.md`** — no default params, ≤2 positional params, no
- docs/plans/publish-pages.md:29 (mention) — - `callback-box/code-style.md` — mechanical rules for all box-side TS and the Worker package.
- docs/plans/source-available-release.md:44 (mention) — - `callback-box/code-style.md` — style rules for any code touched by deploy
- docs/unimplemented-plans/query-cards.md:34 (mention) — - `callback-box/code-style.md` — strict types, no `any`, custom errors,
- frontend.md:3 (mention) — UI palette, primitives, and the `className` rule. Backend code never needs to load this; code-style.md covers convention
- ../.claude/agents/finish.md:56 (mention) — root `CLAUDE.md`/`code-style.md` — also drops you to the full flow.
- ../.claude/skills/cb-frontend/SKILL.md:37 (mention) — - **One job per component.** A component near the 300-line cap (code-style.md)
- ../.claude/skills/cb-plan/SKILL.md:100 (mention) — - `callback-box/code-style.md` — the checkable mechanical rules (no
- ../CLAUDE.md:39 (mention) — **NEVER disable or weaken a lint rule to make code pass. Ask first.** Every rule in `@ianbicking/personal-vibe-check` is
- ../issues/closed/code-quality/2026-07-10-tour-lib-lint-debt.md:17 (mention) — helpers. See `code-style.md`'s "Type Checking and Linting" section for the
- ../issues/closed/code-quality/2026-07-12-frontend-local-helper-consolidation-into-shared.md:37 (mention) — code-style.md) has a frontend twin. `isRecord` is pure and dependency-free, so
- ../issues/closed/decisions/2026-07-06-architectural-review-open-decisions.md:102 (mention) — code-style.md's Exhaustiveness section, not literal `switch` statements:
- ../issues/closed/decisions/2026-07-15-single-export-should-ignore-types.md:15 (mention) — convention (`code-style.md`) plus review covers the residual concern. The custom
- ../issues/code-quality/2026-07-06-engine-dev-knowledge-audits.md:16 (mention) — and the rest of `docs/engineering-principles.md` / `code-style.md`.
- ../issues/docs-and-chores/2026-07-04-claude-md-review-docs-backlog.md:9 (mention) — folded into `code-style.md`, `frontend.md`, `docs/maintenance.md`, and
- ../issues/exploration/2026-07-18-directory-scoped-rules-vs-generated-claude-md.md:30 (at-include) — - Engine side: `callback-box/CLAUDE.md:174` uses `@code-style.md` (an @-include of a
- ../research/external-skills-harvest.md:14 (mention) — of that in CLAUDE.md, code-style.md, frontend.md, the Laws, and our skills

References:
- → docs/engineering-principles.md (link)
- → frontend.md (mention)
- → CLAUDE.md (mention)

#### frontend.md

Title: "Frontend Conventions" | 114 lines

Referenced by:
- CLAUDE.md:66 (mention) — src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see frontend.md
- code-style.md:3 (mention) — General coding conventions for backend and frontend. UI palette and primitive reference live in frontend.md. The *why* b
- docs/implemented-plans/architectural-review.md:597 (mention) — gray→warm, `DebugLog.tsx:145`) and amend frontend.md's capture-surface
- docs/implemented-plans/card-view-widgets.md:24 (mention) — - `callback-box/frontend.md:34` — *"Reach for a primitive from
- docs/implemented-plans/chat-scroll-redesign.md:37 (mention) — palette. Read frontend.md before writing UI … the `className`-only-for-outer-layout
- docs/implemented-plans/chat-stream-finalize-unify.md:44 (mention) — palette. Read frontend.md before writing UI"* and the
- docs/implemented-plans/figure-card-type.md:79 (mention) — - **`callback-box/frontend.md`** — UI primitives + `className`-only-for-outer-
- docs/implemented-plans/local-password-auth.md:529 (mention) — precedent but non-dismissible. Per cb-frontend conventions (frontend.md
- docs/implemented-plans/open-chat-from-card.md:57 (mention) — - `callback-box/frontend.md` — UI primitives + semantic palette, `className` only for
- docs/implemented-plans/responsive-figures.md:42 (mention) — writing"; frontend rules via frontend.md (`className` conventions).
- docs/implemented-plans/selection-commentary.md:103 (mention) — semantic palette.** Read frontend.md before writing UI."* The pill and
- docs/implemented-plans/user-location.md:63 (mention) — - `callback-box/frontend.md` — UI primitives + the `className`-only-for-
- docs/plans/design-reconciliation.md:39 (mention) — capture, dashboard, views, and a real design system (frontend.md).
- docs/plans/narration-mode.md:193 (mention) — Color and primitive choices follow the box's semantic palette (see `frontend.md`); the accent role is appropriate.
- frontend.md:113 (mention) — New primitives live in `components/ui/<Name>.tsx`, accept `className`, merge via `cn()`, and document their semantic rol
- ../.claude/skills/cb-frontend/SKILL.md:10 (mention) — semantic palette, the `className` rule — lives in **`callback-box/frontend.md`**;
- ../issues/bugs/2026-07-19-landmark-menu-overflows-mobile.md:65 (mention) — read `frontend.md` before reaching for utility classes.
- ../issues/decisions/2026-07-07-cb-render-vs-bin-browse.md:48 (mention) — `suppressHydrationWarning`); and references in `CLAUDE.md`, `frontend.md`,
- ../issues/docs-and-chores/2026-07-04-claude-md-review-docs-backlog.md:9 (mention) — folded into `code-style.md`, `frontend.md`, `docs/maintenance.md`, and
- ../research/external-skills-harvest.md:14 (mention) — of that in CLAUDE.md, code-style.md, frontend.md, the Laws, and our skills

References:
- → code-style.md (mention)
- → docs/data-source-tagging.md (mention)
- → frontend.md (mention)

#### README.md

Title: "callback-box" | 84 lines

Referenced by:
- docs/adding-a-box.md:27 (link) — see the root [`README.md`](../README.md) for that path. This doc is about
- docs/implemented-plans/boxes-as-packages-v2.md:498 (mention) — (a real converted v2 box); `README.md`, `docs/adding-a-box.md`, and `deploy/README.md` are
- docs/implemented-plans/cards-as-markdown-rfc.md:75 (mention) — - `README.md` — plain markdown, not a card
- docs/implemented-plans/courseware-lesson-plan.md:13 (mention) — the material convention (proper presentational cards, not a stray `README.md`).
- ../research/CLAUDE.md:11 (mention) — `pai/`, …) with a `README.md` index: a table of the corpus's documents plus
- ../research/backend-alternatives/2026-07-18-sdk-coupling-audit.md:4 (link) — architecture framing in the first-pass [README](README.md)). This is a code-reading
- ../research/backend-alternatives/2026-07-18-synthesis.md:3 (link) — *2026-07-18. Supersedes the first-pass [README](README.md) analysis (kept as a record
- ../research/gstack/skills.md:3 (link) — See [README.md](README.md) for the status legend.
- ../research/openclaw-hermes/deep-letta-code.md:5 (mention) — **What it is:** a Claude-Code-shaped CLI where the agent is not a process you start but a **persistent server-side entit
- ../research/openclaw-hermes/scout-agent-zero.md:7 (mention) — Agent Zero bills itself as "a full Linux system for your AI agent" (`README.md:6-8`): one Docker container ships a full 
- ../research/openclaw-hermes/scout-khoj.md:7 (mention) — Khoj bills itself as "Your AI second brain" (`README.md:15`) — a personal-knowledge chat assistant that layers retrieval
- ../research/openclaw-hermes/scout-nanobot.md:7 (mention) — - Self-description: "an open-source, ultra-lightweight personal AI agent you can truly own" — WebUI, chat channels, tool
- ../research/pai/telos.md:4 (mention) — - `$PAI/PAI/USER/TELOS/` — nine source files + `README.md` + generated summary + `CURRENT_STATE/`/`IDEAL_STATE/` dirs

References:
- → docs/implemented-plans/boxes-as-packages-v2.md (link)
- → CLAUDE.md (mention)
- → docs/box-layout.md (link)
- → docs/cards-as-markdown.md (link)
- → docs/adding-schemas.md (link)
- → docs/adding-a-box.md (link)
- → docs/migrations.md (link)

### deploy/

#### deploy/CLAUDE.md

Title: "Deploy" | 44 lines

Referenced by:
- deploy/README.md:57 (mention) — (see `deploy/CLAUDE.md` for the wait/poll pattern).

References:
- → deploy/README.md (mention)

#### deploy/README.md

Title: "Deploy" | 326 lines

Referenced by:
- CLAUDE.md:19 (mention) — **Deploy** — auto-deploys on `main` commits only (root CLAUDE.md). Prod runs a resident `cb hub` routing `/<slug>/...` t
- deploy/CLAUDE.md:3 (mention) — Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.
- docs/adding-a-box.md:108 (link) — [`deploy/README.md`](../deploy/README.md) for the full provisioning story,
- docs/health-checks.md:11 (link) — **`GET /healthz/canary` — active child check.** Cold-starts one box (via the supervisor's `ensureRunning`), then fetches
- docs/implemented-plans/boxes-as-packages-v2.md:76 (mention) — | In-process Google OAuth gate + per-box `allowedEmails` ACL | preHandler + ACL in `src/webapp/server-box-scope.ts:59-80
- docs/implemented-plans/hub-healthz-box-aggregation.md:313 (mention) — | Hub `/healthz` now 401s a pre-existing unauthenticated monitor | N/A | Behavior change, documented in `deploy/README.m
- docs/implemented-plans/local-password-auth.md:539 (mention) — `deploy/README.md:196-217` env template gains `CB_AUTH_FILE` (default is
- docs/implemented-plans/tailscale-expose-and-protect.md:110 (mention) — `cb hub` on the live server (hand-migrated; `deploy/README.md:85` records
- docs/implemented-plans/web-push-notifications.md:183 (mention) — in the dev shell env. Document in `deploy/README.md`.
- docs/plans/docs-reorg.md:131 (mention) — internals (already covered by `deploy/README.md`). Its dev-server section
- docs/plans/installation-story.md:283 (mention) — enumeration is `deploy/README.md` prose, which wrongly lists
- docs/server-operations.md:3 (link) — Reference for the running callback-box server (production at `box.example.com`). For initial provisioning scripts see [`
- ../issues/bugs/2026-07-18-canvas-loop-figure-post-merge-followup.md:85 (mention) — succeeded via `deploy/README.md`'s health runbook).
- ../issues/closed/code-quality/2026-04-11-switch-deploy-rsync-to-git-push.md:17 (mention) — once deploy-info is guaranteed correct. Mechanism docs: `deploy/README.md`;
- ../issues/code-quality/2026-07-04-web-push-followup-testing.md:51 (mention) — Documented in `callback-box/deploy/README.md` → "Web Push (VAPID) keys". Until
- ../research/openclaw-hermes/deep-installation.md:96 (mention) — and `callback-box/deploy/README.md`.

References:
- → docs/health-checks.md (link)
- → deploy/CLAUDE.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/adding-a-box.md (link)

### docker/

#### docker/README.md **[ORPHAN]**

Title: "Docker packaging" | 28 lines

References:
- → docs/docker-install.md (link)
- → docs/developer-install.md (mention)

### docs/

#### docs/activities-design.md

Title: "Activities — Design Proposal" | 311 lines

Referenced by:
- docs/activities-retrospective.md:7 (link) — An "Activity" was a reusable container for non-default chat shapes (language learning, notebook, guided journaling, etc.
- docs/plans/README.md:95 (mention) — reference-vs-proposal before moving: `activities-design.md`,
- docs/plans/docs-reorg.md:230 (mention) — `activities-design.md` + `activities-retrospective.md` pair (the model for
- docs/plans/narration-mode.md:333 (mention) — - **Activities** (`docs/activities-design.md`): being phased out in favor of composable feature flags. Narration is the 

References:
- → docs/activities-retrospective.md (link)
- → CLAUDE.md (mention)

#### docs/activities-retrospective.md

Title: "Activities — Retrospective" | 44 lines

Referenced by:
- docs/activities-design.md:3 (link) — > **Status: removed.** The Activities system was built and then removed in May 2026 in favor of piecemeal opt-in feature
- docs/design/extensibility.md:19 (link) — ([`../activities-retrospective.md`](../activities-retrospective.md)).
- docs/plans/design-reconciliation.md:24 (mention) — `docs/activities-retrospective.md`).
- docs/plans/docs-reorg.md:230 (mention) — `activities-design.md` + `activities-retrospective.md` pair (the model for
- docs/plans/narration-mode.md:5 (link) — > Note: this doc references the Activities system as a coordinate ("the infrastructure that makes activities being phase
- ../research/openclaw-hermes/deep-cbx-retro.md:11 (mention) — line-by-line below). Note: `callback-box/docs/activities-retrospective.md` is an

References:
- → docs/activities-design.md (link)
- → CLAUDE.md (mention)
- → docs/plans/narration-mode.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/implemented-plans/mvp-implementation-guide.md (mention)

#### docs/adding-a-box.md

Title: "Adding a Box" | 131 lines

Referenced by:
- CLAUDE.md:156 (mention) — | Adding a box | `docs/adding-a-box.md` |
- README.md:81 (link) — - [`docs/adding-a-box.md`](docs/adding-a-box.md) — provisioning a box behind a multi-box hub
- deploy/README.md:114 (link) — (see [`docs/adding-a-box.md`](../docs/adding-a-box.md)); this script doesn't
- docs/implemented-plans/boxes-as-packages-v2.md:498 (mention) — (a real converted v2 box); `README.md`, `docs/adding-a-box.md`, and `deploy/README.md` are
- docs/implemented-plans/remove-box-shape-v1.md:250 (mention) — `docs/migrations.md` (remove box-packageify section), `docs/adding-a-box.md:91`,
- docs/plans/cli-restructure.md:130 (mention) — (see `docs/adding-a-box.md`), `cb upgrade` is the per-box engine-upgrade
- docs/plans/docs-reorg.gap-analysis.md:135 (mention) — `docs/adding-a-box.md`.
- docs/plans/source-available-release.md:62 (mention) — - **The generic-vs-personal boundary is already annotated** — `docs/adding-a-box.md:6-8`
- docs/server-operations.md:224 (link) — - [`adding-a-box.md`](./adding-a-box.md) — per-box setup (secrets, connectors, box directory layout).
- ../issues/decisions/2026-03-15-per-box-secret-management.md:15 (mention) — For now: manually copy secret files to new boxes. See `docs/adding-a-box.md`'s "Connector secrets" section.
- ../issues/decisions/2026-07-04-box-registry-manifests.md:31 (mention) — Refs: `callback-box/docs/scheduler.md`, `callback-box/docs/adding-a-box.md`,

References:
- → docs/implemented-plans/boxes-as-packages-v2.md (link)
- → docs/box-layout.md (link)
- → src/hub/CLAUDE.md (mention)
- → README.md (link)
- → docs/README.md (mention)
- → deploy/README.md (link)

#### docs/adding-api-endpoints.md

Title: "Adding API Endpoints" | 237 lines

Referenced by:
- CLAUDE.md:145 (mention) — | Adding API endpoints | `docs/adding-api-endpoints.md` |
- docs/plans/docs-reorg.gap-analysis.md:160 (mention) — `docs/adding-api-endpoints.md`, `docs/asset-manifests.md`,
- docs/plans/docs-reorg.md:150 (mention) — - **Skill-promotion candidates**: `adding-api-endpoints.md` (tRPC-vs-REST
- docs/plans/ios-native-capture-mode.md:27 (mention) — - `docs/adding-api-endpoints.md`: capture uploads remain raw Fastify because
- ../.claude/skills/cb-guide-api/SKILL.md:3 (mention) — description: Explains how HTTP endpoints are added in callback-box and the tRPC-vs-raw-Fastify decision. Use when adding

#### docs/adding-schemas.md

Title: "Adding a New Card Schema" | 279 lines

Referenced by:
- CLAUDE.md:134 (mention) — | Card examples | `docs/cards-as-markdown.md` (format), `docs/adding-schemas.md` (worked example), `src/schemas/template
- README.md:80 (link) — - [`docs/adding-schemas.md`](docs/adding-schemas.md) — adding a new card type
- docs/cards-as-markdown.md:5 (mention) — This is the living reference for the card *file format* — filenames, frontmatter/body split, attachments, and refs. For 
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a schema from `callback-box/cards`. The atomic unit of data in a box. Named `Title.
- docs/implemented-plans/box-schema-reload.md:247 (mention) — - Mirror in `docs/adding-schemas.md` if it implies `cb init` re-registers.
- docs/implemented-plans/box-search.md:45 (mention) — - `docs/adding-schemas.md`: the checklist any schema-surface change follows
- docs/implemented-plans/mvp-implementation-guide.md:412 (link) — See [adding-schemas.md](../adding-schemas.md) for concrete card examples.
- docs/implemented-plans/remove-cardworks-and-xml.md:417 (mention) — `docs/cards-as-markdown.md`, `docs/adding-schemas.md`.
- docs/implemented-plans/remove-cardworks-deletion.md:455 (mention) — `CLAUDE.md:87`/`docs/adding-schemas.md` (the cardworks bullet → `src/cards/`),
- docs/implemented-plans/remove-cardworks-package.md:323 (mention) — `CLAUDE.md:39`/`docs/adding-schemas.md` (drop "from cardworks" phrasing where
- docs/implemented-plans/schema-validate-hook.md:4 (mention) — > convention lives in `docs/adding-schemas.md`, the box-local schema guide
- docs/migrations.md:287 (mention) — - `docs/adding-schemas.md` — when a *schema* change (not a data shape change) is the right move instead of a migrator
- docs/plans/docs-reorg.gap-analysis.md:44 (mention) — prime retrieval field. `docs/adding-schemas.md` never mentions it and
- docs/plans/docs-reorg.md:90 (mention) — (`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,
- docs/reports/user-stories-audit-2026-06-26.md:764 (mention) — Files: `src/cards/schema.ts`, `src/schemas/audio.tsx`, `src/schemas/memo.ts`, `docs/adding-schemas.md`
- ../.claude/skills/cb-guide-schemas/SKILL.md:3 (mention) — description: Explains adding or changing card types (schemas) in callback-box — what a schema is, the automatic fields, 
- ../.claude/skills/cb-migration/SKILL.md:22 (mention) — **no migration.** Old cards load unchanged. See `docs/adding-schemas.md`.

References:
- → CLAUDE.md (mention)

#### docs/agent-install.md

Title: "Installing callback-box with an AI agent" | 102 lines

Referenced by:
- CLAUDE.md:130 (mention) — | Agent-driven install (for a user's AI assistant) | `docs/agent-install.md` |
- docs/implemented-plans/local-password-auth.md:538 (mention) — `docs/agent-install.md` gain the first-run account step;
- docs/implemented-plans/tailscale-expose-and-protect.md:551 (mention) — surface is `docs/agent-install.md`'s existing "widening exposure is a real
- ../issues/features/2026-07-19-installation-remaining-work.md:22 (mention) — (`docs/agent-install.md`). Node pin + `engine-strict` landed at 22, then

References:
- → docs/docker-install.md (link)
- → docs/developer-install.md (link)

#### docs/asset-manifests.md

Title: "Asset Manifests" | 274 lines

Referenced by:
- docs/glossary.md:30 (mention) — **asset manifest** — `manifest.json` inside each `.attach/` directory recording every asset's size, mtime, and sha256. C
- docs/implemented-plans/attach-directories-superseded.md:3 (mention) — **Shipped differently than this draft describes.** The `.attach/` convention landed, but as part of the asset-manifest s
- docs/implemented-plans/design-md-retired-sections.md:13 (mention) — survived as the attach-scope design (`../asset-manifests.md`).*
- docs/plans/README.md:105 (mention) — to `implemented-plans/` (superseded by `docs/asset-manifests.md`, now
- docs/plans/docs-reorg.gap-analysis.md:160 (mention) — `docs/adding-api-endpoints.md`, `docs/asset-manifests.md`,
- docs/plans/pdf-intake-design.md:80 (link) — All the binaries are assets — tracked via the asset manifest, not committed to git. The card itself, the manifest, and t
- docs/reports/user-stories-audit-2026-06-26.md:713 (mention) — 1. **Pre-commit hook integration missing**: The design doc (docs/asset-manifests.md) says "A pre-commit hook keeps the m
- ../issues/closed/bugs/2026-07-20-worktree-box-clone-missing-attachments.md:26 (mention) — `callback-box/docs/asset-manifests.md` and the `cb-assets` block in the box
- ../issues/closed/features/2026-06-26-asset-manifest-completion-d10.md:7 (mention) — **Closed:** Done (descoped): the pre-commit verify hook had already landed. Content dedup and an attach-a-file UI were d
- ../issues/code-quality/2026-05-27-review-asset-manifest-scope.md:6 (mention) — The asset-manifest hook (`docs/asset-manifests.md`) scopes its discipline to `**/*.attach/**` only. Binaries outside att

References:
- → ../issues/code-quality/2026-05-27-review-asset-manifest-scope.md (link)

#### docs/box-layout.md

Title: "Box Layout" | 206 lines

Referenced by:
- CLAUDE.md:92 (mention) — **Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md); `~/src/boxes/test1/` is the
- README.md:70 (link) — writes, and moves as it works. See [`docs/box-layout.md`](docs/box-layout.md)
- docs/adding-a-box.md:12 (link) — a `content/` directory inside it — see [`docs/box-layout.md`](box-layout.md)
- docs/cards-as-markdown.md:5 (mention) — This is the living reference for the card *file format* — filenames, frontmatter/body split, attachments, and refs. For 
- docs/glossary.md:18 (mention) — **box** — A single user's working directory under `~/src/boxes/` (or `/home/callback/boxes/` on the server). Contains th
- docs/implemented-plans/attach-directories-superseded.md:163 (mention) — - `docs/box-layout.md`
- docs/implemented-plans/box-retrospectives.md:413 (mention) — (`enabled="false"`), `docs/box-layout.md` + `docs/maintenance.md` +
- docs/implemented-plans/boxes-as-packages-v2.md:45 (mention) — - `docs/box-layout.md:139-143`: boxes contain no app code, no global secrets, no cross-box
- docs/implemented-plans/named-places.md:175 (mention) — but no `places`), keeping `docs/box-layout.md` and the box-shape agent guide
- docs/implemented-plans/remove-box-shape-v1.md:79 (mention) — - **1e — Docs** (was Track 3): `box-layout.md`, `migrations.md`, `box-layout-spec`
- docs/implemented-plans/user-location.md:74 (mention) — at `docs/box-layout.md:18-22`. State files there are never committed.
- docs/implemented-plans/web-push-notifications.md:58 (mention) — `web-push` card + connector (Track C). `docs/box-layout.md:57` already lists
- docs/implemented-plans/web-push-notifications.review-codex.md:35 (mention) — for delivery (push notifications, replies)" (`docs/box-layout.md:57`), Telegram cards
- docs/plans/design-reconciliation.md:590 (mention) — `/store/archive/done|failed/`) — reconcile against `docs/box-layout.md`
- docs/plans/docs-reorg.gap-analysis.md:41 (mention) — `docs/box-layout.md`.
- docs/plans/docs-reorg.md:90 (mention) — (`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,
- docs/plans/installation-story.md:130 (mention) — (`docs/box-layout.md:194`), Telegram validate-then-persist
- docs/plans/prompt-surface-ia-review.md:146 (mention) — (`box-layout.md`) and the `box.doctest.md` created-tree assertion updated to
- docs/plans/source-available-release.md:60 (mention) — and documented at `callback-box/docs/box-layout.md:194`. No credential values
- docs/reports/user-stories-audit-2026-06-26.md:4927 (mention) — The user story is accurately implemented across both claimed files. `callback-box/src/cli/commands/init.ts` provides the
- ../research/pai/information-layout.md:10 (mention) — knows-about / discoverable layering) and `docs/box-layout.md`. The two systems

References:
- → CLAUDE.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/implemented-plans/capture-mode.md (mention)
- → docs/triage.md (mention)
- → docs/plans/publish-pages.md (mention)
- → docs/client-debug-log.md (mention)

#### docs/calendar.md

Title: "Calendar Integration" | 89 lines

Referenced by:
- CLAUDE.md:165 (mention) — | Calendar integration | `docs/calendar.md` |
- docs/connectors.md:28 (link) — | Google Calendar | `google-calendar.ts` | `.ics` files | Two-way | Yes | [calendar.md](calendar.md) |
- docs/design/README.md:29 (link) — [`../calendar.md`](../calendar.md); scheduling → [`../scheduler.md`](../scheduler.md)
- docs/design/interaction-model.md:28 (link) — calendar, a prime early integration, is [`../calendar.md`](../calendar.md).
- docs/google-setup.md:5 (mention) — See also: `gmail-setup.md`, `google-drive.md`, `calendar.md` for the per-connector guides that build on this setup.
- docs/implemented-plans/mvp-implementation-guide.md:686 (mention) — calendar.md          # Rules for calendar operations
- docs/implemented-plans/user-story-audit-followups.md:33 (mention) — `docs/calendar.md` updated ([46]).
- docs/reports/user-stories-audit-2026-06-26.md:2267 (mention) — Key limitation from docs/calendar.md (line 77): "One-way only. Local .ics edits are not detected or pushed back to Googl

#### docs/card-validation.md

Title: "Card validation hooks" | 29 lines

Referenced by:
- CLAUDE.md:42 (mention) — **Validation**: Cards validate on load; `cb validate` checks all cards, a file list, or `--staged`. `cb init` installs p
- docs/cards-as-markdown.md:56 (mention) — Cards validate on load (a Zod parse failure is a hard error — the card can't be used) and again at commit time via the p
- docs/plans/docs-reorg.md:320 (mention) — `docs/card-validation.md`); findability quick wins (Guides rows,

References:
- → docs/implemented-plans/external-url-validation.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/implemented-plans/cards-as-markdown-rfc.md (mention)

#### docs/cards-as-markdown.md

Title: "Cards as Markdown" | 65 lines

Referenced by:
- CLAUDE.md:42 (mention) — **Validation**: Cards validate on load; `cb validate` checks all cards, a file list, or `--staged`. `cb init` installs p
- README.md:79 (link) — - [`docs/cards-as-markdown.md`](docs/cards-as-markdown.md) — the card format
- docs/card-validation.md:26 (mention) — Format reference: `docs/cards-as-markdown.md`; design history and migration phases: `docs/implemented-plans/cards-as-mar
- docs/design/README.md:36 (mention) — - **§3 File formats and envelopes** — taught the XML envelope; cards are YAML frontmatter + markdown (`../cards-as-markd
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a schema from `callback-box/cards`. The atomic unit of data in a box. Named `Title.
- docs/implemented-plans/cards-as-markdown-rfc.md:2 (mention) — > The living format reference is `docs/cards-as-markdown.md`.
- docs/implemented-plans/design-md-retired-sections.md:12 (mention) — `../cards-as-markdown.md`. Attachments and transcript-plus-original-audio
- docs/implemented-plans/mvp-implementation-guide.md:7 (mention) — > markdown now, `../cards-as-markdown.md`), the "tailing phase" / `cb tail`
- docs/implemented-plans/remove-cardworks-and-xml.md:417 (mention) — `docs/cards-as-markdown.md`, `docs/adding-schemas.md`.
- docs/migrations.md:285 (mention) — - `docs/cards-as-markdown.md` — living reference for the YAML-frontmatter format these migrators target; `docs/implement
- docs/plans/docs-reorg.md:112 (mention) — 7. `cards-as-markdown.md` — 2,552 lines of resolved RFC with ~50
- docs/stack-decisions.md:18 (mention) — | 15 | [Markdoc](#decision-15-markdown-parsing--markdoc) | Frontend renders markdown via `@markdoc/markdoc` (replaced re
- docs/unimplemented-plans/boxes-as-packages-v1-superseded.md:702 (mention) — - **Interaction with the [Markdown cards idea](../../../issues/closed/features/2026-03-21-markdown-cards-replacing-xml.m
- ../issues/closed/features/2026-03-21-markdown-cards-replacing-xml.md:7 (mention) — **Closed:** Implemented: the card format moved to YAML frontmatter + Markdown body, and the legacy XML card format, its 

References:
- → docs/implemented-plans/cards-as-markdown-rfc.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/box-layout.md (mention)
- → docs/README.md (mention)
- → docs/card-validation.md (mention)

#### docs/chat-schedules.md

Title: "Chat Schedules" | 101 lines

Referenced by:
- CLAUDE.md:23 (mention) — Cards are the core data format. The format is **YAML frontmatter + markdown body** (Phase 2). Every schema is frontmatte
- docs/design/README.md:30 (link) — and [`../chat-schedules.md`](../chat-schedules.md).
- docs/design/processing.md:22 (link) — ([`../chat-schedules.md`](../chat-schedules.md)).
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a schema from `callback-box/cards`. The atomic unit of data in a box. Named `Title.
- docs/implemented-plans/mvp-implementation-guide.md:239 (mention) — See `docs/scheduler.md` and `docs/chat-schedules.md` for scheduling examples.
- docs/plans/design-reconciliation.md:572 (mention) — `<schedule>` tags (docs/scheduler.md, docs/chat-schedules.md).
- docs/plans/docs-reorg.md:175 (mention) — `chat-schedules.md` (current and load-bearing — the worst case),

References:
- → src/hub/CLAUDE.md (mention)

#### docs/chat-scroll-testing.md

Title: "Chat scroll — manual test procedure" | 130 lines

Referenced by:
- docs/implemented-plans/chat-composer-rerender.md:140 (mention) — 4. Manual procedure in `docs/chat-scroll-testing.md` (stick-to-bottom,
- docs/implemented-plans/chat-scroll-redesign.md:16 (mention) — > desktop Chrome via `bin/browse` (procedure: `docs/chat-scroll-testing.md`):
- docs/implemented-plans/chat-stream-finalize-unify.md:364 (mention) — procedure in `docs/chat-scroll-testing.md` (extended), not doctests
- docs/testing.md:519 (link) — checklist) lives in [chat-scroll-testing.md](chat-scroll-testing.md). The
- src/frontend/src/components/chat/CLAUDE.md:31 (mention) — `docs/chat-scroll-testing.md`** (drives the app via `bin/browse`; layout

References:
- → docs/testing.md (mention)

#### docs/chat-session-lifecycle.md

Title: "Chat session lifecycle" | 94 lines

Referenced by:
- CLAUDE.md:160 (mention) — | Chat session lifecycle | `docs/chat-session-lifecycle.md` |
- docs/implemented-plans/architectural-review-followups.md:271 (mention) — `stream_event`s. Also fix the doc-drift: `docs/chat-session-lifecycle.md`
- docs/implemented-plans/architectural-review.md:710 (mention) — then a `docs/chat-session-lifecycle.md` protocol doc for the
- ../issues/code-quality/2026-07-06-chat-session-shared-core.md:50 (mention) — `callback-box/docs/chat-session-lifecycle.md`.

References:
- → ../issues/code-quality/2026-07-06-chat-session-shared-core.md (mention)

#### docs/client-debug-log.md

Title: "Client Debug Log" | 55 lines

Referenced by:
- CLAUDE.md:114 (mention) — - **Check client debug logs when debugging frontend issues.** The browser forwards console errors to the server (now via
- docs/box-layout.md:166 (mention) — | `client-debug.log` | Browser console errors forwarded from the frontend. See `docs/client-debug-log.md`. |
- docs/server-operations.md:218 (link) — For SSH-only debugging: `ssh root@<server> tail /home/callback/boxes/<box>/.callback-box/client-debug.log`. See [`client
- ../.claude/skills/cb-guide-api/SKILL.md:38 (mention) — misbehaves (`docs/client-debug-log.md`).

#### docs/composer-input-machine.md

Title: "Composer input machine — design note" | 305 lines

Referenced by:
- docs/composer-states.md:5 (mention) — us, doing UI polish. Companion to `docs/composer-input-machine.md`, which
- docs/implemented-plans/architectural-review.md:181 (mention) — docs in sync (`docs/composer-input-machine.md`). xstate's home; not to be
- docs/plans/docs-reorg.gap-analysis.md:115 (mention) — 10. `docs/composer-input-machine.md` leads with an unshipped 5-state

References:
- → docs/composer-states.md (mention)

#### docs/composer-states.md

Title: "Composer states" | 282 lines

Referenced by:
- docs/composer-input-machine.md:6 (mention) — us. The companion doc `composer-states.md` enumerates the rendered states with screenshots; this

References:
- → docs/composer-input-machine.md (mention)

#### docs/connectors.md

Title: "Connectors" | 89 lines

Referenced by:
- CLAUDE.md:146 (mention) — | Connectors | `docs/connectors.md` |
- docs/design/interaction-model.md:27 (link) — cards back out (flushed by `cb finalize`). See [`../connectors.md`](../connectors.md);
- docs/implemented-plans/gmail-gc-unlabeled.md:5 (mention) — Lives in `src/connectors/gmail-gc.ts`; reference docs in `docs/connectors.md`.
- docs/implemented-plans/mvp-implementation-guide.md:288 (link) — Config includes credential references, polling intervals, filters, etc. Agents can read these to understand what's avail
- docs/knowledge-taxonomy.md:205 (mention) — - **Expected level: Discoverable** — the agent would need to look at `config/connectors/` and/or `docs/generated/connect
- docs/plans/docs-reorg.gap-analysis.md:21 (mention) — `docs/connectors.md`. The strongest "confidently wrong, silent data
- docs/plans/docs-reorg.md:98 (mention) — 2. `connectors.md` — Google Calendar row says service-injection "Not yet
- ../issues/closed/features/2026-04-27-gmail-sync-improvements.md:7 (mention) — **Closed:** Fully implemented: uncapped Gmail-id dedup checked before fetch, no date filters, incremental sync via the h

References:
- → docs/telegram-setup.md (link)
- → docs/calendar.md (link)
- → docs/gmail-setup.md (link)
- → docs/google-drive.md (link)
- → src/services/CLAUDE.md (mention)
- → docs/triage.md (mention)

#### docs/content-security-policy.md

Title: "Content-Security-Policy" | 80 lines

Referenced by:
- CLAUDE.md:161 (mention) — | Content-Security-Policy | `docs/content-security-policy.md` |
- docs/implemented-plans/app-wide-csp.md:438 (mention) — `docs/content-security-policy.md`) describing the policy, the dev/prod split,
- docs/plans/publish-pages.md:43 (mention) — - **CSP machinery — precedent only; the Worker sets its own.** `src/lib/csp.ts` (`buildCspPolicy`) is the single source 
- docs/scheduled/csp-violation-review.md:6 (mention) — nothing — see `docs/content-security-policy.md`); this routine watches real
- src/dev/CLAUDE.md:15 (mention) — | `csp-digest.ts` | Digests the JSONL CSP violation log (incremental via per-box cursor) | `docs/content-security-policy
- ../issues/decisions/2026-07-19-boxes-share-one-origin.md:22 (mention) — - This is not hypothetical content: `docs/content-security-policy.md` notes *"box views and

References:
- → docs/scheduled/csp-violation-review.md (mention)

#### docs/data-source-tagging.md

Title: "Data Source Tagging Convention" | 89 lines

Referenced by:
- frontend.md:7 (mention) — UI elements that display data from a known source (card, commit, session, etc.) must be tagged with `data-cb-source` att
- ../issues/features/2026-07-08-selection-provenance-canonical-anchors.md:9 (mention) — `docs/data-source-tagging.md`) and text-selection capture (`SelectionCapture.tsx` +
- ../research/hoversource-review.md:13 (mention) — - **`data-cb-source`** (`src/frontend/src/lib/source-tag.ts`, `docs/data-source-tagging.md`) tags rendered elements with

#### docs/developer-install.md

Title: "Developer install (from source)" | 143 lines

Referenced by:
- CLAUDE.md:128 (mention) — | Developer install (from source) | `docs/developer-install.md` |
- docker/README.md:15 (mention) — | `smoke-dev-install.sh` | Bare-machine developer-install smoke: follows `../docs/developer-install.md` from a fresh `de
- docs/agent-install.md:45 (link) — ([developer-install.md](developer-install.md)) is the one. Ask which
- docs/implemented-plans/local-password-auth.md:537 (mention) — **What.** `docs/developer-install.md` + `docs/docker-install.md` +
- docs/plans/installation-story.md:122 (mention) — in `docs/developer-install.md`.
- ../issues/closed/features/2026-07-20-tailscale-expose-and-protect.md:79 (mention) — gotcha `docs/developer-install.md` has to warn about — a real argument for a
- ../issues/features/2026-07-19-installation-remaining-work.md:14 (mention) — - From-source developer install: `callback-box/docs/developer-install.md`,

References:
- → docs/docker-install.md (link)

#### docs/doc-graph.md

Title: "(no title)" | 1 lines

Referenced by:
- docs/README.md:32 (mention) — - **`docs/doc-graph.md`** / **`docs/doc-graph.html`** — generated
- docs/maintenance.md:19 (mention) — | Doc graph | `pnpm doc-graph` | After restructuring docs | `docs/doc-graph.md` |
- docs/plans/docs-reorg.md:116 (mention) — (5,767 generated lines), `doc-graph.md` (build artifact among
- docs/plans/source-available-release.md:432 (mention) — - **doc-graph generator fixed at the source.** `doc-graph.md` only *quoted* the
- docs/testing.md:601 (mention) — `npx tsx src/dev/doc-graph.ts > docs/doc-graph.md` — scans all `.md` files, extracts cross-references, reports orphans a
- src/dev/CLAUDE.md:11 (mention) — | `doc-graph.ts` | Generates `docs/doc-graph.md` (cross-reference graph + orphan/broken-ref report) | `docs/maintenance.
- ../issues/closed/docs-and-chores/2026-03-04-documentation-graph.md:7 (mention) — **Closed:** Implemented as `docs/doc-graph.md` (auto-generated cross-reference report, `src/dev/doc-graph-html.ts`). See

#### docs/docker-install.md

Title: "Docker install (local + VPS)" | 245 lines

Referenced by:
- CLAUDE.md:129 (mention) — | Docker install (local + VPS) | `docs/docker-install.md` |
- docker/README.md:5 (link) — [`../docs/docker-install.md`](../docs/docker-install.md); this file is a map
- docs/agent-install.md:43 (link) — ([docker-install.md](docker-install.md)) is simpler and bundles every
- docs/developer-install.md:7 (link) — [docker-install.md](docker-install.md).
- docs/implemented-plans/local-password-auth.md:537 (mention) — **What.** `docs/developer-install.md` + `docs/docker-install.md` +
- docs/implemented-plans/tailscale-expose-and-protect.md:74 (mention) — - **The documented-but-untested path.** `callback-box/docs/docker-install.md:119`
- docs/plans/installation-story.md:421 (mention) — - **Guide**: `docs/docker-install.md` — local usage first (init, auth,
- ../issues/closed/features/2026-07-20-tailscale-expose-and-protect.md:40 (mention) — as a variant in `callback-box/docs/docker-install.md` (keep loopback mapping,
- ../issues/features/2026-07-19-installation-remaining-work.md:17 (mention) — - Local/VPS Docker install: `callback-box/docker/` + `docs/docker-install.md`,

References:
- → ../issues/features/2026-07-19-installation-remaining-work.md (link)

#### docs/engineering-principles.md

Title: "Engineering Principles" | 160 lines

Referenced by:
- CLAUDE.md:131 (mention) — | Engineering principles | `docs/engineering-principles.md` |
- code-style.md:3 (link) — General coding conventions for backend and frontend. UI palette and primitive reference live in frontend.md. The *why* b
- docs/implemented-plans/architectural-review-followups.md:10 (mention) — principles (`../engineering-principles.md`) and the same execution model
- docs/implemented-plans/architectural-review.md:29 (mention) — >   `docs/engineering-principles.md`, Track N cb-codehealth checks, Track O
- docs/implemented-plans/canvas-loop-figure.md:20 (mention) — - `docs/engineering-principles.md`: #2 exhaustiveness (the runtime union
- docs/implemented-plans/capture-mode.md:24 (mention) — - `docs/engineering-principles.md` — findings trace mostly to: **#3**
- docs/implemented-plans/hub-healthz-box-aggregation.md:31 (mention) — - **Principle 1, types are structure** (`docs/engineering-principles.md:12`):
- docs/implemented-plans/ios-per-box-device-lock.md:15 (mention) — - `docs/engineering-principles.md` **#1 types are structure**, **#3 validate at
- docs/implemented-plans/local-password-auth.md:22 (mention) — - `docs/engineering-principles.md` — principally:
- docs/implemented-plans/mobile-parity-sync.md:21 (mention) — - `docs/engineering-principles.md` **#4 resilient and never silent** — drift
- docs/implemented-plans/mobile-token-handshake.md:14 (mention) — - **`docs/engineering-principles.md` #3 (validate at boundaries)** — the cookie is untrusted
- docs/implemented-plans/questions-end-to-end.md:57 (mention) — - `docs/engineering-principles.md` — findings trace to: **1** (types are
- docs/implemented-plans/refresh-maps-convergence.md:62 (link) — - **[`docs/engineering-principles.md`](../engineering-principles.md) #4
- docs/implemented-plans/refresh-maps-convergence.review.md:113 (mention) — `docs/engineering-principles.md` (#1 types are structure, #3 validate at
- docs/implemented-plans/remove-box-shape-v1.md:93 (mention) — - `callback-box/docs/engineering-principles.md` — most load-bearing: **#4
- docs/implemented-plans/responsive-figures.md:33 (mention) — - `docs/engineering-principles.md` — **#6 Right-sized defensiveness** (the
- docs/implemented-plans/see-as-the-user.md:23 (mention) — - `callback-box/docs/engineering-principles.md` — traced by number below.
- docs/implemented-plans/semantic-search.md:19 (mention) — - `docs/engineering-principles.md` #3 (validate at boundaries) — the
- docs/implemented-plans/tailscale-expose-and-protect.md:48 (mention) — - `callback-box/docs/engineering-principles.md` — especially fail-closed /
- docs/plans/android-companion-app.md:25 (mention) — - `docs/engineering-principles.md`: **#1 types are structure** (bridge messages,
- docs/plans/installation-story.md:41 (mention) — - `docs/engineering-principles.md` #4 (validate at boundaries) and #6
- docs/plans/ios-companion-app.md:19 (mention) — - `callback-box/docs/engineering-principles.md` — the ones this plan leans on:
- docs/plans/ios-input-plane-parity.md:41 (mention) — - `docs/engineering-principles.md`: **#1 types are structure** (draft items,
- docs/plans/ios-native-capture-mode.md:14 (mention) — - `docs/engineering-principles.md`: **#1 types are structure** (native capture
- docs/plans/publish-pages.md:19 (mention) — - `callback-box/docs/engineering-principles.md` — the principles this plan leans on:
- ../.claude/memory/feedback_files_over_external_trackers.md:24 (mention) — - Specific applicable cases: TODO/work-queue → `TODOS.md` or similar; design notes → `docs/`; architectural decisions → 
- ../.claude/skills/cb-plan/SKILL.md:93 (mention) — - `callback-box/docs/engineering-principles.md` — the twelve durable
- ../issues/code-quality/2026-07-06-engine-dev-knowledge-audits.md:16 (mention) — and the rest of `docs/engineering-principles.md` / `code-style.md`.
- ../research/gstack/notes/design-consultation.md:34 (mention) — ★ Probably the single most portable idea in gstack. Worth a CLAUDE.md note or its own principle in `engineering-principl
- ../research/gstack/notes/plan-eng-review.md:183 (mention) — - ★ **Stated preferences as the review spine: yes, and a real artifact to develop.** Would want to write out callback's 
- ../research/gstack/overlap-with-ideas.md:60 (mention) — user-flow edge-cases checklist, engineering-principles.md)
- ../research/gstack/skills.md:11 (mention) — | [plan-eng-review](https://github.com/garrytan/gstack/blob/main/plan-eng-review/SKILL.md) | `integrate (parts)` | Read 

References:
- → code-style.md (link)
- → docs/testing.md (link)
- → docs/knowledge-audits.md (link)

#### docs/event-bus.md

Title: "Event Bus" | 145 lines

Referenced by:
- docs/plans/README.md:96 (mention) — `event-bus.md`, `photo-storage-investigation.md`. Left in place
- docs/plans/docs-reorg.md:341 (mention) — (triage.md, event-bus.md, knowledge-taxonomy.md, …) and ruled

#### docs/example-names.md

Title: "Example names" | 53 lines

Referenced by:
- CLAUDE.md:116 (mention) — - **Keep source and docs generic — never hardcode personal names.** This is a generic tool; any box can be adopted by an
- docs/plans/source-available-release.md:65 (mention) — - **Fictional example roster — reuse.** `docs/example-names.md` and

#### docs/glossary.md

Title: "Glossary" | 57 lines

Referenced by:
- CLAUDE.md:171 (mention) — | Glossary | `docs/glossary.md` |
- docs/design/trust.md:40 (mention) — how firmly an inferred belief is held (`../glossary.md`, retrospective).
- docs/plans/design-reconciliation.md:21 (mention) — chat, connectors, hub), and recent decisions (`docs/glossary.md`,
- docs/plans/docs-reorg.gap-analysis.md:143 (mention) — `docs/glossary.md:22` vs `:42` contradict each other about it.
- docs/plans/docs-reorg.md:91 (mention) — `server-operations.md`, `procedure-implementation.md`, `glossary.md`,
- docs/plans/pdf-intake-design.md:19 (link) — **Intake-time extraction.** When a PDF arrives (`cb import`, capture endpoint, email connector), the intake path runs do
- ../.claude/skills/cb-codehealth/SKILL.md:154 (mention) — Read `docs/glossary.md` for the domain's real names; don't re-litigate decisions
- ../issues/docs-and-chores/2026-05-21-fill-out-the-glossary.md:6 (mention) — `docs/glossary.md` is scoped to Proper Nouns — names we coined and general words we've narrowed to project-specific mean
- ../issues/features/2026-07-20-clerk-import-dispatch-by-url.md:89 (mention) — checking against the glossary (`callback-box/docs/glossary.md`) — the codebase
- ../research/external-skills-harvest.md:93 (mention) — Markdown), the CONTEXT.md/ADR coupling (→ `docs/glossary.md` + git history +

References:
- → ../issues/decisions/2026-05-21-glossary-proper-nouns.md (link)
- → docs/box-layout.md (mention)
- → CLAUDE.md (mention)
- → docs/chat-schedules.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/asset-manifests.md (mention)
- → docs/scheduler.md (mention)
- → docs/design/processing.md (mention)
- → src/core/reactor/DESIGN.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/procedure-implementation.md (mention)
- → src/services/CLAUDE.md (mention)
- → docs/implemented-plans/remove-cardworks-package.md (mention)
- → docs/implemented-plans/box-retrospectives.md (mention)

#### docs/gmail-setup.md

Title: "Gmail Connector Setup" | 85 lines

Referenced by:
- docs/connectors.md:29 (link) — | Gmail | `gmail.ts` | `email-thread`, `email-message`, `email-outbound` | Two-way (pull + draft upload) | Yes | [gmail-
- docs/google-setup.md:5 (mention) — See also: `gmail-setup.md`, `google-drive.md`, `calendar.md` for the per-connector guides that build on this setup.
- docs/plans/docs-reorg.md:210 (mention) — - `google-setup.md` / `gmail-setup.md` / `google-drive.md` / `connectors.md`
- docs/reports/user-stories-audit-2026-06-26.md:2043 (mention) — - docs/gmail-setup.md lines 37-41 (user documentation with examples)

References:
- → docs/google-setup.md (mention)

#### docs/google-drive.md

Title: "Google Drive Integration" | 140 lines

Referenced by:
- docs/connectors.md:30 (link) — | Google Drive | `google-drive.ts` | `sheet` | Two-way | Yes | [google-drive.md](google-drive.md) |
- docs/google-setup.md:5 (mention) — See also: `gmail-setup.md`, `google-drive.md`, `calendar.md` for the per-connector guides that build on this setup.
- docs/plans/docs-reorg.md:210 (mention) — - `google-setup.md` / `gmail-setup.md` / `google-drive.md` / `connectors.md`
- docs/reports/user-stories-audit-2026-06-26.md:2702 (mention) — The implementation is complete and accurate. The google-drive.ts connector's syncFolder() method (lines 260-312) fully i

References:
- → docs/google-setup.md (link)

#### docs/google-setup.md

Title: "Google Cloud Console Setup" | 138 lines

Referenced by:
- docs/gmail-setup.md:14 (mention) — If the server doesn't show the Google Services section at all, OAuth client credentials haven't been configured server-w
- docs/google-drive.md:7 (link) — 1. **Google OAuth** configured (see [google-setup.md](google-setup.md))
- docs/plans/docs-reorg.md:210 (mention) — - `google-setup.md` / `gmail-setup.md` / `google-drive.md` / `connectors.md`

References:
- → docs/gmail-setup.md (mention)
- → docs/google-drive.md (mention)
- → docs/calendar.md (mention)

#### docs/health-checks.md

Title: "Health Checks" | 70 lines

Referenced by:
- CLAUDE.md:149 (mention) — | Deployed-server health-check runbooks | `docs/health-checks.md` |
- deploy/README.md:38 (link) — localhost (see [`../docs/health-checks.md`](../docs/health-checks.md)): it polls
- docs/implemented-plans/hub-healthz-box-aggregation.md:4 (mention) — canary route all shipped; see `docs/health-checks.md` for the current
- docs/implemented-plans/tailscale-expose-and-protect.md:414 (mention) — on the server plus a short runbook note in `docs/health-checks.md`'s style
- docs/plans/docs-reorg.md:180 (mention) — `health-checks.md` are load-bearing but missing from CLAUDE.md's Guides
- docs/server-operations.md:203 (link) — **Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — 
- src/hub/CLAUDE.md:15 (mention) — `docs/health-checks.md`. Do NOT derive health from `restarts` (a lifetime
- ../issues/closed/features/2026-07-20-tailscale-expose-and-protect.md:82 (mention) — (`docs/health-checks.md`). Decide where a Tailscale check belongs rather than
- ../issues/features/2026-07-15-admin-landmark-maintenance-owner.md:63 (mention) — updates) and `docs/health-checks.md` owns deployed-server runbooks — this admin

References:
- → deploy/README.md (link)
- → docs/server-operations.md (link)

#### docs/knowledge-audits.md

Title: "Knowledge Audits" | 91 lines

Referenced by:
- CLAUDE.md:163 (mention) — | Knowledge audits | `docs/knowledge-audits.md` |
- docs/engineering-principles.md:159 (link) — ([`docs/knowledge-audits.md`](knowledge-audits.md)).
- docs/maintenance.md:61 (mention) — **Full guide:** `docs/knowledge-audits.md` (test structure, recording results, interpreting failures).
- docs/plans/docs-reorg.md:119 (mention) — policy — `.gitignore` and `knowledge-audits.md` both say reports are
- docs/reports/user-stories-audit-2026-06-26.md:5670 (mention) — Both claimed files exist at the correct paths. The implementation is complete: test-runner.ts extracts context metrics f
- src/dev/CLAUDE.md:7 (mention) — | `knowledge-audit.ts` | Runs YAML-defined tests against a real box agent | `docs/knowledge-audits.md` |
- ../.claude/memory/feedback_run_audits.md:10 (mention) — When the user asks for new knowledge audits in `src/dev/knowledge-audits.yaml`, just run them after writing them. Don't 
- ../.claude/skills/cb-context/SKILL.md:133 (mention) — `docs/knowledge-audits.md`).
- ../.claude/skills/cb-guide-schemas/SKILL.md:41 (mention) — (`docs/knowledge-audits.md`).
- ../issues/bugs/2026-07-15-knowledge-audit-box-nesting.md:13 (mention) — `docs/knowledge-audits.md`'s `--box ~/src/boxes/test1` example presumably
- ../issues/docs-and-chores/2026-07-04-claude-md-review-docs-backlog.md:10 (mention) — `docs/knowledge-audits.md` over several passes). What's left:

References:
- → CLAUDE.md (mention)
- → docs/maintenance.md (mention)
- → docs/reports/knowledge-audit-rerun-2026-07-03.md (mention)
- → MAP.md (at-include) **[BROKEN]**

#### docs/knowledge-taxonomy.md

Title: "Agent Knowledge Audit: What It Should Know and How to Verify" | 493 lines

Referenced by:
- docs/implemented-plans/card-view-widgets.md:574 (mention) — **Altitude.** Per `docs/knowledge-taxonomy.md:307` view authoring sits at
- docs/plans/docs-reorg.md:341 (mention) — (triage.md, event-bus.md, knowledge-taxonomy.md, …) and ruled
- docs/plans/source-available-release.md:172 (mention) — test data), `docs/knowledge-taxonomy.md:468-491` (agent inferring the real
- docs/testing.md:381 (link) — See [knowledge-taxonomy.md](knowledge-taxonomy.md) for the full knowledge taxonomy and test prompt guide.
- ../research/openclaw-hermes/compare-context-memory.md:92 (mention) — **Layered instruction files, narrowed by role, is universal.** CBX's always-loaded/conditionally-loaded/referenced-but-n
- ../research/openclaw-hermes/compare-skills-tools.md:84 (mention) — explicitly not agent-editable (`docs/knowledge-taxonomy.md`). There is no plugin manifest, no
- ../research/pai/information-layout.md:9 (mention) — cb's comparable thinking is `docs/knowledge-taxonomy.md` (the knows-directly /

References:
- → CLAUDE.md (mention)
- → docs/connectors.md (mention)
- → docs/triage.md (mention)

#### docs/landmark-curation.md

Title: "Landmark Curation" | 48 lines

Referenced by:
- docs/plans/docs-reorg.md:192 (mention) — Two flagged cases: `landmark-curation.md` is written as second-person
- docs/reports/knowledge-audit-rerun-2026-07-03.md:261 (mention) — (`docs/landmark-curation.md`, `docs/triage.md`) that don't exist in
- ../issues/features/2026-07-09-memory-gardener-consolidation-loop.md:30 (mention) — - **Landmark curation** (`docs/landmark-curation.md`) — curates the *navigation
- ../research/openclaw-hermes/compare-skills-tools.md:56 (mention) — by `docs/landmark-curation.md`). None of these have a formal create/edit/patch/delete tool

References:
- → docs/landmarks.md (mention)

#### docs/landmarks.md

Title: "Landmarks" | 164 lines

Referenced by:
- CLAUDE.md:158 (mention) — | Landmarks (navigation surface) | `docs/landmarks.md` |
- docs/design/representation.md:91 (link) — and/or a triage filing destination ([`../landmarks.md`](../landmarks.md),
- docs/implemented-plans/architectural-review.md:829 (mention) — `docs/landmarks.md` cites never-built renderer paths; a clerk docstring
- docs/implemented-plans/clerk-webpage-capture.md:264 (mention) — destinations API, extension UI labels, docs/landmarks.md, knowledge audits.
- docs/implemented-plans/open-chat-from-card.md:96 (mention) — `contextDir` chosen at the call site (`LandmarkSection.tsx:96`). `docs/landmarks.md` (per the
- docs/landmark-curation.md:5 (mention) — For the design and schema of the card itself, see `docs/landmarks.md` and `docs/generated/card-landmark.md`.
- docs/reports/user-stories-audit-2026-06-26.md:732 (mention) — The file src/core/frontmatter-field.ts exports two functions that implement the exact capability described. lookupField(
- docs/unimplemented-plans/design-vision-superseded.md:7 (mention) — > retired (ruling 17; `../landmarks.md`); extensibility-through-knowledge →
- docs/unimplemented-plans/query-cards.md:14 (mention) — planned in docs/landmarks.md long before this, useful for any list-shaped
- ../issues/bugs/2026-07-19-landmark-menu-overflows-mobile.md:59 (mention) — `src/schemas/landmark.ts` and `docs/landmarks.md`; an `expand` entry fans out to
- ../issues/features/2026-06-12-card-level-prominence.md:7 (mention) — Started as "a landmark-ish marker in the card itself" and resolved (2026-06-12 discussion) into a unification: **there i
- ../issues/features/2026-07-15-admin-landmark-maintenance-owner.md:26 (mention) — Landmarks are already the box's "notable spots" surface (`docs/landmarks.md`), and

References:
- → docs/triage.md (mention)

#### docs/maintenance.md

Title: "Code Maintenance" | 133 lines

Referenced by:
- CLAUDE.md:162 (mention) — | Periodic maintenance | `docs/maintenance.md` |
- docs/implemented-plans/box-retrospectives.md:413 (mention) — (`enabled="false"`), `docs/box-layout.md` + `docs/maintenance.md` +
- docs/implemented-plans/mobile-parity-sync.md:180 (mention) — After any burst of mobile work, and otherwise on the `docs/maintenance.md`
- docs/knowledge-audits.md:22 (mention) — `docs/maintenance.md` lists this alongside the other periodic tasks.
- docs/migrations.md:286 (mention) — - `docs/maintenance.md` — where `cb migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface
- docs/plans/cli-restructure.md:138 (mention) — - **Card normalization story.** `cb format` was deleted (80-line one-off normalizer that re-serialized cards to flat XML
- docs/plans/docs-reorg.md:392 (mention) — belongs in the maintenance cadence (it is listed in docs/maintenance.md).
- src/dev/CLAUDE.md:8 (mention) — | `prompt-report.ts` | Generates `docs/prompts.md` (system-wide prompt inventory) | `docs/maintenance.md` |
- ../issues/closed/code-quality/2026-05-09-claude-code-sdk-binary-currency.md:13 (mention) — semantics. Documented in `callback-box/docs/maintenance.md`.
- ../issues/docs-and-chores/2026-03-16-review-all-prompts.md:16 (mention) — `~/src/boxes/test1`; `docs/maintenance.md` has the details). Every fragment has
- ../issues/docs-and-chores/2026-07-04-claude-md-review-docs-backlog.md:9 (mention) — folded into `code-style.md`, `frontend.md`, `docs/maintenance.md`, and
- ../issues/docs-and-chores/2026-07-04-doc-refresh-cadence.md:15 (mention) — `callback-box/docs/maintenance.md` with a cadence, or a scheduled routine):
- ../issues/features/2026-07-15-admin-landmark-maintenance-owner.md:62 (mention) — `docs/maintenance.md` already owns **dev/code** maintenance (audits, sweeps, SDK

References:
- → CLAUDE.md (mention)
- → docs/doc-graph.md (mention)
- → docs/todo-security.md (mention)
- → docs/implemented-plans/mobile-parity-sync.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/migrations.md (mention)
- → docs/architecture/CLAUDE.md (mention)

#### docs/migrations.md

Title: "Box Migrations" | 300 lines

Referenced by:
- CLAUDE.md:141 (mention) — | Box migration runbook | `docs/migrations.md` |
- README.md:82 (link) — - [`docs/migrations.md`](docs/migrations.md) — the data-migration runbook
- docs/design/representation.md:65 (link) — controlled migration ([`../migrations.md`](../migrations.md)), not silent
- docs/implemented-plans/agent-applied-migrations.md:33 (mention) — `docs/migrations.md` ("Writing an agent-applied (procedure) migration").
- docs/implemented-plans/box-migration.subplan.md:48 (mention) — - **`docs/migrations.md`** — the established migration framework: `cb migrate`
- docs/implemented-plans/boxes-as-packages-v2.md:72 (mention) — | `cb migrate`: ordered registry, agent-procedure migrations with abort gates | `src/core/migrations.ts`, `docs/migratio
- docs/implemented-plans/capture-mode.md:447 (mention) — wakeup-time failure). Migration (per `docs/migrations.md` runbook
- docs/implemented-plans/cards-as-markdown-rfc.md:47 (mention) — **Tracking which migrations have been applied per box** is handled by `cb migrate` against the per-box append-only manif
- docs/implemented-plans/questions-end-to-end.md:251 (mention) — `docs/migrations.md` on test1 + prod boxes. The two live test1 retro
- docs/implemented-plans/remove-box-shape-v1.md:79 (mention) — - **1e — Docs** (was Track 3): `box-layout.md`, `migrations.md`, `box-layout-spec`
- docs/implemented-plans/remove-box-shape-v1.review.md:47 (mention) — entries." `migrations.md:80-84`: "Never reorder, rename, or remove."
- docs/implemented-plans/remove-cardworks-deletion.md:456 (mention) — `docs/migrations.md` (retire deleted-migrator references).
- docs/implemented-plans/remove-cardworks-package.md:324 (mention) — it now means "from `src/cards/`"); retire `docs/migrations.md` references to
- docs/maintenance.md:91 (mention) — **Author guide + runbook:** `docs/migrations.md` (how to write a new migrator with the noisy-mode `_migrate-warnings` he
- docs/plans/docs-reorg.gap-analysis.md:161 (mention) — `docs/migrations.md`, chat components CLAUDE.md, `chat-turn-buffer.ts`,
- docs/plans/docs-reorg.md:90 (mention) — (`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,
- ../.claude/skills/cb-migration/SKILL.md:12 (mention) — lives in **`callback-box/docs/migrations.md`** — read it before writing one.
- ../issues/closed/bugs/2026-07-11-pre-v2-session-resume-broken.md:39 (mention) — migration script territory (`docs/migrations.md`).
- ../issues/docs-and-chores/2026-07-19-questions-end-to-end-followups.md:14 (mention) — `~/src/boxes/test1`** per `callback-box/docs/migrations.md`

References:
- → docs/implemented-plans/questions-end-to-end.md (mention)
- → docs/implemented-plans/remove-box-shape-v1.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/implemented-plans/cards-as-markdown-rfc.md (mention)
- → docs/maintenance.md (mention)
- → docs/adding-schemas.md (mention)

#### docs/mobile-contract.md

Title: "Cross-Platform Mobile Contract" | 636 lines

Referenced by:
- CLAUDE.md:142 (mention) — | Cross-platform mobile contract (iOS/Android ↔ box) | `docs/mobile-contract.md` |
- docs/implemented-plans/ios-per-box-device-lock.md:261 (mention) — no `docs/mobile-contract.md` change because nothing crosses the wire. Commits
- docs/implemented-plans/mobile-parity-sync.md:36 (mention) — ### 1. `docs/mobile-contract.md` — the canonical contract (exists)
- docs/implemented-plans/mobile-token-handshake.md:27 (mention) — `docs/mobile-contract.md` and mirrored in Swift + shared fixtures; a wire change updates
- docs/mobile-parity.md:5 (mention) — detail lives in `docs/mobile-contract.md`. Cell values: **done**,
- docs/plans/android-companion-app.md:7 (mention) — grounded in the same-day contract inventory (`docs/mobile-contract.md`), the iOS
- docs/plans/ios-input-plane-parity.md:119 (mention) — | Bridge contract | Web `Emission` supports files and selections | Native payload carries only text/origin/diarized/imag
- ../issues/code-quality/2026-07-19-mobile-contract-small-cleanups.md:27 (mention) — one so a future Android client has one thing to learn. `docs/mobile-contract.md` §8 lists
- ../issues/code-quality/2026-07-19-mobile-device-token-no-expiry.md:29 (mention) — web (`docs/mobile-contract.md` §2).
- ../issues/features/2026-07-18-android-companion-track1-unblocked.md:11 (mention) — - **Contract infrastructure live** — `docs/mobile-contract.md` (with the
- ../issues/features/2026-07-19-ios-input-plane-parity.md:82 (mention) — `ios-app/CLAUDE.md`, `callback-box/docs/mobile-contract.md`, and the linked

References:
- → docs/implemented-plans/mobile-parity-sync.md (mention)
- → docs/plans/android-companion-app.md (mention)
- → docs/plans/ios-companion-review-2026-07-17.md (mention)
- → docs/implemented-plans/mobile-token-handshake.md (mention)

#### docs/mobile-parity.md

Title: "Mobile parity matrix" | 43 lines

Referenced by:
- CLAUDE.md:143 (mention) — | Mobile parity matrix (iOS vs Android capabilities) | `docs/mobile-parity.md` |
- docs/implemented-plans/ios-per-box-device-lock.md:259 (mention) — **Direction.** Add **Per-box local device lock** to `docs/mobile-parity.md` as
- docs/implemented-plans/mobile-parity-sync.md:97 (mention) — ### 3. `docs/mobile-parity.md` — the parity matrix (to build)
- docs/plans/android-companion-app.md:592 (mention) — - The parity matrix (`docs/mobile-parity.md`, owned by the sync plan) lists each
- ../issues/features/2026-07-18-android-companion-track1-unblocked.md:12 (mention) — tripwire anchor manifest), `docs/mobile-parity.md`, shared golden fixtures
- ../issues/features/2026-07-20-android-per-box-device-lock-parity.md:34 (mention) — acceptance. Close only when the Android cell in `docs/mobile-parity.md` can be

References:
- → docs/implemented-plans/mobile-parity-sync.md (mention)
- → docs/mobile-contract.md (mention)
- → docs/plans/android-companion-app.md (mention)
- → docs/implemented-plans/ios-per-box-device-lock.md (mention)
- → docs/plans/ios-native-capture-mode.md (mention)

#### docs/module-map.md

Title: "Module map: where shared code lives" | 52 lines

Referenced by:
- CLAUDE.md:132 (mention) — | Module map (lib/shared/types boundary) | `docs/module-map.md` |
- docs/implemented-plans/clerk-contract-and-import-boundary.md:113 (mention) — against `docs/module-map.md` and update that doc if it's silent on
- ../issues/closed/code-quality/2026-07-12-frontend-local-helper-consolidation-into-shared.md:22 (mention) — added to `OUTSIDE_VITE_SHARED_RAW`. Pattern documented in `docs/module-map.md`.
- ../issues/closed/decisions/2026-07-06-architectural-review-open-decisions.md:140 (mention) — is a future boxholder question; `docs/module-map.md` now documents the

#### docs/procedure-implementation.md

Title: "Procedures" | 223 lines

Referenced by:
- CLAUDE.md:147 (mention) — | Procedures | `docs/procedure-implementation.md` |
- docs/glossary.md:40 (mention) — **procedure** — A multi-step workflow defined as a `*.procedure.card` (YAML frontmatter, no body). Config in `config/pro
- docs/implemented-plans/agent-applied-migrations.md:29 (mention) — general write-up landed in `docs/procedure-implementation.md` ("Checklists"
- docs/implemented-plans/procedure-validation-completion.md:9 (mention) — > `docs/procedure-implementation.md` and the generated procedure guide. Two
- docs/plans/docs-reorg.md:91 (mention) — `server-operations.md`, `procedure-implementation.md`, `glossary.md`,
- docs/reports/user-stories-audit-2026-06-26.md:5732 (mention) — **Verifier (flagged):** The code implements multi-phase procedure definitions and execution with progress tracking, but 
- ../issues/closed/code-quality/2026-06-26-procedure-validation-completion-d5.md:7 (mention) — **Closed:** Done: model-judged instruction validation, `severity: review` auto-retry, and resumable runs (`cb procedure 

#### docs/prompt-audits.md

Title: "Prompt Audits" | 203 lines

Referenced by:
- docs/plans/box-commentary-surface.md:109 (mention) — - **Convention — `ref` for in-box targets** (`docs/prompt-audits.md:184`:
- docs/plans/docs-reorg.md:105 (mention) — `browse`); `prompt-audits.md` → nonexistent `tone-design.md`;
- docs/prompt-audits.md:174 (mention) — **Useful: what-changed closers.** One or two sentences naming what changed and where: "Added the pre-tool-brevity audit 
- ../.claude/skills/cb-prompt-review/SKILL.md:59 (mention) — Prior art: `callback-box/docs/plans/prompt-surface-ia-review.md` is the worked example of a full-surface review (what wa
- ../issues/exploration/2026-05-19-introspectable-feedback-storage.md:20 (link) — - *Park ignored proactive observations* in [prompt-audits.md](../callback-box/docs/prompt-audits.md#park-ignored-proacti
- ../issues/exploration/2026-05-19-subagent-strategy.md:19 (link) — - Multi-perspective drafting, *only if* the perspectives are grounded in different sources or different roles. Same-mode
- ../issues/exploration/2026-05-19-universal-confidence-rubric.md:14 (link) — Universality is the point: the same rubric applies wherever the agent commits to something below fact level — hypotheses
- ../issues/features/2026-05-19-agent-loop-hooks.md:17 (link) — - **Link enforcement** (*Link, don't name* in [prompt-audits.md](../callback-box/docs/prompt-audits.md#link-dont-name) a
- ../issues/features/2026-05-19-spark-mode.md:13 (link) — - Parked proactive observations (see *Park ignored proactive observations* in [prompt-audits.md](../callback-box/docs/pr

References:
- → ../.claude/memory/tone-design.md (link)
- → docs/prompt-audits.md (mention)

#### docs/prompt-logging.md

Title: "Prompt Logging for Agent Invocations" | 212 lines

Referenced by:
- CLAUDE.md:151 (mention) — | Capturing full agent-invocation API traffic | `docs/prompt-logging.md` |
- docs/plans/docs-reorg.md:179 (mention) — link. `prompt-logging.md` is a near-orphan; `scheduler.md` and
- docs/reports/user-stories-audit-2026-06-26.md:1326 (mention) — 6. **Supporting documentation**: `docs/prompt-logging.md` provides detailed guidance on using the feature, confirming th

References:
- → CLAUDE.md (mention)

#### docs/questions.md

Title: "Questions" | 335 lines

Referenced by:
- CLAUDE.md:153 (mention) — | Questions subsystem design | `docs/questions.md` |
- docs/implemented-plans/questions-end-to-end.md:461 (mention) — **What.** `docs/questions.md` (the subsystem's design doc: purpose frame,
- docs/triage.md:133 (mention) — The rule-update-plus-placement evolution landed: `learning:` (`docs/questions.md`, `docs/implemented-plans/questions-end
- ../issues/closed/features/2026-05-19-questions-aging-policy.md:14 (mention) — See `docs/questions.md` § Aging.
- ../issues/closed/features/2026-06-26-questions-end-to-end-d1.md:14 (mention) — maintainer doc at `docs/questions.md`. See that plan for the full track
- ../issues/features/2026-07-19-write-only-secret-capture-in-chat.md:32 (mention) — - **Explicitly NOT the questions subsystem.** Questions (`docs/questions.md`) are an

References:
- → docs/implemented-plans/questions-end-to-end.md (mention)
- → docs/implemented-plans/box-retrospectives.md (mention)
- → CLAUDE.md (mention)

#### docs/README.md

Title: "docs/ — map and naming conventions" | 52 lines

Referenced by:
- docs/README.md:19 (mention) — Each entry in the directory's `README.md` disposition table says what
- docs/adding-a-box.md:27 (mention) — see the root [`README.md`](../README.md) for that path. This doc is about
- docs/cards-as-markdown.md:20 (mention) — **Naming and type discrimination.** `Name.type.card` — the type segment is the canonical discriminator, not a `type:` fr
- docs/plans/README.md:68 (mention) — applies the naming conventions (`docs/README.md`). The 2026-07-04
- docs/plans/docs-reorg.md:344 (mention) — role change). Conventions recorded in `docs/README.md`.
- src/dev/CLAUDE.md:12 (mention) — | `doc-check.ts` | Enforcement twin of doc-graph: exits nonzero on broken refs or live-area orphans; run by pre-commit o
- ../.claude/agents/finish.md:189 (mention) — - **Filenames matter** — apply `callback-box/docs/README.md`'s naming rules: a
- ../CLAUDE.md:25 (mention) — **Commit docs WITH hooks.** Docs-only commits run only fast checks (~1s — typecheck/lint are skipped automatically), so 

References:
- → docs/plans/README.md (mention)
- → docs/README.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/doc-graph.md (mention)
- → CLAUDE.md (mention)

#### docs/scheduler.md

Title: "Scheduler" | 93 lines

Referenced by:
- CLAUDE.md:96 (mention) — **Wakeup cycle** — `cb wakeup` preprocesses inbox items → runs housekeeping + on-wakeup scripts → syncs connectors (crea
- docs/design/README.md:29 (link) — [`../calendar.md`](../calendar.md); scheduling → [`../scheduler.md`](../scheduler.md)
- docs/design/interaction-model.md:9 (link) — (`cb tick`, see [`../scheduler.md`](../scheduler.md)), a connector pulls new
- docs/design/processing.md:21 (link) — ([`../scheduler.md`](../scheduler.md)) and agent-set timers
- docs/glossary.md:34 (mention) — **wakeup cycle** — One full sync-and-process pass. `cb wakeup` preprocesses inbox items → housekeeping + on-wakeup scrip
- docs/implemented-plans/mvp-implementation-guide.md:8 (mention) — > (never built — scheduling is `cb tick`, `../scheduler.md`), `agents.json` +
- docs/plans/design-reconciliation.md:572 (mention) — `<schedule>` tags (docs/scheduler.md, docs/chat-schedules.md).
- docs/plans/docs-reorg.gap-analysis.md:137 (mention) — contradicts `serve.ts:11-14` and `docs/scheduler.md:31`;
- docs/plans/docs-reorg.md:179 (mention) — link. `prompt-logging.md` is a near-orphan; `scheduler.md` and
- ../issues/decisions/2026-07-04-box-registry-manifests.md:31 (mention) — Refs: `callback-box/docs/scheduler.md`, `callback-box/docs/adding-a-box.md`,
- ../issues/exploration/2026-07-08-per-surface-agent-vs-boxwide-reactor.md:22 (mention) — `docs/scheduler.md`). Is the latency gap real for the user, and could it be closed
- ../issues/features/2026-07-15-admin-landmark-maintenance-owner.md:86 (mention) — (`docs/scheduler.md` / the scheduled-task health state at
- ../research/pai/README.md:65 (mention) — | Scheduling | Pulse daemon, `[[job]]` cron in one TOML | `cb tick` + per-box `scheduled-script.card`s (`docs/scheduler.

#### docs/server-operations.md

Title: "Server Operations" | 225 lines

Referenced by:
- CLAUDE.md:155 (mention) — | Server operations | `docs/server-operations.md` |
- docs/health-checks.md:19 (link) — The server runs `claude update` nightly via `claude-update.timer` → `claude-update.service` → `deploy/claude-update.sh` 
- docs/implemented-plans/box-migration.subplan.md:157 (mention) — **Server mechanics** (`docs/server-operations.md`). Boxes are
- docs/implemented-plans/boxes-as-packages-v2.md:499 (mention) — rewritten for the hub era; `docs/server-operations.md` and `docs/ideas.md` had stale pre-hub
- docs/plans/docs-reorg.md:91 (mention) — `server-operations.md`, `procedure-implementation.md`, `glossary.md`,
- docs/unimplemented-plans/boxes-as-packages-v1-superseded.md:366 (mention) — - **`CB_DIAG_API_KEY` becomes per-box** (it lives in each box's `.env`). The bypass curl pattern in `server-operations.m
- ../.claude/memory/MEMORY.md:4 (mention) — Auto-memory (`~/.claude/projects/` path) is problematic: path-hash-based, machine-specific, not version-controlled, easi
- ../issues/closed/code-quality/2026-04-11-switch-deploy-rsync-to-git-push.md:18 (mention) — rollback runbook: `docs/server-operations.md`. A Codex adversarial review

References:
- → deploy/README.md (link)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/health-checks.md (link)
- → docs/client-debug-log.md (link)
- → docs/adding-a-box.md (link)

#### docs/ssr-render-testing.md

Title: "SSR Render Testing (`cb render`)" | 185 lines

Referenced by:
- CLAUDE.md:164 (mention) — | SSR page rendering (`cb render`) | `docs/ssr-render-testing.md` |
- docs/reports/user-stories-audit-2026-06-26.md:4686 (mention) — All files exist and are properly implemented. Verified: (1) src/cli/commands/render.ts spawns render.tsx with full optio
- ../.claude/skills/cb-guide-testing/SKILL.md:38 (mention) — - **SSR render tests** (`cb render`, `docs/ssr-render-testing.md`) —
- ../issues/closed/bugs/2026-07-07-cb-render-ssr-window-undefined.md:35 (mention) — couldn't use. It's also covered by `docs/ssr-render-testing.md`, so SSR is
- ../issues/decisions/2026-07-07-cb-render-vs-bin-browse.md:46 (mention) — `docs/ssr-render-testing.md`; the SSR-state-injection machinery (`useSSRMachine`,

#### docs/stack-decisions.md

Title: "Stack Decisions" | 1201 lines

Referenced by:
- docs/README.md:28 (mention) — `stack-decisions.md`; answers *why*, never *how to*.
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode.md`, `stack-de
- docs/architecture/CLAUDE.md:5 (mention) — **Role:** this series is the onboarding narrative — the canonical human-facing "what is this." Engineering rationale liv
- docs/design/README.md:3 (link) — Why the system is shaped the way it is. Peer of [`../stack-decisions.md`](../stack-decisions.md)
- docs/implemented-plans/architectural-review.md:828 (mention) — 5. **Doc drift:** `docs/stack-decisions.md` cites deleted `sseMachine.ts`;
- docs/plans/README.md:98 (mention) — `design-vision.md`, `stack-decisions.md` were judged reference and stayed
- docs/plans/design-reconciliation.md:22 (mention) — `docs/stack-decisions.md`, `docs/plans/interface-as-cards.md`,
- docs/plans/docs-reorg.gap-analysis.md:110 (mention) — 8. **`@xstate/store` documented as adopted (`docs/stack-decisions.md:143`)
- docs/plans/docs-reorg.md:92 (mention) — `stack-decisions.md`, the Google/Telegram setup runbooks, CSP docs) verified
- docs/plans/installation-story.md:111 (mention) — `node --watch` over the backend; `docs/stack-decisions.md` used to pair
- docs/plans/publish-pages.md:44 (mention) — - **Designed-but-unbuilt authorization.** `docs/stack-decisions.md:581`: *`## Decision 11: Authorization — Typed Princip
- docs/reports/user-stories-audit-2026-06-26.md:4801 (mention) — Feature is fully implemented with all claimed capabilities. Evidence: (1) /src/cli/commands/render.ts registers the `cb 
- docs/unimplemented-plans/design-vision-superseded.md:13 (mention) — > `../stack-decisions.md` Decision 18).
- ../issues/code-quality/2026-07-04-xstate-store-never-adopted.md:7 (mention) — `callback-box/docs/stack-decisions.md` (~line 143) records `@xstate/store`
- ../issues/decisions/2026-07-07-cb-render-vs-bin-browse.md:38 (mention) — pixel screenshots for exactly this (stack-decisions.md Decision 1, §931).

References:
- → docs/cards-as-markdown.md (mention)
- → docs/plans/docs-reorg.md (mention)
- → docs/implemented-plans/state-management-comparison.md (mention)
- → docs/implemented-plans/cards-as-markdown-rfc.md (mention)
- → CLAUDE.md (mention)

#### docs/telegram-setup.md

Title: "Telegram Connector Setup" | 133 lines

Referenced by:
- docs/connectors.md:27 (link) — | Telegram | `telegram.ts` | `chat-thread` | Two-way | Yes | [telegram-setup.md](telegram-setup.md) |
- docs/plans/docs-reorg.md:176 (mention) — `telegram-setup.md`, `todo-security.md`,

#### docs/testing.md

Title: "Testing" | 621 lines

Referenced by:
- CLAUDE.md:135 (mention) — | Testing philosophy | `docs/testing.md` |
- docs/chat-scroll-testing.md:5 (mention) — behavior that doctests can't exercise (`docs/testing.md` §6). This is the
- docs/engineering-principles.md:125 (link) — [`docs/testing.md`](testing.md).
- docs/implemented-plans/agent-applied-migrations.md:82 (mention) — - `callback-box/docs/testing.md` — tests-first as a design tool; the machine
- docs/implemented-plans/architectural-review.md:760 (mention) — that didn't happen. `testing.md:608`'s "soft assertions" note is a
- docs/implemented-plans/architectural-review.review.md:12 (mention) — **Citation:** plan Track P.1; `testing.md:608`.
- docs/implemented-plans/card-view-widgets.md:636 (mention) — - **Test posture** (per `docs/testing.md` — tests first, as a design tool):
- docs/implemented-plans/chat-scroll-redesign.md:55 (mention) — - `callback-box/docs/testing.md:5-11` — tests force decomposition, document, and
- docs/implemented-plans/chat-stream-finalize-unify.md:53 (mention) — - `callback-box/docs/testing.md:5-9` + `:474-521` — layout/streaming behavior is
- docs/implemented-plans/courseware-lesson-plan.md:326 (mention) — - **Tests** (per `docs/testing.md`, on substantial codepaths): the `lesson-plan` parse doctest
- docs/implemented-plans/courseware-phase1.md:487 (mention) — - **Tests** (per `docs/testing.md`):
- docs/implemented-plans/figure-card-type.md:81 (mention) — - **`docs/testing.md`** — tests as a design tool, on substantial codepaths.
- docs/implemented-plans/hub-healthz-box-aggregation.md:429 (mention) — **Test posture.** Per `docs/testing.md`, tests come first as a design tool.
- docs/implemented-plans/input-extraction.md:30 (mention) — - `docs/testing.md` via the cb-plan template: tests first as a design tool;
- docs/implemented-plans/ios-per-box-device-lock.md:32 (mention) — - `docs/testing.md` says tests first force useful decomposition, then document
- docs/implemented-plans/link-validation-fix.md:35 (mention) — - `callback-box/docs/testing.md` — tests as a design tool; name the doctest for
- docs/implemented-plans/local-password-auth.md:683 (mention) — - **Test posture (tests as design tool, `docs/testing.md`).** Named up
- docs/implemented-plans/mobile-token-handshake.md:494 (mention) — substantial new codepaths, per `docs/testing.md`.
- docs/implemented-plans/normalize-chat-links.md:78 (mention) — - **`callback-box/docs/testing.md`** — tests as a design tool; doctest the
- docs/implemented-plans/procedure-validation-completion.md:36 (mention) — - **`docs/testing.md`** — tests come first as a design tool; cover substantial codepaths, not coverage-for-its-own-sake.
- docs/implemented-plans/refresh-maps-convergence.md:352 (mention) — **Test posture.** Doctests named as part of the design, per `docs/testing.md`:
- docs/implemented-plans/refresh-maps-convergence.review.md:268 (mention) — **Why it matters:** The plan's ordering rationale is the one place a reader checks before starting work. An "independent
- docs/implemented-plans/responsive-figures.md:403 (mention) — doctest tiers exercise (`docs/testing.md` posture: don't test for coverage's
- docs/implemented-plans/rest-to-trpc-consolidation.md:383 (mention) — - **Test posture** (`docs/testing.md` — tests as design tool, not coverage): a
- docs/implemented-plans/see-as-the-user.md:575 (mention) — - **Tests first as design tool** (`docs/testing.md`): B0's extraction is
- docs/implemented-plans/slopo-codehealth-adoption.md:56 (mention) — - **`docs/testing.md`** — tests are not for coverage (`docs/testing.md:11`:
- docs/implemented-plans/view-render-testing.md:31 (mention) — - `callback-box/docs/testing.md` — tests as a design tool; doctests are the
- docs/implemented-plans/web-push-notifications.md:482 (mention) — - **Test posture.** Doctests as a design tool (`docs/testing.md`): the load-bearing
- docs/plans/docs-reorg.gap-analysis.md:53 (mention) — `docs/testing.md:80` lists the helper without the prefixing.
- docs/plans/docs-reorg.md:90 (mention) — (`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,
- docs/plans/ios-companion-app.md:212 (mention) — - **Test posture.** Box-side (TS) gets doctests per `docs/testing.md`: a route doctest for `verifyDeviceToken` (`makeTes
- docs/plans/ios-input-plane-parity.md:62 (mention) — - `docs/testing.md`: pure draft and protocol behavior gets doctests/XCTest;
- docs/plans/ios-native-capture-mode.md:33 (mention) — - `docs/testing.md`: route and filesystem behavior gets doctests; pure state
- docs/plans/publish-pages.md:274 (mention) — - **Test posture (tests as the design tool, per `docs/testing.md`):**
- docs/tours.md:16 (link) — ([testing.md](testing.md)).
- ../.claude/skills/cb-debug/SKILL.md:30 (mention) — - **A doctest** — the default, and per `docs/testing.md` it's also your
- ../.claude/skills/cb-guide-testing/SKILL.md:3 (mention) — description: Explains callback-box's testing system — the test tiers, what each is for, and how to choose. Use when deci
- ../.claude/skills/cb-plan/SKILL.md:285 (mention) — `docs/testing.md`): a test's first job is to force decomposition —
- ../issues/closed/features/2026-03-04-session-output-critique-tool.md:7 (mention) — **Closed:** Implemented as `cb session <id> --tool-report` + `@session-critique` subagent. See `docs/testing.md` § Sessi
- ../issues/code-quality/2026-07-11-v1-removal-residue-src-comments-and-scenario-boxes.md:48 (mention) — (`content/`-nested, `shapeVersion: 2`) layout. `docs/testing.md` was updated to
- ../issues/docs-and-chores/2026-07-04-claude-md-review-docs-backlog.md:23 (mention) — `docs/testing.md`): which doctest tier to choose, what to fake vs. let run
- ../research/external-skills-harvest.md:289 (mention) — - [x] **X1 — reconcile cb-plan's test posture with `docs/testing.md`. DONE →

References:
- → src/services/CLAUDE.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/implemented-plans/remove-box-shape-v1.md (mention)
- → docs/knowledge-taxonomy.md (link)
- → docs/chat-scroll-testing.md (link)
- → docs/tours.md (link)
- → docs/doc-graph.md (mention)

#### docs/todo-security.md

Title: "Security TODOs" | 49 lines

Referenced by:
- docs/implemented-plans/local-password-auth.md:541 (mention) — `docs/todo-security.md` records the new posture; the issue file moves to
- docs/maintenance.md:26 (mention) — | Accepted security gaps | — | Review when touching auth/OAuth boundaries | `docs/todo-security.md` |
- docs/plans/docs-reorg.md:79 (mention) — decay-prone OCR vendor pricing), `todo-security.md` (orphaned TODO list),
- ../issues/bugs/2026-07-19-google-oauth-callback-unauthenticated.md:28 (mention) — owner. Relates to `docs/todo-security.md` ("shared Google token with broad
- ../issues/closed/features/2026-07-16-local-password-auth-default-on.md:95 (mention) — Touches the same surface as `docs/todo-security.md` (accepted security gaps) and

References:
- → docs/implemented-plans/local-password-auth.md (mention)

#### docs/tours.md

Title: "Tours — scripted browser walks for rendering + a11y review" | 133 lines

Referenced by:
- CLAUDE.md:136 (mention) — | Tours (browser walks for UI/a11y review) | `docs/tours.md` |
- docs/testing.md:553 (link) — them: [tours.md](tours.md).
- ../issues/closed/code-quality/2026-07-10-tour-lib-lint-debt.md:45 (mention) — Filed while formalizing tours (docs/tours.md); the 2026-07-10 fixes to
- ../issues/exploration/2026-07-15-claude-code-cloud-environment.md:193 (mention) — (`agent-browser` / `bin/browse`) and **tours** (`docs/tours.md` — scripted browser
- ../issues/features/2026-07-17-regenerable-app-demo-video.md:22 (mention) — 375×800) + a11y snapshots, not video (`docs/tours.md`). The interaction-scripting

References:
- → docs/testing.md (link)

#### docs/triage.md

Title: "Triage" | 264 lines

Referenced by:
- CLAUDE.md:152 (mention) — | Triage pipeline design | `docs/triage.md` |
- docs/box-layout.md:110 (mention) — | `box/inbox/unhandled/` | Items with no clear destination after triage. Pre-existing catch-all; predates the formal tri
- docs/connectors.md:86 (mention) — - `intake-utils.ts` — `createOrAppendIntakeJob()` for creating reactor inbox-processing jobs (legacy reactor path, disti
- docs/design/README.md:28 (link) — triage pipeline → [`../triage.md`](../triage.md); calendar →
- docs/design/processing.md:36 (link) — [`../triage.md`](../triage.md). Possible outcomes for an item: archive it
- docs/design/representation.md:92 (link) — [`../triage.md`](../triage.md)). Best effort for the moment; more will be
- docs/design/teaching.md:22 (link) — rules at the destination ([`../triage.md`](../triage.md)).
- docs/design/trust.md:38 (link) — ([`../triage.md`](../triage.md)).
- docs/implemented-plans/mvp-implementation-guide.md:12 (mention) — > intake→triage→handle pipeline now, `../triage.md`), and the
- docs/implemented-plans/questions-end-to-end.md:33 (mention) — ask time). `docs/triage.md:131` already demands this: *"needing to carry both
- docs/knowledge-taxonomy.md:243 (mention) — - **Modify landmark `<triage-destination>`** — edit a directory's landmark to change pipeline routing rules (the cross-c
- docs/landmarks.md:33 (mention) — A landmark is pure YAML frontmatter (no body) with one or more **roles**. The `navigation` role carries the bookmark fie
- docs/plans/README.md:82 (mention) — `source-editor.md`. (`triage.md` later turned out to be fully built
- docs/plans/cli-restructure.md:92 (mention) — > **Namespace note (2026-05-20):** This group was originally proposed as `cb intake`, but the bare `cb intake` is now oc
- docs/plans/docs-reorg.md:341 (mention) — (triage.md, event-bus.md, knowledge-taxonomy.md, …) and ruled
- docs/reports/knowledge-audit-rerun-2026-07-03.md:36 (mention) — | `triage-confidence-levels` | new generated box doc documenting the `confident/probable/guess` enum | `generate-docs-tr
- docs/reports/user-stories-audit-2026-06-26.md:1658 (mention) — **Design alignment:** Matches triage.md §5 exactly, with all three confidence levels implemented as specified including 
- docs/unimplemented-plans/design-vision-superseded.md:11 (mention) — > categories → implemented as the triage pipeline (`../triage.md`). Whisper/
- ../issues/features/2026-07-15-admin-landmark-maintenance-owner.md:78 (mention) — role with a handler procedure (`docs/triage.md`). Could the admin landmark host
- ../issues/features/2026-07-20-clerk-import-dispatch-by-url.md:78 (mention) — (`docs/triage.md`) or a Drive-specific destination — the Drive connector may
- ../research/pai/README.md:60 (mention) — | Pipeline | Algorithm doctrine (`$PAI/PAI/ALGORITHM/v6.3.0.md`, 673 lines of prompt) | reactor + intake→triage→handle i

References:
- → docs/questions.md (mention)
- → docs/implemented-plans/questions-end-to-end.md (mention)

### docs/architecture/

#### docs/architecture/01-what-is-this.md

Title: "What Is This Thing?" | 66 lines

Referenced by:
- docs/architecture/CLAUDE.md:7 (mention) — The user-facing chapters themselves start with **`01-what-is-this.md`** and **`02-cards-and-memory.md`**.
- docs/design/identity.md:32 (mention) — multiple people (the household box of `../architecture/01-what-is-this.md` is
- docs/plans/design-reconciliation.md:35 (mention) — - **Reality/tension** — architecture/01-what-is-this.md:11: "This group chat is

#### docs/architecture/02-cards-and-memory.md

Title: "Cards and Memory" | 99 lines

Referenced by:
- docs/architecture/CLAUDE.md:7 (mention) — The user-facing chapters themselves start with **`01-what-is-this.md`** and **`02-cards-and-memory.md`**.
- docs/plans/design-reconciliation.md:306 (mention) — history" (02-cards-and-memory.md:96; also 02:72-77, 83-91). The code agrees

#### docs/architecture/CLAUDE.md

Title: "Architecture Docs" | 59 lines

Referenced by:
- docs/design/README.md:5 (link) — narrative lives in [`../architecture/`](../architecture/CLAUDE.md); the values
- docs/maintenance.md:124 (mention) — **When to run:** after editing `docs/architecture/*.md` text that drives image prompts, or after editing `.mmd` Mermaid 
- src/dev/CLAUDE.md:14 (mention) — | `generate-doc-images.ts` | Generates illustrations for `docs/architecture/` | `docs/architecture/CLAUDE.md` |

References:
- → docs/stack-decisions.md (mention)
- → docs/plans/design-reconciliation.md (mention)
- → docs/architecture/spirit.md (mention)
- → docs/architecture/01-what-is-this.md (mention)
- → docs/architecture/02-cards-and-memory.md (mention)
- → docs/architecture/family.md (mention)
- → docs/architecture/outline.md (mention)
- → docs/architecture/writing-style.md (mention)

#### docs/architecture/family.md

Title: "The Lund-Vega Family" | 95 lines

Referenced by:
- docs/architecture/CLAUDE.md:14 (mention) — - **`family.md`** — Character reference for the Lund-Vega family used in all examples. Detailed bios, relationships, hou
- docs/architecture/outline.md:5 (mention) — Supporting docs (not user-facing): `spirit.md` (values compass), `family.md` (character reference), `image-gen.yaml` (il
- docs/plans/source-available-release.md:66 (mention) — `docs/architecture/family.md` (Lund-Vega roster) are the sanctioned

#### docs/architecture/outline.md

Title: "Architecture Docs Outline" | 214 lines

Referenced by:
- docs/architecture/CLAUDE.md:15 (mention) — - **`outline.md`** — Working outline for the architecture docs. Section structure, story ideas, open design questions.
- docs/plans/design-reconciliation.md:20 (mention) — (01, 02, spirit.md, outline.md), the code as it is (triage pipeline, reactor,
- docs/plans/docs-reorg.md:80 (mention) — `architecture/outline.md` (75%-unwritten writing plan),
- docs/plans/publish-pages.md:45 (mention) — - **The aspiration this plan implements.** `docs/architecture/outline.md:166` (James's build journal story): *"The box t

References:
- → docs/architecture/spirit.md (mention)
- → docs/architecture/family.md (mention)

#### docs/architecture/spirit.md

Title: "The Spirit of the Thing" | 112 lines

Referenced by:
- docs/architecture/CLAUDE.md:5 (mention) — **Role:** this series is the onboarding narrative — the canonical human-facing "what is this." Engineering rationale liv
- docs/architecture/outline.md:5 (mention) — Supporting docs (not user-facing): `spirit.md` (values compass), `family.md` (character reference), `image-gen.yaml` (il
- docs/architecture/writing-style.md:63 (mention) — - **spirit**: Which values from spirit.md does this section express or depend on? (e.g., "inspectable history", "messy i
- docs/design/README.md:6 (link) — compass is [`../architecture/spirit.md`](../architecture/spirit.md) — **design
- docs/design/identity.md:7 (mention) — not an app you open (ruling 3; the feel is `../architecture/spirit.md`'s
- docs/implemented-plans/questions-end-to-end.md:369 (mention) — `docs/architecture/spirit.md:81` states the intent (*"at some point the box
- docs/plans/design-reconciliation.md:20 (mention) — (01, 02, spirit.md, outline.md), the code as it is (triage pipeline, reactor,
- docs/plans/docs-reorg.md:334 (mention) — `docs/design/` (8 topic files + README acknowledging spirit.md),

#### docs/architecture/writing-style.md

Title: "Writing Style Guide" | 95 lines

Referenced by:
- docs/architecture/CLAUDE.md:16 (mention) — - **`writing-style.md`** — Writing style guide. Tone, structure, common pitfalls, corrections from the editing process. 

References:
- → docs/architecture/spirit.md (mention)

### docs/design/

#### docs/design/durability-and-provenance.md

Title: "Durability and provenance" | 41 lines

Referenced by:
- docs/design/README.md:22 (link) — - [`durability-and-provenance.md`](durability-and-provenance.md) — committing makes it durable and real (with the chat-m
- docs/design/representation.md:42 (mention) — `durability-and-provenance.md`) preserves *where an idea came from* as it
- docs/design/trust.md:14 (mention) — commit history (`durability-and-provenance.md`).
- docs/implemented-plans/mvp-implementation-guide.md:15 (mention) — > `../design/durability-and-provenance.md`.

#### docs/design/extensibility.md

Title: "Extensibility — knowledge, not plugins" | 47 lines

Referenced by:
- docs/design/README.md:25 (link) — - [`extensibility.md`](extensibility.md) — knowledge over plugins (active plan; neither exists yet); composition over ne
- docs/unimplemented-plans/README.md:21 (mention) — | `design-vision-superseded.md` | Superseded by `../design/` (2026-07-04) — each section adjudicated in `../plans/design
- docs/unimplemented-plans/design-vision-superseded.md:8 (mention) — > `../design/extensibility.md` (ruling 18 — active plan, neither knowledge nor
- ../research/pai/README.md:101 (mention) — composition over plugins — `callback-box/docs/design/extensibility.md`); lightweight satisfaction-signal capture (Ian pr

References:
- → docs/activities-retrospective.md (link)
- → CLAUDE.md (mention)

#### docs/design/identity.md

Title: "Identity — what Callback Box is" | 47 lines

Referenced by:
- docs/design/README.md:19 (link) — - [`identity.md`](identity.md) — what this is: OS as the ambition, shared boxes (one sharing granularity each), web UI a
- docs/plans/publish-pages.md:46 (mention) — - **Identity ruling constraining the design.** `docs/design/identity.md:31-36`: *"A box has exactly **one granularity of
- docs/unimplemented-plans/README.md:21 (mention) — | `design-vision-superseded.md` | Superseded by `../design/` (2026-07-04) — each section adjudicated in `../plans/design
- docs/unimplemented-plans/design-vision-superseded.md:5 (mention) — > `../design/identity.md` (ruling 3); landmarks — the shipped role-bearing-card

References:
- → CLAUDE.md (mention)
- → docs/architecture/spirit.md (mention)
- → docs/plans/interface-as-cards.md (link)
- → docs/design/interaction-model.md (mention)
- → docs/architecture/01-what-is-this.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)

#### docs/design/interaction-model.md

Title: "Interaction model" | 44 lines

Referenced by:
- docs/design/README.md:20 (link) — - [`interaction-model.md`](interaction-model.md) — idle-by-default background engine AND definitely also a chatbot; proa
- docs/design/identity.md:23 (mention) — continuous presence (see `interaction-model.md`).
- docs/design/teaching.md:33 (mention) — (see `interaction-model.md` on proactivity) but not built.

References:
- → docs/scheduler.md (link)
- → docs/design/processing.md (mention)
- → src/core/reactor/DESIGN.md (mention)
- → docs/plans/interface-as-cards.md (link)
- → docs/connectors.md (link)
- → docs/calendar.md (link)

#### docs/design/processing.md

Title: "Processing — wakeup, the reactor, and the question loop" | 65 lines

Referenced by:
- docs/design/README.md:21 (link) — - [`processing.md`](processing.md) — what `cb wakeup` and the reactor actually do (verified against code), what "process
- docs/design/interaction-model.md:12 (mention) — and load-bearing for the engine (see `processing.md`).
- docs/glossary.md:34 (mention) — **wakeup cycle** — One full sync-and-process pass. `cb wakeup` preprocesses inbox items → housekeeping + on-wakeup scrip

References:
- → docs/scheduler.md (link)
- → docs/chat-schedules.md (link)
- → src/core/reactor/DESIGN.md (mention)
- → docs/triage.md (link)
- → docs/design/teaching.md (mention)

#### docs/design/README.md

Title: "docs/design/ — engineering rationale" | 40 lines

Referenced by:
- CLAUDE.md:133 (mention) — | Design rationale | `docs/design/README.md` |
- docs/implemented-plans/mvp-implementation-guide.md:4 (mention) — > that postdate it; current design rationale is `../design/README.md`. Known

References:
- → docs/stack-decisions.md (link)
- → docs/architecture/CLAUDE.md (link)
- → docs/architecture/spirit.md (link)
- → docs/plans/design-reconciliation.md (link)
- → docs/design/representation.md (link)
- → docs/design/identity.md (link)
- → docs/design/interaction-model.md (link)
- → docs/design/processing.md (link)
- → docs/design/durability-and-provenance.md (link)
- → docs/design/trust.md (link)
- → docs/design/teaching.md (link)
- → docs/design/extensibility.md (link)
- → docs/triage.md (link)
- → docs/calendar.md (link)
- → docs/scheduler.md (link)
- → docs/chat-schedules.md (link)
- → docs/implemented-plans/design-md-retired-sections.md (link)
- → docs/cards-as-markdown.md (mention)

#### docs/design/representation.md

Title: "Representation should mirror the shape of the idea" | 95 lines

Referenced by:
- docs/design/README.md:18 (link) — - [`representation.md`](representation.md) — the anchor principle: the representation mirrors the shape of the idea (Eng
- docs/unimplemented-plans/README.md:21 (mention) — | `design-vision-superseded.md` | Superseded by `../design/` (2026-07-04) — each section adjudicated in `../plans/design

References:
- → docs/design/durability-and-provenance.md (mention)
- → docs/migrations.md (link)
- → docs/plans/interface-as-cards.md (link)
- → docs/landmarks.md (link)
- → docs/triage.md (link)

#### docs/design/teaching.md

Title: "Teaching — how the system learns what to do" | 40 lines

Referenced by:
- docs/design/README.md:24 (link) — - [`teaching.md`](teaching.md) — the teaching relationship and what shipped of it (retro, personality/guide cards, brief
- docs/design/processing.md:41 (mention) — personality/guide cards (see `teaching.md`) — not from a hardcoded pipeline.

References:
- → docs/implemented-plans/box-retrospectives.md (mention)
- → docs/triage.md (link)
- → docs/design/interaction-model.md (mention)

#### docs/design/trust.md

Title: "Trust and authorization" | 45 lines

Referenced by:
- docs/design/README.md:23 (link) — - [`trust.md`](trust.md) — question → confirmation → automatic; paperwork lives on as schema process-fields; the three c
- docs/implemented-plans/design-md-retired-sections.md:49 (mention) — process-fields; see `../design/trust.md`.*

References:
- → docs/design/durability-and-provenance.md (mention)
- → docs/triage.md (link)
- → docs/glossary.md (mention)

### docs/implemented-plans/

#### docs/implemented-plans/agent-applied-migrations.md **[ORPHAN]**

Title: "Agent-applied migrations (via procedure checklists)" | 544 lines

References:
- → docs/procedure-implementation.md (mention)
- → docs/migrations.md (mention)
- → docs/testing.md (mention)
- → code-style.md (mention)

#### docs/implemented-plans/app-wide-csp.md

Title: "App-wide Content-Security-Policy" | 443 lines

Referenced by:
- docs/scheduled/csp-violation-review.md:93 (mention) — `docs/implemented-plans/app-wide-csp.md` (the design rationale, including why the

References:
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/content-security-policy.md (mention)

#### docs/implemented-plans/architectural-review-followups.md

Title: "Architectural Review Follow-ups — Plan" | 383 lines

Referenced by:
- ../issues/closed/bugs/2026-07-05-connector-transient-state-rmw.md:10 (mention) — `callback-box/docs/implemented-plans/architectural-review-followups.md` Track 1.
- ../issues/closed/bugs/2026-07-05-git-commit-race-audit.md:12 (mention) — deliberate). Plan: `callback-box/docs/implemented-plans/architectural-review-followups.md`
- ../issues/closed/bugs/2026-07-06-parallel-agent-git-commit-race.md:10 (mention) — `callback-box/docs/implemented-plans/architectural-review-followups.md` swept ~31
- ../issues/closed/code-quality/2026-07-06-phase2-deferred-boundaries.md:11 (mention) — 5c93f7a9. Plan: `callback-box/docs/implemented-plans/architectural-review-followups.md`

References:
- → ../issues/closed/bugs/2026-07-09-flaky-child-output-log-doctest.md (link)
- → docs/engineering-principles.md (mention)
- → docs/chat-session-lifecycle.md (mention)

#### docs/implemented-plans/architectural-review.md

Title: "Architectural Review — Findings and Improvement Plan" | 1239 lines

Referenced by:
- ../issues/closed/bugs/2026-07-05-connector-transient-state-rmw.md:23 (mention) — `docs/implemented-plans/architectural-review.md`.
- ../issues/closed/bugs/2026-07-05-git-commit-race-audit.md:15 (mention) — Deferred from Track H (plan `docs/implemented-plans/architectural-review.md`): a card
- ../issues/closed/code-quality/2026-07-06-phase2-deferred-boundaries.md:15 (mention) — (`callback-box/docs/implemented-plans/architectural-review.md`, Tracks P.2/D.2):
- ../issues/closed/decisions/2026-07-06-architectural-review-open-decisions.md:15 (mention) — (`docs/implemented-plans/architectural-review.md`). All are safe in their current

References:
- → ../issues/closed/decisions/2026-07-06-architectural-review-open-decisions.md (link)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/composer-input-machine.md (mention)
- → frontend.md (mention)
- → docs/chat-session-lifecycle.md (mention)
- → docs/testing.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/landmarks.md (mention)

#### docs/implemented-plans/architectural-review.review.md **[ORPHAN]**

Title: "Plan Engineering Review — architectural-review (codex cross-model pass)" | 99 lines

References:
- → docs/testing.md (mention)

#### docs/implemented-plans/attach-directories-superseded.md

Title: "Implementation spec: `.attach/` directories" | 346 lines

Referenced by:
- docs/plans/README.md:106 (mention) — `attach-directories-superseded.md`), and

References:
- → docs/asset-manifests.md (mention)
- → docs/implemented-plans/cards-as-markdown-rfc.md (link)
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)

#### docs/implemented-plans/box-migration.subplan.md

Title: "Box migration to frontmatter (subplan of remove-cardworks-package)" | 282 lines

Referenced by:
- docs/plans/source-available-release.md:193 (mention) — `docs/implemented-plans/box-migration.subplan.md:162`; domain in source comments

References:
- → docs/implemented-plans/remove-cardworks-package.md (mention)
- → docs/implemented-plans/remove-cardworks-package.md (link)
- → docs/migrations.md (mention)
- → docs/server-operations.md (mention)

#### docs/implemented-plans/box-retrospectives.md

Title: "Box Retrospectives" | 433 lines

Referenced by:
- docs/design/teaching.md:19 (mention) — cards (`../implemented-plans/box-retrospectives.md`).
- docs/glossary.md:46 (mention) — **retrospective** — The `process-retrospective` procedure (driven by `cb retro`): mines recent chat sessions for what th
- docs/implemented-plans/questions-end-to-end.md:21 (mention) — belief (the evidence model of `docs/implemented-plans/box-retrospectives.md`:
- docs/questions.md:32 (mention) — `docs/implemented-plans/box-retrospectives.md`: inferred beliefs cap at
- ../issues/features/2026-07-09-memory-gardener-consolidation-loop.md:26 (mention) — - **Retro** (`src/core/retro/`, `docs/implemented-plans/box-retrospectives.md`) —
- ../research/openclaw-hermes/deep-cbx-retro.md:9 (mention) — `callback-box/docs/implemented-plans/box-retrospectives.md` (the original plan;

References:
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)
- → docs/maintenance.md (mention)
- → src/dev/CLAUDE.md (mention)

#### docs/implemented-plans/box-schema-reload.md **[ORPHAN]**

Title: "Box-local schema reload — design & implementation plan" | 354 lines

References:
- → docs/adding-schemas.md (mention)

#### docs/implemented-plans/box-search.md

Title: "Box search (`cb search`) and the global `contains` field" | 567 lines

Referenced by:
- docs/implemented-plans/semantic-search.md:12 (mention) — (`docs/implemented-plans/box-search.md` § NOT in scope), which pre-committed
- ../issues/closed/features/2026-05-11-box-search.md:9 (mention) — `docs/implemented-plans/box-search.md`), as the body already records.

References:
- → code-style.md (mention)
- → docs/adding-schemas.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/boxes-as-packages-v2.md

Title: "Boxes as Packages v2 — callback-box as a library" | 725 lines

Referenced by:
- README.md:25 (link) — live yet — see [`docs/implemented-plans/boxes-as-packages-v2.md`](docs/implemented-plans/boxes-as-packages-v2.md)
- deploy/README.md:89 (mention) — `docs/implemented-plans/boxes-as-packages-v2.md`'s "Post-cutover state" section); a fresh
- docs/adding-a-box.md:4 (link) — see "Serving" in [`docs/implemented-plans/boxes-as-packages-v2.md`](plans/boxes-as-packages-v2.md)
- docs/box-layout.md:15 (mention) — repository" in `docs/implemented-plans/boxes-as-packages-v2.md` for the full design.
- docs/design/identity.md:45 (mention) — (`../implemented-plans/boxes-as-packages-v2.md`, including the
- docs/implemented-plans/remove-box-shape-v1.md:80 (mention) — `shapeNotes`, H4 check-off in `boxes-as-packages-v2.md`.
- docs/implemented-plans/remove-box-shape-v1.review.md:99 (mention) — `boxes-as-packages-v2.md:532-538` prior-art citation IS accurate.)
- docs/plans/design-reconciliation.md:23 (mention) — `docs/implemented-plans/boxes-as-packages-v2.md`,
- docs/plans/docs-reorg.md:51 (mention) — - **At least 5 plans are done-but-never-moved**: `boxes-as-packages-v2.md`
- docs/plans/source-available-release.md:387 (mention) — concerns (`docs/implemented-plans/boxes-as-packages-v2.md` is the roadmap). Doing
- docs/server-operations.md:38 (mention) — | Box manifest (which boxes the scheduler still sees — retirement deferred, see `docs/implemented-plans/boxes-as-package
- docs/testing.md:303 (mention) — **Directory structure:** `cb init` now scaffolds the v2 package layout by default (package.json/tsconfig/src/ plus an op
- docs/unimplemented-plans/README.md:16 (mention) — | `boxes-as-packages-v1-superseded.md` | Superseded by `../implemented-plans/boxes-as-packages-v2.md` (2026-07-03), whic
- docs/unimplemented-plans/boxes-as-packages-v1-superseded.md:3 (mention) — **Status:** SUPERSEDED by `docs/implemented-plans/boxes-as-packages-v2.md` (2026-07-03), which re-derives
- ../issues/decisions/2026-07-04-box-registry-manifests.md:33 (mention) — `callback-box/docs/implemented-plans/boxes-as-packages-v2.md`.
- ../issues/features/2026-07-19-installation-remaining-work.md:51 (mention) — (Roadmap: `callback-box/docs/implemented-plans/boxes-as-packages-v2.md`
- ../research/openclaw-hermes/deep-installation.md:200 (mention) — | 7 | **npm publish** — the gate to a real five-minute start (`pnpm dlx`), and the prerequisite for any installer script

References:
- → docs/unimplemented-plans/boxes-as-packages-v1-superseded.md (mention)
- → docs/box-layout.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/migrations.md (mention)
- → deploy/README.md (mention)
- → docs/implemented-plans/remove-box-shape-v1.md (mention)
- → README.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/server-operations.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (mention)

#### docs/implemented-plans/canvas-loop-figure.md

Title: "canvas-loop figure runtime" | 300 lines

Referenced by:
- docs/implemented-plans/figure-card-type.md:14 (mention) — > `docs/implemented-plans/canvas-loop-figure.md`; the `p5js|three|d3` enumerations below

References:
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → docs/implemented-plans/figure-card-type.md (mention)

#### docs/implemented-plans/capture-mode.md

Title: "Capture mode — unifying capture into the input" | 670 lines

Referenced by:
- docs/box-layout.md:92 (mention) — `docs/implemented-plans/capture-mode.md`; agent duties:
- docs/plans/cli-restructure.md:9 (mention) — **2026-07 update:** the capture-processing commands this plan discusses renaming/grouping (`cb transcribe-captures`, `cb
- docs/plans/input-widget.md:9 (mention) — (`docs/implemented-plans/capture-mode.md`). The remaining open section
- docs/plans/input-widget.md:535 (link) — [../implemented-plans/capture-mode.md](../implemented-plans/capture-mode.md)
- docs/plans/ios-native-capture-mode.md:36 (mention) — - Shipped precedent: `docs/implemented-plans/capture-mode.md` owns the capture
- docs/plans/ios-native-capture-mode.review.md:72 (mention) — - Doc references exist: `docs/implemented-plans/capture-mode.md`,
- docs/unimplemented-plans/capture-pipeline-redesign.md:3 (link) — **Superseded by [../implemented-plans/capture-mode.md](../implemented-plans/capture-mode.md)** — that plan retired the `
- ../issues/closed/bugs/2026-07-07-capture-pipeline-retries-broken-capture-forever.md:53 (mention) — capture-mode work (`callback-box/docs/implemented-plans/capture-mode.md`):

References:
- → docs/plans/input-widget.md (link)
- → docs/unimplemented-plans/capture-pipeline-redesign.md (link)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → docs/implemented-plans/input-extraction.md (mention)
- → CLAUDE.md (mention)
- → docs/migrations.md (mention)
- → src/services/CLAUDE.md (mention)

#### docs/implemented-plans/card-view-widgets.md

Title: "Card-aware widgets for box-authored views" | 662 lines

Referenced by:
- ../issues/closed/features/2026-06-29-card-aware-view-widgets.md:9 (mention) — design in `callback-box/docs/implemented-plans/card-view-widgets.md` (marked

References:
- → code-style.md (mention)
- → frontend.md (mention)
- → CLAUDE.md (mention)
- → docs/knowledge-taxonomy.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/cards-as-markdown-rfc.md

Title: "RFC: Cards as Markdown + YAML Frontmatter" | 2556 lines

Referenced by:
- CLAUDE.md:42 (mention) — **Validation**: Cards validate on load; `cb validate` checks all cards, a file list, or `--staged`. `cb init` installs p
- docs/card-validation.md:26 (mention) — Format reference: `docs/cards-as-markdown.md`; design history and migration phases: `docs/implemented-plans/cards-as-mar
- docs/cards-as-markdown.md:5 (mention) — This is the living reference for the card *file format* — filenames, frontmatter/body split, attachments, and refs. For 
- docs/implemented-plans/attach-directories-superseded.md:5 (link) — **Status:** Draft. Phase 1 of the [cards-as-markdown RFC](./cards-as-markdown-rfc.md), but designed to ship independentl
- docs/implemented-plans/remove-cardworks-and-xml.md:117 (mention) — production migration"* (`docs/implemented-plans/cards-as-markdown-rfc.md`). **Reuse:** the
- docs/migrations.md:285 (mention) — - `docs/cards-as-markdown.md` — living reference for the YAML-frontmatter format these migrators target; `docs/implement
- docs/stack-decisions.md:805 (mention) — > **Superseded in practice (2026-05).** The frontend no longer uses react-markdown / remark / rehype — it renders via Ma

References:
- → docs/cards-as-markdown.md (mention)
- → docs/migrations.md (mention)
- → README.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/chat-composer-rerender.md **[ORPHAN]**

Title: "Plan: stop composer keystrokes from re-rendering chat history" | 154 lines

References:
- → docs/chat-scroll-testing.md (mention)

#### docs/implemented-plans/chat-scroll-redesign.md

Title: "Chat scroll redesign: remove virtualization, single scroll controller" | 492 lines

Referenced by:
- docs/implemented-plans/chat-stream-finalize-unify.md:56 (mention) — - Precedent: `docs/implemented-plans/chat-scroll-redesign.md` (just shipped) —
- src/frontend/src/components/chat/CLAUDE.md:8 (mention) — without revisiting `docs/implemented-plans/chat-scroll-redesign.md`.

References:
- → docs/chat-scroll-testing.md (mention)
- → frontend.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/chat-stream-finalize-unify.md

Title: "Chat streaming/finalize unification: one stably-keyed assistant turn" | 379 lines

Referenced by:
- src/frontend/src/components/chat/CLAUDE.md:46 (mention) — (`docs/implemented-plans/chat-stream-finalize-unify.md`). `liveTurnId` is held

References:
- → frontend.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)
- → docs/implemented-plans/chat-scroll-redesign.md (mention)
- → CLAUDE.md (mention)
- → src/frontend/src/components/chat/CLAUDE.md (mention)
- → docs/chat-scroll-testing.md (mention)

#### docs/implemented-plans/clerk-contract-and-import-boundary.md

Title: "Clerk↔Server Contract + Frontend Import Boundary" | 181 lines

Referenced by:
- ../issues/closed/code-quality/2026-07-12-frontend-local-helper-consolidation-into-shared.md:5 (mention) — discovered-in: worktree-architectural-review — implementing the frontend import-boundary (clerk-contract-and-import-boun
- ../issues/closed/decisions/2026-07-06-architectural-review-open-decisions.md:71 (mention) — `callback-box/docs/implemented-plans/clerk-contract-and-import-boundary.md`.

References:
- → docs/module-map.md (mention)

#### docs/implemented-plans/clerk-webpage-capture.md

Title: "Web-page commentary capture" | 561 lines

Referenced by:
- docs/implemented-plans/webpage-card-and-commentary.md:30 (link) — [`clerk-webpage-capture.md`](./clerk-webpage-capture.md) (which is otherwise

References:
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/landmarks.md (mention)

#### docs/implemented-plans/companion-pane-card-activity.md **[ORPHAN]**

Title: "Companion-pane card activity awareness for chat" | 366 lines

References:
- → code-style.md (mention)

#### docs/implemented-plans/courseware-lesson-plan.md **[ORPHAN]**

Title: "Courseware: the `lesson-plan` card" | 345 lines

References:
- → README.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/courseware-phase1.md

Title: "Courseware Phase 1 — the course: cards, rules, and the authoring skill" | 512 lines

Referenced by:
- docs/plans/docs-reorg.md:53 (mention) — `courseware-phase1.md` ("built and on `main`"), `web-page-commentary.md`

References:
- → CLAUDE.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/design-md-retired-sections.md

Title: "design.md — retired sections (history)" | 131 lines

Referenced by:
- docs/design/README.md:34 (link) — Moved verbatim to [`../implemented-plans/design-md-retired-sections.md`](../implemented-plans/design-md-retired-sections

References:
- → docs/plans/design-reconciliation.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/asset-manifests.md (mention)
- → docs/design/trust.md (mention)

#### docs/implemented-plans/external-url-validation.md

Title: "External URL validation (`cb validate --urls`)" | 78 lines

Referenced by:
- docs/card-validation.md:24 (mention) — `docs/implemented-plans/external-url-validation.md`.

#### docs/implemented-plans/extfile-card.md **[ORPHAN]**

Title: "`extfile` Card — an In-Box Pointer to a Live External File" | 714 lines

References:
- → CLAUDE.md (mention)
- → code-style.md (mention)
- → docs/plans/box-commentary-surface.md (mention)

#### docs/implemented-plans/figure-card-type.md

Title: "Figure card type" | 429 lines

Referenced by:
- docs/implemented-plans/canvas-loop-figure.md:31 (mention) — `docs/implemented-plans/figure-card-type.md`. This plan adds a runtime to
- docs/reports/user-stories-audit-2026-06-26.md:4230 (mention) — 7. **Documentation**: Complete plan documented in `callback-box/docs/implemented-plans/figure-card-type.md` (marked as i

References:
- → docs/implemented-plans/canvas-loop-figure.md (mention)
- → code-style.md (mention)
- → frontend.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/gmail-gc-unlabeled.md

Title: "Plan: Garbage-collect unlabeled Gmail messages" | 197 lines

Referenced by:
- ../issues/closed/features/2026-04-27-gmail-sync-improvements.md:7 (mention) — **Closed:** Fully implemented: uncapped Gmail-id dedup checked before fetch, no date filters, incremental sync via the h

References:
- → docs/connectors.md (mention)

#### docs/implemented-plans/hub-healthz-box-aggregation.md

Title: "Hub `/healthz` reflects box-child health" | 454 lines

Referenced by:
- ../issues/code-quality/2026-07-19-hub-startall-blocks-listen.md:14 (link) — ([design](../../callback-box/docs/implemented-plans/hub-healthz-box-aggregation.md)) worked
- ../issues/docs-and-chores/2026-07-19-tech-talk-box-not-in-hub-config.md:6 (link) — ([design](../../callback-box/docs/implemented-plans/hub-healthz-box-aggregation.md)):

References:
- → docs/health-checks.md (mention)
- → docs/engineering-principles.md (mention)
- → deploy/README.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/input-extraction.md

Title: "Input extraction — isolating the composer behind the Emission/Input/Target API" | 426 lines

Referenced by:
- docs/implemented-plans/capture-mode.md:42 (mention) — (`docs/implemented-plans/input-extraction.md`) for how composer work
- docs/plans/input-widget.md:7 (mention) — (`docs/implemented-plans/input-extraction.md`), and the capture-mode
- docs/plans/ios-input-plane-parity.md:65 (mention) — - Shipped precedent: `docs/implemented-plans/input-extraction.md` establishes

References:
- → docs/plans/input-widget.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/input-extraction.review.md **[ORPHAN]**

Title: "Plan Engineering Review — input-extraction (codex cross-model pass)" | 86 lines

No references in or out.

#### docs/implemented-plans/ios-per-box-device-lock.md

Title: "iOS per-box device lock" | 406 lines

Referenced by:
- docs/mobile-parity.md:34 (mention) — | Per-box local device lock | done (`docs/implemented-plans/ios-per-box-device-lock.md`; physical-device acceptance rema
- ../issues/features/2026-07-19-per-box-lock-native-auth.md:4 (mention) — design: ../../callback-box/docs/implemented-plans/ios-per-box-device-lock.md
- ../issues/features/2026-07-19-per-box-lock-native-auth.md:20 (link) — [`ios-per-box-device-lock.md`](../../callback-box/docs/implemented-plans/ios-per-box-device-lock.md).
- ../issues/features/2026-07-20-android-per-box-device-lock-parity.md:30 (link) — [iOS design](../../callback-box/docs/implemented-plans/ios-per-box-device-lock.md): this is

References:
- → docs/engineering-principles.md (mention)
- → CLAUDE.md (mention)
- → ../ios-app/CLAUDE.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)
- → ../issues/features/2026-07-19-per-box-lock-native-auth.md (mention)
- → docs/implemented-plans/mobile-parity-sync.md (mention)
- → docs/mobile-parity.md (mention)
- → docs/mobile-contract.md (mention)

#### docs/implemented-plans/job-xml-purge.subplan.md

Title: "Job-Card XML Purge (subplan)" | 220 lines

Referenced by:
- docs/plans/prompt-surface-ia-review.md:544 (mention) — scrub, and is split out to **`job-xml-purge.subplan.md`** — executed in its own

References:
- → docs/plans/prompt-surface-ia-review.md (mention)
- → code-style.md (mention)

#### docs/implemented-plans/lightbox-mobile-gestures.md

Title: "Lightbox mobile gestures: double-tap zoom + pan, pinch, swipe-to-dismiss" | 294 lines

Referenced by:
- ../issues/features/2026-07-20-lightbox-mobile-gestures.md:7 (mention) — design: ../../callback-box/docs/implemented-plans/lightbox-mobile-gestures.md

#### docs/implemented-plans/link-validation-fix.md

Title: "Markdown link validation — turn it on, make it correct, close the commit-time hole" | 652 lines

Referenced by:
- docs/plans/docs-reorg.md:186 (mention) — (`implemented-plans/link-validation-fix.md`) but is itself orphaned and

References:
- → CLAUDE.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)
- → /store/foo/bar.md (link) **[BROKEN]**

#### docs/implemented-plans/local-password-auth.md

Title: "Local password auth, default-on" | 704 lines

Referenced by:
- docs/implemented-plans/local-password-auth.review.md:3 (mention) — Adversarial review of `local-password-auth.md` by OpenAI Codex
- docs/todo-security.md:8 (mention) — `docs/implemented-plans/local-password-auth.md`). A box requires a logged-in identity unless
- ../issues/closed/features/2026-07-16-local-password-auth-default-on.md:3 (mention) — design: ../../callback-box/docs/implemented-plans/local-password-auth.md
- ../issues/code-quality/2026-07-19-browse-agent-token-argv-env-exposure.md:37 (mention) — `../../callback-box/docs/implemented-plans/local-password-auth.md`.

References:
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → frontend.md (mention)
- → docs/developer-install.md (mention)
- → docs/docker-install.md (mention)
- → docs/agent-install.md (mention)
- → deploy/README.md (mention)
- → docs/todo-security.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/local-password-auth.review.md **[ORPHAN]**

Title: "Cross-model review — local-password-auth (Codex, 2026-07-19)" | 81 lines

References:
- → docs/implemented-plans/local-password-auth.md (mention)

#### docs/implemented-plans/markdoc-format-investigation.md

Title: "Markdoc.format Investigation" | 447 lines

Referenced by:
- docs/implemented-plans/markdoc-tags-plan.md:396 (mention) — `docs/implemented-plans/markdoc-format-investigation.md`; the catalogue covers ~70
- docs/implemented-plans/remove-cardworks-and-xml.md:157 (mention) — `docs/implemented-plans/markdoc-format-investigation.md:5`: *"safe for
- docs/plans/README.md:77 (mention) — (+ `.review.md`, `.review-adapted-trial.md`), `markdoc-format-investigation.md`,

#### docs/implemented-plans/markdoc-tags-plan.md

Title: "Markdoc Tags — Design" | 493 lines

Referenced by:
- docs/implemented-plans/markdoc-tags-plan.review-adapted-trial.md:72 (mention) — **Location in plan:** `docs/implemented-plans/markdoc-tags-plan.md:146-150` ("Compile-briefing transition")
- docs/implemented-plans/markdoc-tags-plan.review.md:3 (mention) — Review of `markdoc-tags-plan.md` following the `cb-plan-review` skill's
- docs/implemented-plans/remove-cardworks-and-xml.md:106 (mention) — `docs/implemented-plans/markdoc-tags-plan.md`. Track 4 (ref tracking
- docs/implemented-plans/shared-frontend-backend-code.subplan.md:3 (mention) — A subplan of `markdoc-tags-plan.md`. The Markdoc work needs the same
- docs/plans/README.md:76 (mention) — - → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-plan.md`

References:
- → docs/implemented-plans/shared-frontend-backend-code.subplan.md (link)
- → CLAUDE.md (mention)
- → docs/implemented-plans/markdoc-format-investigation.md (mention)

#### docs/implemented-plans/markdoc-tags-plan.review-adapted-trial.md **[ORPHAN]**

Title: "Plan Engineering Review — Markdoc Tags Design" | 129 lines

References:
- → CLAUDE.md (mention)
- → code-style.md (mention)
- → docs/implemented-plans/markdoc-tags-plan.md (mention)

#### docs/implemented-plans/markdoc-tags-plan.review.md **[ORPHAN]**

Title: "Plan Engineering Review — Markdoc Tags Design" | 505 lines

References:
- → docs/implemented-plans/markdoc-tags-plan.md (mention)
- → CLAUDE.md (mention)
- → code-style.md (mention)

#### docs/implemented-plans/mobile-parity-sync.md

Title: "Mobile parity & contract-sync discipline" | 294 lines

Referenced by:
- docs/implemented-plans/ios-per-box-device-lock.md:42 (mention) — (`docs/implemented-plans/mobile-parity-sync.md:115-134`). This feature changes
- docs/maintenance.md:27 (mention) — | Mobile parity audit | agent procedure (prompt in `docs/implemented-plans/mobile-parity-sync.md` §6) | After a burst of
- docs/mobile-contract.md:14 (mention) — contract change — is defined in `docs/implemented-plans/mobile-parity-sync.md`.
- docs/mobile-parity.md:4 (mention) — Maintained under the process in `docs/implemented-plans/mobile-parity-sync.md`; wire-level
- docs/plans/android-companion-app.md:576 (mention) — **What.** Consume the shared golden fixtures the parallel `docs/implemented-plans/mobile-parity-sync.md`

References:
- → docs/plans/android-companion-app.md (mention)
- → docs/engineering-principles.md (mention)
- → CLAUDE.md (mention)
- → docs/mobile-contract.md (mention)
- → docs/mobile-parity.md (mention)
- → docs/maintenance.md (mention)

#### docs/implemented-plans/mobile-token-handshake.md

Title: "Mobile device token: replace `?mobileToken=` with a box-scoped session cookie" | 506 lines

Referenced by:
- docs/mobile-contract.md:531 (mention) — `docs/implemented-plans/mobile-token-handshake.md`.
- ../issues/closed/bugs/2026-07-17-mobile-token-in-url-query.md:10 (mention) — `../../../callback-box/docs/implemented-plans/mobile-token-handshake.md`. The query-param carrier is gone: the
- ../issues/closed/code-quality/2026-07-17-mobile-auth-parser-plumbing-cleanups.md:12 (mention) — `../../../callback-box/docs/implemented-plans/mobile-token-handshake.md`; the single resolver every mobile
- ../issues/code-quality/2026-07-19-mobile-device-token-no-expiry.md:12 (mention) — The cb_mobile cookie work (`../../callback-box/docs/implemented-plans/mobile-token-handshake.md`) removed
- ../issues/decisions/2026-07-19-boxes-share-one-origin.md:28 (mention) — The mobile-token work (`docs/implemented-plans/mobile-token-handshake.md`) ran into this and deliberately

References:
- → docs/engineering-principles.md (mention)
- → docs/mobile-contract.md (mention)
- → src/hub/CLAUDE.md (mention)
- → docs/plans/android-companion-app.md (mention)
- → CLAUDE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/mvp-implementation-guide.md

Title: "Callback Box: Implementation Guide (MVP era)" | 1029 lines

Referenced by:
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode.md`, `stack-de
- docs/plans/docs-reorg.md:335 (mention) — implementation.md → implemented-plans/mvp-implementation-guide.md
- ../issues/closed/code-quality/2026-07-04-git-replay-testing.md:15 (mention) — (`implemented-plans/mvp-implementation-guide.md`).

References:
- → docs/plans/design-reconciliation.md (mention)
- → CLAUDE.md (mention)
- → docs/design/README.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/scheduler.md (mention)
- → docs/triage.md (mention)
- → docs/design/durability-and-provenance.md (mention)
- → docs/chat-schedules.md (mention)
- → docs/connectors.md (link)
- → docs/adding-schemas.md (link)
- → docs/calendar.md (mention)

#### docs/implemented-plans/named-places.md **[ORPHAN]**

Title: "Named Places (`place` cards + `cb location mark`)" | 465 lines

References:
- → docs/implemented-plans/user-location.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)

#### docs/implemented-plans/nav-card.md

Title: "Nav as a card — first interface-as-cards slice" | 107 lines

Referenced by:
- docs/plans/interface-as-cards.md:289 (mention) — | Nav | curated `refs` card + per-entry overrides — **shipped 2026-07** (`docs/implemented-plans/nav-card.md`; nav form/

References:
- → docs/plans/interface-as-cards.md (mention)

#### docs/implemented-plans/normalize-chat-links.md **[ORPHAN]**

Title: "Normalize chat/card links" | 690 lines

References:
- → code-style.md (mention)
- → docs/testing.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/open-chat-from-card.md **[ORPHAN]**

Title: "Open chat from a card browse page" | 339 lines

References:
- → code-style.md (mention)
- → frontend.md (mention)
- → docs/landmarks.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/procedure-validation-completion.md **[ORPHAN]**

Title: "Procedure validation completion (D5)" | 440 lines

References:
- → docs/procedure-implementation.md (mention)
- → CLAUDE.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/questions-end-to-end.md

Title: "Questions, end-to-end" | 660 lines

Referenced by:
- docs/migrations.md:200 (mention) — `question-lifecycle` (`scripts/migrate/question-lifecycle-run.ts`, pure transform in `scripts/migrate/question-lifecycle
- docs/questions.md:6 (mention) — Design and implementation history: `docs/implemented-plans/questions-end-to-end.md`.
- docs/triage.md:133 (mention) — The rule-update-plus-placement evolution landed: `learning:` (`docs/questions.md`, `docs/implemented-plans/questions-end
- ../issues/closed/features/2026-05-19-questions-aging-policy.md:8 (mention) — aging sweep, Track D of `docs/implemented-plans/questions-end-to-end.md`) — nudge once
- ../issues/closed/features/2026-06-09-in-chat-interactive-questions.md:9 (mention) — `docs/implemented-plans/questions-end-to-end.md` (see its "NOT in scope"): synchronous
- ../issues/closed/features/2026-06-26-questions-end-to-end-d1.md:4 (mention) — design: ../../../callback-box/docs/implemented-plans/questions-end-to-end.md
- ../issues/docs-and-chores/2026-07-19-questions-end-to-end-followups.md:4 (mention) — design: ../../callback-box/docs/implemented-plans/questions-end-to-end.md

References:
- → docs/implemented-plans/box-retrospectives.md (mention)
- → docs/triage.md (mention)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/migrations.md (mention)
- → docs/architecture/spirit.md (mention)
- → docs/questions.md (mention)
- → docs/reports/user-stories-audit-2026-06-26.md (mention)

#### docs/implemented-plans/refresh-clerk.md **[ORPHAN]**

Title: "Refresh callback-clerk" | 441 lines

References:
- → CLAUDE.md (mention)
- → code-style.md (mention)

#### docs/implemented-plans/refresh-maps-convergence.md

Title: "refresh-maps convergence" | 382 lines

Referenced by:
- docs/implemented-plans/refresh-maps-convergence.review.md:12 (link) — Adversarial review of [`refresh-maps-convergence.md`](refresh-maps-convergence.md),
- ../issues/closed/bugs/2026-07-15-refresh-maps-wedges-on-unresolvable-dir.md:81 (link) — [`callback-box/docs/plans/refresh-maps-convergence.md`](../../../callback-box/docs/plans/refresh-maps-convergence.md).
- ../issues/code-quality/2026-07-19-refresh-maps-max-turns-throughput.md:16 (link) — [`docs/plans/refresh-maps-convergence.md`](../../callback-box/docs/plans/refresh-maps-convergence.md)).

References:
- → docs/engineering-principles.md (link)
- → code-style.md (link)
- → CLAUDE.md (link)
- → docs/testing.md (mention)

#### docs/implemented-plans/refresh-maps-convergence.review.md **[ORPHAN]**

Title: "Plan Engineering Review — refresh-maps convergence" | 379 lines

References:
- → docs/implemented-plans/refresh-maps-convergence.md (link)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/remove-box-shape-v1.core-review.md **[ORPHAN]**

Title: "1a+1b core review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)" | 57 lines

No references in or out.

#### docs/implemented-plans/remove-box-shape-v1.final-review.md **[ORPHAN]**

Title: "Final review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)" | 49 lines

No references in or out.

#### docs/implemented-plans/remove-box-shape-v1.md

Title: "Remove box-shape v1 (legacy) + de-template box skills" | 358 lines

Referenced by:
- docs/implemented-plans/boxes-as-packages-v2.md:495 (mention) — resolve-hook machinery are now removed (`docs/implemented-plans/remove-box-shape-v1.md`); see the rewritten
- docs/implemented-plans/remove-box-shape-v1.review.md:3 (mention) — Cross-model review of the draft `remove-box-shape-v1.md`. Findings verbatim
- docs/migrations.md:210 (mention) — `docs/implemented-plans/remove-box-shape-v1.md`).
- docs/testing.md:318 (mention) — The existing scenarios in the table above (`intake-basic`, `tick-basic`, `tick-chain`) predate this and are still flat o
- ../issues/code-quality/2026-07-11-v1-removal-residue-src-comments-and-scenario-boxes.md:7 (mention) — Fallout from the box-shape v1 removal (`docs/plans/remove-box-shape-v1.md`,

References:
- → docs/implemented-plans/remove-box-shape-v1.review.md (mention)
- → docs/box-layout.md (mention)
- → docs/migrations.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → docs/adding-a-box.md (mention)

#### docs/implemented-plans/remove-box-shape-v1.review.md

Title: "Plan review — remove-box-shape-v1 (Codex, gpt-5.6-sol, 2026-07-11)" | 121 lines

Referenced by:
- docs/implemented-plans/remove-box-shape-v1.md:11 (mention) — > superseded by the cross-model review (`remove-box-shape-v1.review.md`); the

References:
- → docs/implemented-plans/remove-box-shape-v1.md (mention)
- → docs/migrations.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)

#### docs/implemented-plans/remove-cardworks-and-xml.md

Title: "Remove cardworks and all XML from callback-box" | 670 lines

Referenced by:
- docs/implemented-plans/remove-cardworks-deletion.md:103 (mention) — - **The schema-migration precedent** (`remove-cardworks-and-xml.md`):
- docs/implemented-plans/remove-cardworks-package.md:12 (mention) — This is the follow-up round to `remove-cardworks-and-xml.md` (the schema

References:
- → code-style.md (mention)
- → docs/implemented-plans/markdoc-tags-plan.md (mention)
- → docs/implemented-plans/cards-as-markdown-rfc.md (mention)
- → docs/implemented-plans/markdoc-format-investigation.md (mention)
- → CLAUDE.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/adding-schemas.md (mention)

#### docs/implemented-plans/remove-cardworks-deletion.md **[ORPHAN]**

Title: "Remove cardworks — final deletion phase" | 621 lines

References:
- → docs/implemented-plans/remove-cardworks-package.md (mention)
- → code-style.md (mention)
- → docs/implemented-plans/remove-cardworks-and-xml.md (mention)
- → CLAUDE.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/migrations.md (mention)

#### docs/implemented-plans/remove-cardworks-package.md

Title: "Remove the cardworks package" | 503 lines

Referenced by:
- docs/glossary.md:44 (mention) — **cardworks** — A former standalone card library, now removed. Its frontmatter-card primitives (`cardSchema()`, parsing,
- docs/implemented-plans/box-migration.subplan.md:4 (mention) — the gated box-local-XML removal (`remove-cardworks-package.md`, task #11) and
- docs/implemented-plans/box-migration.subplan.md:8 (link) — Parent plan: [remove-cardworks-package.md](./remove-cardworks-package.md). Both
- docs/implemented-plans/remove-cardworks-deletion.md:3 (mention) — The execution plan for the last phase of `remove-cardworks-package.md`: sever

References:
- → docs/implemented-plans/remove-cardworks-and-xml.md (mention)
- → CLAUDE.md (mention)
- → code-style.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/migrations.md (mention)

#### docs/implemented-plans/responsive-figures.md **[ORPHAN]**

Title: "Responsive Figures" | 411 lines

References:
- → docs/engineering-principles.md (mention)
- → frontend.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/rest-to-trpc-consolidation.md

Title: "REST → tRPC route consolidation" | 397 lines

Referenced by:
- docs/implemented-plans/slopo-evaluation.md:15 (mention) — migrated to tRPC. See `docs/implemented-plans/rest-to-trpc-consolidation.md`.

References:
- → docs/implemented-plans/slopo-codehealth-adoption.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/router-state-formalization.md

Title: "Router Phase 2 — WorktreeState Formalization" | 259 lines

Referenced by:
- ../bin/docs/router-protocol.md:215 (mention) — `callback-box/docs/implemented-plans/router-state-formalization.md`) then did the fuller
- ../issues/closed/decisions/2026-07-06-architectural-review-open-decisions.md:54 (mention) — Design record: `callback-box/docs/implemented-plans/router-state-formalization.md`.

#### docs/implemented-plans/schema-validate-hook.md **[ORPHAN]**

Title: "Schema `validate` hook — co-locate non-Zod card validation with its schema" | 373 lines

References:
- → docs/adding-schemas.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/see-as-the-user.md

Title: "See as the user — screenshots of the live box UI for the chat agent" | 596 lines

Referenced by:
- docs/implemented-plans/see-as-the-user.review.md:3 (mention) — Cross-model review of `see-as-the-user.md` (the 2026-07-11 first draft), run

References:
- → docs/implemented-plans/see-as-the-user.review.md (mention)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → CLAUDE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/see-as-the-user.review.md

Title: "Plan review — see-as-the-user (Codex, gpt-5.6-sol, 2026-07-11)" | 190 lines

Referenced by:
- docs/implemented-plans/see-as-the-user.md:5 (mention) — `see-as-the-user.review.md` for the incorporated cross-model review.

References:
- → docs/implemented-plans/see-as-the-user.md (mention)

#### docs/implemented-plans/selection-commentary.md

Title: "Selection Commentary — referencing document text in chat input" | 706 lines

Referenced by:
- docs/plans/README.md:76 (mention) — - → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-plan.md`
- docs/plans/box-commentary-surface.md:98 (mention) — selection-commentary feature (`docs/implemented-plans/selection-commentary.md`) and the

References:
- → test/manual/selection-commentary.manual.md (mention)
- → code-style.md (mention)
- → frontend.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/semantic-search.md **[ORPHAN]**

Title: "Semantic search (box-search phase 3): hybrid BM25 + vector retrieval" | 533 lines

References:
- → docs/plans/README.md (mention)
- → docs/implemented-plans/box-search.md (mention)
- → docs/engineering-principles.md (mention)
- → src/services/CLAUDE.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/shared-frontend-backend-code.subplan.md

Title: "Shared Frontend/Backend Code — Subplan" | 319 lines

Referenced by:
- docs/implemented-plans/markdoc-tags-plan.md:170 (link) — [shared-frontend-backend-code subplan](shared-frontend-backend-code.subplan.md).
- docs/plans/README.md:78 (mention) — `shared-frontend-backend-code.subplan.md`, `narration-mode-design.md`

References:
- → docs/implemented-plans/markdoc-tags-plan.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/slopo-codehealth-adoption.md

Title: "slopo adoption + duplication triage" | 431 lines

Referenced by:
- docs/implemented-plans/rest-to-trpc-consolidation.md:32 (mention) — duplication pass (see `docs/implemented-plans/slopo-codehealth-adoption.md`), which
- docs/implemented-plans/slopo-evaluation.md:12 (mention) — See `docs/implemented-plans/slopo-codehealth-adoption.md`.

References:
- → docs/implemented-plans/slopo-evaluation.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/slopo-evaluation.md

Title: "slopo evaluation — callback-box/src" | 122 lines

Referenced by:
- docs/implemented-plans/slopo-codehealth-adoption.md:17 (mention) — `docs/implemented-plans/slopo-evaluation.md`: 105 clusters on a clean run,

References:
- → docs/implemented-plans/slopo-codehealth-adoption.md (mention)
- → docs/implemented-plans/rest-to-trpc-consolidation.md (mention)

#### docs/implemented-plans/state-management-comparison.md

Title: "State Management Comparison: Zustand vs MobX-State-Tree vs Valtio vs XState" | 831 lines

Referenced by:
- docs/plans/docs-reorg.md:81 (mention) — `state-management-comparison.md` (bake-off record, unclear adoption), and
- docs/stack-decisions.md:157 (mention) — Evaluation prototypes (history-xstate.ts, HistoryPageXState.tsx, state-fixtures.ts, render-page.tsx) have been deleted. 

#### docs/implemented-plans/tailscale-expose-and-protect.md

Title: "Tailscale expose-and-protect" | 596 lines

Referenced by:
- ../issues/closed/features/2026-07-20-tailscale-expose-and-protect.md:15 (mention) — `research/openclaw-hermes/`. Design/history: `docs/implemented-plans/tailscale-expose-and-protect.md`
- ../research/openclaw-hermes/README.md:98 (mention) — | 23 | **Tailscale identity as an app-login accelerator (OpenClaw's post-fix `tailscale` auth mode: Serve identity heade

References:
- → ../issues/features/2026-07-19-installation-remaining-work.md (link)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → docs/docker-install.md (mention)
- → deploy/README.md (mention)
- → docs/plans/installation-story.md (mention)
- → docs/health-checks.md (mention)
- → docs/agent-install.md (mention)

#### docs/implemented-plans/user-location.md

Title: "User Location (`cb location get`)" | 496 lines

Referenced by:
- docs/implemented-plans/named-places.md:19 (mention) — live fix and the `cb location get` command from `docs/implemented-plans/user-location.md`.

References:
- → code-style.md (mention)
- → frontend.md (mention)
- → docs/box-layout.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/user-story-audit-followups.md

Title: "User-story audit — follow-up plans" | 428 lines

Referenced by:
- docs/plans/design-reconciliation.md:10 (mention) — `docs/implemented-plans/user-story-audit-followups.md`): the boxholder writes
- docs/plans/docs-reorg.md:56 (mention) — and `user-story-audit-followups.md` (mostly done).
- ../issues/closed/features/2026-06-26-questions-end-to-end-d1.md:17 (mention) — From the user-story audit (`docs/plans/user-story-audit-followups.md`, bucket D).
- ../issues/features/2026-06-26-drive-mounting-file-browsing-ui.md:7 (mention) — Surfaced by the user-story audit (`docs/plans/user-story-audit-followups.md` D9).

References:
- → docs/reports/user-stories-audit-2026-06-26.md (mention)
- → docs/calendar.md (mention)
- → docs/plans/pdf-intake-design.md (mention)

#### docs/implemented-plans/view-render-testing.md **[ORPHAN]**

Title: "Plan: testing agent-authored views" | 544 lines

References:
- → code-style.md (mention)
- → docs/testing.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/web-push-notifications.md

Title: "Web Push notifications" | 508 lines

Referenced by:
- docs/implemented-plans/web-push-notifications.review-codex.md:1 (mention) — # Codex review — web-push-notifications.md
- ../issues/code-quality/2026-07-04-web-push-followup-testing.md:5 (mention) — design: ../callback-box/docs/implemented-plans/web-push-notifications.md

References:
- → docs/box-layout.md (mention)
- → docs/implemented-plans/web-push-notifications.review-codex.md (mention)
- → deploy/README.md (mention)
- → CLAUDE.md (mention)
- → src/services/CLAUDE.md (mention)
- → docs/testing.md (mention)
- → src/connectors/CLAUDE.md (mention)

#### docs/implemented-plans/web-push-notifications.review-codex.md

Title: "Codex review — web-push-notifications.md" | 102 lines

Referenced by:
- docs/implemented-plans/web-push-notifications.md:122 (mention) — (`web-push-notifications.review-codex.md` findings #1, #2): **(1)** push

References:
- → docs/implemented-plans/web-push-notifications.md (mention)
- → docs/box-layout.md (mention)

#### docs/implemented-plans/webpage-card-and-commentary.md

Title: "`.webpage.card` + commentary-as-attachment" | 458 lines

Referenced by:
- docs/plans/docs-reorg.md:208 (mention) — - `webpage-card-and-commentary.md` (implemented) vs `web-page-commentary.md`

References:
- → docs/implemented-plans/clerk-webpage-capture.md (link)
- → code-style.md (mention)

#### docs/implemented-plans/websocket-chat-transport.md

Title: "WebSocket chat transport" | 528 lines

Referenced by:
- docs/reports/user-stories-audit-2026-06-26.md:1367 (mention) — The code accurately implements support for mid-turn resume via: TurnBuffer with seq numbers and version tracking, tracke

References:
- → code-style.md (mention)
- → CLAUDE.md (mention)

### docs/plans/

#### docs/plans/android-companion-app.md

Title: "Native Android companion app" | 763 lines

Referenced by:
- docs/implemented-plans/mobile-parity-sync.md:7 (mention) — the planned Android app (`docs/plans/android-companion-app.md`), and the
- docs/implemented-plans/mobile-token-handshake.md:342 (mention) — - **Android.** No Android client exists yet; `docs/plans/android-companion-app.md` describes
- docs/mobile-contract.md:222 (mention) — 2026-07-17, Track 0 of `docs/plans/android-companion-app.md`): each shell's document-start script
- docs/mobile-parity.md:9 (mention) — Android columns reflect `docs/plans/android-companion-app.md` — a plan, not
- ../issues/features/2026-07-18-android-companion-track1-unblocked.md:5 (mention) — `callback-box/docs/plans/android-companion-app.md` is build-ready and its

References:
- → docs/mobile-contract.md (mention)
- → docs/plans/ios-companion-review-2026-07-17.md (mention)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → docs/plans/ios-companion-app.md (mention)
- → docs/implemented-plans/mobile-parity-sync.md (mention)
- → docs/mobile-parity.md (mention)
- → docs/plans/ios-native-capture-mode.md (mention)

#### docs/plans/box-commentary-surface.md

Title: "In-box Commentary Surface for Out-of-Box Files" | 781 lines

Referenced by:
- docs/implemented-plans/extfile-card.md:45 (mention) — - **Precedent — the commentary surface** (`docs/plans/box-commentary-surface.md`,
- docs/plans/docs-reorg.md:45 (mention) — plus the open remainders of `box-commentary-surface.md` / `chat-husks.md`):

References:
- → code-style.md (mention)
- → docs/implemented-plans/selection-commentary.md (mention)
- → docs/prompt-audits.md (mention)
- → CLAUDE.md (mention)

#### docs/plans/chat-husks.md

Title: "Chat husks — web chat sessions as cards (phase 1)" | 70 lines

Referenced by:
- docs/plans/docs-reorg.md:45 (mention) — plus the open remainders of `box-commentary-surface.md` / `chat-husks.md`):
- docs/plans/interface-as-cards.md:293 (mention) — | Chat | husk card per session + chat view + the slot | Below. **Husks shipped 2026-07** (`docs/plans/chat-husks.md`): a

References:
- → docs/plans/interface-as-cards.md (mention)

#### docs/plans/cli-restructure.md

Title: "`cb` CLI Restructure — Plan" | 174 lines

Referenced by:
- docs/plans/docs-reorg.md:77 (mention) — `cli-restructure.md` (verified unimplemented; says "delete this doc when

References:
- → docs/implemented-plans/capture-mode.md (mention)
- → docs/triage.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/maintenance.md (mention)

#### docs/plans/design-reconciliation.md

Title: "Design reconciliation — adjudication list" | 604 lines

Referenced by:
- docs/architecture/CLAUDE.md:5 (mention) — **Role:** this series is the onboarding narrative — the canonical human-facing "what is this." Engineering rationale liv
- docs/design/README.md:12 (link) — the boxholder's rulings in [`../plans/design-reconciliation.md`](../plans/design-reconciliation.md)
- docs/implemented-plans/design-md-retired-sections.md:4 (mention) — into `docs/design/` per the rulings in `../plans/design-reconciliation.md`.
- docs/implemented-plans/mvp-implementation-guide.md:2 (mention) — > (retired 2026-07-04 per `../plans/design-reconciliation.md`). Everything
- docs/plans/docs-reorg.md:332 (mention) — (`docs/plans/design-reconciliation.md`) with 20 rulings + roles
- docs/unimplemented-plans/README.md:21 (mention) — | `design-vision-superseded.md` | Superseded by `../design/` (2026-07-04) — each section adjudicated in `../plans/design
- docs/unimplemented-plans/design-vision-superseded.md:4 (mention) — > `../plans/design-reconciliation.md`). Harvest map: the OS vision →

References:
- → docs/plans/docs-reorg.md (mention)
- → docs/implemented-plans/user-story-audit-followups.md (mention)
- → docs/architecture/spirit.md (mention)
- → docs/architecture/outline.md (mention)
- → docs/glossary.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/activities-retrospective.md (mention)
- → docs/architecture/01-what-is-this.md (mention)
- → frontend.md (mention)
- → CLAUDE.md (mention)
- → src/core/reactor/DESIGN.md (mention)
- → docs/architecture/02-cards-and-memory.md (mention)
- → docs/scheduler.md (mention)
- → docs/chat-schedules.md (mention)
- → docs/box-layout.md (mention)

#### docs/plans/docs-reorg.gap-analysis.md

Title: "Docs-reorg companion: gap analysis — non-obvious, undocumented conventions" | 163 lines

Referenced by:
- docs/plans/docs-reorg.md:359 (mention) — - Unanswered from the gap analysis (docs-reorg.gap-analysis.md B6–B9):

References:
- → docs/plans/docs-reorg.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/connectors.md (mention)
- → src/core/reactor/DESIGN.md (mention)
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/testing.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/composer-input-machine.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/scheduler.md (mention)
- → docs/glossary.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/asset-manifests.md (mention)
- → docs/migrations.md (mention)

#### docs/plans/docs-reorg.md

Title: "Documentation reorganization" | 418 lines

Referenced by:
- docs/plans/design-reconciliation.md:7 (mention) — (see the Direction section of `docs/plans/docs-reorg.md`: "Design docs require
- docs/plans/docs-reorg.gap-analysis.md:3 (mention) — **Status:** survey artifact 2026-07-04 — input to `docs-reorg.md`; findings
- docs/stack-decisions.md:145 (mention) — - **@xstate/store** — Under 1KB event-driven store for simple pages (Settings, Admin) where a full state machine is over

References:
- → CLAUDE.md (mention)
- → docs/plans/input-widget.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/plans/pdf-intake-design.md (mention)
- → docs/plans/source-editor.md (mention)
- → docs/plans/prompt-surface-ia-review.md (mention)
- → docs/plans/box-commentary-surface.md (mention)
- → docs/plans/chat-husks.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/implemented-plans/courseware-phase1.md (mention)
- → docs/unimplemented-plans/query-cards.md (mention)
- → docs/implemented-plans/user-story-audit-followups.md (mention)
- → docs/plans/cli-restructure.md (mention)
- → docs/unimplemented-plans/capture-pipeline-redesign.md (mention)
- → docs/todo-security.md (mention)
- → docs/architecture/outline.md (mention)
- → docs/implemented-plans/state-management-comparison.md (mention)
- → docs/box-layout.md (mention)
- → docs/testing.md (mention)
- → docs/migrations.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/server-operations.md (mention)
- → docs/procedure-implementation.md (mention)
- → docs/glossary.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/connectors.md (mention)
- → docs/prompt-audits.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/reports/knowledge-audit-rerun-2026-07-03.md (mention)
- → docs/doc-graph.md (mention)
- → docs/knowledge-audits.md (mention)
- → deploy/README.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/chat-schedules.md (mention)
- → docs/telegram-setup.md (mention)
- → docs/prompt-logging.md (mention)
- → docs/scheduler.md (mention)
- → docs/health-checks.md (mention)
- → docs/implemented-plans/link-validation-fix.md (mention)
- → docs/landmark-curation.md (mention)
- → docs/scheduled/csp-violation-review.md (mention)
- → src/core/reactor/DESIGN.md (mention)
- → docs/implemented-plans/webpage-card-and-commentary.md (mention)
- → docs/google-setup.md (mention)
- → docs/gmail-setup.md (mention)
- → docs/google-drive.md (mention)
- → docs/activities-design.md (mention)
- → docs/activities-retrospective.md (mention)
- → src/hub/CLAUDE.md (mention)
- → docs/card-validation.md (mention)
- → docs/plans/design-reconciliation.md (mention)
- → docs/architecture/spirit.md (mention)
- → docs/implemented-plans/mvp-implementation-guide.md (mention)
- → docs/triage.md (mention)
- → docs/event-bus.md (mention)
- → docs/knowledge-taxonomy.md (mention)
- → docs/README.md (mention)
- → docs/plans/docs-reorg.gap-analysis.md (mention)
- → docs/maintenance.md (mention)

#### docs/plans/input-widget.md

Title: "The input — interface design" | 685 lines

Referenced by:
- docs/implemented-plans/capture-mode.md:4 (link) — [input-widget.md](../plans/input-widget.md): capture stops being a separate app
- docs/implemented-plans/input-extraction.md:5 (mention) — `docs/plans/input-widget.md`. Scope: the chat target only — Emission +
- docs/plans/docs-reorg.md:43 (mention) — files are genuinely active plans** (`input-widget.md`, `interface-as-cards.md`,

References:
- → docs/implemented-plans/input-extraction.md (mention)
- → docs/implemented-plans/capture-mode.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → ../issues/features/2026-06-28-triage-agent-session-routing.md (link)
- → docs/implemented-plans/capture-mode.md (link)

#### docs/plans/installation-story.md

Title: "Installation story, phase 1: developer install + local Docker" | 612 lines

Referenced by:
- docs/implemented-plans/tailscale-expose-and-protect.md:365 (mention) — `docs/plans/installation-story.md`'s failure-modes table, which treats the
- docs/plans/source-available-release.md:271 (mention) — (preflight + health half) by `docs/plans/installation-story.md` Track B
- ../issues/closed/features/2026-07-20-tailscale-expose-and-protect.md:39 (mention) — first-class alternative in `callback-box/docs/plans/installation-story.md` and
- ../issues/features/2026-07-19-installation-remaining-work.md:3 (mention) — design: ../../callback-box/docs/plans/installation-story.md

References:
- → docs/plans/source-available-release.md (mention)
- → docs/engineering-principles.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/developer-install.md (mention)
- → docs/box-layout.md (mention)
- → deploy/README.md (mention)
- → docs/docker-install.md (mention)

#### docs/plans/interface-as-cards.md

Title: "The interface as cards — design" | 473 lines

Referenced by:
- CLAUDE.md:168 (mention) — | Interface-as-cards design | `docs/plans/interface-as-cards.md` |
- docs/design/identity.md:17 (link) — [interface-as-cards](../plans/interface-as-cards.md) direction built entirely
- docs/design/interaction-model.md:17 (link) — ([interface-as-cards](../plans/interface-as-cards.md)).
- docs/design/representation.md:85 (link) — ([interface-as-cards](../plans/interface-as-cards.md) owns that guardrail).
- docs/implemented-plans/nav-card.md:11 (mention) — First implementation slice of `docs/plans/interface-as-cards.md`. Small on
- docs/plans/chat-husks.md:8 (mention) — `docs/plans/interface-as-cards.md` ("Chat / Husks").
- docs/plans/design-reconciliation.md:22 (mention) — `docs/stack-decisions.md`, `docs/plans/interface-as-cards.md`,
- docs/plans/docs-reorg.md:43 (mention) — files are genuinely active plans** (`input-widget.md`, `interface-as-cards.md`,
- docs/plans/input-widget.md:14 (mention) — the frame-model notes in `docs/plans/interface-as-cards.md` ("The input
- docs/unimplemented-plans/README.md:19 (mention) — | `query-cards.md` | Parked 2026-07-03; vocabulary explored but not planned for implementation. Parent design lives on i
- docs/unimplemented-plans/query-cards.md:22 (mention) — species deferred from `docs/plans/interface-as-cards.md` — the piece that
- ../issues/closed/exploration/2026-05-11-interface-itself-as-cards.md:7 (link) — **Closed:** Superseded by [interface-as-cards.md](../../callback-box/docs/plans/interface-as-cards.md) (2026-07 design e

References:
- → ../issues/closed/exploration/2026-05-11-interface-itself-as-cards.md (link)
- → docs/unimplemented-plans/query-cards.md (mention)
- → docs/implemented-plans/nav-card.md (mention)
- → docs/plans/chat-husks.md (mention)

#### docs/plans/ios-companion-app.md

Title: "iOS Companion App for Callback Box" | 216 lines

Referenced by:
- docs/plans/android-companion-app.md:39 (mention) — - Shipped precedent: `docs/plans/ios-companion-app.md` (umbrella), the native
- docs/plans/ios-companion-review-2026-07-09.md:15 (mention) — Cross-referencing the plan (`ios-companion-app.md`): this work is **Tracks A, C, D, G, H partially built ahead of their 
- docs/plans/ios-companion-review-2026-07-17.md:144 (mention) — - **The plan's hardest question is still unresolved.** `ios-companion-app.md` named **device-token/web-session convergen
- docs/plans/publish-pages.md:30 (mention) — - **Precedents (denser than docs):** the Telegram webhook (`src/webapp/routes/telegram.ts`) as the "external service wit
- ../issues/bugs/2026-07-17-mobile-chat-unattributed.md:14 (mention) — The `ios-companion-app.md` plan already calls identity unification the hardest problem in its

References:
- → docs/engineering-principles.md (mention)
- → CLAUDE.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)

#### docs/plans/ios-companion-review-2026-07-09.md

Title: "iOS Companion — code review (2026-07-09)" | 167 lines

Referenced by:
- docs/plans/ios-companion-review-2026-07-17.md:4 (mention) — **Scope:** everything under `ios-app/` re-reviewed against the July-9 punch list (`ios-companion-review-2026-07-09.md`),

References:
- → docs/plans/ios-companion-review-2026-07-17.md (mention)
- → docs/plans/ios-companion-app.md (mention)
- → CLAUDE.md (mention)

#### docs/plans/ios-companion-review-2026-07-17.md

Title: "iOS Companion — follow-up code review (2026-07-17)" | 149 lines

Referenced by:
- docs/mobile-contract.md:525 (mention) — reproduction, proposed fixes) is in `docs/plans/ios-companion-review-2026-07-17.md`.
- docs/plans/android-companion-app.md:8 (mention) — follow-up review (`ios-companion-review-2026-07-17.md`), and Android platform
- docs/plans/ios-companion-review-2026-07-09.md:3 (mention) — **Superseded:** follow-up review at `ios-companion-review-2026-07-17.md` (2026-07-17) — most iOS findings closed by the 
- ../issues/bugs/2026-07-17-hub-mobile-auth-presence-only.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/bugs/2026-07-17-ios-hq-transcription-window-unlocked.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/bugs/2026-07-17-ios-hq-wav-float-format-needs-verify.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/bugs/2026-07-17-ios-pairing-flow-robustness.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/bugs/2026-07-17-ios-send-hangs-webview-unloaded.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/bugs/2026-07-17-ios-token-plaintext-not-keychain.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/bugs/2026-07-17-mobile-chat-unattributed.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/bugs/2026-07-17-mobile-device-store-unlocked-rmw.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/closed/bugs/2026-07-17-mobile-token-in-url-query.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/closed/code-quality/2026-07-17-mobile-auth-parser-plumbing-cleanups.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md
- ../issues/code-quality/2026-07-17-ios-small-cleanups.md:5 (mention) — discovered-in: 2026-07-17 iOS companion review — callback-box/docs/plans/ios-companion-review-2026-07-17.md

References:
- → docs/plans/ios-companion-review-2026-07-09.md (mention)
- → docs/plans/ios-companion-app.md (mention)

#### docs/plans/ios-input-plane-parity.md

Title: "iOS input-plane parity" | 578 lines

Referenced by:
- ../issues/features/2026-07-19-ios-input-plane-parity.md:3 (mention) — design: ../../callback-box/docs/plans/ios-input-plane-parity.md
- ../issues/features/2026-07-19-ios-input-plane-parity.md:9 (link) — [`ios-input-plane-parity.md`](../../callback-box/docs/plans/ios-input-plane-parity.md).

References:
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → docs/testing.md (mention)
- → docs/implemented-plans/input-extraction.md (mention)
- → docs/plans/ios-native-capture-mode.md (mention)
- → docs/mobile-contract.md (mention)

#### docs/plans/ios-native-capture-mode.md

Title: "Native iOS capture mode" | 619 lines

Referenced by:
- docs/mobile-parity.md:35 (mention) — | Capture mode | planned (`docs/plans/ios-native-capture-mode.md`) | not planned until iOS capture ships |
- docs/plans/android-companion-app.md:676 (mention) — (`docs/plans/ios-native-capture-mode.md`); Android follows once it ships.
- docs/plans/ios-input-plane-parity.md:68 (mention) — - Active precedent: `docs/plans/ios-native-capture-mode.md` keeps capture media
- docs/plans/ios-native-capture-mode.review.md:3 (mention) — Review of `docs/plans/ios-native-capture-mode.md`, performed against the shipped

References:
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/testing.md (mention)
- → docs/implemented-plans/capture-mode.md (mention)
- → ../issues/bugs/2026-07-17-image-orientation-exif-boundaries.md (mention)

#### docs/plans/ios-native-capture-mode.review.md **[ORPHAN]**

Title: "Plan Engineering Review — Native iOS capture mode" | 470 lines

References:
- → docs/plans/ios-native-capture-mode.md (mention)
- → docs/implemented-plans/capture-mode.md (mention)

#### docs/plans/narration-mode.md

Title: "Narration Mode — Design" | 465 lines

Referenced by:
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode.md`, `stack-de
- docs/plans/README.md:87 (mention) — to `plans/narration-mode.md` — the doc opens "Status: proposal, for
- docs/reports/user-stories-audit-2026-06-26.md:1567 (mention) — The design doc (narration-mode.md line 240) explicitly states: "The chat has a `...` menu where settings live; the expli
- ../issues/features/2026-05-19-spark-mode.md:7 (link) — Conceptual inverse of narration mode (see [narration-mode.md](../callback-box/docs/plans/narration-mode.md)). Narration 

References:
- → docs/activities-retrospective.md (link)
- → frontend.md (mention)
- → docs/activities-design.md (mention)

#### docs/plans/pdf-intake-design.md

Title: "PDF Intake" | 179 lines

Referenced by:
- CLAUDE.md:166 (mention) — | PDF intake design | `docs/plans/pdf-intake-design.md` |
- docs/implemented-plans/user-story-audit-followups.md:57 (mention) — - **D4 (PDF) — design only.** `docs/plans/pdf-intake-design.md` reviewed and its
- docs/plans/README.md:81 (mention) — - → `plans/` (still open): `pdf-intake-design.md` (not yet implemented),
- docs/plans/docs-reorg.md:44 (mention) — `pdf-intake-design.md`, `source-editor.md`, `prompt-surface-ia-review.md`,

References:
- → docs/glossary.md (link)
- → docs/asset-manifests.md (link)

#### docs/plans/prompt-surface-ia-review.md

Title: "Prompt Surface Cleanup — IA Review" | 990 lines

Referenced by:
- docs/implemented-plans/job-xml-purge.subplan.md:25 (mention) — (`prompt-surface-ia-review.md`, Track 1). The parent plan's original Track 1
- docs/plans/docs-reorg.md:44 (mention) — `pdf-intake-design.md`, `source-editor.md`, `prompt-surface-ia-review.md`,
- ../.claude/skills/cb-prompt-review/SKILL.md:59 (mention) — Prior art: `callback-box/docs/plans/prompt-surface-ia-review.md` is the worked example of a full-surface review (what wa

References:
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)
- → code-style.md (mention)
- → docs/implemented-plans/job-xml-purge.subplan.md (mention)

#### docs/plans/publish-pages.md

Title: "Publish Pages — External Static Publishing via Cloudflare Workers" | 285 lines

Referenced by:
- docs/box-layout.md:117 (mention) — | `box/publish/` | Publications staged for external (Cloudflare) hosting — one `<pub-id>/` per publication, each holding
- ../issues/features/2026-07-19-pub-access-setup-via-api-not-dashboard.md:5 (mention) — design: ../../callback-box/docs/plans/publish-pages.md
- ../issues/features/2026-07-19-publish-pages-resume.md:5 (mention) — design: ../../callback-box/docs/plans/publish-pages.md
- ../issues/features/2026-07-19-publish-pages-resume.md:12 (link) — [publish-pages.md](../../callback-box/docs/plans/publish-pages.md).

References:
- → ../issues/features/2026-07-19-publish-pages-resume.md (link)
- → docs/engineering-principles.md (mention)
- → code-style.md (mention)
- → docs/plans/ios-companion-app.md (mention)
- → docs/content-security-policy.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/architecture/outline.md (mention)
- → docs/design/identity.md (mention)
- → CLAUDE.md (mention)
- → docs/testing.md (mention)

#### docs/plans/README.md

Title: "docs/plans/ — proposals and in-flight plans" | 108 lines

Referenced by:
- docs/README.md:13 (mention) — opens with a `**Status:**` line; see `docs/plans/README.md` for the full
- docs/implemented-plans/semantic-search.md:4 (mention) — see `docs/plans/README.md` for the plan-doc lifecycle.
- docs/plans/source-available-release.md:70 (mention) — (`README.md:24`: *"npm publish is planned but not live yet"*). The
- ../.claude/agents/finish.md:178 (mention) — `callback-box/docs/plans/README.md`), then either fold durable "how it works
- ../.claude/skills/cb-plan/SKILL.md:76 (mention) — live there, separate from reference docs (see `docs/plans/README.md`).

References:
- → docs/README.md (mention)
- → docs/implemented-plans/selection-commentary.md (mention)
- → docs/implemented-plans/markdoc-tags-plan.md (mention)
- → docs/implemented-plans/markdoc-format-investigation.md (mention)
- → docs/implemented-plans/shared-frontend-backend-code.subplan.md (mention)
- → docs/plans/pdf-intake-design.md (mention)
- → docs/plans/source-editor.md (mention)
- → docs/triage.md (mention)
- → docs/plans/narration-mode.md (mention)
- → docs/activities-design.md (mention)
- → docs/event-bus.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/unimplemented-plans/design-vision-superseded.md (mention)
- → docs/unimplemented-plans/design-card-views-superseded.md (mention)
- → docs/asset-manifests.md (mention)
- → docs/implemented-plans/attach-directories-superseded.md (mention)
- → docs/unimplemented-plans/capture-pipeline-redesign.md (mention)

#### docs/plans/source-available-release.md

Title: "Source-available release of callback-box" | 529 lines

Referenced by:
- docs/plans/installation-story.md:21 (mention) — Coordinates with `docs/plans/source-available-release.md`: this plan
- ../issues/closed/bugs/2026-07-05-report-workflows-emit-relative-paths.md:40 (mention) — (`callback-box/docs/plans/source-available-release.md`) records the leak
- ../issues/closed/features/2026-07-12-cb-doctor-preflight.md:25 (mention) — `callback-box/docs/plans/source-available-release.md` (preflight + actionable
- ../issues/closed/features/2026-07-12-docker-vps-install-path.md:10 (mention) — `callback-box/docs/plans/source-available-release.md`, currently deferred
- ../issues/decisions/2026-07-08-release-cloud-provider-honesty.md:14 (mention) — feature gap. Two things to settle in `docs/plans/source-available-release.md`:
- ../issues/features/2026-07-19-installation-remaining-work.md:52 (mention) — distribution decisions; `source-available-release.md` NOT-in-scope.)
- ../research/openclaw-hermes/deep-installation.md:9 (link) — [`source-available-release.md`](../../callback-box/docs/plans/source-available-release.md)
- ../research/rowboat-review.md:39 (mention) — - **Local-model option (Ollama/LM Studio).** We hard-require a configured Claude key (deliberately — bill safety, `feedb

References:
- → code-style.md (mention)
- → docs/box-layout.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/example-names.md (mention)
- → docs/architecture/family.md (mention)
- → docs/plans/README.md (mention)
- → docs/knowledge-taxonomy.md (mention)
- → docs/reports/user-stories-audit-2026-06-26.md (mention)
- → docs/implemented-plans/box-migration.subplan.md (mention)
- → docs/plans/installation-story.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → CLAUDE.md (mention)
- → docs/doc-graph.md (mention)

#### docs/plans/source-editor.md

Title: "Source Editor Plan" | 140 lines

Referenced by:
- CLAUDE.md:167 (mention) — | Source editor plan | `docs/plans/source-editor.md` |
- docs/plans/README.md:82 (mention) — `source-editor.md`. (`triage.md` later turned out to be fully built
- docs/plans/docs-reorg.md:44 (mention) — `pdf-intake-design.md`, `source-editor.md`, `prompt-surface-ia-review.md`,

### docs/reports/

#### docs/reports/knowledge-audit-rerun-2026-07-03.md

Title: "Knowledge-audit full rerun — 2026-07-03" | 465 lines

Referenced by:
- docs/knowledge-audits.md:24 (mention) — See `docs/reports/knowledge-audit-rerun-2026-07-03.md` for the latest full-corpus rerun record.
- docs/plans/docs-reorg.md:115 (mention) — `knowledge-audit-rerun-2026-07-03.md` (orphaned), `user-stories.md`

References:
- → docs/triage.md (mention)
- → docs/landmark-curation.md (mention)

#### docs/reports/user-stories-audit-2026-06-26.md

Title: "callback-box — User Stories" | 5768 lines

Referenced by:
- docs/implemented-plans/questions-end-to-end.md:618 (mention) — `bin/browse` checks, per `docs/reports/user-stories-audit-2026-06-26.md`'s
- docs/implemented-plans/user-story-audit-followups.md:5 (mention) — This plan triages the 95 `IAN:` comments left on `docs/reports/user-stories-audit-2026-06-26.md` (the
- docs/plans/source-available-release.md:173 (mention) — name), `docs/reports/user-stories-audit-2026-06-26.md:671` (real email).
- docs/reports/user-stories-audit-2026-06-26.md:2509 (mention) — **Verifier (flagged):** The story is partially accurate. Core features (markdown export, lossy detection, warning displa

References:
- → docs/asset-manifests.md (mention)
- → docs/landmarks.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/prompt-logging.md (mention)
- → docs/implemented-plans/websocket-chat-transport.md (mention)
- → CLAUDE.md (mention)
- → docs/plans/narration-mode.md (mention)
- → docs/triage.md (mention)
- → docs/gmail-setup.md (mention)
- → docs/calendar.md (mention)
- → docs/reports/user-stories-audit-2026-06-26.md (mention)
- → docs/google-drive.md (mention)
- → docs/implemented-plans/figure-card-type.md (mention)
- → docs/ssr-render-testing.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/box-layout.md (mention)
- → MAP.md (at-include) **[BROKEN]**
- → docs/knowledge-audits.md (mention)
- → docs/procedure-implementation.md (mention)

### docs/scheduled/

#### docs/scheduled/csp-violation-review.md

Title: "Scheduled routine: CSP violation review" | 95 lines

Referenced by:
- docs/content-security-policy.md:76 (mention) — The routine is a runbook: see `docs/scheduled/csp-violation-review.md`. To harden
- docs/plans/docs-reorg.md:196 (mention) — `scheduled/csp-violation-review.md` is half dev reference, half the literal
- docs/scheduled/csp-violation-review.md:11 (mention) — `callback-box/docs/scheduled/csp-violation-review.md`."* Everything it needs is
- src/dev/CLAUDE.md:15 (mention) — | `csp-digest.ts` | Digests the JSONL CSP violation log (incremental via per-box cursor) | `docs/content-security-policy

References:
- → docs/content-security-policy.md (mention)
- → docs/scheduled/csp-violation-review.md (mention)
- → docs/implemented-plans/app-wide-csp.md (mention)

### docs/unimplemented-plans/

#### docs/unimplemented-plans/box-user-account-spec.md

Title: "Spec: Box as Linux User Account" | 402 lines

Referenced by:
- docs/implemented-plans/boxes-as-packages-v2.md:568 (mention) — - **Per-box OS users / socket permissions / secrets split** (`docs/unimplemented-plans/box-user-account-spec.md`
- docs/unimplemented-plans/README.md:17 (mention) — | `box-user-account-spec.md` | Derivative of boxes-as-packages-v1-superseded.md; the OS-user-as-box-identity idea is def
- docs/unimplemented-plans/boxes-as-packages-v1-superseded.md:11 (link) — **Related:** [Box as Linux User Account spec](box-user-account-spec.md) — tightens this proposal by adopting the OS user

References:
- → docs/unimplemented-plans/boxes-as-packages-v1-superseded.md (link)

#### docs/unimplemented-plans/boxes-as-packages-v1-superseded.md

Title: "Design Exploration: Boxes as Code Repositories" | 706 lines

Referenced by:
- docs/implemented-plans/boxes-as-packages-v2.md:8 (mention) — **Supersedes:** `docs/unimplemented-plans/boxes-as-packages-v1-superseded.md` (2025 design exploration). This plan re-de
- docs/unimplemented-plans/README.md:16 (mention) — | `boxes-as-packages-v1-superseded.md` | Superseded by `../implemented-plans/boxes-as-packages-v2.md` (2026-07-03), whic
- docs/unimplemented-plans/box-user-account-spec.md:4 (link) — **Relationship to other docs:** Builds on the [boxes-as-packages design exploration](boxes-as-packages-v1-superseded.md)

References:
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (link)
- → docs/server-operations.md (mention)
- → CLAUDE.md (mention)
- → ../issues/closed/features/2026-03-21-markdown-cards-replacing-xml.md (link)
- → docs/cards-as-markdown.md (mention)

#### docs/unimplemented-plans/capture-pipeline-redesign.md

Title: "Capture Pipeline Redesign" | 132 lines

Referenced by:
- docs/implemented-plans/capture-mode.md:18 (link) — [../unimplemented-plans/capture-pipeline-redesign.md](../unimplemented-plans/capture-pipeline-redesign.md)
- docs/plans/README.md:107 (mention) — `capture-pipeline-redesign.md` to `unimplemented-plans/` (parked 2026-03).
- docs/plans/docs-reorg.md:78 (mention) — done"), `capture-pipeline-redesign.md` (no implementation evidence,
- docs/unimplemented-plans/README.md:20 (mention) — | `capture-pipeline-redesign.md` | Parked 2026-03 — direction (simpler capture pipeline) may still be relevant; OCR vend

References:
- → docs/implemented-plans/capture-mode.md (link)

#### docs/unimplemented-plans/design-card-views-superseded.md

Title: "Card View Plugin System" | 878 lines

Referenced by:
- docs/plans/README.md:104 (mention) — `design-card-views-superseded.md`), `attach-implementation.md`
- docs/unimplemented-plans/README.md:18 (mention) — | `design-card-views-superseded.md` | Superseded by the shipped renderer system: `src/frontend/src/renderers/` + the fil

References:
- → docs/unimplemented-plans/README.md (mention)

#### docs/unimplemented-plans/design-vision-superseded.md

Title: "Callback Box: Design Vision and Architecture" | 80 lines

Referenced by:
- docs/plans/README.md:101 (mention) — `unimplemented-plans/design-vision-superseded.md`).
- docs/unimplemented-plans/README.md:21 (mention) — | `design-vision-superseded.md` | Superseded by `../design/` (2026-07-04) — each section adjudicated in `../plans/design

References:
- → docs/plans/design-reconciliation.md (mention)
- → docs/design/identity.md (mention)
- → docs/landmarks.md (mention)
- → docs/design/extensibility.md (mention)
- → docs/triage.md (mention)
- → docs/stack-decisions.md (mention)
- → CLAUDE.md (mention)

#### docs/unimplemented-plans/query-cards.md

Title: "Query cards — the "select and arrange cards" vocabulary" | 363 lines

Referenced by:
- docs/plans/docs-reorg.md:54 (mention) — (header claims unmerged branch; commits are on main), `query-cards.md`
- docs/plans/interface-as-cards.md:284 (mention) — | Landmarks page | query card (`type: landmark`) | Trivial; machinery proof. **Shipped 2026-07 as an instrument card** (
- docs/unimplemented-plans/README.md:19 (mention) — | `query-cards.md` | Parked 2026-07-03; vocabulary explored but not planned for implementation. Parent design lives on i

References:
- → docs/landmarks.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → code-style.md (mention)

#### docs/unimplemented-plans/README.md

Title: "Unimplemented plans" | 22 lines

Referenced by:
- docs/unimplemented-plans/design-card-views-superseded.md:48 (mention) — README.md               → [Source]

References:
- → docs/unimplemented-plans/boxes-as-packages-v1-superseded.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (mention)
- → docs/unimplemented-plans/design-card-views-superseded.md (mention)
- → docs/unimplemented-plans/query-cards.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/unimplemented-plans/capture-pipeline-redesign.md (mention)
- → docs/unimplemented-plans/design-vision-superseded.md (mention)
- → docs/plans/design-reconciliation.md (mention)
- → docs/design/identity.md (mention)
- → docs/design/extensibility.md (mention)
- → docs/design/representation.md (mention)

### src/connectors/

#### src/connectors/CLAUDE.md

Title: "Connectors" | 27 lines

Referenced by:
- CLAUDE.md:100 (mention) — **Connectors** — Sync external services with the box filesystem. Each implements `Connector.sync()`. See `src/connectors
- docs/glossary.md:38 (mention) — **connector** — Code that syncs an external service (Gmail, RSS, Telegram, ...) with the box filesystem. Implements `Con
- docs/implemented-plans/web-push-notifications.md:484 (mention) — (service-injection pattern, `src/services/CLAUDE.md` / `src/connectors/CLAUDE.md`)
- docs/plans/docs-reorg.gap-analysis.md:20 (mention) — module's own comment — not in `src/connectors/CLAUDE.md` or
- ../.claude/skills/cb-codehealth/SKILL.md:30 (mention) — `src/services/CLAUDE.md`, `src/connectors/CLAUDE.md`), so a caller — human or

References:
- → src/services/CLAUDE.md (mention)

### src/core/reactor/

#### src/core/reactor/CLAUDE.md

Title: "Reactor" | 24 lines

Referenced by:
- src/core/reactor/DESIGN.md:90 (mention) — - **System prompt** tells the agent what context it already has (job card content, referenced files, schema instructions

References:
- → src/core/reactor/DESIGN.md (link)

#### src/core/reactor/DESIGN.md

Title: "Reactor Design" | 135 lines

Referenced by:
- CLAUDE.md:96 (mention) — **Wakeup cycle** — `cb wakeup` preprocesses inbox items → runs housekeeping + on-wakeup scripts → syncs connectors (crea
- docs/design/interaction-model.md:15 (mention) — across reactor cycles (`src/core/reactor/DESIGN.md`), and the current design
- docs/design/processing.md:26 (mention) — `runReactor` (`src/core/reactor/DESIGN.md`): sync (`cb wakeup` as its step
- docs/glossary.md:36 (mention) — **reactor** — The main processing loop (`src/core/reactor/DESIGN.md`): find job cards in `box/jobs/` → agent processing 
- docs/plans/design-reconciliation.md:127 (mention) — (src/core/reactor/DESIGN.md, "Two Processing Paths"), and the current design
- docs/plans/docs-reorg.gap-analysis.md:33 (mention) — hint today is `reactor/DESIGN.md:78`).
- docs/plans/docs-reorg.md:204 (mention) — `DESIGN.md`/`IMPLEMENTATION.md` — never cross-referenced. Decide canonical
- src/core/reactor/CLAUDE.md:3 (link) — See [DESIGN.md](DESIGN.md) for the full architecture, flow, and rationale.
- ../research/gstack/notes/design-consultation.md:3 (mention) — Six-phase conversation that ends with a written DESIGN.md and a CLAUDE.md update telling the agent to always read it. Th
- ../research/gstack/notes/design-shotgun.md:48 (mention) — > "Pre-fill what you inferred from the codebase, DESIGN.md, and office-hours output. Then ask for what's missing. Frame 

References:
- → src/core/reactor/CLAUDE.md (mention)

### src/dev/

#### src/dev/CLAUDE.md

Title: "Dev Scripts" | 19 lines

Referenced by:
- docs/implemented-plans/box-retrospectives.md:414 (mention) — glossary entries, the two knowledge-audit entries, `src/dev/CLAUDE.md`

References:
- → docs/knowledge-audits.md (mention)
- → docs/maintenance.md (mention)
- → docs/doc-graph.md (mention)
- → docs/README.md (mention)
- → docs/architecture/CLAUDE.md (mention)
- → docs/content-security-policy.md (mention)
- → docs/scheduled/csp-violation-review.md (mention)

### src/frontend/dist/earcons/

#### src/frontend/dist/earcons/SOURCES.md **[ORPHAN]**

Title: "Earcon sources & attribution" | 13 lines

No references in or out.

### src/frontend/public/earcons/

#### src/frontend/public/earcons/SOURCES.md **[ORPHAN]**

Title: "Earcon sources & attribution" | 13 lines

No references in or out.

### src/frontend/src/components/chat/

#### src/frontend/src/components/chat/CLAUDE.md

Title: "Chat UI" | 72 lines

Referenced by:
- docs/implemented-plans/chat-stream-finalize-unify.md:338 (mention) — `CLAUDE.md` (`src/frontend/src/components/chat/CLAUDE.md`, shipped with the scroll

References:
- → docs/implemented-plans/chat-scroll-redesign.md (mention)
- → docs/chat-scroll-testing.md (mention)
- → docs/implemented-plans/chat-stream-finalize-unify.md (mention)

### src/hub/

#### src/hub/CLAUDE.md

Title: "Hub" | 64 lines

Referenced by:
- CLAUDE.md:61 (mention) — src/hub/          `cb hub`: routes /<slug>/... to per-box `cb serve` children (lazy start, idle-collect, health-check) —
- docs/adding-a-box.md:25 (mention) — persisted to `hub-state.json` beside the config) — see `src/hub/CLAUDE.md`.
- docs/chat-schedules.md:96 (mention) — Schedules persist to `.callback-box/chat-schedules.json` and are re-armed when a box's `cb serve` process boots (overdue
- docs/implemented-plans/mobile-token-handshake.md:75 (mention) — unacceptable."* `src/hub/CLAUDE.md` reinforces it: `CHILD_ENV_ALLOWLIST` deliberately
- docs/plans/docs-reorg.md:319 (mention) — conventions documented at colocated homes (new `src/hub/CLAUDE.md`,
- ../issues/decisions/2026-07-04-box-registry-manifests.md:32 (mention) — `callback-box/src/hub/CLAUDE.md`,
- ../issues/decisions/2026-07-19-boxes-share-one-origin.md:13 (mention) — withholding `CB_SESSION_SECRET` from boxes (`src/hub/CLAUDE.md`).

References:
- → docs/health-checks.md (mention)

### src/services/

#### src/services/CLAUDE.md

Title: "Services" | 127 lines

Referenced by:
- CLAUDE.md:98 (mention) — **Services** — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have ob
- docs/connectors.md:70 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation.
- docs/glossary.md:42 (mention) — **service** — A typed interface wrapping an external dependency, with real and fake implementations. Fakes have observab
- docs/implemented-plans/capture-mode.md:623 (mention) — `src/services/CLAUDE.md`). Scripted word timestamps + fixture image
- docs/implemented-plans/semantic-search.md:35 (mention) — - `src/services/CLAUDE.md`: *"if a library or function touches external
- docs/implemented-plans/web-push-notifications.md:194 (mention) — `src/services/CLAUDE.md`): `sendNotification(subscription, payload)` →
- docs/testing.md:123 (mention) — External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full s
- src/connectors/CLAUDE.md:15 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation: interfaces, fakes, call logging, and testing patt
- ../.claude/skills/cb-codehealth/SKILL.md:30 (mention) — `src/services/CLAUDE.md`, `src/connectors/CLAUDE.md`), so a caller — human or

### test/manual/

#### test/manual/README.md **[ORPHAN]**

Title: "Manual tests" | 21 lines

No references in or out.

#### test/manual/selection-commentary.manual.md

Title: "Manual test: selection commentary (capture in the companion pane)" | 73 lines

Referenced by:
- docs/implemented-plans/selection-commentary.md:41 (mention) — >   `test/manual/selection-commentary.manual.md` — the natural-language

