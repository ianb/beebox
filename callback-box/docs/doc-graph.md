# Documentation Graph Report

Generated: 2026-07-04T20:54:19Z
Total documents: 137

## Issues

### Orphaned Documents (no incoming references)

These documents are not referenced by any other document.

- **deploy/CLAUDE.md** — "Deploy" (26 lines)
- **docs/architecture/01-what-is-this.md** — "What Is This Thing?" (66 lines)
- **docs/architecture/02-cards-and-memory.md** — "Cards and Memory" (99 lines)
- **docs/implemented-plans/agent-applied-migrations.md** — "Agent-applied migrations (via procedure checklists)" (544 lines)
- **docs/implemented-plans/box-migration.subplan.md** — "Box migration to frontmatter (subplan of remove-cardworks-package)" (282 lines)
- **docs/implemented-plans/box-schema-reload.md** — "Box-local schema reload — design & implementation plan" (354 lines)
- **docs/implemented-plans/card-view-widgets.md** — "Card-aware widgets for box-authored views" (662 lines)
- **docs/implemented-plans/chat-composer-rerender.md** — "Plan: stop composer keystrokes from re-rendering chat history" (154 lines)
- **docs/implemented-plans/companion-pane-card-activity.md** — "Companion-pane card activity awareness for chat" (366 lines)
- **docs/implemented-plans/courseware-lesson-plan.md** — "Courseware: the `lesson-plan` card" (345 lines)
- **docs/implemented-plans/extfile-card.md** — "`extfile` Card — an In-Box Pointer to a Live External File" (714 lines)
- **docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md** — "Plan Engineering Review — Markdoc Tags Design" (129 lines)
- **docs/implemented-plans/markdoc-tags-design.review.md** — "Plan Engineering Review — Markdoc Tags Design" (505 lines)
- **docs/implemented-plans/named-places.md** — "Named Places (`place` cards + `cb location mark`)" (465 lines)
- **docs/implemented-plans/normalize-chat-links.md** — "Normalize chat/card links" (690 lines)
- **docs/implemented-plans/open-chat-from-card.md** — "Open chat from a card browse page" (339 lines)
- **docs/implemented-plans/procedure-validation-completion.md** — "Procedure validation completion (D5)" (440 lines)
- **docs/implemented-plans/refresh-clerk.md** — "Refresh callback-clerk" (441 lines)
- **docs/implemented-plans/remove-cardworks-deletion.md** — "Remove cardworks — final deletion phase" (621 lines)
- **docs/implemented-plans/schema-validate-hook.md** — "Schema `validate` hook — co-locate non-Zod card validation with its schema" (373 lines)
- **docs/implemented-plans/view-render-testing.md** — "Plan: testing agent-authored views" (544 lines)
- **docs/plans/README.md** — "docs/plans/ — proposals and in-flight plans" (92 lines)
- **docs/plans/docs-reorg.gap-analysis.md** — "Docs-reorg companion: gap analysis — non-obvious, undocumented conventions" (154 lines)
- **src/frontend/public/earcons/SOURCES.md** — "Earcon sources & attribution" (13 lines)
- **test/manual/README.md** — "Manual tests" (21 lines)

### Broken References

These references point to files that don't exist.

- **docs/agent-knowledge.md:329** → `view:store/path/to/file.md` (link)
  Context: - **Expected level: Knows directly** — the chat system prompt describes the `[Display Name](view:store/path/to/file.md)`
- **docs/implemented-plans/link-validation-fix.md:530** → `/store/foo/bar.md` (link)
  Context: `[x](/store/foo/bar.md)`. What does the leading slash mean?"*;
- **docs/knowledge-audits.md:74** → `MAP.md` (at-include)
  Context: - `context_dir` — box-relative subdirectory to run the agent from. Sets the SDK's `cwd` there and adds the box root to `
- **docs/prompt-audits.md:47** → `tone-design.md` (link)
  Context: Stock LLM phrases ("Great question!", "Let me unpack that," "That's a real tension") often come from prompt language tha
- **docs/user-stories.md:5334** → `MAP.md` (at-include)
  Context: - Ensure per-dir CLAUDE.md includes are correct: IMPLEMENTED in finalize.ts lines 58-79 with `ensureClaudeMdInDir()` tha

## Document Inventory

### ./

#### CLAUDE.md

Title: "Callback Box" | 150 lines

Referenced by:
- CLAUDE.md:14 (mention) — Overmind and Procfile.dev are gone. The router (`bin/router.ts`) spawns Vite and the hub directly as its children — flat
- README.md:36 (mention) — `CLAUDE.md`) and the box itself under `content/` — directories, default
- docs/EXAMPLE_FILES.md:55 (mention) — ├── CLAUDE.md
- docs/IMPLEMENTATION.md:671 (mention) — CLAUDE.md              # Base instructions for all agents
- docs/activities-design.md:46 (mention) — Live at `<box>/activities/<name>/src/`. The `src/` subdirectory is deliberate — the activity directory isn't just code, 
- docs/activities-retrospective.md:21 (mention) — Each "activity-shaped" use case turned out to be better served by adding the specific capability (a card type, a schedul
- docs/adding-schemas.md:266 (mention) — 5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
- docs/agent-knowledge.md:7 (mention) — 1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CL
- docs/box-layout.md:9 (mention) — A box is a directory marked by a `.cb-box` file. It's a git repository (`cb init` initialises one), and the working tree
- docs/cards-as-markdown.md:231 (mention) — The explanation-length test (see Test results section) confirms this is modest, not dramatic: the full Cards section in 
- docs/design-vision.md:49 (mention) — - Small additions like a `CLAUDE.md` file with custom prompts are preferred to elaborate new structures
- docs/glossary.md:20 (mention) — **boxholder** — The human a box belongs to. Used in shared prose where "the user" is ambiguous (since agents are also "u
- docs/ideas.md:38 (mention) — *instructions* (akin to CLAUDE.md), where should it land? Today the only home
- docs/implemented-plans/app-wide-csp.md:217 (mention) — `mode`. Lives in `src/lib/` per CLAUDE.md ("Cross-cutting helpers").
- docs/implemented-plans/attach-implementation.md:156 (mention) — Throughout prompts, generated docs, agent instructions, and `CLAUDE.md` mentions, the user-facing terminology is "card a
- docs/implemented-plans/box-retrospectives.md:46 (mention) — - "Treat noisy command output as a bug" (monorepo CLAUDE.md) — `cb retro`
- docs/implemented-plans/box-search.md:47 (mention) — - Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — search and
- docs/implemented-plans/boxes-as-packages-v2.md:54 (mention) — - Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — scaffold/upgrade commands
- docs/implemented-plans/card-view-widgets.md:542 (mention) — CLAUDE.md's "don't add features beyond what the task requires."
- docs/implemented-plans/chat-stream-finalize-unify.md:338 (mention) — `CLAUDE.md` (`src/frontend/src/components/chat/CLAUDE.md`, shipped with the scroll
- docs/implemented-plans/courseware-phase1.md:98 (mention) — "filename supplies the type — there is no `type:` field"** (`CLAUDE.md:39`), so templates
- docs/implemented-plans/extfile-card.md:39 (mention) — (CLAUDE.md exempts *"per-box config, throwaway replies, and personal
- docs/implemented-plans/link-validation-fix.md:28 (mention) — - User-global rule (project CLAUDE.md) — *"NEVER disable or weaken a lint rule to
- docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:9 (mention) — - **Card validation pipeline** — `cb validate` PostToolUse hook + pre-commit hook (per CLAUDE.md). Markdoc's `Markdoc.va
- docs/implemented-plans/markdoc-tags-design.md:177 (mention) — text in the compiled CLAUDE.md include (not lost); the warning surfaces
- docs/implemented-plans/markdoc-tags-design.review.md:5 (mention) — source. Trace each to a stated preference in CLAUDE.md / CODE-STYLE.md
- docs/implemented-plans/named-places.md:85 (mention) — (the CLAUDE.md parse-mutate-reserialize contract, faithful form). **Not**
- docs/implemented-plans/normalize-chat-links.md:80 (mention) — - **Monorepo `CLAUDE.md:` "NEVER disable or weaken a lint rule… Ask first."**
- docs/implemented-plans/open-chat-from-card.md:265 (mention) — pane; CLAUDE.md's "don't add features beyond what the task requires."
- docs/implemented-plans/procedure-validation-completion.md:33 (mention) — - *"Treat noisy command output as a bug"* (monorepo `CLAUDE.md`) — model calls and retries must stay quiet on the happy 
- docs/implemented-plans/refresh-clerk.md:17 (mention) — - Monorepo `CLAUDE.md` — **"NEVER disable or weaken a lint rule to make code
- docs/implemented-plans/remove-cardworks-and-xml.md:416 (mention) — pnpm-workspace entry. Update `callback-box/CLAUDE.md`, root `CLAUDE.md`,
- docs/implemented-plans/remove-cardworks-deletion.md:127 (mention) — CLAUDE.md "refs starting with `attach/` resolve into this scope").
- docs/implemented-plans/remove-cardworks-package.md:87 (mention) — - **`callback-box/CLAUDE.md`** — `CLAUDE.md:28` (current): *"Every built-in
- docs/implemented-plans/rest-to-trpc-consolidation.md:143 (mention) — already runs cross-origin-capable via `wsLink`/`splitLink` (`CLAUDE.md`).
- docs/implemented-plans/schema-validate-hook.md:242 (mention) — (`CLAUDE.md` Behavioral Notes). Designed-for, not built — see Open questions
- docs/implemented-plans/selection-commentary.md:445 (mention) — explained will be misread; CLAUDE.md's "improving these instructions" loop
- docs/implemented-plans/shared-frontend-backend-code.subplan.md:23 (mention) — `CLAUDE.md`. We share what Track 2 forces us to share. We do not
- docs/implemented-plans/user-location.md:255 (mention) — CLAUDE.md default; the raw-route carve-out doesn't apply. (An earlier
- docs/implemented-plans/view-render-testing.md:258 (mention) — of the orphan-prone dev machinery in CLAUDE.md — no router, no Vite, no Fastify,
- docs/implemented-plans/web-page-commentary.md:125 (mention) — - **callback-clerk `CLAUDE.md`** — *"domain code never imports React, WXT, or
- docs/implemented-plans/websocket-chat-transport.md:230 (mention) — and it reuses the framework we're already deep in (CLAUDE.md's "tRPC by
- docs/knowledge-audits.md:19 (mention) — - After touching CLAUDE.md, schemas, prompts, or anything that changes what an agent should know.
- docs/maintenance.md:7 (mention) — The system carries a lot of agent-facing surface: CLAUDE.md and rule files, schemas with embedded `instructions`, prompt
- docs/plans/box-commentary-surface.md:377 (mention) — (CLAUDE.md exempts "per-box config, throwaway replies, and personal memory"),
- docs/plans/docs-reorg.gap-analysis.md:36 (mention) — `setTimeout` counts macOS sleep. CLAUDE.md covers the analogous
- docs/plans/docs-reorg.md:9 (mention) — history out of the way but findable, and slim CLAUDE.md files down to
- docs/plans/prompt-surface-ia-review.md:141 (mention) — empty in every box (only auto-generated `MAP.md`/`CLAUDE.md`, zero real items)
- docs/prompt-logging.md:3 (mention) — When agents run in a callback box (via `cb wakeup`, `cb reactor`, procedures, etc.), you can capture the full API traffi
- docs/stack-decisions.md:1183 (mention) — `CLAUDE.md` for the user-facing workflow. The old Overmind-based dev
- docs/unimplemented-plans/boxes-as-packages.md:411 (mention) — The boxes are physically still at `~/src/boxes/<box>/` (outside the callback monorepo, so agents working inside a box do
- docs/user-stories.md:1474 (mention) — > As a developer debugging an agent run, I want to capture full API traffic including system prompts, CLAUDE.md context,

References:
- → CLAUDE.md (mention)
- → deploy/README.md (mention)
- → docs/implemented-plans/external-url-validation.md (mention)
- → docs/cards-as-markdown.md (mention)
- → FRONTEND.md (mention)
- → docs/box-layout.md (mention)
- → src/services/CLAUDE.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/client-debug-log.md (mention)
- → CODE-STYLE.md (mention)
- → docs/DESIGN.md (mention)
- → docs/IMPLEMENTATION.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/testing.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/migrations.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/connectors.md (mention)
- → docs/procedure-implementation.md (mention)
- → docs/server-operations.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/landmarks.md (mention)
- → docs/content-security-policy.md (mention)
- → docs/maintenance.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/ssr-render-testing.md (mention)
- → docs/calendar.md (mention)
- → docs/plans/pdf-intake-design.md (mention)
- → docs/plans/source-editor.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/ideas.md (mention)
- → docs/glossary.md (mention)
- → CODE-STYLE.md (at-include)

#### CODE-STYLE.md

Title: "Code Style" | 60 lines

Referenced by:
- CLAUDE.md:114 (mention) — When you get corrected on a convention, pattern, or workflow that wasn't documented, update CLAUDE.md, CODE-STYLE.md, FR
- CLAUDE.md:149 (at-include) — @CODE-STYLE.md
- FRONTEND.md:3 (mention) — UI palette, primitives, and the `className` rule. Backend code never needs to load this; CODE-STYLE.md covers convention
- docs/ideas.md:1686 (mention) — since deleted — most of its scope was completed and folded into CODE-STYLE.md,
- docs/implemented-plans/agent-applied-migrations.md:84 (mention) — - `callback-box/CODE-STYLE.md` — max 2 positional params (named options), no
- docs/implemented-plans/app-wide-csp.md:28 (mention) — - `callback-box/CODE-STYLE.md:` no `any`, max 2 positional params, custom error
- docs/implemented-plans/box-retrospectives.md:39 (mention) — - `callback-box/CODE-STYLE.md` — custom error classes; no silent error
- docs/implemented-plans/box-search.md:38 (mention) — - `callback-box/CODE-STYLE.md`: max 2 positional params, no default
- docs/implemented-plans/boxes-as-packages-v2.md:48 (mention) — - `callback-box/CODE-STYLE.md`: strict types, no `any`, custom error classes — the new
- docs/implemented-plans/card-view-widgets.md:22 (mention) — - `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional
- docs/implemented-plans/chat-scroll-redesign.md:46 (mention) — - `callback-box/CODE-STYLE.md:36-37` — no default parameters; max 2 positional
- docs/implemented-plans/chat-stream-finalize-unify.md:48 (mention) — - `callback-box/CODE-STYLE.md:37` — max 2 positional params; new/changed
- docs/implemented-plans/companion-pane-card-activity.md:36 (mention) — - `callback-box/CODE-STYLE.md` — files ≤300 lines, no default parameters, max 2
- docs/implemented-plans/courseware-lesson-plan.md:23 (mention) — - `callback-box/CODE-STYLE.md` — no `any`, no default params, max 2 positional params, files ≤300
- docs/implemented-plans/courseware-phase1.md:100 (mention) — - `callback-box/CODE-STYLE.md` → **"No default parameters"**, **"Max 2 positional
- docs/implemented-plans/extfile-card.md:42 (mention) — - `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional params
- docs/implemented-plans/figure-card-type.md:72 (mention) — - **`callback-box/CODE-STYLE.md`** — *"No default parameters"*, *"Max 2 positional
- docs/implemented-plans/job-xml-purge.subplan.md:35 (mention) — - `callback-box/CODE-STYLE.md` — no `any`, max-2 positional params, named-error
- docs/implemented-plans/link-validation-fix.md:31 (mention) — - `callback-box/CODE-STYLE.md` — no `any`, double quotes, semicolons, max 2
- docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:16 (mention) — Drawn from `CLAUDE.md` and `CODE-STYLE.md`; referenced by name in findings below.
- docs/implemented-plans/markdoc-tags-design.review.md:5 (mention) — source. Trace each to a stated preference in CLAUDE.md / CODE-STYLE.md
- docs/implemented-plans/named-places.md:53 (mention) — - `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional params,
- docs/implemented-plans/normalize-chat-links.md:76 (mention) — - **`callback-box/CODE-STYLE.md:` no default parameters; max 2 positional
- docs/implemented-plans/open-chat-from-card.md:53 (mention) — - `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional params (the new
- docs/implemented-plans/procedure-validation-completion.md:35 (mention) — - **`callback-box/CODE-STYLE.md`** — no `any`; no default parameters; max 2 positional params (named-params objects); cu
- docs/implemented-plans/refresh-clerk.md:23 (mention) — - `callback-box/CODE-STYLE.md` — no optional chaining, no default params, max
- docs/implemented-plans/remove-cardworks-and-xml.md:51 (mention) — - **`callback-box/CODE-STYLE.md`** — `CODE-STYLE.md:25`: *"NEVER use
- docs/implemented-plans/remove-cardworks-deletion.md:100 (mention) — - **`callback-box/CODE-STYLE.md:25`** (no `any`), **`:55`** (`as` is like Rust
- docs/implemented-plans/remove-cardworks-package.md:93 (mention) — - **`callback-box/CODE-STYLE.md`** — `CODE-STYLE.md:25` (no `any`),
- docs/implemented-plans/rest-to-trpc-consolidation.md:43 (mention) — - **`callback-box/CODE-STYLE.md`** — Zod-validated inputs, `only export what's
- docs/implemented-plans/schema-validate-hook.md:32 (mention) — - `callback-box/CODE-STYLE.md` — *"as type assertions are like Rust's
- docs/implemented-plans/selection-commentary.md:88 (mention) — - `callback-box/CODE-STYLE.md:36` — *"**No default parameters**: handle
- docs/implemented-plans/slopo-codehealth-adoption.md:42 (mention) — - **`callback-box/CODE-STYLE.md`** — style preferences; the centralise-a-cast
- docs/implemented-plans/user-location.md:60 (mention) — - `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional
- docs/implemented-plans/view-render-testing.md:28 (mention) — - `callback-box/CODE-STYLE.md` — no `any`; custom error classes not
- docs/implemented-plans/web-page-commentary.md:122 (mention) — - **`callback-box/CODE-STYLE.md`** — no `any`; no default parameters; max 2
- docs/implemented-plans/webpage-card-and-commentary.md:48 (mention) — - `callback-box/CODE-STYLE.md` — no optional chaining, no default params,
- docs/implemented-plans/websocket-chat-transport.md:72 (mention) — - `callback-box/CODE-STYLE.md:` no `any`, no default params, max 2 positional
- docs/plans/box-commentary-surface.md:94 (mention) — - `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional
- docs/plans/docs-reorg.md:27 (mention) — (root 47 + callback-box 149 + `@`-imported CODE-STYLE.md 59).
- docs/plans/prompt-surface-ia-review.md:375 (mention) — - **`callback-box/CODE-STYLE.md`** — no default params, ≤2 positional params, no
- docs/unimplemented-plans/query-cards.md:34 (mention) — - `callback-box/CODE-STYLE.md` — strict types, no `any`, custom errors,

References:
- → FRONTEND.md (mention)

#### FRONTEND.md

Title: "Frontend Conventions" | 109 lines

Referenced by:
- CLAUDE.md:69 (mention) — src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see FRONTEND.md
- CODE-STYLE.md:3 (mention) — General coding conventions for backend and frontend. UI palette and primitive reference live in FRONTEND.md.
- FRONTEND.md:108 (mention) — New primitives live in `components/ui/<Name>.tsx`, accept `className`, merge via `cn()`, and document their semantic rol
- docs/ideas.md:485 (mention) — Method: do one sweep through `CLAUDE.md`, `FRONTEND.md`, the schemas, and `docs/` collecting terms-of-art, then write en
- docs/implemented-plans/card-view-widgets.md:24 (mention) — - `callback-box/FRONTEND.md:34` — *"Reach for a primitive from
- docs/implemented-plans/chat-scroll-redesign.md:37 (mention) — palette. Read FRONTEND.md before writing UI … the `className`-only-for-outer-layout
- docs/implemented-plans/chat-stream-finalize-unify.md:44 (mention) — palette. Read FRONTEND.md before writing UI"* and the
- docs/implemented-plans/figure-card-type.md:76 (mention) — - **`callback-box/FRONTEND.md`** — UI primitives + `className`-only-for-outer-
- docs/implemented-plans/narration-mode-design.md:193 (mention) — Color and primitive choices follow the box's semantic palette (see `FRONTEND.md`); the accent role is appropriate.
- docs/implemented-plans/open-chat-from-card.md:57 (mention) — - `callback-box/FRONTEND.md` — UI primitives + semantic palette, `className` only for
- docs/implemented-plans/selection-commentary.md:103 (mention) — semantic palette.** Read FRONTEND.md before writing UI."* The pill and
- docs/implemented-plans/user-location.md:63 (mention) — - `callback-box/FRONTEND.md` — UI primitives + the `className`-only-for-
- docs/plans/docs-reorg.gap-analysis.md:64 (mention) — FRONTEND.md implies categorical enforcement. Rule of thumb to state:
- docs/plans/docs-reorg.md:134 (mention) — correctly `@`-imported; FRONTEND.md is the model for load-on-demand

References:
- → CODE-STYLE.md (mention)
- → docs/data-source-tagging.md (mention)
- → FRONTEND.md (mention)

#### README.md

Title: "callback-box" | 84 lines

Referenced by:
- docs/adding-a-box.md:20 (link) — see the root [`README.md`](../README.md) for that path. This doc is about
- docs/cards-as-markdown.md:72 (mention) — - `README.md` — plain markdown, not a card
- docs/implemented-plans/boxes-as-packages-v2.md:497 (mention) — (a real converted v2 box); `README.md`, `docs/adding-a-box.md`, and `deploy/README.md` are
- docs/implemented-plans/courseware-lesson-plan.md:13 (mention) — the material convention (proper presentational cards, not a stray `README.md`).

References:
- → docs/implemented-plans/boxes-as-packages-v2.md (link)
- → CLAUDE.md (mention)
- → docs/box-layout.md (link)
- → docs/cards-as-markdown.md (link)
- → docs/adding-schemas.md (link)
- → docs/adding-a-box.md (link)
- → docs/migrations.md (link)

### deploy/

#### deploy/CLAUDE.md **[ORPHAN]**

Title: "Deploy" | 26 lines

References:
- → deploy/README.md (mention)

#### deploy/README.md

Title: "Deploy" | 242 lines

Referenced by:
- CLAUDE.md:24 (mention) — **Deploy** — Post-commit hook auto-deploys via `deploy/deploy.sh` (rsync to server) **only when HEAD is `main`**. Worktr
- deploy/CLAUDE.md:3 (mention) — Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.
- docs/adding-a-box.md:102 (link) — [`deploy/README.md`](../deploy/README.md) for the full provisioning story,
- docs/implemented-plans/boxes-as-packages-v2.md:76 (mention) — | In-process Google OAuth gate + per-box `allowedEmails` ACL | preHandler + ACL in `src/webapp/server-box-scope.ts:59-80
- docs/plans/docs-reorg.md:125 (mention) — internals (already covered by `deploy/README.md`). Its dev-server section
- docs/server-operations.md:3 (link) — Reference for the running callback-box server (production at `box.example.com`). For initial provisioning scripts see 

References:
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/adding-a-box.md (link)

### docs/

#### docs/activities-design.md

Title: "Activities — Design Proposal" | 311 lines

Referenced by:
- docs/activities-retrospective.md:7 (link) — An "Activity" was a reusable container for non-default chat shapes (language learning, notebook, guided journaling, etc.
- docs/implemented-plans/narration-mode-design.md:333 (mention) — - **Activities** (`docs/activities-design.md`): being phased out in favor of composable feature flags. Narration is the 
- docs/plans/README.md:84 (mention) — reference-vs-proposal before moving: `activities-design.md`,
- docs/plans/docs-reorg.md:224 (mention) — `activities-design.md` + `activities-retrospective.md` pair (the model for

References:
- → docs/activities-retrospective.md (link)
- → CLAUDE.md (mention)

#### docs/activities-retrospective.md

Title: "Activities — Retrospective" | 44 lines

Referenced by:
- docs/activities-design.md:3 (link) — > **Status: removed.** The Activities system was built and then removed in May 2026 in favor of piecemeal opt-in feature
- docs/implemented-plans/narration-mode-design.md:5 (link) — > Note: this doc references the Activities system as a coordinate ("the infrastructure that makes activities being phase
- docs/plans/docs-reorg.md:224 (mention) — `activities-design.md` + `activities-retrospective.md` pair (the model for

References:
- → docs/activities-design.md (link)
- → CLAUDE.md (mention)
- → docs/implemented-plans/narration-mode-design.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/IMPLEMENTATION.md (mention)

#### docs/adding-a-box.md

Title: "Adding a Box" | 125 lines

Referenced by:
- CLAUDE.md:133 (mention) — | Adding a box | `docs/adding-a-box.md` |
- README.md:81 (link) — - [`docs/adding-a-box.md`](docs/adding-a-box.md) — provisioning a box behind a multi-box hub
- deploy/README.md:80 (link) — (see [`docs/adding-a-box.md`](../docs/adding-a-box.md)); this script doesn't
- docs/ideas.md:550 (mention) — For now: manually copy secret files to new boxes. See `docs/adding-a-box.md`'s "Connector secrets" section.
- docs/implemented-plans/boxes-as-packages-v2.md:497 (mention) — (a real converted v2 box); `README.md`, `docs/adding-a-box.md`, and `deploy/README.md` are
- docs/plans/cli-restructure.md:128 (mention) — (see `docs/adding-a-box.md`), `cb upgrade` is the per-box engine-upgrade
- docs/plans/docs-reorg.gap-analysis.md:126 (mention) — `docs/adding-a-box.md`.
- docs/server-operations.md:184 (link) — - [`adding-a-box.md`](./adding-a-box.md) — per-box setup (secrets, connectors, box directory layout).

References:
- → docs/implemented-plans/boxes-as-packages-v2.md (link)
- → docs/box-layout.md (link)
- → README.md (link)
- → deploy/README.md (link)

#### docs/adding-api-endpoints.md

Title: "Adding API Endpoints" | 237 lines

Referenced by:
- CLAUDE.md:128 (mention) — | Adding API endpoints | `docs/adding-api-endpoints.md` |
- docs/plans/docs-reorg.gap-analysis.md:151 (mention) — `docs/adding-api-endpoints.md`, `docs/asset-manifests.md`,
- docs/plans/docs-reorg.md:144 (mention) — - **Skill-promotion candidates**: `adding-api-endpoints.md` (tRPC-vs-REST

#### docs/adding-schemas.md

Title: "Adding a New Card Schema" | 280 lines

Referenced by:
- CLAUDE.md:125 (mention) — | Adding a card type | `docs/adding-schemas.md` |
- README.md:80 (link) — - [`docs/adding-schemas.md`](docs/adding-schemas.md) — adding a new card type
- docs/EXAMPLE_FILES.md:4 (mention) — > - **Schema authoring**: For how to add a new schema today, see `docs/adding-schemas.md`.
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a schema from `callback-box/cards`. The atomic unit of data in a box. Named `Title.
- docs/implemented-plans/box-schema-reload.md:247 (mention) — - Mirror in `docs/adding-schemas.md` if it implies `cb init` re-registers.
- docs/implemented-plans/box-search.md:45 (mention) — - `docs/adding-schemas.md`: the checklist any schema-surface change follows
- docs/implemented-plans/remove-cardworks-and-xml.md:417 (mention) — `docs/cards-as-markdown.md`, `docs/adding-schemas.md`.
- docs/implemented-plans/remove-cardworks-deletion.md:455 (mention) — `CLAUDE.md:87`/`docs/adding-schemas.md` (the cardworks bullet → `src/cards/`),
- docs/implemented-plans/remove-cardworks-package.md:323 (mention) — `CLAUDE.md:39`/`docs/adding-schemas.md` (drop "from cardworks" phrasing where
- docs/implemented-plans/schema-validate-hook.md:4 (mention) — > convention lives in `docs/adding-schemas.md`, the box-local schema guide
- docs/migrations.md:267 (mention) — - `docs/adding-schemas.md` — when a *schema* change (not a data shape change) is the right move instead of a migrator
- docs/plans/docs-reorg.gap-analysis.md:44 (mention) — prime retrieval field. `docs/adding-schemas.md` never mentions it and
- docs/plans/docs-reorg.md:84 (mention) — (`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,
- docs/user-stories.md:764 (mention) — Files: `src/cards/schema.ts`, `src/schemas/audio.tsx`, `src/schemas/memo.ts`, `docs/adding-schemas.md`

References:
- → CLAUDE.md (mention)

#### docs/agent-knowledge.md

Title: "Agent Knowledge Audit: What It Should Know and How to Verify" | 493 lines

Referenced by:
- docs/implemented-plans/card-view-widgets.md:574 (mention) — **Altitude.** Per `docs/agent-knowledge.md:307` view authoring sits at
- docs/plans/docs-reorg.md:152 (mention) — `agent-knowledge.md`, harness mechanics in `knowledge-audits.md`, routing
- docs/testing.md:377 (link) — See [agent-knowledge.md](agent-knowledge.md) for the full knowledge taxonomy and test prompt guide.

References:
- → CLAUDE.md (mention)
- → docs/connectors.md (mention)
- → docs/triage-design.md (mention)
- → view:store/path/to/file.md (link) **[BROKEN]**

#### docs/asset-manifests.md

Title: "Asset Manifests" | 274 lines

Referenced by:
- docs/glossary.md:30 (mention) — **asset manifest** — `manifest.json` inside each `.attach/` directory recording every asset's size, mtime, and sha256. C
- docs/ideas.md:491 (mention) — The asset-manifest hook (`docs/asset-manifests.md`) scopes its discipline to `**/*.attach/**` only. Binaries outside att
- docs/implemented-plans/attach-implementation.md:3 (mention) — **Shipped differently than this draft describes.** The `.attach/` convention landed, but as part of the asset-manifest s
- docs/plans/README.md:90 (mention) — to `implemented-plans/` (superseded by `docs/asset-manifests.md`), and
- docs/plans/docs-reorg.gap-analysis.md:151 (mention) — `docs/adding-api-endpoints.md`, `docs/asset-manifests.md`,
- docs/plans/pdf-intake-design.md:80 (link) — All the binaries are assets — tracked via the asset manifest, not committed to git. The card itself, the manifest, and t
- docs/user-stories.md:713 (mention) — 1. **Pre-commit hook integration missing**: The design doc (docs/asset-manifests.md) says "A pre-commit hook keeps the m

References:
- → docs/ideas.md (mention)

#### docs/box-layout.md

Title: "Box Layout" | 192 lines

Referenced by:
- CLAUDE.md:87 (mention) — **Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md). `~/src/boxes/test1/` is the
- README.md:70 (link) — writes, and moves as it works. See [`docs/box-layout.md`](docs/box-layout.md)
- docs/adding-a-box.md:12 (link) — a `content/` directory inside it — see [`docs/box-layout.md`](box-layout.md)
- docs/glossary.md:18 (mention) — **box** — A single user's working directory under `~/src/boxes/` (or `/home/callback/boxes/` on the server). Contains th
- docs/implemented-plans/attach-implementation.md:163 (mention) — - `docs/box-layout.md`
- docs/implemented-plans/box-retrospectives.md:413 (mention) — (`enabled="false"`), `docs/box-layout.md` + `docs/maintenance.md` +
- docs/implemented-plans/boxes-as-packages-v2.md:45 (mention) — - `docs/box-layout.md:139-143`: boxes contain no app code, no global secrets, no cross-box
- docs/implemented-plans/named-places.md:175 (mention) — but no `places`), keeping `docs/box-layout.md` and the box-shape agent guide
- docs/implemented-plans/user-location.md:74 (mention) — at `docs/box-layout.md:18-22`. State files there are never committed.
- docs/plans/docs-reorg.gap-analysis.md:41 (mention) — `docs/box-layout.md`.
- docs/plans/docs-reorg.md:84 (mention) — (`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,
- docs/plans/prompt-surface-ia-review.md:146 (mention) — (`box-layout.md`) and the `box.doctest.md` created-tree assertion updated to
- docs/user-stories.md:4927 (mention) — The user story is accurately implemented across both claimed files. `/Users/ianbicking/src/callback-worktrees/user-stori

References:
- → CLAUDE.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/triage-design.md (mention)
- → docs/client-debug-log.md (mention)

#### docs/calendar.md

Title: "Calendar Integration" | 89 lines

Referenced by:
- CLAUDE.md:141 (mention) — | Calendar integration | `docs/calendar.md` |
- docs/EXAMPLE_FILES.md:60 (mention) — └── calendar.md
- docs/IMPLEMENTATION.md:675 (mention) — calendar.md          # Rules for calendar operations
- docs/implemented-plans/user-story-audit-followups.md:33 (mention) — `docs/calendar.md` updated ([46]).
- docs/user-stories.md:2267 (mention) — Key limitation from docs/calendar.md (line 77): "One-way only. Local .ics edits are not detected or pushed back to Googl

#### docs/cards-as-markdown.md

Title: "RFC: Cards as Markdown + YAML Frontmatter" | 2553 lines

Referenced by:
- CLAUDE.md:53 (mention) — See `src/core/install-validation-hooks.ts`. The hook commands embed the absolute path to the installing `bin/cb` so they
- README.md:79 (link) — - [`docs/cards-as-markdown.md`](docs/cards-as-markdown.md) — the card format
- docs/DESIGN.md:4 (mention) — > - §3–§4 describe an XML envelope as the canonical card format. As of May 2026, most schemas are YAML frontmatter + mar
- docs/EXAMPLE_FILES.md:2 (mention) — > - **Card format**: Most schemas are now YAML frontmatter + markdown body, not XML. The XML examples below show the old
- docs/IMPLEMENTATION.md:4 (mention) — > - Card format: most schemas are now YAML frontmatter + markdown body, not XML. Anywhere this doc shows an XML envelope
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a schema from `callback-box/cards`. The atomic unit of data in a box. Named `Title.
- docs/implemented-plans/remove-cardworks-and-xml.md:117 (mention) — production migration"* (`docs/cards-as-markdown.md`). **Reuse:** the
- docs/migrations.md:265 (mention) — - `docs/cards-as-markdown.md` — design rationale for the YAML-frontmatter format these migrators target
- docs/plans/docs-reorg.md:106 (mention) — 7. `cards-as-markdown.md` — 2,552 lines of resolved RFC with ~50
- docs/stack-decisions.md:18 (mention) — | 15 | [Markdoc](#decision-15-markdown-parsing--markdoc) | Frontend renders markdown via `@markdoc/markdoc` (replaced re

References:
- → docs/migrations.md (mention)
- → README.md (mention)
- → CLAUDE.md (mention)

#### docs/chat-schedules.md

Title: "Chat Schedules" | 90 lines

Referenced by:
- docs/plans/docs-reorg.md:169 (mention) — `chat-schedules.md` (current and load-bearing — the worst case),

#### docs/chat-scroll-testing.md

Title: "Chat scroll — manual test procedure" | 130 lines

Referenced by:
- docs/implemented-plans/chat-composer-rerender.md:140 (mention) — 4. Manual procedure in `docs/chat-scroll-testing.md` (stick-to-bottom,
- docs/implemented-plans/chat-scroll-redesign.md:16 (mention) — > desktop Chrome via `bin/browse` (procedure: `docs/chat-scroll-testing.md`):
- docs/implemented-plans/chat-stream-finalize-unify.md:364 (mention) — procedure in `docs/chat-scroll-testing.md` (extended), not doctests
- docs/testing.md:515 (link) — checklist) lives in [chat-scroll-testing.md](chat-scroll-testing.md). The
- src/frontend/src/components/chat/CLAUDE.md:31 (mention) — `docs/chat-scroll-testing.md`** (drives the app via `bin/browse`; layout

References:
- → docs/testing.md (mention)

#### docs/client-debug-log.md

Title: "Client Debug Log" | 55 lines

Referenced by:
- CLAUDE.md:108 (mention) — - **Check client debug logs when debugging frontend issues.** The browser forwards console errors to the server (now via
- docs/box-layout.md:152 (mention) — | `client-debug.log` | Browser console errors forwarded from the frontend. See `docs/client-debug-log.md`. |
- docs/server-operations.md:178 (link) — For SSH-only debugging: `ssh root@<server> tail /home/callback/boxes/<box>/.callback-box/client-debug.log`. See [`client

#### docs/composer-input-machine.md

Title: "Composer input machine — design note" | 291 lines

Referenced by:
- docs/composer-states.md:5 (mention) — us, doing UI polish. Companion to `docs/composer-input-machine.md`, which
- docs/plans/docs-reorg.gap-analysis.md:106 (mention) — 10. `docs/composer-input-machine.md` leads with an unshipped 5-state

References:
- → docs/composer-states.md (mention)

#### docs/composer-states.md

Title: "Composer states" | 282 lines

Referenced by:
- docs/composer-input-machine.md:5 (mention) — in `test/frontend/composer-machine.doctest.md`). Audience: us. The companion doc `composer-states.md`

References:
- → docs/composer-input-machine.md (mention)

#### docs/connectors.md

Title: "Connectors" | 87 lines

Referenced by:
- CLAUDE.md:129 (mention) — | Connectors | `docs/connectors.md` |
- docs/agent-knowledge.md:205 (mention) — - **Expected level: Discoverable** — the agent would need to look at `config/connectors/` and/or `docs/generated/connect
- docs/ideas.md:938 (mention) — `src/connectors/gmail-gc.ts`, `docs/connectors.md`, and
- docs/implemented-plans/gmail-gc-unlabeled.md:5 (mention) — Lives in `src/connectors/gmail-gc.ts`; reference docs in `docs/connectors.md`.
- docs/plans/docs-reorg.gap-analysis.md:21 (mention) — `docs/connectors.md`. The strongest "confidently wrong, silent data
- docs/plans/docs-reorg.md:92 (mention) — 2. `connectors.md` — Google Calendar row says service-injection "Not yet

References:
- → src/services/CLAUDE.md (mention)
- → docs/triage-design.md (mention)

#### docs/content-security-policy.md

Title: "Content-Security-Policy" | 80 lines

Referenced by:
- CLAUDE.md:137 (mention) — | Content-Security-Policy | `docs/content-security-policy.md` |
- docs/implemented-plans/app-wide-csp.md:438 (mention) — `docs/content-security-policy.md`) describing the policy, the dev/prod split,
- docs/scheduled/csp-violation-review.md:6 (mention) — nothing — see `docs/content-security-policy.md`); this routine watches real
- src/dev/CLAUDE.md:13 (mention) — | `csp-digest.ts` | Digests the JSONL CSP violation log (incremental via per-box cursor) | `docs/content-security-policy

References:
- → docs/scheduled/csp-violation-review.md (mention)

#### docs/data-source-tagging.md

Title: "Data Source Tagging Convention" | 89 lines

Referenced by:
- FRONTEND.md:7 (mention) — UI elements that display data from a known source (card, commit, session, etc.) must be tagged with `data-cb-source` att

#### docs/design-vision.md

Title: "Callback Box: Design Vision and Architecture" | 68 lines

Referenced by:
- docs/plans/README.md:87 (mention) — `design-vision.md`, `stack-decisions.md` are reference and stay).
- docs/plans/docs-reorg.md:200 (mention) — - `design-vision.md` is a thinner, staler sibling of `DESIGN.md` — merge or

References:
- → docs/triage-design.md (mention)
- → CLAUDE.md (mention)

#### docs/DESIGN.md

Title: "Callback Box: comprehensive design notes" | 592 lines

Referenced by:
- CLAUDE.md:120 (mention) — | Design rationale | `docs/DESIGN.md` |
- docs/IMPLEMENTATION.md:8 (mention) — This document describes how to build Callback Box, complementing DESIGN.md with concrete implementation details.

References:
- → docs/triage-design.md (mention)
- → docs/cards-as-markdown.md (mention)

#### docs/doc-graph.md

Title: "(no title)" | 1 lines

Referenced by:
- docs/ideas.md:841 (mention) — Implemented as `docs/doc-graph.md` (auto-generated cross-reference report). See CLAUDE.md Doc Map.
- docs/maintenance.md:17 (mention) — | Doc graph | `pnpm doc-graph` | After restructuring docs | `docs/doc-graph.md` |
- docs/plans/docs-reorg.md:110 (mention) — (5,767 generated lines), `doc-graph.md` (build artifact among
- docs/testing.md:584 (mention) — `npx tsx src/dev/doc-graph.ts > docs/doc-graph.md` — scans all `.md` files, extracts cross-references, reports orphans a
- src/dev/CLAUDE.md:10 (mention) — | `doc-graph.ts` | Generates `docs/doc-graph.md` (cross-reference graph + orphan/broken-ref report) | `docs/maintenance.

#### docs/event-bus-design.md

Title: "Event Bus Design" | 145 lines

Referenced by:
- docs/plans/README.md:85 (mention) — `event-bus-design.md`, `photo-storage-investigation.md`. Left in place

#### docs/EXAMPLE_FILES.md

Title: "Callback Box: Example Files" | 820 lines

Referenced by:
- CLAUDE.md:122 (mention) — | Card examples | `docs/EXAMPLE_FILES.md` |
- docs/IMPLEMENTATION.md:228 (mention) — See EXAMPLE_FILES.md for RRULE examples and other card/schema samples.
- docs/IMPLEMENTATION.md:277 (link) — Config includes credential references, polling intervals, filters, etc. Agents can read these to understand what's avail
- docs/plans/docs-reorg.md:89 (mention) — 1. `EXAMPLE_FILES.md` — **wholesale stale** (~90% retired XML format; even

References:
- → docs/cards-as-markdown.md (mention)
- → docs/adding-schemas.md (mention)
- → CLAUDE.md (mention)
- → docs/calendar.md (mention)

#### docs/glossary.md

Title: "Glossary" | 55 lines

Referenced by:
- CLAUDE.md:147 (mention) — | Glossary | `docs/glossary.md` |
- docs/ideas.md:472 (mention) — `docs/glossary.md` is scoped to Proper Nouns — names we coined and general words we've narrowed to project-specific mean
- docs/plans/docs-reorg.gap-analysis.md:134 (mention) — `docs/glossary.md:22` vs `:42` contradict each other about it.
- docs/plans/docs-reorg.md:85 (mention) — `server-operations.md`, `procedure-implementation.md`, `glossary.md`,
- docs/plans/pdf-intake-design.md:19 (link) — **Intake-time extraction.** When a PDF arrives (`cb import`, capture endpoint, email connector), the intake path runs do

References:
- → docs/ideas.md (mention)
- → docs/box-layout.md (mention)
- → CLAUDE.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/asset-manifests.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/procedure-implementation.md (mention)
- → src/services/CLAUDE.md (mention)
- → docs/implemented-plans/remove-cardworks-package.md (mention)
- → docs/implemented-plans/box-retrospectives.md (mention)

#### docs/gmail-setup.md

Title: "Gmail Connector Setup" | 85 lines

Referenced by:
- docs/plans/docs-reorg.md:204 (mention) — - `google-setup.md` / `gmail-setup.md` / `google-drive.md` / `connectors.md`
- docs/user-stories.md:2043 (mention) — - docs/gmail-setup.md lines 37-41 (user documentation with examples)

References:
- → docs/google-setup.md (mention)

#### docs/google-drive.md

Title: "Google Drive Integration" | 140 lines

Referenced by:
- docs/plans/docs-reorg.md:204 (mention) — - `google-setup.md` / `gmail-setup.md` / `google-drive.md` / `connectors.md`
- docs/user-stories.md:2702 (mention) — The implementation is complete and accurate. The google-drive.ts connector's syncFolder() method (lines 260-312) fully i

References:
- → docs/google-setup.md (link)

#### docs/google-setup.md

Title: "Google Cloud Console Setup" | 136 lines

Referenced by:
- docs/gmail-setup.md:14 (mention) — If the server doesn't show the Google Services section at all, OAuth client credentials haven't been configured server-w
- docs/google-drive.md:7 (link) — 1. **Google OAuth** configured (see [google-setup.md](google-setup.md))
- docs/plans/docs-reorg.md:204 (mention) — - `google-setup.md` / `gmail-setup.md` / `google-drive.md` / `connectors.md`

#### docs/health-checks.md

Title: "Health Checks" | 60 lines

Referenced by:
- docs/plans/docs-reorg.md:174 (mention) — `health-checks.md` are load-bearing but missing from CLAUDE.md's Guides
- docs/server-operations.md:163 (link) — **Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — 

References:
- → docs/server-operations.md (link)

#### docs/ideas.md

Title: "Ideas & Planned Features" | 1719 lines

Referenced by:
- CLAUDE.md:145 (mention) — | Feature ideas | `docs/ideas.md` |
- docs/asset-manifests.md:266 (mention) — Noted in `docs/ideas.md`.
- docs/glossary.md:14 (mention) — **Open question — capitalization.** Proper nouns in English are normally capitalized. We may want to write "Asset" and "
- docs/ideas.md:1202 (mention) — This `ideas.md` plus scattered TODOs across the monorepo is the current state of issue tracking. It works for a single a
- docs/implemented-plans/box-search.md:41 (mention) — - `docs/ideas.md:493` § CLI Design for Agents: enumerate valid values in
- docs/implemented-plans/boxes-as-packages-v2.md:498 (mention) — rewritten for the hub era; `docs/server-operations.md` and `docs/ideas.md` had stale pre-hub
- docs/implemented-plans/user-story-audit-followups.md:42 (mention) — unbuilt bucket-D features are now parked as the backlog in `docs/ideas.md`
- docs/implemented-plans/webpage-card-and-commentary.md:105 (mention) — - **Directory head-cards idea.** `docs/ideas.md:740-755` — the unifying frame:
- docs/plans/README.md:59 (mention) — worth pursuing get cross-linked into `docs/ideas.md` or promoted to an actual
- docs/plans/docs-reorg.md:78 (mention) — `ideas.md` (1,681 lines) is also a backlog but is well-linked and functions
- docs/plans/input-widget.md:287 (mention) — apparatus). `unaddressed` (triage memo, ideas.md) is a declared kind
- docs/plans/interface-as-cards.md:6 (mention) — "The interface itself as cards" entry in `docs/ideas.md`; this doc supersedes
- docs/prompt-audits.md:5 (link) — Many of the lenses here, and a number of the related entries in [ideas.md](ideas.md), originated from working through th
- docs/unimplemented-plans/boxes-as-packages.md:702 (link) — - **Interaction with the [Markdown cards idea](../ideas.md#markdown-cards-replacing-xml).** Both touch the schema-defini

References:
- → CLAUDE.md (mention)
- → docs/prompt-audits.md (mention)
- → docs/implemented-plans/narration-mode-design.md (link)
- → docs/triage-design.md (mention)
- → docs/glossary.md (mention)
- → FRONTEND.md (mention)
- → docs/asset-manifests.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/IMPLEMENTATION.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/doc-graph.md (mention)
- → docs/testing.md (mention)
- → docs/connectors.md (mention)
- → docs/implemented-plans/gmail-gc-unlabeled.md (mention)
- → docs/implemented-plans/box-search.md (mention)
- → docs/landmarks.md (mention)
- → docs/ideas.md (mention)
- → docs/implemented-plans/user-story-audit-followups.md (mention)
- → docs/procedure-implementation.md (mention)
- → CODE-STYLE.md (mention)
- → docs/maintenance.md (mention)
- → docs/knowledge-audits.md (mention)

#### docs/IMPLEMENTATION.md

Title: "Callback Box: Implementation Guide" | 1018 lines

Referenced by:
- CLAUDE.md:121 (mention) — | Implementation guide | `docs/IMPLEMENTATION.md` |
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `s
- docs/ideas.md:610 (mention) — `cb` currently has only layer 1. Layer 2 would be straightforward to generate from the existing command definitions (yar
- docs/plans/docs-reorg.md:198 (mention) — `DESIGN.md`/`IMPLEMENTATION.md` — never cross-referenced. Decide canonical

References:
- → docs/triage-design.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/DESIGN.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/EXAMPLE_FILES.md (link)
- → CLAUDE.md (mention)
- → docs/calendar.md (mention)

#### docs/knowledge-audit-rerun-2026-07-03.md

Title: "Knowledge-audit full rerun — 2026-07-03" | 465 lines

Referenced by:
- docs/plans/docs-reorg.md:109 (mention) — `knowledge-audit-rerun-2026-07-03.md` (orphaned), `user-stories.md`

References:
- → docs/triage-design.md (mention)
- → docs/landmark-curation.md (mention)

#### docs/knowledge-audits.md

Title: "Knowledge Audits" | 89 lines

Referenced by:
- CLAUDE.md:139 (mention) — | Knowledge audits | `docs/knowledge-audits.md` |
- docs/ideas.md:1687 (mention) — FRONTEND.md, docs/maintenance.md, and docs/knowledge-audits.md over several
- docs/maintenance.md:31 (mention) — **Full guide:** `docs/knowledge-audits.md` (test structure, recording results, interpreting failures).
- docs/plans/docs-reorg.md:113 (mention) — policy — `.gitignore` and `knowledge-audits.md` both say reports are
- docs/user-stories.md:5670 (mention) — Both claimed files exist at the correct paths. The implementation is complete: test-runner.ts extracts context metrics f
- src/dev/CLAUDE.md:7 (mention) — | `knowledge-audit.ts` | Runs YAML-defined tests against a real box agent | `docs/knowledge-audits.md` |

References:
- → CLAUDE.md (mention)
- → docs/maintenance.md (mention)
- → MAP.md (at-include) **[BROKEN]**

#### docs/landmark-curation.md

Title: "Landmark Curation" | 48 lines

Referenced by:
- docs/knowledge-audit-rerun-2026-07-03.md:261 (mention) — (`docs/landmark-curation.md`, `docs/triage-design.md`) that don't exist in
- docs/plans/docs-reorg.md:186 (mention) — Two flagged cases: `landmark-curation.md` is written as second-person

References:
- → docs/landmarks.md (mention)

#### docs/landmarks.md

Title: "Landmarks" | 164 lines

Referenced by:
- CLAUDE.md:135 (mention) — | Landmarks (navigation surface) | `docs/landmarks.md` |
- docs/ideas.md:992 (mention) — Started as "a landmark-ish marker in the card itself" and resolved (2026-06-12 discussion) into a unification: **there i
- docs/implemented-plans/open-chat-from-card.md:96 (mention) — `contextDir` chosen at the call site (`LandmarkSection.tsx:96`). `docs/landmarks.md` (per the
- docs/implemented-plans/web-page-commentary.md:264 (mention) — destinations API, extension UI labels, docs/landmarks.md, knowledge audits.
- docs/landmark-curation.md:5 (mention) — For the design and schema of the card itself, see `docs/landmarks.md` and `docs/generated/card-landmark.md`.
- docs/unimplemented-plans/query-cards.md:14 (mention) — planned in docs/landmarks.md long before this, useful for any list-shaped
- docs/user-stories.md:732 (mention) — The file src/core/frontmatter-field.ts exports two functions that implement the exact capability described. lookupField(

References:
- → docs/triage-design.md (mention)

#### docs/maintenance.md

Title: "Code Maintenance" | 97 lines

Referenced by:
- CLAUDE.md:138 (mention) — | Periodic maintenance | `docs/maintenance.md` |
- docs/ideas.md:1687 (mention) — FRONTEND.md, docs/maintenance.md, and docs/knowledge-audits.md over several
- docs/implemented-plans/box-retrospectives.md:413 (mention) — (`enabled="false"`), `docs/box-layout.md` + `docs/maintenance.md` +
- docs/knowledge-audits.md:22 (mention) — `docs/maintenance.md` lists this alongside the other periodic tasks.
- docs/migrations.md:266 (mention) — - `docs/maintenance.md` — where `cb migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface
- docs/plans/cli-restructure.md:136 (mention) — - **Card normalization story.** `cb format` was deleted (80-line one-off normalizer that re-serialized cards to flat XML
- src/dev/CLAUDE.md:8 (mention) — | `prompt-report.ts` | Generates `docs/prompts.md` (system-wide prompt inventory) | `docs/maintenance.md` |

References:
- → CLAUDE.md (mention)
- → docs/doc-graph.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/migrations.md (mention)
- → docs/architecture/CLAUDE.md (mention)

#### docs/migrations.md

Title: "Box Migrations" | 280 lines

Referenced by:
- CLAUDE.md:127 (mention) — | Box migration runbook | `docs/migrations.md` |
- README.md:82 (link) — - [`docs/migrations.md`](docs/migrations.md) — the data-migration runbook
- docs/cards-as-markdown.md:44 (mention) — **Tracking which migrations have been applied per box** is handled by `cb migrate` against the per-box append-only manif
- docs/implemented-plans/agent-applied-migrations.md:33 (mention) — `docs/migrations.md` ("Writing an agent-applied (procedure) migration").
- docs/implemented-plans/box-migration.subplan.md:48 (mention) — - **`docs/migrations.md`** — the established migration framework: `cb migrate`
- docs/implemented-plans/boxes-as-packages-v2.md:72 (mention) — | `cb migrate`: ordered registry, agent-procedure migrations with abort gates | `src/core/migrations.ts`, `docs/migratio
- docs/implemented-plans/remove-cardworks-deletion.md:456 (mention) — `docs/migrations.md` (retire deleted-migrator references).
- docs/implemented-plans/remove-cardworks-package.md:324 (mention) — it now means "from `src/cards/`"); retire `docs/migrations.md` references to
- docs/maintenance.md:55 (mention) — **Author guide + runbook:** `docs/migrations.md` (how to write a new migrator with the noisy-mode `_migrate-warnings` he
- docs/plans/docs-reorg.gap-analysis.md:152 (mention) — `docs/migrations.md`, chat components CLAUDE.md, `chat-turn-buffer.ts`,
- docs/plans/docs-reorg.md:84 (mention) — (`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,

References:
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/maintenance.md (mention)
- → docs/adding-schemas.md (mention)

#### docs/photo-storage-investigation.md

Title: "Photo storage investigation: the ledger box is 20G" | 187 lines

Referenced by:
- docs/plans/README.md:85 (mention) — `event-bus-design.md`, `photo-storage-investigation.md`. Left in place
- docs/triage-design.md:153 (mention) — **Photo and PDF canonicalization is an intake step.** Raw phone images (HEIC/JPEG) arrive in `inbox/intake/`, get transc

References:
- → docs/triage-design.md (mention)

#### docs/procedure-implementation.md

Title: "Procedures" | 215 lines

Referenced by:
- CLAUDE.md:130 (mention) — | Procedures | `docs/procedure-implementation.md` |
- docs/glossary.md:38 (mention) — **procedure** — A multi-step workflow defined as a `*.procedure.card` (YAML frontmatter, no body). Config in `config/pro
- docs/ideas.md:1629 (mention) — `engine-orchestrate.ts`. See `docs/procedure-implementation.md`.
- docs/implemented-plans/agent-applied-migrations.md:29 (mention) — general write-up landed in `docs/procedure-implementation.md` ("Checklists"
- docs/implemented-plans/procedure-validation-completion.md:9 (mention) — > `docs/procedure-implementation.md` and the generated procedure guide. Two
- docs/plans/docs-reorg.md:85 (mention) — `server-operations.md`, `procedure-implementation.md`, `glossary.md`,
- docs/user-stories.md:5732 (mention) — **Verifier (flagged):** The code implements multi-phase procedure definitions and execution with progress tracking, but 

#### docs/prompt-audits.md

Title: "Prompt Audits" | 203 lines

Referenced by:
- docs/ideas.md:154 (mention) — Universality is the point: the same rubric applies wherever the agent commits to something below fact level — hypotheses
- docs/plans/box-commentary-surface.md:109 (mention) — - **Convention — `ref` for in-box targets** (`docs/prompt-audits.md:184`:
- docs/plans/docs-reorg.md:99 (mention) — `browse`); `prompt-audits.md` → nonexistent `tone-design.md`;
- docs/prompt-audits.md:174 (mention) — **Useful: what-changed closers.** One or two sentences naming what changed and where: "Added the pre-tool-brevity audit 

References:
- → docs/ideas.md (link)
- → tone-design.md (link) **[BROKEN]**
- → docs/prompt-audits.md (mention)

#### docs/prompt-logging.md

Title: "Prompt Logging for Agent Invocations" | 212 lines

Referenced by:
- docs/plans/docs-reorg.md:173 (mention) — link. `prompt-logging.md` is a near-orphan; `scheduler.md` and
- docs/user-stories.md:1326 (mention) — 6. **Supporting documentation**: `docs/prompt-logging.md` provides detailed guidance on using the feature, confirming th

References:
- → CLAUDE.md (mention)

#### docs/scheduler.md

Title: "Scheduler" | 93 lines

Referenced by:
- docs/plans/docs-reorg.gap-analysis.md:128 (mention) — contradicts `serve.ts:11-14` and `docs/scheduler.md:31`;
- docs/plans/docs-reorg.md:173 (mention) — link. `prompt-logging.md` is a near-orphan; `scheduler.md` and

#### docs/server-operations.md

Title: "Server Operations" | 185 lines

Referenced by:
- CLAUDE.md:132 (mention) — | Server operations | `docs/server-operations.md` |
- docs/health-checks.md:9 (link) — The server runs `claude update` nightly via `claude-update.timer` → `claude-update.service` → `deploy/claude-update.sh` 
- docs/implemented-plans/box-migration.subplan.md:157 (mention) — **Server mechanics** (`docs/server-operations.md`). Boxes are
- docs/implemented-plans/boxes-as-packages-v2.md:498 (mention) — rewritten for the hub era; `docs/server-operations.md` and `docs/ideas.md` had stale pre-hub
- docs/plans/docs-reorg.md:85 (mention) — `server-operations.md`, `procedure-implementation.md`, `glossary.md`,
- docs/unimplemented-plans/boxes-as-packages.md:366 (mention) — - **`CB_DIAG_API_KEY` becomes per-box** (it lives in each box's `.env`). The bypass curl pattern in `server-operations.m

References:
- → deploy/README.md (link)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/health-checks.md (link)
- → docs/client-debug-log.md (link)
- → docs/adding-a-box.md (link)

#### docs/ssr-render-testing.md

Title: "SSR Render Testing (`cb render`)" | 179 lines

Referenced by:
- CLAUDE.md:140 (mention) — | SSR page rendering (`cb render`) | `docs/ssr-render-testing.md` |
- docs/user-stories.md:4686 (mention) — All files exist and are properly implemented. Verified: (1) src/cli/commands/render.ts spawns render.tsx with full optio

#### docs/stack-decisions.md

Title: "Stack Decisions" | 1201 lines

Referenced by:
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `s
- docs/plans/README.md:87 (mention) — `design-vision.md`, `stack-decisions.md` are reference and stay).
- docs/plans/docs-reorg.gap-analysis.md:101 (mention) — 8. **`@xstate/store` documented as adopted (`docs/stack-decisions.md:143`)
- docs/plans/docs-reorg.md:86 (mention) — `stack-decisions.md`, the Google/Telegram setup runbooks, CSP docs) verified
- docs/user-stories.md:4801 (mention) — Feature is fully implemented with all claimed capabilities. Evidence: (1) /src/cli/commands/render.ts registers the `cb 

References:
- → docs/cards-as-markdown.md (mention)
- → docs/implemented-plans/state-management-comparison.md (mention)
- → CLAUDE.md (mention)

#### docs/telegram-setup.md

Title: "Telegram Connector Setup" | 133 lines

Referenced by:
- docs/plans/docs-reorg.md:170 (mention) — `telegram-setup.md`, `todo-security.md`,

#### docs/testing.md

Title: "Testing" | 604 lines

Referenced by:
- CLAUDE.md:123 (mention) — | Testing philosophy | `docs/testing.md` |
- docs/chat-scroll-testing.md:5 (mention) — behavior that doctests can't exercise (`docs/testing.md` §6). This is the
- docs/ideas.md:900 (mention) — Implemented as `cb session <id> --tool-report` + `@session-critique` subagent. See `docs/testing.md` § Session Critiques
- docs/implemented-plans/agent-applied-migrations.md:82 (mention) — - `callback-box/docs/testing.md` — tests-first as a design tool; the machine
- docs/implemented-plans/card-view-widgets.md:636 (mention) — - **Test posture** (per `docs/testing.md` — tests first, as a design tool):
- docs/implemented-plans/chat-scroll-redesign.md:55 (mention) — - `callback-box/docs/testing.md:5-11` — tests force decomposition, document, and
- docs/implemented-plans/chat-stream-finalize-unify.md:53 (mention) — - `callback-box/docs/testing.md:5-9` + `:474-521` — layout/streaming behavior is
- docs/implemented-plans/courseware-lesson-plan.md:326 (mention) — - **Tests** (per `docs/testing.md`, on substantial codepaths): the `lesson-plan` parse doctest
- docs/implemented-plans/courseware-phase1.md:487 (mention) — - **Tests** (per `docs/testing.md`):
- docs/implemented-plans/figure-card-type.md:78 (mention) — - **`docs/testing.md`** — tests as a design tool, on substantial codepaths.
- docs/implemented-plans/link-validation-fix.md:35 (mention) — - `callback-box/docs/testing.md` — tests as a design tool; name the doctest for
- docs/implemented-plans/normalize-chat-links.md:78 (mention) — - **`callback-box/docs/testing.md`** — tests as a design tool; doctest the
- docs/implemented-plans/procedure-validation-completion.md:36 (mention) — - **`docs/testing.md`** — tests come first as a design tool; cover substantial codepaths, not coverage-for-its-own-sake.
- docs/implemented-plans/rest-to-trpc-consolidation.md:383 (mention) — - **Test posture** (`docs/testing.md` — tests as design tool, not coverage): a
- docs/implemented-plans/slopo-codehealth-adoption.md:56 (mention) — - **`docs/testing.md`** — tests are not for coverage (`docs/testing.md:11`:
- docs/implemented-plans/view-render-testing.md:31 (mention) — - `callback-box/docs/testing.md` — tests as a design tool; doctests are the
- docs/plans/docs-reorg.gap-analysis.md:53 (mention) — `docs/testing.md:80` lists the helper without the prefixing.
- docs/plans/docs-reorg.md:84 (mention) — (`box-layout.md`, `testing.md`, `migrations.md`, `adding-schemas.md`,

References:
- → src/services/CLAUDE.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/agent-knowledge.md (link)
- → docs/chat-scroll-testing.md (link)
- → docs/doc-graph.md (mention)

#### docs/todo-security.md

Title: "Security TODOs" | 25 lines

Referenced by:
- docs/plans/docs-reorg.md:73 (mention) — decay-prone OCR vendor pricing), `todo-security.md` (orphaned TODO list),

#### docs/triage-design.md

Title: "Triage — Design" | 262 lines

Referenced by:
- docs/DESIGN.md:3 (mention) — > - §2 ("Input → Inbox → preprocessing/triage") talks about a single "triage" phase. The formal three-stage pipeline tha
- docs/IMPLEMENTATION.md:3 (mention) — > - References to a single "triage" agent / "triage" run-mode / `--agent triage` predate both the reactor and the new so
- docs/agent-knowledge.md:243 (mention) — - **Modify landmark `<triage-destination>`** — edit a directory's landmark to change pipeline routing rules (the cross-c
- docs/box-layout.md:97 (mention) — | `box/inbox/unhandled/` | Items with no clear destination after triage. Pre-existing catch-all; predates the formal tri
- docs/connectors.md:84 (mention) — - `intake-utils.ts` — `createOrAppendIntakeJob()` for creating reactor inbox-processing jobs (legacy reactor path, disti
- docs/design-vision.md:9 (mention) — **Categories** form the triage stage for incoming items. Material arrives from multiple sources—document scans, voice in
- docs/ideas.md:464 (mention) — - **Relation to landmarks/triage-design.** `docs/triage-design.md` already sketches a typed-routing pipeline using `<tri
- docs/knowledge-audit-rerun-2026-07-03.md:245 (mention) — internals live in dev-repo source and `docs/triage-design.md`, which is
- docs/landmarks.md:33 (mention) — A landmark is pure YAML frontmatter (no body) with one or more **roles**. The `navigation` role carries the bookmark fie
- docs/photo-storage-investigation.md:63 (mention) — This maps directly to the intake stage in the triage design (see `docs/triage-design.md`). Canonical optimization (AVIF 
- docs/plans/README.md:76 (mention) — `source-editor.md`. (`triage-design.md` later turned out to be fully built
- docs/plans/cli-restructure.md:90 (mention) — > **Namespace note (2026-05-20):** This group was originally proposed as `cb intake`, but the bare `cb intake` is now oc
- docs/plans/docs-reorg.md:51 (mention) — - **Worst drift case: `triage-design.md`** — still opens with "early notes,
- docs/user-stories.md:1658 (mention) — **Design alignment:** Matches triage-design.md §5 exactly, with all three confidence levels implemented as specified inc

References:
- → docs/photo-storage-investigation.md (mention)

#### docs/user-stories.md

Title: "callback-box — User Stories" | 5768 lines

Referenced by:
- docs/implemented-plans/user-story-audit-followups.md:5 (mention) — This plan triages the 95 `IAN:` comments left on `docs/user-stories.md` (the
- docs/plans/docs-reorg.gap-analysis.md:129 (mention) — `docs/user-stories.md` asserts the old behavior as verified.
- docs/plans/docs-reorg.md:109 (mention) — `knowledge-audit-rerun-2026-07-03.md` (orphaned), `user-stories.md`
- docs/user-stories.md:2509 (mention) — **Verifier (flagged):** The story is partially accurate. Core features (markdown export, lossy detection, warning displa

References:
- → docs/asset-manifests.md (mention)
- → docs/landmarks.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/prompt-logging.md (mention)
- → docs/implemented-plans/websocket-chat-transport.md (mention)
- → CLAUDE.md (mention)
- → docs/implemented-plans/narration-mode-design.md (mention)
- → docs/triage-design.md (mention)
- → docs/gmail-setup.md (mention)
- → docs/calendar.md (mention)
- → docs/user-stories.md (mention)
- → docs/google-drive.md (mention)
- → docs/implemented-plans/figure-card-type.md (mention)
- → docs/ssr-render-testing.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/box-layout.md (mention)
- → MAP.md (at-include) **[BROKEN]**
- → docs/knowledge-audits.md (mention)
- → docs/procedure-implementation.md (mention)

### docs/architecture/

#### docs/architecture/01-what-is-this.md **[ORPHAN]**

Title: "What Is This Thing?" | 66 lines

No references in or out.

#### docs/architecture/02-cards-and-memory.md **[ORPHAN]**

Title: "Cards and Memory" | 99 lines

No references in or out.

#### docs/architecture/CLAUDE.md

Title: "Architecture Docs" | 55 lines

Referenced by:
- docs/maintenance.md:88 (mention) — **When to run:** after editing `docs/architecture/*.md` text that drives image prompts, or after editing `.mmd` Mermaid 
- src/dev/CLAUDE.md:12 (mention) — | `generate-doc-images.ts` | Generates illustrations for `docs/architecture/` | `docs/architecture/CLAUDE.md` |

References:
- → docs/architecture/spirit.md (mention)
- → docs/architecture/family.md (mention)
- → docs/architecture/outline.md (mention)
- → docs/architecture/writing-style.md (mention)

#### docs/architecture/family.md

Title: "The Lund-Vega Family" | 95 lines

Referenced by:
- docs/architecture/CLAUDE.md:10 (mention) — - **`family.md`** — Character reference for the Lund-Vega family used in all examples. Detailed bios, relationships, hou
- docs/architecture/outline.md:5 (mention) — Supporting docs (not user-facing): `spirit.md` (values compass), `family.md` (character reference), `image-gen.yaml` (il

#### docs/architecture/outline.md

Title: "Architecture Docs Outline" | 214 lines

Referenced by:
- docs/architecture/CLAUDE.md:11 (mention) — - **`outline.md`** — Working outline for the architecture docs. Section structure, story ideas, open design questions.
- docs/plans/docs-reorg.md:74 (mention) — `architecture/outline.md` (75%-unwritten writing plan),

References:
- → docs/architecture/spirit.md (mention)
- → docs/architecture/family.md (mention)

#### docs/architecture/spirit.md

Title: "The Spirit of the Thing" | 112 lines

Referenced by:
- docs/architecture/CLAUDE.md:9 (mention) — - **`spirit.md`** — Values compass. The feelings and principles we're trying to protect. If something in the architectur
- docs/architecture/outline.md:5 (mention) — Supporting docs (not user-facing): `spirit.md` (values compass), `family.md` (character reference), `image-gen.yaml` (il
- docs/architecture/writing-style.md:63 (mention) — - **spirit**: Which values from spirit.md does this section express or depend on? (e.g., "inspectable history", "messy i

#### docs/architecture/writing-style.md

Title: "Writing Style Guide" | 95 lines

Referenced by:
- docs/architecture/CLAUDE.md:12 (mention) — - **`writing-style.md`** — Writing style guide. Tone, structure, common pitfalls, corrections from the editing process. 

References:
- → docs/architecture/spirit.md (mention)

### docs/implemented-plans/

#### docs/implemented-plans/agent-applied-migrations.md **[ORPHAN]**

Title: "Agent-applied migrations (via procedure checklists)" | 544 lines

References:
- → docs/procedure-implementation.md (mention)
- → docs/migrations.md (mention)
- → docs/testing.md (mention)
- → CODE-STYLE.md (mention)

#### docs/implemented-plans/app-wide-csp.md

Title: "App-wide Content-Security-Policy" | 443 lines

Referenced by:
- docs/scheduled/csp-violation-review.md:93 (mention) — `docs/implemented-plans/app-wide-csp.md` (the design rationale, including why the

References:
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)
- → docs/content-security-policy.md (mention)

#### docs/implemented-plans/attach-implementation.md

Title: "Implementation spec: `.attach/` directories" | 346 lines

Referenced by:
- docs/plans/README.md:89 (mention) — (superseded by the shipped renderer registry), `attach-implementation.md`

References:
- → docs/asset-manifests.md (mention)
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)

#### docs/implemented-plans/box-migration.subplan.md **[ORPHAN]**

Title: "Box migration to frontmatter (subplan of remove-cardworks-package)" | 282 lines

References:
- → docs/implemented-plans/remove-cardworks-package.md (mention)
- → docs/implemented-plans/remove-cardworks-package.md (link)
- → docs/migrations.md (mention)
- → docs/server-operations.md (mention)

#### docs/implemented-plans/box-retrospectives.md

Title: "Box Retrospectives" | 433 lines

Referenced by:
- docs/glossary.md:44 (mention) — **retrospective** — The `process-retrospective` procedure (driven by `cb retro`): mines recent chat sessions for what th

References:
- → CODE-STYLE.md (mention)
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
- docs/ideas.md:946 (mention) — `docs/implemented-plans/box-search.md`. Embeddings/hybrid remain future

References:
- → CODE-STYLE.md (mention)
- → docs/ideas.md (mention)
- → docs/adding-schemas.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/boxes-as-packages-v2.md

Title: "Boxes as Packages v2 — callback-box as a library" | 724 lines

Referenced by:
- README.md:25 (link) — live yet — see [`docs/implemented-plans/boxes-as-packages-v2.md`](docs/implemented-plans/boxes-as-packages-v2.md)
- deploy/README.md:55 (mention) — `docs/implemented-plans/boxes-as-packages-v2.md`'s "Post-cutover state" section); a fresh
- docs/adding-a-box.md:4 (link) — see "Serving" in [`docs/implemented-plans/boxes-as-packages-v2.md`](plans/boxes-as-packages-v2.md)
- docs/box-layout.md:15 (mention) — repository" in `docs/implemented-plans/boxes-as-packages-v2.md` for the full design.
- docs/migrations.md:204 (mention) — "The box repository" in `docs/implemented-plans/boxes-as-packages-v2.md`): `views/`,
- docs/plans/docs-reorg.md:45 (mention) — - **At least 5 plans are done-but-never-moved**: `boxes-as-packages-v2.md`
- docs/server-operations.md:38 (mention) — | Box manifest (which boxes the scheduler still sees — retirement deferred, see `docs/implemented-plans/boxes-as-package
- docs/testing.md:299 (mention) — **Directory structure:** `cb init` now scaffolds the v2 package layout by default (package.json/tsconfig/src/ plus an op
- docs/unimplemented-plans/README.md:16 (mention) — | `boxes-as-packages.md` | Superseded by `../implemented-plans/boxes-as-packages-v2.md` (2026-07-03), which re-derived t
- docs/unimplemented-plans/boxes-as-packages.md:3 (mention) — **Status:** SUPERSEDED by `docs/implemented-plans/boxes-as-packages-v2.md` (2026-07-03), which re-derives

References:
- → docs/unimplemented-plans/boxes-as-packages.md (mention)
- → docs/box-layout.md (mention)
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)
- → docs/migrations.md (mention)
- → deploy/README.md (mention)
- → README.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/server-operations.md (mention)
- → docs/ideas.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (mention)

#### docs/implemented-plans/card-view-widgets.md **[ORPHAN]**

Title: "Card-aware widgets for box-authored views" | 662 lines

References:
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → CLAUDE.md (mention)
- → docs/agent-knowledge.md (mention)
- → docs/testing.md (mention)

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
- → FRONTEND.md (mention)
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/chat-stream-finalize-unify.md

Title: "Chat streaming/finalize unification: one stably-keyed assistant turn" | 379 lines

Referenced by:
- src/frontend/src/components/chat/CLAUDE.md:46 (mention) — (`docs/implemented-plans/chat-stream-finalize-unify.md`). `liveTurnId` is held

References:
- → FRONTEND.md (mention)
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)
- → docs/implemented-plans/chat-scroll-redesign.md (mention)
- → CLAUDE.md (mention)
- → src/frontend/src/components/chat/CLAUDE.md (mention)
- → docs/chat-scroll-testing.md (mention)

#### docs/implemented-plans/companion-pane-card-activity.md **[ORPHAN]**

Title: "Companion-pane card activity awareness for chat" | 366 lines

References:
- → CODE-STYLE.md (mention)

#### docs/implemented-plans/courseware-lesson-plan.md **[ORPHAN]**

Title: "Courseware: the `lesson-plan` card" | 345 lines

References:
- → README.md (mention)
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/courseware-phase1.md

Title: "Courseware Phase 1 — the course: cards, rules, and the authoring skill" | 512 lines

Referenced by:
- docs/plans/docs-reorg.md:47 (mention) — `courseware-phase1.md` ("built and on `main`"), `web-page-commentary.md`

References:
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/external-url-validation.md

Title: "External URL validation (`cb validate --urls`)" | 78 lines

Referenced by:
- CLAUDE.md:51 (mention) — - `.git/hooks/post-commit` — fires `cb validate --urls --urls-since HEAD~1` in the background (non-blocking) to HEAD-che

#### docs/implemented-plans/extfile-card.md **[ORPHAN]**

Title: "`extfile` Card — an In-Box Pointer to a Live External File" | 714 lines

References:
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → docs/plans/box-commentary-surface.md (mention)

#### docs/implemented-plans/figure-card-type.md

Title: "Figure card type" | 426 lines

Referenced by:
- docs/user-stories.md:4230 (mention) — 7. **Documentation**: Complete plan documented in `/Users/ianbicking/src/callback-worktrees/user-stories/callback-box/do

References:
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/gmail-gc-unlabeled.md

Title: "Plan: Garbage-collect unlabeled Gmail messages" | 197 lines

Referenced by:
- docs/ideas.md:939 (mention) — `docs/implemented-plans/gmail-gc-unlabeled.md`. (Chose full reconciliation over

References:
- → docs/connectors.md (mention)

#### docs/implemented-plans/job-xml-purge.subplan.md

Title: "Job-Card XML Purge (subplan)" | 220 lines

Referenced by:
- docs/plans/prompt-surface-ia-review.md:544 (mention) — scrub, and is split out to **`job-xml-purge.subplan.md`** — executed in its own

References:
- → docs/plans/prompt-surface-ia-review.md (mention)
- → CODE-STYLE.md (mention)

#### docs/implemented-plans/link-validation-fix.md

Title: "Markdown link validation — turn it on, make it correct, close the commit-time hole" | 652 lines

Referenced by:
- docs/plans/docs-reorg.md:180 (mention) — (`implemented-plans/link-validation-fix.md`) but is itself orphaned and

References:
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)
- → /store/foo/bar.md (link) **[BROKEN]**

#### docs/implemented-plans/markdoc-format-investigation.md

Title: "Markdoc.format Investigation" | 447 lines

Referenced by:
- docs/implemented-plans/markdoc-tags-design.md:396 (mention) — `docs/implemented-plans/markdoc-format-investigation.md`; the catalogue covers ~70
- docs/implemented-plans/remove-cardworks-and-xml.md:157 (mention) — `docs/implemented-plans/markdoc-format-investigation.md:5`: *"safe for
- docs/plans/README.md:72 (mention) — (+ `.review.md`, `.gstack-trial-review.md`), `markdoc-format-investigation.md`,

#### docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md **[ORPHAN]**

Title: "Plan Engineering Review — Markdoc Tags Design" | 129 lines

References:
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → docs/implemented-plans/markdoc-tags-design.md (mention)

#### docs/implemented-plans/markdoc-tags-design.md

Title: "Markdoc Tags — Design" | 493 lines

Referenced by:
- docs/implemented-plans/markdoc-tags-design.gstack-trial-review.md:72 (mention) — **Location in plan:** `docs/implemented-plans/markdoc-tags-design.md:146-150` ("Compile-briefing transition")
- docs/implemented-plans/markdoc-tags-design.review.md:3 (mention) — Review of `markdoc-tags-design.md` following the `cb-plan-review` skill's
- docs/implemented-plans/remove-cardworks-and-xml.md:106 (mention) — `docs/implemented-plans/markdoc-tags-design.md`. Track 4 (ref tracking
- docs/implemented-plans/shared-frontend-backend-code.subplan.md:3 (mention) — A subplan of `markdoc-tags-design.md`. The Markdoc work needs the same
- docs/plans/README.md:71 (mention) — - → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-design.md`

References:
- → docs/implemented-plans/shared-frontend-backend-code.subplan.md (link)
- → CLAUDE.md (mention)
- → docs/implemented-plans/markdoc-format-investigation.md (mention)

#### docs/implemented-plans/markdoc-tags-design.review.md **[ORPHAN]**

Title: "Plan Engineering Review — Markdoc Tags Design" | 505 lines

References:
- → docs/implemented-plans/markdoc-tags-design.md (mention)
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)

#### docs/implemented-plans/named-places.md **[ORPHAN]**

Title: "Named Places (`place` cards + `cb location mark`)" | 465 lines

References:
- → docs/implemented-plans/user-location.md (mention)
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)

#### docs/implemented-plans/narration-mode-design.md

Title: "Narration Mode — Design" | 465 lines

Referenced by:
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `s
- docs/ideas.md:342 (link) — Conceptual inverse of narration mode (see [narration-mode-design.md](narration-mode-design.md)). Narration is user-talks
- docs/plans/README.md:73 (mention) — `shared-frontend-backend-code.subplan.md`, `narration-mode-design.md`
- docs/user-stories.md:1567 (mention) — The design doc (narration-mode-design.md line 240) explicitly states: "The chat has a `...` menu where settings live; th

References:
- → docs/activities-retrospective.md (link)
- → FRONTEND.md (mention)
- → docs/activities-design.md (mention)

#### docs/implemented-plans/nav-card.md

Title: "Nav as a card — first interface-as-cards slice" | 107 lines

Referenced by:
- docs/plans/interface-as-cards.md:288 (mention) — | Nav | curated `refs` card + per-entry overrides — **shipped 2026-07** (`docs/implemented-plans/nav-card.md`; nav form/

References:
- → docs/plans/interface-as-cards.md (mention)

#### docs/implemented-plans/normalize-chat-links.md **[ORPHAN]**

Title: "Normalize chat/card links" | 690 lines

References:
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/open-chat-from-card.md **[ORPHAN]**

Title: "Open chat from a card browse page" | 339 lines

References:
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → docs/landmarks.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/procedure-validation-completion.md **[ORPHAN]**

Title: "Procedure validation completion (D5)" | 440 lines

References:
- → docs/procedure-implementation.md (mention)
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/refresh-clerk.md **[ORPHAN]**

Title: "Refresh callback-clerk" | 441 lines

References:
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)

#### docs/implemented-plans/remove-cardworks-and-xml.md

Title: "Remove cardworks and all XML from callback-box" | 670 lines

Referenced by:
- docs/implemented-plans/remove-cardworks-deletion.md:103 (mention) — - **The schema-migration precedent** (`remove-cardworks-and-xml.md`):
- docs/implemented-plans/remove-cardworks-package.md:12 (mention) — This is the follow-up round to `remove-cardworks-and-xml.md` (the schema

References:
- → CODE-STYLE.md (mention)
- → docs/implemented-plans/markdoc-tags-design.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/implemented-plans/markdoc-format-investigation.md (mention)
- → CLAUDE.md (mention)
- → docs/adding-schemas.md (mention)

#### docs/implemented-plans/remove-cardworks-deletion.md **[ORPHAN]**

Title: "Remove cardworks — final deletion phase" | 621 lines

References:
- → docs/implemented-plans/remove-cardworks-package.md (mention)
- → CODE-STYLE.md (mention)
- → docs/implemented-plans/remove-cardworks-and-xml.md (mention)
- → CLAUDE.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/migrations.md (mention)

#### docs/implemented-plans/remove-cardworks-package.md

Title: "Remove the cardworks package" | 503 lines

Referenced by:
- docs/glossary.md:42 (mention) — **cardworks** — A former standalone card library, now removed. Its card primitives (`cardSchema()` for YAML-frontmatter 
- docs/implemented-plans/box-migration.subplan.md:4 (mention) — the gated box-local-XML removal (`remove-cardworks-package.md`, task #11) and
- docs/implemented-plans/box-migration.subplan.md:8 (link) — Parent plan: [remove-cardworks-package.md](./remove-cardworks-package.md). Both
- docs/implemented-plans/remove-cardworks-deletion.md:3 (mention) — The execution plan for the last phase of `remove-cardworks-package.md`: sever

References:
- → docs/implemented-plans/remove-cardworks-and-xml.md (mention)
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/migrations.md (mention)

#### docs/implemented-plans/rest-to-trpc-consolidation.md

Title: "REST → tRPC route consolidation" | 397 lines

Referenced by:
- docs/implemented-plans/slopo-evaluation.md:15 (mention) — migrated to tRPC. See `docs/implemented-plans/rest-to-trpc-consolidation.md`.

References:
- → docs/implemented-plans/slopo-codehealth-adoption.md (mention)
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)
- → docs/testing.md (mention)

#### docs/implemented-plans/schema-validate-hook.md **[ORPHAN]**

Title: "Schema `validate` hook — co-locate non-Zod card validation with its schema" | 373 lines

References:
- → docs/adding-schemas.md (mention)
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/selection-commentary.md

Title: "Selection Commentary — referencing document text in chat input" | 706 lines

Referenced by:
- docs/plans/README.md:71 (mention) — - → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-design.md`
- docs/plans/box-commentary-surface.md:98 (mention) — selection-commentary feature (`docs/implemented-plans/selection-commentary.md`) and the

References:
- → test/manual/selection-commentary.manual.md (mention)
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/shared-frontend-backend-code.subplan.md

Title: "Shared Frontend/Backend Code — Subplan" | 319 lines

Referenced by:
- docs/implemented-plans/markdoc-tags-design.md:170 (link) — [shared-frontend-backend-code subplan](shared-frontend-backend-code.subplan.md).
- docs/plans/README.md:73 (mention) — `shared-frontend-backend-code.subplan.md`, `narration-mode-design.md`

References:
- → docs/implemented-plans/markdoc-tags-design.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/slopo-codehealth-adoption.md

Title: "slopo adoption + duplication triage" | 431 lines

Referenced by:
- docs/implemented-plans/rest-to-trpc-consolidation.md:32 (mention) — duplication pass (see `docs/implemented-plans/slopo-codehealth-adoption.md`), which
- docs/implemented-plans/slopo-evaluation.md:12 (mention) — See `docs/implemented-plans/slopo-codehealth-adoption.md`.

References:
- → docs/implemented-plans/slopo-evaluation.md (mention)
- → CODE-STYLE.md (mention)
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
- docs/plans/docs-reorg.md:75 (mention) — `state-management-comparison.md` (bake-off record, unclear adoption), and
- docs/stack-decisions.md:157 (mention) — Evaluation prototypes (history-xstate.ts, HistoryPageXState.tsx, state-fixtures.ts, render-page.tsx) have been deleted. 

#### docs/implemented-plans/user-location.md

Title: "User Location (`cb location get`)" | 496 lines

Referenced by:
- docs/implemented-plans/named-places.md:19 (mention) — live fix and the `cb location get` command from `docs/implemented-plans/user-location.md`.

References:
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → docs/box-layout.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/user-story-audit-followups.md

Title: "User-story audit — follow-up plans" | 427 lines

Referenced by:
- docs/ideas.md:1567 (mention) — Surfaced by the user-story audit (`docs/implemented-plans/user-story-audit-followups.md` D9).
- docs/plans/docs-reorg.md:50 (mention) — and `user-story-audit-followups.md` (mostly done).

References:
- → docs/user-stories.md (mention)
- → docs/calendar.md (mention)
- → docs/ideas.md (mention)
- → docs/plans/pdf-intake-design.md (mention)

#### docs/implemented-plans/view-render-testing.md **[ORPHAN]**

Title: "Plan: testing agent-authored views" | 544 lines

References:
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/web-page-commentary.md

Title: "Web-page commentary capture" | 561 lines

Referenced by:
- docs/implemented-plans/webpage-card-and-commentary.md:30 (link) — [`web-page-commentary.md`](./web-page-commentary.md) (which is otherwise
- docs/plans/docs-reorg.md:47 (mention) — `courseware-phase1.md` ("built and on `main`"), `web-page-commentary.md`

References:
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)
- → docs/landmarks.md (mention)

#### docs/implemented-plans/webpage-card-and-commentary.md

Title: "`.webpage.card` + commentary-as-attachment" | 458 lines

Referenced by:
- docs/plans/docs-reorg.md:202 (mention) — - `webpage-card-and-commentary.md` (implemented) vs `web-page-commentary.md`

References:
- → docs/implemented-plans/web-page-commentary.md (link)
- → CODE-STYLE.md (mention)
- → docs/ideas.md (mention)

#### docs/implemented-plans/websocket-chat-transport.md

Title: "WebSocket chat transport" | 528 lines

Referenced by:
- docs/user-stories.md:1367 (mention) — The code accurately implements support for mid-turn resume via: TurnBuffer with seq numbers and version tracking, tracke

References:
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)

### docs/plans/

#### docs/plans/box-commentary-surface.md

Title: "In-box Commentary Surface for Out-of-Box Files" | 781 lines

Referenced by:
- docs/implemented-plans/extfile-card.md:45 (mention) — - **Precedent — the commentary surface** (`docs/plans/box-commentary-surface.md`,
- docs/plans/docs-reorg.md:39 (mention) — plus the open remainders of `box-commentary-surface.md` / `chat-husks.md`):

References:
- → CODE-STYLE.md (mention)
- → docs/implemented-plans/selection-commentary.md (mention)
- → docs/prompt-audits.md (mention)
- → CLAUDE.md (mention)

#### docs/plans/chat-husks.md

Title: "Chat husks — web chat sessions as cards (phase 1)" | 70 lines

Referenced by:
- docs/plans/docs-reorg.md:39 (mention) — plus the open remainders of `box-commentary-surface.md` / `chat-husks.md`):
- docs/plans/interface-as-cards.md:292 (mention) — | Chat | husk card per session + chat view + the slot | Below. **Husks shipped 2026-07** (`docs/plans/chat-husks.md`): a

References:
- → docs/plans/interface-as-cards.md (mention)

#### docs/plans/cli-restructure.md

Title: "`cb` CLI Restructure — Plan" | 172 lines

Referenced by:
- docs/plans/docs-reorg.md:71 (mention) — `cli-restructure.md` (verified unimplemented; says "delete this doc when

References:
- → docs/triage-design.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/maintenance.md (mention)

#### docs/plans/docs-reorg.gap-analysis.md **[ORPHAN]**

Title: "Docs-reorg companion: gap analysis — non-obvious, undocumented conventions" | 154 lines

References:
- → docs/plans/docs-reorg.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/connectors.md (mention)
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/testing.md (mention)
- → FRONTEND.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/composer-input-machine.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/scheduler.md (mention)
- → docs/user-stories.md (mention)
- → src/core/reactor/DESIGN.md (mention)
- → docs/glossary.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/asset-manifests.md (mention)
- → docs/migrations.md (mention)

#### docs/plans/docs-reorg.md

Title: "Documentation reorganization" | 337 lines

Referenced by:
- docs/plans/docs-reorg.gap-analysis.md:3 (mention) — **Status:** survey artifact 2026-07-04 — input to `docs-reorg.md`; findings

References:
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → docs/plans/input-widget.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/plans/pdf-intake-design.md (mention)
- → docs/plans/source-editor.md (mention)
- → docs/plans/prompt-surface-ia-review.md (mention)
- → docs/plans/box-commentary-surface.md (mention)
- → docs/plans/chat-husks.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/implemented-plans/courseware-phase1.md (mention)
- → docs/implemented-plans/web-page-commentary.md (mention)
- → docs/unimplemented-plans/query-cards.md (mention)
- → docs/implemented-plans/user-story-audit-followups.md (mention)
- → docs/triage-design.md (mention)
- → docs/plans/cli-restructure.md (mention)
- → docs/unimplemented-plans/capture-pipeline-redesign.md (mention)
- → docs/todo-security.md (mention)
- → docs/architecture/outline.md (mention)
- → docs/implemented-plans/state-management-comparison.md (mention)
- → docs/ideas.md (mention)
- → docs/box-layout.md (mention)
- → docs/testing.md (mention)
- → docs/migrations.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/server-operations.md (mention)
- → docs/procedure-implementation.md (mention)
- → docs/glossary.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/connectors.md (mention)
- → docs/prompt-audits.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/knowledge-audit-rerun-2026-07-03.md (mention)
- → docs/user-stories.md (mention)
- → docs/doc-graph.md (mention)
- → docs/knowledge-audits.md (mention)
- → deploy/README.md (mention)
- → FRONTEND.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/agent-knowledge.md (mention)
- → docs/chat-schedules.md (mention)
- → docs/telegram-setup.md (mention)
- → docs/prompt-logging.md (mention)
- → docs/scheduler.md (mention)
- → docs/health-checks.md (mention)
- → docs/implemented-plans/link-validation-fix.md (mention)
- → docs/landmark-curation.md (mention)
- → docs/scheduled/csp-violation-review.md (mention)
- → docs/IMPLEMENTATION.md (mention)
- → docs/design-vision.md (mention)
- → docs/implemented-plans/webpage-card-and-commentary.md (mention)
- → docs/google-setup.md (mention)
- → docs/gmail-setup.md (mention)
- → docs/google-drive.md (mention)
- → docs/activities-design.md (mention)
- → docs/activities-retrospective.md (mention)

#### docs/plans/input-widget.md

Title: "The input — interface design" | 610 lines

Referenced by:
- docs/plans/docs-reorg.md:37 (mention) — files are genuinely active plans** (`input-widget.md`, `interface-as-cards.md`,

References:
- → docs/plans/interface-as-cards.md (mention)
- → docs/ideas.md (mention)

#### docs/plans/interface-as-cards.md

Title: "The interface as cards — design" | 472 lines

Referenced by:
- CLAUDE.md:144 (mention) — | Interface-as-cards design | `docs/plans/interface-as-cards.md` |
- docs/ideas.md:616 (mention) — **Superseded by `docs/plans/interface-as-cards.md`** (2026-07 design
- docs/implemented-plans/nav-card.md:11 (mention) — First implementation slice of `docs/plans/interface-as-cards.md`. Small on
- docs/plans/chat-husks.md:8 (mention) — `docs/plans/interface-as-cards.md` ("Chat / Husks").
- docs/plans/docs-reorg.md:37 (mention) — files are genuinely active plans** (`input-widget.md`, `interface-as-cards.md`,
- docs/plans/input-widget.md:7 (mention) — the frame-model notes in `docs/plans/interface-as-cards.md` ("The input
- docs/unimplemented-plans/README.md:19 (mention) — | `query-cards.md` | Parked 2026-07-03; vocabulary explored but not planned for implementation. Parent design lives on i
- docs/unimplemented-plans/query-cards.md:22 (mention) — species deferred from `docs/plans/interface-as-cards.md` — the piece that

References:
- → docs/ideas.md (mention)
- → docs/unimplemented-plans/query-cards.md (mention)
- → docs/implemented-plans/nav-card.md (mention)
- → docs/plans/chat-husks.md (mention)

#### docs/plans/pdf-intake-design.md

Title: "PDF Intake" | 179 lines

Referenced by:
- CLAUDE.md:142 (mention) — | PDF intake design | `docs/plans/pdf-intake-design.md` |
- docs/implemented-plans/user-story-audit-followups.md:57 (mention) — - **D4 (PDF) — design only.** `docs/plans/pdf-intake-design.md` reviewed and its
- docs/plans/README.md:75 (mention) — - → `plans/` (still open): `pdf-intake-design.md` (not yet implemented),
- docs/plans/docs-reorg.md:38 (mention) — `pdf-intake-design.md`, `source-editor.md`, `prompt-surface-ia-review.md`,

References:
- → docs/glossary.md (link)
- → docs/asset-manifests.md (link)

#### docs/plans/prompt-surface-ia-review.md

Title: "Prompt Surface Cleanup — IA Review" | 990 lines

Referenced by:
- docs/implemented-plans/job-xml-purge.subplan.md:25 (mention) — (`prompt-surface-ia-review.md`, Track 1). The parent plan's original Track 1
- docs/plans/docs-reorg.md:38 (mention) — `pdf-intake-design.md`, `source-editor.md`, `prompt-surface-ia-review.md`,

References:
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)
- → CODE-STYLE.md (mention)
- → docs/implemented-plans/job-xml-purge.subplan.md (mention)

#### docs/plans/README.md **[ORPHAN]**

Title: "docs/plans/ — proposals and in-flight plans" | 92 lines

References:
- → docs/ideas.md (mention)
- → docs/implemented-plans/selection-commentary.md (mention)
- → docs/implemented-plans/markdoc-tags-design.md (mention)
- → docs/implemented-plans/markdoc-format-investigation.md (mention)
- → docs/implemented-plans/shared-frontend-backend-code.subplan.md (mention)
- → docs/implemented-plans/narration-mode-design.md (mention)
- → docs/plans/pdf-intake-design.md (mention)
- → docs/plans/source-editor.md (mention)
- → docs/triage-design.md (mention)
- → docs/activities-design.md (mention)
- → docs/event-bus-design.md (mention)
- → docs/photo-storage-investigation.md (mention)
- → docs/design-vision.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/unimplemented-plans/design-card-views.md (mention)
- → docs/implemented-plans/attach-implementation.md (mention)
- → docs/asset-manifests.md (mention)
- → docs/unimplemented-plans/capture-pipeline-redesign.md (mention)

#### docs/plans/source-editor.md

Title: "Source Editor Plan" | 140 lines

Referenced by:
- CLAUDE.md:143 (mention) — | Source editor plan | `docs/plans/source-editor.md` |
- docs/plans/README.md:76 (mention) — `source-editor.md`. (`triage-design.md` later turned out to be fully built
- docs/plans/docs-reorg.md:38 (mention) — `pdf-intake-design.md`, `source-editor.md`, `prompt-surface-ia-review.md`,

### docs/scheduled/

#### docs/scheduled/csp-violation-review.md

Title: "Scheduled routine: CSP violation review" | 95 lines

Referenced by:
- docs/content-security-policy.md:76 (mention) — The routine is a runbook: see `docs/scheduled/csp-violation-review.md`. To harden
- docs/plans/docs-reorg.md:190 (mention) — `scheduled/csp-violation-review.md` is half dev reference, half the literal
- docs/scheduled/csp-violation-review.md:11 (mention) — `callback-box/docs/scheduled/csp-violation-review.md`."* Everything it needs is
- src/dev/CLAUDE.md:13 (mention) — | `csp-digest.ts` | Digests the JSONL CSP violation log (incremental via per-box cursor) | `docs/content-security-policy

References:
- → docs/content-security-policy.md (mention)
- → docs/scheduled/csp-violation-review.md (mention)
- → docs/implemented-plans/app-wide-csp.md (mention)

### docs/unimplemented-plans/

#### docs/unimplemented-plans/box-user-account-spec.md

Title: "Spec: Box as Linux User Account" | 402 lines

Referenced by:
- docs/implemented-plans/boxes-as-packages-v2.md:567 (mention) — - **Per-box OS users / socket permissions / secrets split** (`docs/unimplemented-plans/box-user-account-spec.md`
- docs/unimplemented-plans/README.md:17 (mention) — | `box-user-account-spec.md` | Derivative of boxes-as-packages.md; the OS-user-as-box-identity idea is deferred to the i
- docs/unimplemented-plans/boxes-as-packages.md:11 (link) — **Related:** [Box as Linux User Account spec](box-user-account-spec.md) — tightens this proposal by adopting the OS user

References:
- → docs/unimplemented-plans/boxes-as-packages.md (link)

#### docs/unimplemented-plans/boxes-as-packages.md

Title: "Design Exploration: Boxes as Code Repositories" | 706 lines

Referenced by:
- docs/implemented-plans/boxes-as-packages-v2.md:8 (mention) — **Supersedes:** `docs/unimplemented-plans/boxes-as-packages.md` (2025 design exploration). This plan re-derives that
- docs/unimplemented-plans/README.md:16 (mention) — | `boxes-as-packages.md` | Superseded by `../implemented-plans/boxes-as-packages-v2.md` (2026-07-03), which re-derived t
- docs/unimplemented-plans/box-user-account-spec.md:4 (link) — **Relationship to other docs:** Builds on the [boxes-as-packages design exploration](boxes-as-packages.md), which propos

References:
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (link)
- → docs/server-operations.md (mention)
- → CLAUDE.md (mention)
- → docs/ideas.md (link)

#### docs/unimplemented-plans/capture-pipeline-redesign.md

Title: "Capture Pipeline Redesign" | 130 lines

Referenced by:
- docs/plans/README.md:91 (mention) — `capture-pipeline-redesign.md` to `unimplemented-plans/` (parked 2026-03).
- docs/plans/docs-reorg.md:72 (mention) — done"), `capture-pipeline-redesign.md` (no implementation evidence,
- docs/unimplemented-plans/README.md:20 (mention) — | `capture-pipeline-redesign.md` | Parked 2026-03 — direction (simpler capture pipeline) may still be relevant; OCR vend

#### docs/unimplemented-plans/design-card-views.md

Title: "Card View Plugin System" | 878 lines

Referenced by:
- docs/plans/README.md:88 (mention) — `design-card-views.md` has since moved to `unimplemented-plans/`
- docs/unimplemented-plans/README.md:18 (mention) — | `design-card-views.md` | Superseded by the shipped renderer system: `src/frontend/src/renderers/` + the file-types reg

References:
- → docs/unimplemented-plans/README.md (mention)

#### docs/unimplemented-plans/query-cards.md

Title: "Query cards — the "select and arrange cards" vocabulary" | 363 lines

Referenced by:
- docs/plans/docs-reorg.md:48 (mention) — (header claims unmerged branch; commits are on main), `query-cards.md`
- docs/plans/interface-as-cards.md:283 (mention) — | Landmarks page | query card (`type: landmark`) | Trivial; machinery proof. **Shipped 2026-07 as an instrument card** (
- docs/unimplemented-plans/README.md:19 (mention) — | `query-cards.md` | Parked 2026-07-03; vocabulary explored but not planned for implementation. Parent design lives on i

References:
- → docs/landmarks.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → CODE-STYLE.md (mention)

#### docs/unimplemented-plans/README.md

Title: "Unimplemented plans" | 21 lines

Referenced by:
- docs/unimplemented-plans/design-card-views.md:48 (mention) — README.md               → [Source]

References:
- → docs/unimplemented-plans/boxes-as-packages.md (mention)
- → docs/implemented-plans/boxes-as-packages-v2.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (mention)
- → docs/unimplemented-plans/design-card-views.md (mention)
- → docs/unimplemented-plans/query-cards.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/unimplemented-plans/capture-pipeline-redesign.md (mention)

### src/connectors/

#### src/connectors/CLAUDE.md

Title: "Connectors" | 23 lines

Referenced by:
- CLAUDE.md:95 (mention) — **Connectors** — Sync external services with the box filesystem. Each implements `Connector.sync()`. See `src/connectors
- docs/glossary.md:36 (mention) — **connector** — Code that syncs an external service (Gmail, RSS, Telegram, ...) with the box filesystem. Implements `Con
- docs/plans/docs-reorg.gap-analysis.md:20 (mention) — module's own comment — not in `src/connectors/CLAUDE.md` or

References:
- → src/services/CLAUDE.md (mention)

### src/core/reactor/

#### src/core/reactor/CLAUDE.md

Title: "Reactor" | 23 lines

Referenced by:
- src/core/reactor/DESIGN.md:66 (mention) — - **System prompt** tells the agent what context it already has (job XML, referenced files, schema instructions, rules f

References:
- → src/core/reactor/DESIGN.md (link)

#### src/core/reactor/DESIGN.md

Title: "Reactor Design" | 111 lines

Referenced by:
- docs/plans/docs-reorg.gap-analysis.md:130 (mention) — 7. **`src/core/reactor/DESIGN.md:51,70` describes job cards as XML;** code
- src/core/reactor/CLAUDE.md:3 (link) — See [DESIGN.md](DESIGN.md) for the full architecture, flow, and rationale.

References:
- → src/core/reactor/CLAUDE.md (mention)

### src/dev/

#### src/dev/CLAUDE.md

Title: "Dev Scripts" | 17 lines

Referenced by:
- docs/implemented-plans/box-retrospectives.md:414 (mention) — glossary entries, the two knowledge-audit entries, `src/dev/CLAUDE.md`

References:
- → docs/knowledge-audits.md (mention)
- → docs/maintenance.md (mention)
- → docs/doc-graph.md (mention)
- → docs/architecture/CLAUDE.md (mention)
- → docs/content-security-policy.md (mention)
- → docs/scheduled/csp-violation-review.md (mention)

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

### src/services/

#### src/services/CLAUDE.md

Title: "Services" | 126 lines

Referenced by:
- CLAUDE.md:93 (mention) — **Services** — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have ob
- docs/connectors.md:68 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation.
- docs/glossary.md:40 (mention) — **service** — A typed interface wrapping an external dependency, with real and fake implementations. Fakes have observab
- docs/testing.md:123 (mention) — External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full s
- src/connectors/CLAUDE.md:15 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation: interfaces, fakes, call logging, and testing patt

### test/manual/

#### test/manual/README.md **[ORPHAN]**

Title: "Manual tests" | 21 lines

No references in or out.

#### test/manual/selection-commentary.manual.md

Title: "Manual test: selection commentary (capture in the companion pane)" | 73 lines

Referenced by:
- docs/implemented-plans/selection-commentary.md:41 (mention) — >   `test/manual/selection-commentary.manual.md` — the natural-language

