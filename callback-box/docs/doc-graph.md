# Documentation Graph Report

Generated: 2026-07-04T01:31:13Z
Total documents: 144

## Issues

### Orphaned Documents (no incoming references)

These documents are not referenced by any other document.

- **docs/architecture/01-what-is-this.md** — "What Is This Thing?" (66 lines)
- **docs/architecture/02-cards-and-memory.md** — "Cards and Memory" (99 lines)
- **docs/attach-implementation.md** — "Implementation spec: `.attach/` directories" (344 lines)
- **docs/chat-schedules.md** — "Chat Schedules" (94 lines)
- **docs/implemented-plans/agent-applied-migrations.md** — "Agent-applied migrations (via procedure checklists)" (544 lines)
- **docs/implemented-plans/box-migration.subplan.md** — "Box migration to frontmatter (subplan of remove-cardworks-package)" (282 lines)
- **docs/implemented-plans/box-schema-reload.md** — "Box-local schema reload — design & implementation plan" (354 lines)
- **docs/implemented-plans/card-view-widgets.md** — "Card-aware widgets for box-authored views" (662 lines)
- **docs/implemented-plans/chat-composer-rerender.md** — "Plan: stop composer keystrokes from re-rendering chat history" (154 lines)
- **docs/implemented-plans/companion-pane-card-activity.md** — "Companion-pane card activity awareness for chat" (366 lines)
- **docs/implemented-plans/courseware-lesson-plan.md** — "Courseware: the `lesson-plan` card" (345 lines)
- **docs/implemented-plans/extfile-card.md** — "`extfile` Card — an In-Box Pointer to a Live External File" (714 lines)
- **docs/implemented-plans/link-validation-fix.md** — "Markdown link validation — turn it on, make it correct, close the commit-time hole" (652 lines)
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
- **docs/implemented-plans/webpage-card-and-commentary.md** — "`.webpage.card` + commentary-as-attachment" (458 lines)
- **docs/knowledge-audit-rerun-2026-07-03.md** — "Knowledge-audit full rerun — 2026-07-03" (465 lines)
- **docs/plans/courseware-phase1.md** — "Courseware Phase 1 — the course: cards, rules, and the authoring skill" (510 lines)
- **docs/plans/external-skills-harvest.md** — "External skills harvest — evaluation backlog" (314 lines)
- **docs/telegram-setup.md** — "Telegram Connector Setup" (136 lines)
- **docs/todo-security.md** — "Security TODOs" (25 lines)
- **docs/unimplemented-plans/README.md** — "Unimplemented plans" (18 lines)
- **src/frontend/public/earcons/SOURCES.md** — "Earcon sources & attribution" (13 lines)
- **test/manual/README.md** — "Manual tests" (21 lines)

### Broken References

These references point to files that don't exist.

- **CLAUDE-MD-REVIEW.md:282** → `CONVENTIONS.md` (at-include)
  Context: 2. ~~**`@CONVENTIONS.md` import syntax** and the mixed-scope problem.~~
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

#### CLAUDE-MD-REVIEW.md

Title: "CLAUDE.md Review — 2026-04-28" | 448 lines

Referenced by:
- docs/cli-restructure.md:162 (mention) — Once the migration is complete and the review (`CLAUDE-MD-REVIEW.md`) is also gone, delete this file. The state of the C

References:
- → CLAUDE.md (mention)
- → deploy/CLAUDE.md (mention)
- → docs/architecture/CLAUDE.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → src/core/reactor/CLAUDE.md (mention)
- → src/dev/CLAUDE.md (mention)
- → src/services/CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → docs/doc-graph.md (mention)
- → docs/cli-restructure.md (mention)
- → docs/plans/pai-review/prompts.md (mention)
- → docs/box-layout.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/connectors.md (mention)
- → CONVENTIONS.md (at-include) **[BROKEN]**
- → docs/testing.md (mention)
- → docs/maintenance.md (mention)
- → docs/knowledge-audits.md (mention)
- → CODE-STYLE.md (at-include)

#### CLAUDE.md

Title: "Callback Box" | 148 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:1 (mention) — # CLAUDE.md Review — 2026-04-28
- CLAUDE.md:14 (mention) — Overmind and Procfile.dev are gone. The router (`bin/router.ts`) spawns the same two processes (Vite, Fastify) directly 
- docs/EXAMPLE_FILES.md:55 (mention) — ├── CLAUDE.md
- docs/IMPLEMENTATION.md:671 (mention) — CLAUDE.md              # Base instructions for all agents
- docs/activities-design.md:46 (mention) — Live at `<box>/activities/<name>/src/`. The `src/` subdirectory is deliberate — the activity directory isn't just code, 
- docs/activities-retrospective.md:21 (mention) — Each "activity-shaped" use case turned out to be better served by adding the specific capability (a card type, a schedul
- docs/adding-schemas.md:266 (mention) — 5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
- docs/agent-knowledge.md:7 (mention) — 1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CL
- docs/attach-implementation.md:154 (mention) — Throughout prompts, generated docs, agent instructions, and `CLAUDE.md` mentions, the user-facing terminology is "card a
- docs/box-layout.md:9 (mention) — A box is a directory marked by a `.cb-box` file. It's a git repository (`cb init` initialises one), and the working tree
- docs/cards-as-markdown.md:231 (mention) — The explanation-length test (see Test results section) confirms this is modest, not dramatic: the full Cards section in 
- docs/design-vision.md:49 (mention) — - Small additions like a `CLAUDE.md` file with custom prompts are preferred to elaborate new structures
- docs/glossary.md:20 (mention) — **boxholder** — The human a box belongs to. Used in shared prose where "the user" is ambiguous (since agents are also "u
- docs/ideas.md:38 (mention) — *instructions* (akin to CLAUDE.md), where should it land? Today the only home
- docs/implemented-plans/app-wide-csp.md:217 (mention) — `mode`. Lives in `src/lib/` per CLAUDE.md ("Cross-cutting helpers").
- docs/implemented-plans/box-retrospectives.md:46 (mention) — - "Treat noisy command output as a bug" (monorepo CLAUDE.md) — `cb retro`
- docs/implemented-plans/box-search.md:47 (mention) — - Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — search and
- docs/implemented-plans/card-view-widgets.md:542 (mention) — CLAUDE.md's "don't add features beyond what the task requires."
- docs/implemented-plans/chat-stream-finalize-unify.md:338 (mention) — `CLAUDE.md` (`src/frontend/src/components/chat/CLAUDE.md`, shipped with the scroll
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
- docs/implemented-plans/websocket-chat-transport.md:230 (mention) — and it reuses the framework we're already deep in (CLAUDE.md's "tRPC by
- docs/knowledge-audits.md:19 (mention) — - After touching CLAUDE.md, schemas, prompts, or anything that changes what an agent should know.
- docs/maintenance.md:7 (mention) — The system carries a lot of agent-facing surface: CLAUDE.md and rule files, schemas with embedded `instructions`, prompt
- docs/plans/box-commentary-surface.md:375 (mention) — (CLAUDE.md exempts "per-box config, throwaway replies, and personal memory"),
- docs/plans/boxes-as-packages-v2.md:49 (mention) — - Monorepo `CLAUDE.md`: *"Treat noisy command output as a bug"* — scaffold/upgrade commands
- docs/plans/courseware-phase1.md:96 (mention) — "filename supplies the type — there is no `type:` field"** (`CLAUDE.md:39`), so templates
- docs/plans/external-skills-harvest.md:14 (mention) — of that in CLAUDE.md, CODE-STYLE.md, FRONTEND.md, the Laws, and our skills
- docs/plans/pai-review/README.md:17 (mention) — | [prompts.md](./prompts.md) | The actual prompt text — system prompt, CLAUDE.md, Algorithm doctrine — quoted and annota
- docs/plans/pai-review/information-layout.md:17 (mention) — CLAUDE.md:
- docs/plans/pai-review/prompts.md:20 (mention) — > layer. CLAUDE.md defines operational procedures and format templates.
- docs/plans/pai-review/telos.md:36 (mention) — > | `PRINCIPAL_TELOS.md` | **Auto-generated summary** of all the above. Loaded into every session via CLAUDE.md. |
- docs/plans/prompt-surface-ia-review.md:139 (mention) — empty in every box (only auto-generated `MAP.md`/`CLAUDE.md`, zero real items)
- docs/plans/web-page-commentary.md:123 (mention) — - **callback-clerk `CLAUDE.md`** — *"domain code never imports React, WXT, or
- docs/prompt-logging.md:3 (mention) — When agents run in a callback box (via `cb wakeup`, `cb reactor`, procedures, etc.), you can capture the full API traffi
- docs/stack-decisions.md:1183 (mention) — `CLAUDE.md` for the user-facing workflow. The old Overmind-based dev
- docs/testing-gaps.md:93 (mention) — - **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DE
- docs/unimplemented-plans/boxes-as-packages.md:411 (mention) — The boxes are physically still at `~/src/boxes/<box>/` (outside the callback monorepo, so agents working inside a box do
- docs/user-stories.md:1474 (mention) — > As a developer debugging an agent run, I want to capture full API traffic including system prompts, CLAUDE.md context,

References:
- → CLAUDE.md (mention)
- → docs/implemented-plans/external-url-validation.md (mention)
- → docs/cards-as-markdown.md (mention)
- → FRONTEND.md (mention)
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
- → deploy/README.md (mention)
- → docs/server-operations.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/box-layout.md (mention)
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
- CLAUDE-MD-REVIEW.md:39 (mention) — 5. **Split CONVENTIONS.md** into `CODE-STYLE.md` (general — typecheck/lint,
- CLAUDE-MD-REVIEW.md:445 (at-include) — 14. Verify `@CODE-STYLE.md` import syntax does what's intended.
- CLAUDE.md:113 (mention) — When you get corrected on a convention, pattern, or workflow that wasn't documented, update CLAUDE.md, CODE-STYLE.md, FR
- CLAUDE.md:147 (at-include) — @CODE-STYLE.md
- FRONTEND.md:3 (mention) — UI palette, primitives, and the `className` rule. Backend code never needs to load this; CODE-STYLE.md covers convention
- docs/implemented-plans/agent-applied-migrations.md:84 (mention) — - `callback-box/CODE-STYLE.md` — max 2 positional params (named options), no
- docs/implemented-plans/app-wide-csp.md:28 (mention) — - `callback-box/CODE-STYLE.md:` no `any`, max 2 positional params, custom error
- docs/implemented-plans/box-retrospectives.md:39 (mention) — - `callback-box/CODE-STYLE.md` — custom error classes; no silent error
- docs/implemented-plans/box-search.md:38 (mention) — - `callback-box/CODE-STYLE.md`: max 2 positional params, no default
- docs/implemented-plans/card-view-widgets.md:22 (mention) — - `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional
- docs/implemented-plans/chat-scroll-redesign.md:46 (mention) — - `callback-box/CODE-STYLE.md:36-37` — no default parameters; max 2 positional
- docs/implemented-plans/chat-stream-finalize-unify.md:48 (mention) — - `callback-box/CODE-STYLE.md:37` — max 2 positional params; new/changed
- docs/implemented-plans/companion-pane-card-activity.md:36 (mention) — - `callback-box/CODE-STYLE.md` — files ≤300 lines, no default parameters, max 2
- docs/implemented-plans/courseware-lesson-plan.md:23 (mention) — - `callback-box/CODE-STYLE.md` — no `any`, no default params, max 2 positional params, files ≤300
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
- docs/implemented-plans/webpage-card-and-commentary.md:48 (mention) — - `callback-box/CODE-STYLE.md` — no optional chaining, no default params,
- docs/implemented-plans/websocket-chat-transport.md:72 (mention) — - `callback-box/CODE-STYLE.md:` no `any`, no default params, max 2 positional
- docs/plans/box-commentary-surface.md:92 (mention) — - `callback-box/CODE-STYLE.md` — no default parameters, max 2 positional
- docs/plans/boxes-as-packages-v2.md:43 (mention) — - `callback-box/CODE-STYLE.md`: strict types, no `any`, custom error classes — the new
- docs/plans/courseware-phase1.md:98 (mention) — - `callback-box/CODE-STYLE.md` → **"No default parameters"**, **"Max 2 positional
- docs/plans/external-skills-harvest.md:14 (mention) — of that in CLAUDE.md, CODE-STYLE.md, FRONTEND.md, the Laws, and our skills
- docs/plans/prompt-surface-ia-review.md:373 (mention) — - **`callback-box/CODE-STYLE.md`** — no default params, ≤2 positional params, no
- docs/plans/query-cards.md:34 (mention) — - `callback-box/CODE-STYLE.md` — strict types, no `any`, custom errors,
- docs/plans/web-page-commentary.md:120 (mention) — - **`callback-box/CODE-STYLE.md`** — no `any`; no default parameters; max 2

References:
- → FRONTEND.md (mention)

#### FRONTEND.md

Title: "Frontend Conventions" | 109 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:40 (mention) — error handling, code style; ~58 lines) and `FRONTEND.md` (data-source
- CLAUDE.md:68 (mention) — src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see FRONTEND.md
- CODE-STYLE.md:3 (mention) — General coding conventions for backend and frontend. UI palette and primitive reference live in FRONTEND.md.
- FRONTEND.md:108 (mention) — New primitives live in `components/ui/<Name>.tsx`, accept `className`, merge via `cn()`, and document their semantic rol
- docs/ideas.md:455 (mention) — Method: do one sweep through `CLAUDE.md`, `FRONTEND.md`, the schemas, and `docs/` collecting terms-of-art, then write en
- docs/implemented-plans/card-view-widgets.md:24 (mention) — - `callback-box/FRONTEND.md:34` — *"Reach for a primitive from
- docs/implemented-plans/chat-scroll-redesign.md:37 (mention) — palette. Read FRONTEND.md before writing UI … the `className`-only-for-outer-layout
- docs/implemented-plans/chat-stream-finalize-unify.md:44 (mention) — palette. Read FRONTEND.md before writing UI"* and the
- docs/implemented-plans/figure-card-type.md:76 (mention) — - **`callback-box/FRONTEND.md`** — UI primitives + `className`-only-for-outer-
- docs/implemented-plans/narration-mode-design.md:193 (mention) — Color and primitive choices follow the box's semantic palette (see `FRONTEND.md`); the accent role is appropriate.
- docs/implemented-plans/open-chat-from-card.md:57 (mention) — - `callback-box/FRONTEND.md` — UI primitives + semantic palette, `className` only for
- docs/implemented-plans/selection-commentary.md:103 (mention) — semantic palette.** Read FRONTEND.md before writing UI."* The pill and
- docs/implemented-plans/user-location.md:63 (mention) — - `callback-box/FRONTEND.md` — UI primitives + the `className`-only-for-
- docs/plans/external-skills-harvest.md:14 (mention) — of that in CLAUDE.md, CODE-STYLE.md, FRONTEND.md, the Laws, and our skills

References:
- → CODE-STYLE.md (mention)
- → docs/data-source-tagging.md (mention)
- → FRONTEND.md (mention)

#### README.md

Title: "callback-box" | 2 lines

Referenced by:
- docs/cards-as-markdown.md:72 (mention) — - `README.md` — plain markdown, not a card
- docs/design-card-views.md:46 (mention) — README.md               → [Source]
- docs/implemented-plans/courseware-lesson-plan.md:13 (mention) — the material convention (proper presentational cards, not a stray `README.md`).

#### THINKING_CLAUDE.md

Title: "Thinking Machine Mode" | 93 lines

Referenced by:
- docs/implemented-plans/refresh-clerk.md:296 (mention) — `CONVENTIONS.md`/`THINKING_CLAUDE.md` if obsolete (they predate the monorepo
- docs/prompt-logging.md:81 (mention) — Contents of /Users/.../THINKING_CLAUDE.md (project instructions, checked into the codebase):

### deploy/

#### deploy/CLAUDE.md

Title: "Deploy" | 26 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:15 (mention) — - `deploy/CLAUDE.md` (8 lines)

References:
- → deploy/README.md (mention)

#### deploy/README.md

Title: "Deploy" | 190 lines

Referenced by:
- CLAUDE.md:130 (mention) — | Deployment | `deploy/README.md` |
- deploy/CLAUDE.md:3 (mention) — Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.
- docs/plans/boxes-as-packages-v2.md:71 (mention) — | In-process Google OAuth gate + per-box `allowedEmails` ACL | `src/webapp/` auth preHandler, `deploy/README.md:144-173`
- docs/server-operations.md:3 (link) — Reference for the running callback-box server (production at `box.example.com`). For initial provisioning scripts see 

### docs/

#### docs/activities-design.md

Title: "Activities — Design Proposal" | 311 lines

Referenced by:
- docs/activities-retrospective.md:7 (link) — An "Activity" was a reusable container for non-default chat shapes (language learning, notebook, guided journaling, etc.
- docs/implemented-plans/narration-mode-design.md:333 (mention) — - **Activities** (`docs/activities-design.md`): being phased out in favor of composable feature flags. Narration is the 
- docs/plans/README.md:55 (mention) — reference-vs-proposal before moving: `activities-design.md`,

References:
- → docs/activities-retrospective.md (link)
- → CLAUDE.md (mention)

#### docs/activities-retrospective.md

Title: "Activities — Retrospective" | 44 lines

Referenced by:
- docs/activities-design.md:3 (link) — > **Status: removed.** The Activities system was built and then removed in May 2026 in favor of piecemeal opt-in feature
- docs/implemented-plans/narration-mode-design.md:5 (link) — > Note: this doc references the Activities system as a coordinate ("the infrastructure that makes activities being phase

References:
- → docs/activities-design.md (link)
- → CLAUDE.md (mention)
- → docs/implemented-plans/narration-mode-design.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/IMPLEMENTATION.md (mention)

#### docs/adding-a-box.md

Title: "Adding a New Box" | 134 lines

Referenced by:
- CLAUDE.md:132 (mention) — | Adding a box | `docs/adding-a-box.md` |
- docs/ideas.md:520 (mention) — For now: manually copy secret files to new boxes. See `docs/adding-a-box.md` step 7.
- docs/plans/boxes-as-packages-v2.md:517 (mention) — run, docs rewrite (`adding-a-box.md`, `deploy/README.md`, a real `README.md` with the
- docs/server-operations.md:180 (link) — - [`adding-a-box.md`](./adding-a-box.md) — per-box setup (secrets, connectors, box directory layout).

#### docs/adding-api-endpoints.md

Title: "Adding API Endpoints" | 247 lines

Referenced by:
- CLAUDE.md:127 (mention) — | Adding API endpoints | `docs/adding-api-endpoints.md` |

#### docs/adding-schemas.md

Title: "Adding a New Card Schema" | 280 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:241 (mention) — - `src/schemas/` — `docs/adding-schemas.md` exists; might just need a one-line
- CLAUDE.md:124 (mention) — | Adding a card type | `docs/adding-schemas.md` |
- docs/EXAMPLE_FILES.md:4 (mention) — > - **Schema authoring**: For how to add a new schema today, see `docs/adding-schemas.md`.
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a cardworks schema. The atomic unit of data in a box. Named `Title.type.card` (e.g.
- docs/implemented-plans/box-schema-reload.md:247 (mention) — - Mirror in `docs/adding-schemas.md` if it implies `cb init` re-registers.
- docs/implemented-plans/box-search.md:45 (mention) — - `docs/adding-schemas.md`: the checklist any schema-surface change follows
- docs/implemented-plans/remove-cardworks-and-xml.md:417 (mention) — `docs/cards-as-markdown.md`, `docs/adding-schemas.md`.
- docs/implemented-plans/remove-cardworks-deletion.md:455 (mention) — `CLAUDE.md:87`/`docs/adding-schemas.md` (the cardworks bullet → `src/cards/`),
- docs/implemented-plans/remove-cardworks-package.md:323 (mention) — `CLAUDE.md:39`/`docs/adding-schemas.md` (drop "from cardworks" phrasing where
- docs/implemented-plans/schema-validate-hook.md:4 (mention) — > convention lives in `docs/adding-schemas.md`, the box-local schema guide
- docs/migrations.md:230 (mention) — - `docs/adding-schemas.md` — when a *schema* change (not a data shape change) is the right move instead of a migrator
- docs/user-stories.md:764 (mention) — Files: `src/cards/schema.ts`, `src/schemas/audio.tsx`, `src/schemas/memo.ts`, `docs/adding-schemas.md`

References:
- → CLAUDE.md (mention)

#### docs/agent-knowledge.md

Title: "Agent Knowledge Audit: What It Should Know and How to Verify" | 493 lines

Referenced by:
- docs/implemented-plans/card-view-widgets.md:574 (mention) — **Altitude.** Per `docs/agent-knowledge.md:307` view authoring sits at
- docs/plans/pai-review/information-layout.md:9 (mention) — cb's comparable thinking is `docs/agent-knowledge.md` (the knows-directly /
- docs/testing.md:375 (link) — See [agent-knowledge.md](agent-knowledge.md) for the full knowledge taxonomy and test prompt guide.

References:
- → CLAUDE.md (mention)
- → docs/connectors.md (mention)
- → docs/plans/triage-design.md (mention)
- → view:store/path/to/file.md (link) **[BROKEN]**

#### docs/asset-manifests.md

Title: "Asset Manifests" | 274 lines

Referenced by:
- docs/glossary.md:30 (mention) — **asset manifest** — `manifest.json` inside each `.attach/` directory recording every asset's size, mtime, and sha256. C
- docs/ideas.md:461 (mention) — The asset-manifest hook (`docs/asset-manifests.md`) scopes its discipline to `**/*.attach/**` only. Binaries outside att
- docs/plans/pdf-intake-design.md:80 (link) — All the binaries are assets — tracked via the asset manifest, not committed to git. The card itself, the manifest, and t
- docs/user-stories.md:713 (mention) — 1. **Pre-commit hook integration missing**: The design doc (docs/asset-manifests.md) says "A pre-commit hook keeps the m

References:
- → docs/ideas.md (mention)

#### docs/attach-implementation.md **[ORPHAN]**

Title: "Implementation spec: `.attach/` directories" | 344 lines

References:
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)

#### docs/box-layout.md

Title: "Box Layout" | 150 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:215 (mention) — `docs/box-layout.md`. Covers marker files, `box/`, `store/`, `config/`,
- CLAUDE.md:133 (mention) — | Box layout reference | `docs/box-layout.md` |
- docs/attach-implementation.md:161 (mention) — - `docs/box-layout.md`
- docs/implemented-plans/box-retrospectives.md:413 (mention) — (`enabled="false"`), `docs/box-layout.md` + `docs/maintenance.md` +
- docs/implemented-plans/named-places.md:175 (mention) — but no `places`), keeping `docs/box-layout.md` and the box-shape agent guide
- docs/implemented-plans/user-location.md:74 (mention) — at `docs/box-layout.md:18-22`. State files there are never committed.
- docs/plans/boxes-as-packages-v2.md:40 (mention) — - `docs/box-layout.md:139-143`: boxes contain no app code, no global secrets, no cross-box
- docs/plans/pai-review/information-layout.md:10 (mention) — knows-about / discoverable layering) and `docs/box-layout.md`. The two systems
- docs/plans/prompt-surface-ia-review.md:144 (mention) — (`box-layout.md`) and the `box.doctest.md` created-tree assertion updated to
- docs/user-stories.md:4927 (mention) — The user story is accurately implemented across both claimed files. `/Users/ianbicking/src/callback-worktrees/user-stori

References:
- → CLAUDE.md (mention)
- → docs/plans/triage-design.md (mention)
- → docs/client-debug-log.md (mention)

#### docs/calendar.md

Title: "Calendar Integration" | 89 lines

Referenced by:
- CLAUDE.md:140 (mention) — | Calendar integration | `docs/calendar.md` |
- docs/EXAMPLE_FILES.md:60 (mention) — └── calendar.md
- docs/IMPLEMENTATION.md:675 (mention) — calendar.md          # Rules for calendar operations
- docs/plans/user-story-audit-followups.md:31 (mention) — `docs/calendar.md` updated ([46]).
- docs/user-stories.md:2267 (mention) — Key limitation from docs/calendar.md (line 77): "One-way only. Local .ics edits are not detected or pushed back to Googl

#### docs/capture-pipeline-redesign.md

Title: "Capture Pipeline Redesign" | 128 lines

Referenced by:
- docs/plans/README.md:56 (mention) — `capture-pipeline-redesign.md`, `event-bus-design.md`, `design-card-views.md`,

#### docs/cards-as-markdown.md

Title: "RFC: Cards as Markdown + YAML Frontmatter" | 2553 lines

Referenced by:
- CLAUDE.md:53 (mention) — See `src/core/install-validation-hooks.ts`. The hook commands embed the absolute path to the installing `bin/cb` so they
- docs/DESIGN.md:4 (mention) — > - §3–§4 describe an XML envelope as the canonical card format. As of May 2026, most schemas are YAML frontmatter + mar
- docs/EXAMPLE_FILES.md:2 (mention) — > - **Card format**: Most schemas are now YAML frontmatter + markdown body, not XML. The XML examples below show the old
- docs/IMPLEMENTATION.md:4 (mention) — > - Card format: most schemas are now YAML frontmatter + markdown body, not XML. Anywhere this doc shows an XML envelope
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a cardworks schema. The atomic unit of data in a box. Named `Title.type.card` (e.g.
- docs/implemented-plans/remove-cardworks-and-xml.md:117 (mention) — production migration"* (`docs/cards-as-markdown.md`). **Reuse:** the
- docs/migrations.md:228 (mention) — - `docs/cards-as-markdown.md` — design rationale for the YAML-frontmatter format these migrators target
- docs/stack-decisions.md:18 (mention) — | 15 | [Markdoc](#decision-15-markdown-parsing--markdoc) | Frontend renders markdown via `@markdoc/markdoc` (replaced re

References:
- → docs/migrations.md (mention)
- → README.md (mention)
- → CLAUDE.md (mention)

#### docs/chat-schedules.md **[ORPHAN]**

Title: "Chat Schedules" | 94 lines

No references in or out.

#### docs/chat-scroll-testing.md

Title: "Chat scroll — manual test procedure" | 130 lines

Referenced by:
- docs/implemented-plans/chat-composer-rerender.md:140 (mention) — 4. Manual procedure in `docs/chat-scroll-testing.md` (stick-to-bottom,
- docs/implemented-plans/chat-scroll-redesign.md:16 (mention) — > desktop Chrome via `bin/browse` (procedure: `docs/chat-scroll-testing.md`):
- docs/implemented-plans/chat-stream-finalize-unify.md:364 (mention) — procedure in `docs/chat-scroll-testing.md` (extended), not doctests
- docs/testing.md:513 (link) — checklist) lives in [chat-scroll-testing.md](chat-scroll-testing.md). The
- src/frontend/src/components/chat/CLAUDE.md:31 (mention) — `docs/chat-scroll-testing.md`** (drives the app via `bin/browse`; layout

References:
- → docs/testing.md (mention)

#### docs/cli-restructure.md

Title: "`cb` CLI Restructure — Plan" | 163 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:186 (mention) — `docs/cli-restructure.md`. Summary:

References:
- → docs/plans/pai-review/prompts.md (mention)
- → docs/plans/triage-design.md (mention)
- → docs/maintenance.md (mention)
- → CLAUDE-MD-REVIEW.md (mention)

#### docs/client-debug-log.md

Title: "Client Debug Log" | 55 lines

Referenced by:
- CLAUDE.md:107 (mention) — - **Check client debug logs when debugging frontend issues.** The browser forwards console errors to the server (now via
- docs/box-layout.md:110 (mention) — | `client-debug.log` | Browser console errors forwarded from the frontend. See `docs/client-debug-log.md`. |
- docs/server-operations.md:174 (link) — For SSH-only debugging: `ssh root@<server> tail /home/callback/boxes/<box>/.callback-box/client-debug.log`. See [`client

#### docs/composer-input-machine.md

Title: "Composer input machine — design note" | 291 lines

Referenced by:
- docs/composer-states.md:5 (mention) — us, doing UI polish. Companion to `docs/composer-input-machine.md`, which

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
- CLAUDE-MD-REVIEW.md:255 (mention) — - Add a connector (`docs/connectors.md` exists — is it a how-to or a
- CLAUDE.md:128 (mention) — | Connectors | `docs/connectors.md` |
- docs/agent-knowledge.md:205 (mention) — - **Expected level: Discoverable** — the agent would need to look at `config/connectors/` and/or `docs/generated/connect
- docs/ideas.md:908 (mention) — `src/connectors/gmail-gc.ts`, `docs/connectors.md`, and
- docs/implemented-plans/gmail-gc-unlabeled.md:5 (mention) — Lives in `src/connectors/gmail-gc.ts`; reference docs in `docs/connectors.md`.

References:
- → src/services/CLAUDE.md (mention)
- → docs/plans/triage-design.md (mention)

#### docs/content-security-policy.md

Title: "Content-Security-Policy" | 80 lines

Referenced by:
- CLAUDE.md:136 (mention) — | Content-Security-Policy | `docs/content-security-policy.md` |
- docs/implemented-plans/app-wide-csp.md:438 (mention) — `docs/content-security-policy.md`) describing the policy, the dev/prod split,
- docs/scheduled/csp-violation-review.md:6 (mention) — nothing — see `docs/content-security-policy.md`); this routine watches real
- src/dev/CLAUDE.md:13 (mention) — | `csp-digest.ts` | Digests the JSONL CSP violation log (incremental via per-box cursor) | `docs/content-security-policy

References:
- → docs/scheduled/csp-violation-review.md (mention)

#### docs/data-source-tagging.md

Title: "Data Source Tagging Convention" | 89 lines

Referenced by:
- FRONTEND.md:7 (mention) — UI elements that display data from a known source (card, commit, session, etc.) must be tagged with `data-cb-source` att

#### docs/design-card-views.md

Title: "Card View Plugin System" | 876 lines

Referenced by:
- docs/plans/README.md:56 (mention) — `capture-pipeline-redesign.md`, `event-bus-design.md`, `design-card-views.md`,

References:
- → README.md (mention)

#### docs/design-vision.md

Title: "Callback Box: Design Vision and Architecture" | 68 lines

Referenced by:
- docs/plans/README.md:58 (mention) — reference than active proposals — `DESIGN.md`, `design-vision.md`,

References:
- → docs/plans/triage-design.md (mention)
- → CLAUDE.md (mention)

#### docs/DESIGN.md

Title: "Callback Box: comprehensive design notes" | 531 lines

Referenced by:
- CLAUDE.md:119 (mention) — | Design rationale | `docs/DESIGN.md` |
- docs/IMPLEMENTATION.md:8 (mention) — This document describes how to build Callback Box, complementing DESIGN.md with concrete implementation details.
- docs/testing-gaps.md:93 (mention) — - **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DE

References:
- → docs/plans/triage-design.md (mention)
- → docs/cards-as-markdown.md (mention)

#### docs/doc-graph.md

Title: "(no title)" | 1 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:46 (mention) — 6. **Regenerated `docs/doc-graph.md`** to reflect the split (doc went from
- docs/ideas.md:811 (mention) — Implemented as `docs/doc-graph.md` (auto-generated cross-reference report). See CLAUDE.md Doc Map.
- docs/maintenance.md:17 (mention) — | Doc graph | `pnpm doc-graph` | After restructuring docs | `docs/doc-graph.md` |
- docs/testing.md:582 (mention) — `npx tsx src/dev/doc-graph.ts > docs/doc-graph.md` — scans all `.md` files, extracts cross-references, reports orphans a
- src/dev/CLAUDE.md:10 (mention) — | `doc-graph.ts` | Generates `docs/doc-graph.md` (cross-reference graph + orphan/broken-ref report) | `docs/maintenance.

#### docs/event-bus-design.md

Title: "Event Bus Design" | 142 lines

Referenced by:
- docs/plans/README.md:56 (mention) — `capture-pipeline-redesign.md`, `event-bus-design.md`, `design-card-views.md`,

#### docs/EXAMPLE_FILES.md

Title: "Callback Box: Example Files" | 820 lines

Referenced by:
- CLAUDE.md:121 (mention) — | Card examples | `docs/EXAMPLE_FILES.md` |
- docs/IMPLEMENTATION.md:228 (mention) — See EXAMPLE_FILES.md for RRULE examples and other card/schema samples.
- docs/IMPLEMENTATION.md:277 (link) — Config includes credential references, polling intervals, filters, etc. Agents can read these to understand what's avail

References:
- → docs/cards-as-markdown.md (mention)
- → docs/adding-schemas.md (mention)
- → CLAUDE.md (mention)
- → docs/calendar.md (mention)

#### docs/glossary.md

Title: "Glossary" | 55 lines

Referenced by:
- CLAUDE.md:145 (mention) — | Glossary | `docs/glossary.md` |
- docs/ideas.md:442 (mention) — `docs/glossary.md` is scoped to Proper Nouns — names we coined and general words we've narrowed to project-specific mean
- docs/plans/external-skills-harvest.md:93 (mention) — Markdown), the CONTEXT.md/ADR coupling (→ `docs/glossary.md` + git history +
- docs/plans/pdf-intake-design.md:19 (link) — **Intake-time extraction.** When a PDF arrives (`cb import`, capture endpoint, email connector), the intake path runs do

References:
- → docs/ideas.md (mention)
- → CLAUDE.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/asset-manifests.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/procedure-implementation.md (mention)
- → src/services/CLAUDE.md (mention)
- → docs/implemented-plans/box-retrospectives.md (mention)

#### docs/gmail-setup.md

Title: "Gmail Connector Setup" | 85 lines

Referenced by:
- docs/user-stories.md:2043 (mention) — - docs/gmail-setup.md lines 37-41 (user documentation with examples)

References:
- → docs/google-setup.md (mention)

#### docs/google-drive.md

Title: "Google Drive Integration" | 140 lines

Referenced by:
- docs/user-stories.md:2702 (mention) — The implementation is complete and accurate. The google-drive.ts connector's syncFolder() method (lines 260-312) fully i

References:
- → docs/google-setup.md (link)

#### docs/google-setup.md

Title: "Google Cloud Console Setup" | 136 lines

Referenced by:
- docs/gmail-setup.md:14 (mention) — If the server doesn't show the Google Services section at all, OAuth client credentials haven't been configured server-w
- docs/google-drive.md:7 (link) — 1. **Google OAuth** configured (see [google-setup.md](google-setup.md))

#### docs/health-checks.md

Title: "Health Checks" | 60 lines

Referenced by:
- docs/server-operations.md:159 (link) — **Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — 

References:
- → docs/server-operations.md (link)

#### docs/ideas.md

Title: "Ideas & Planned Features" | 1652 lines

Referenced by:
- CLAUDE.md:144 (mention) — | Feature ideas | `docs/ideas.md` |
- docs/asset-manifests.md:266 (mention) — Noted in `docs/ideas.md`.
- docs/glossary.md:14 (mention) — **Open question — capitalization.** Proper nouns in English are normally capitalized. We may want to write "Asset" and "
- docs/ideas.md:1172 (mention) — This `ideas.md` plus scattered TODOs across the monorepo is the current state of issue tracking. It works for a single a
- docs/implemented-plans/box-search.md:41 (mention) — - `docs/ideas.md:493` § CLI Design for Agents: enumerate valid values in
- docs/implemented-plans/webpage-card-and-commentary.md:105 (mention) — - **Directory head-cards idea.** `docs/ideas.md:740-755` — the unifying frame:
- docs/plans/external-skills-harvest.md:21 (mention) — callback-box skill), `idea` (file in ideas.md for later), or `skip` (with a
- docs/plans/interface-as-cards.md:4 (mention) — "The interface itself as cards" entry in `docs/ideas.md`; this doc supersedes
- docs/plans/user-story-audit-followups.md:40 (mention) — unbuilt bucket-D features are now parked as the backlog in `docs/ideas.md`
- docs/prompt-audits.md:5 (link) — Many of the lenses here, and a number of the related entries in [ideas.md](ideas.md), originated from working through th
- docs/unimplemented-plans/boxes-as-packages.md:702 (link) — - **Interaction with the [Markdown cards idea](../ideas.md#markdown-cards-replacing-xml).** Both touch the schema-defini

References:
- → CLAUDE.md (mention)
- → docs/prompt-audits.md (mention)
- → docs/implemented-plans/narration-mode-design.md (link)
- → docs/plans/triage-design.md (mention)
- → docs/glossary.md (mention)
- → FRONTEND.md (mention)
- → docs/asset-manifests.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/IMPLEMENTATION.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → docs/doc-graph.md (mention)
- → docs/plans/pai-review/prompts.md (mention)
- → docs/testing.md (mention)
- → docs/connectors.md (mention)
- → docs/implemented-plans/gmail-gc-unlabeled.md (mention)
- → docs/implemented-plans/box-search.md (mention)
- → docs/landmarks.md (mention)
- → docs/ideas.md (mention)
- → docs/plans/courseware-external-skills-triage.md (mention)
- → docs/plans/user-story-audit-followups.md (mention)
- → docs/procedure-implementation.md (mention)

#### docs/IMPLEMENTATION.md

Title: "Callback Box: Implementation Guide" | 1018 lines

Referenced by:
- CLAUDE.md:120 (mention) — | Implementation guide | `docs/IMPLEMENTATION.md` |
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `s
- docs/ideas.md:580 (mention) — `cb` currently has only layer 1. Layer 2 would be straightforward to generate from the existing command definitions (yar

References:
- → docs/plans/triage-design.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/DESIGN.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/EXAMPLE_FILES.md (link)
- → CLAUDE.md (mention)
- → docs/calendar.md (mention)

#### docs/knowledge-audit-rerun-2026-07-03.md **[ORPHAN]**

Title: "Knowledge-audit full rerun — 2026-07-03" | 465 lines

References:
- → docs/plans/triage-design.md (mention)
- → docs/landmark-curation.md (mention)

#### docs/knowledge-audits.md

Title: "Knowledge Audits" | 89 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:439 (mention) — script to its full doc). Created `docs/knowledge-audits.md` for the
- CLAUDE.md:138 (mention) — | Knowledge audits | `docs/knowledge-audits.md` |
- docs/maintenance.md:31 (mention) — **Full guide:** `docs/knowledge-audits.md` (test structure, recording results, interpreting failures).
- docs/user-stories.md:5670 (mention) — Both claimed files exist at the correct paths. The implementation is complete: test-runner.ts extracts context metrics f
- src/dev/CLAUDE.md:7 (mention) — | `knowledge-audit.ts` | Runs YAML-defined tests against a real box agent | `docs/knowledge-audits.md` |

References:
- → CLAUDE.md (mention)
- → docs/maintenance.md (mention)
- → MAP.md (at-include) **[BROKEN]**

#### docs/landmark-curation.md

Title: "Landmark Curation" | 48 lines

Referenced by:
- docs/knowledge-audit-rerun-2026-07-03.md:261 (mention) — (`docs/landmark-curation.md`, `docs/plans/triage-design.md`) that don't exist in

References:
- → docs/landmarks.md (mention)

#### docs/landmarks.md

Title: "Landmarks" | 164 lines

Referenced by:
- CLAUDE.md:134 (mention) — | Landmarks (navigation surface) | `docs/landmarks.md` |
- docs/ideas.md:962 (mention) — Started as "a landmark-ish marker in the card itself" and resolved (2026-06-12 discussion) into a unification: **there i
- docs/implemented-plans/open-chat-from-card.md:96 (mention) — `contextDir` chosen at the call site (`LandmarkSection.tsx:96`). `docs/landmarks.md` (per the
- docs/landmark-curation.md:5 (mention) — For the design and schema of the card itself, see `docs/landmarks.md` and `docs/generated/card-landmark.md`.
- docs/plans/query-cards.md:14 (mention) — planned in docs/landmarks.md long before this, useful for any list-shaped
- docs/plans/web-page-commentary.md:262 (mention) — destinations API, extension UI labels, docs/landmarks.md, knowledge audits.
- docs/user-stories.md:732 (mention) — The file src/core/frontmatter-field.ts exports two functions that implement the exact capability described. lookupField(

References:
- → docs/plans/triage-design.md (mention)

#### docs/maintenance.md

Title: "Code Maintenance" | 97 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:403 (mention) — the first place; or a periodic sweep listed in `docs/maintenance.md`.
- CLAUDE.md:137 (mention) — | Periodic maintenance | `docs/maintenance.md` |
- docs/cli-restructure.md:127 (mention) — - **Card normalization story.** `cb format` was deleted (80-line one-off normalizer that re-serialized cards to flat XML
- docs/implemented-plans/box-retrospectives.md:413 (mention) — (`enabled="false"`), `docs/box-layout.md` + `docs/maintenance.md` +
- docs/knowledge-audits.md:22 (mention) — `docs/maintenance.md` lists this alongside the other periodic tasks.
- docs/migrations.md:229 (mention) — - `docs/maintenance.md` — where `cb migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface
- src/dev/CLAUDE.md:8 (mention) — | `prompt-report.ts` | Generates `docs/prompts.md` (system-wide prompt inventory) | `docs/maintenance.md` |

References:
- → CLAUDE.md (mention)
- → docs/plans/pai-review/prompts.md (mention)
- → docs/doc-graph.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/migrations.md (mention)
- → docs/architecture/CLAUDE.md (mention)

#### docs/migrations.md

Title: "Box Migrations" | 243 lines

Referenced by:
- CLAUDE.md:126 (mention) — | Box migration runbook | `docs/migrations.md` |
- docs/cards-as-markdown.md:44 (mention) — **Tracking which migrations have been applied per box** is handled by `cb migrate` against the per-box append-only manif
- docs/implemented-plans/agent-applied-migrations.md:33 (mention) — `docs/migrations.md` ("Writing an agent-applied (procedure) migration").
- docs/implemented-plans/box-migration.subplan.md:48 (mention) — - **`docs/migrations.md`** — the established migration framework: `cb migrate`
- docs/implemented-plans/remove-cardworks-deletion.md:456 (mention) — `docs/migrations.md` (retire deleted-migrator references).
- docs/implemented-plans/remove-cardworks-package.md:324 (mention) — it now means "from `src/cards/`"); retire `docs/migrations.md` references to
- docs/maintenance.md:55 (mention) — **Author guide + runbook:** `docs/migrations.md` (how to write a new migrator with the noisy-mode `_migrate-warnings` he
- docs/plans/boxes-as-packages-v2.md:67 (mention) — | `cb migrate`: ordered registry, agent-procedure migrations with abort gates | `src/core/migrations.ts`, `docs/migratio

References:
- → docs/cards-as-markdown.md (mention)
- → docs/maintenance.md (mention)
- → docs/adding-schemas.md (mention)

#### docs/photo-storage-investigation.md

Title: "Photo storage investigation: the ledger box is 20G" | 187 lines

Referenced by:
- docs/plans/README.md:57 (mention) — `photo-storage-investigation.md`. Left in place (some read more like vision/
- docs/plans/triage-design.md:153 (mention) — **Photo and PDF canonicalization is an intake step.** Raw phone images (HEIC/JPEG) arrive in `inbox/intake/`, get transc

References:
- → docs/plans/triage-design.md (mention)

#### docs/procedure-implementation.md

Title: "Procedures" | 215 lines

Referenced by:
- CLAUDE.md:129 (mention) — | Procedures | `docs/procedure-implementation.md` |
- docs/glossary.md:38 (mention) — **procedure** — A multi-step workflow defined as a `*.procedure.card` (currently still XML; one of the deferred Markdoc-
- docs/ideas.md:1599 (mention) — `engine-orchestrate.ts`. See `docs/procedure-implementation.md`.
- docs/implemented-plans/agent-applied-migrations.md:29 (mention) — general write-up landed in `docs/procedure-implementation.md` ("Checklists"
- docs/implemented-plans/procedure-validation-completion.md:9 (mention) — > `docs/procedure-implementation.md` and the generated procedure guide. Two
- docs/user-stories.md:5732 (mention) — **Verifier (flagged):** The code implements multi-phase procedure definitions and execution with progress tracking, but 

#### docs/prompt-audits.md

Title: "Prompt Audits" | 203 lines

Referenced by:
- docs/ideas.md:124 (mention) — Universality is the point: the same rubric applies wherever the agent commits to something below fact level — hypotheses
- docs/plans/box-commentary-surface.md:107 (mention) — - **Convention — `ref` for in-box targets** (`docs/prompt-audits.md:184`:
- docs/prompt-audits.md:174 (mention) — **Useful: what-changed closers.** One or two sentences naming what changed and where: "Added the pre-tool-brevity audit 

References:
- → docs/ideas.md (link)
- → tone-design.md (link) **[BROKEN]**
- → docs/prompt-audits.md (mention)

#### docs/prompt-logging.md

Title: "Prompt Logging for Agent Invocations" | 212 lines

Referenced by:
- docs/user-stories.md:1326 (mention) — 6. **Supporting documentation**: `docs/prompt-logging.md` provides detailed guidance on using the feature, confirming th

References:
- → CLAUDE.md (mention)
- → THINKING_CLAUDE.md (mention)

#### docs/scheduler.md

Title: "Scheduler" | 93 lines

Referenced by:
- docs/plans/pai-review/README.md:65 (mention) — | Scheduling | Pulse daemon, `[[job]]` cron in one TOML | `cb tick` + per-box `scheduled-script.card`s (`docs/scheduler.

#### docs/server-operations.md

Title: "Server Operations" | 181 lines

Referenced by:
- CLAUDE.md:131 (mention) — | Server operations | `docs/server-operations.md` |
- docs/health-checks.md:9 (link) — The server runs `claude update` nightly via `claude-update.timer` → `claude-update.service` → `deploy/claude-update.sh` 
- docs/implemented-plans/box-migration.subplan.md:157 (mention) — **Server mechanics** (`docs/server-operations.md`). Boxes are
- docs/unimplemented-plans/boxes-as-packages.md:366 (mention) — - **`CB_DIAG_API_KEY` becomes per-box** (it lives in each box's `.env`). The bypass curl pattern in `server-operations.m

References:
- → deploy/README.md (link)
- → docs/health-checks.md (link)
- → docs/client-debug-log.md (link)
- → docs/adding-a-box.md (link)

#### docs/ssr-render-testing.md

Title: "SSR Render Testing (`cb render`)" | 177 lines

Referenced by:
- CLAUDE.md:139 (mention) — | SSR page rendering (`cb render`) | `docs/ssr-render-testing.md` |
- docs/user-stories.md:4686 (mention) — All files exist and are properly implemented. Verified: (1) src/cli/commands/render.ts spawns render.tsx with full optio

#### docs/stack-decisions.md

Title: "Stack Decisions" | 1201 lines

Referenced by:
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `s
- docs/plans/README.md:59 (mention) — `stack-decisions.md` are reference and stay).
- docs/user-stories.md:4801 (mention) — Feature is fully implemented with all claimed capabilities. Evidence: (1) /src/cli/commands/render.ts registers the `cb 

References:
- → docs/cards-as-markdown.md (mention)
- → docs/state-management-comparison.md (mention)
- → docs/testing-gaps.md (mention)
- → CLAUDE.md (mention)

#### docs/state-management-comparison.md

Title: "State Management Comparison: Zustand vs MobX-State-Tree vs Valtio vs XState" | 831 lines

Referenced by:
- docs/stack-decisions.md:157 (mention) — Evaluation prototypes (history-xstate.ts, HistoryPageXState.tsx, state-fixtures.ts, render-page.tsx) have been deleted. 

#### docs/telegram-setup.md **[ORPHAN]**

Title: "Telegram Connector Setup" | 136 lines

No references in or out.

#### docs/testing-gaps.md

Title: "Testing Gaps — Working Document" | 95 lines

Referenced by:
- docs/stack-decisions.md:793 (mention) — Core doctest system is **done** and working well. See `docs/testing-gaps.md` for coverage status. The remaining items fr
- docs/testing.md:596 (link) — See [testing-gaps.md](testing-gaps.md) for detailed plans. Key ideas:

References:
- → docs/DESIGN.md (mention)
- → CLAUDE.md (mention)

#### docs/testing.md

Title: "Testing" | 602 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:372 (mention) — `docs/testing.md`). What's missing is the *practice*:
- CLAUDE.md:122 (mention) — | Testing philosophy | `docs/testing.md` |
- docs/chat-scroll-testing.md:5 (mention) — behavior that doctests can't exercise (`docs/testing.md` §6). This is the
- docs/ideas.md:870 (mention) — Implemented as `cb session <id> --tool-report` + `@session-critique` subagent. See `docs/testing.md` § Session Critiques
- docs/implemented-plans/agent-applied-migrations.md:82 (mention) — - `callback-box/docs/testing.md` — tests-first as a design tool; the machine
- docs/implemented-plans/card-view-widgets.md:636 (mention) — - **Test posture** (per `docs/testing.md` — tests first, as a design tool):
- docs/implemented-plans/chat-scroll-redesign.md:55 (mention) — - `callback-box/docs/testing.md:5-11` — tests force decomposition, document, and
- docs/implemented-plans/chat-stream-finalize-unify.md:53 (mention) — - `callback-box/docs/testing.md:5-9` + `:474-521` — layout/streaming behavior is
- docs/implemented-plans/courseware-lesson-plan.md:326 (mention) — - **Tests** (per `docs/testing.md`, on substantial codepaths): the `lesson-plan` parse doctest
- docs/implemented-plans/figure-card-type.md:78 (mention) — - **`docs/testing.md`** — tests as a design tool, on substantial codepaths.
- docs/implemented-plans/link-validation-fix.md:35 (mention) — - `callback-box/docs/testing.md` — tests as a design tool; name the doctest for
- docs/implemented-plans/normalize-chat-links.md:78 (mention) — - **`callback-box/docs/testing.md`** — tests as a design tool; doctest the
- docs/implemented-plans/procedure-validation-completion.md:36 (mention) — - **`docs/testing.md`** — tests come first as a design tool; cover substantial codepaths, not coverage-for-its-own-sake.
- docs/implemented-plans/rest-to-trpc-consolidation.md:383 (mention) — - **Test posture** (`docs/testing.md` — tests as design tool, not coverage): a
- docs/implemented-plans/slopo-codehealth-adoption.md:56 (mention) — - **`docs/testing.md`** — tests are not for coverage (`docs/testing.md:11`:
- docs/implemented-plans/view-render-testing.md:31 (mention) — - `callback-box/docs/testing.md` — tests as a design tool; doctests are the
- docs/plans/courseware-phase1.md:485 (mention) — - **Tests** (per `docs/testing.md`):
- docs/plans/external-skills-harvest.md:288 (mention) — - [x] **X1 — reconcile cb-plan's test posture with `docs/testing.md`. DONE →

References:
- → src/services/CLAUDE.md (mention)
- → docs/agent-knowledge.md (link)
- → docs/chat-scroll-testing.md (link)
- → docs/doc-graph.md (mention)
- → docs/testing-gaps.md (link)

#### docs/todo-security.md **[ORPHAN]**

Title: "Security TODOs" | 25 lines

No references in or out.

#### docs/user-stories.md

Title: "callback-box — User Stories" | 5768 lines

Referenced by:
- docs/plans/user-story-audit-followups.md:3 (mention) — This plan triages the 95 `IAN:` comments left on `docs/user-stories.md` (the
- docs/user-stories.md:2509 (mention) — **Verifier (flagged):** The story is partially accurate. Core features (markdown export, lossy detection, warning displa

References:
- → docs/asset-manifests.md (mention)
- → docs/landmarks.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/prompt-logging.md (mention)
- → docs/implemented-plans/websocket-chat-transport.md (mention)
- → CLAUDE.md (mention)
- → docs/implemented-plans/narration-mode-design.md (mention)
- → docs/plans/triage-design.md (mention)
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
- CLAUDE-MD-REVIEW.md:16 (mention) — - `docs/architecture/CLAUDE.md` (54 lines)
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
- docs/scheduled/csp-violation-review.md:91 (mention) — `docs/implemented-plans/app-wide-csp.md` (the design rationale, including why the

References:
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)
- → docs/content-security-policy.md (mention)

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
- docs/ideas.md:916 (mention) — `docs/implemented-plans/box-search.md`. Embeddings/hybrid remain future

References:
- → CODE-STYLE.md (mention)
- → docs/ideas.md (mention)
- → docs/adding-schemas.md (mention)
- → CLAUDE.md (mention)

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
- docs/ideas.md:909 (mention) — `docs/implemented-plans/gmail-gc-unlabeled.md`. (Chose full reconciliation over

References:
- → docs/connectors.md (mention)

#### docs/implemented-plans/job-xml-purge.subplan.md

Title: "Job-Card XML Purge (subplan)" | 220 lines

Referenced by:
- docs/plans/prompt-surface-ia-review.md:542 (mention) — scrub, and is split out to **`job-xml-purge.subplan.md`** — executed in its own

References:
- → docs/plans/prompt-surface-ia-review.md (mention)
- → CODE-STYLE.md (mention)

#### docs/implemented-plans/link-validation-fix.md **[ORPHAN]**

Title: "Markdown link validation — turn it on, make it correct, close the commit-time hole" | 652 lines

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
- docs/plans/README.md:45 (mention) — (+ `.review.md`, `.gstack-trial-review.md`), `markdoc-format-investigation.md`,

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
- docs/plans/README.md:44 (mention) — - → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-design.md`

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
- docs/ideas.md:312 (link) — Conceptual inverse of narration mode (see [narration-mode-design.md](narration-mode-design.md)). Narration is user-talks
- docs/plans/README.md:46 (mention) — `shared-frontend-backend-code.subplan.md`, `narration-mode-design.md`
- docs/user-stories.md:1567 (mention) — The design doc (narration-mode-design.md line 240) explicitly states: "The chat has a `...` menu where settings live; th

References:
- → docs/activities-retrospective.md (link)
- → FRONTEND.md (mention)
- → docs/activities-design.md (mention)

#### docs/implemented-plans/nav-card.md

Title: "Nav as a card — first interface-as-cards slice" | 107 lines

Referenced by:
- docs/plans/interface-as-cards.md:286 (mention) — | Nav | curated `refs` card + per-entry overrides — **shipped 2026-07** (`docs/implemented-plans/nav-card.md`; nav form/

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
- → THINKING_CLAUDE.md (mention)

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
- docs/plans/README.md:44 (mention) — - → `implemented-plans/`: `selection-commentary.md`, `markdoc-tags-design.md`
- docs/plans/box-commentary-surface.md:96 (mention) — selection-commentary feature (`docs/implemented-plans/selection-commentary.md`) and the

References:
- → test/manual/selection-commentary.manual.md (mention)
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/shared-frontend-backend-code.subplan.md

Title: "Shared Frontend/Backend Code — Subplan" | 319 lines

Referenced by:
- docs/implemented-plans/markdoc-tags-design.md:170 (link) — [shared-frontend-backend-code subplan](shared-frontend-backend-code.subplan.md).
- docs/plans/README.md:46 (mention) — `shared-frontend-backend-code.subplan.md`, `narration-mode-design.md`

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

#### docs/implemented-plans/user-location.md

Title: "User Location (`cb location get`)" | 496 lines

Referenced by:
- docs/implemented-plans/named-places.md:19 (mention) — live fix and the `cb location get` command from `docs/implemented-plans/user-location.md`.

References:
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → docs/box-layout.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/view-render-testing.md **[ORPHAN]**

Title: "Plan: testing agent-authored views" | 544 lines

References:
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)
- → CLAUDE.md (mention)

#### docs/implemented-plans/webpage-card-and-commentary.md **[ORPHAN]**

Title: "`.webpage.card` + commentary-as-attachment" | 458 lines

References:
- → docs/plans/web-page-commentary.md (link)
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

Title: "In-box Commentary Surface for Out-of-Box Files" | 779 lines

Referenced by:
- docs/implemented-plans/extfile-card.md:45 (mention) — - **Precedent — the commentary surface** (`docs/plans/box-commentary-surface.md`,

References:
- → CODE-STYLE.md (mention)
- → docs/implemented-plans/selection-commentary.md (mention)
- → docs/prompt-audits.md (mention)
- → CLAUDE.md (mention)

#### docs/plans/boxes-as-packages-v2.md

Title: "Boxes as Packages v2 — callback-box as a library" | 541 lines

Referenced by:
- docs/unimplemented-plans/README.md:16 (mention) — | `boxes-as-packages.md` | Superseded by `../plans/boxes-as-packages-v2.md` (2026-07-03), which re-derived the design ag
- docs/unimplemented-plans/boxes-as-packages.md:3 (mention) — **Status:** SUPERSEDED by `docs/plans/boxes-as-packages-v2.md` (2026-07-03), which re-derives

References:
- → docs/unimplemented-plans/boxes-as-packages.md (mention)
- → docs/box-layout.md (mention)
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)
- → docs/migrations.md (mention)
- → deploy/README.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/plans/README.md (mention)

#### docs/plans/chat-husks.md

Title: "Chat husks — web chat sessions as cards (phase 1)" | 70 lines

Referenced by:
- docs/plans/interface-as-cards.md:290 (mention) — | Chat | husk card per session + chat view + the slot | Below. **Husks shipped 2026-07** (`docs/plans/chat-husks.md`): a

References:
- → docs/plans/interface-as-cards.md (mention)

#### docs/plans/courseware-external-skills-triage.md

Title: "Courseware prior art — triaging dmccreary/claude-skills" | 304 lines

Referenced by:
- docs/ideas.md:1493 (mention) — `interactive-infographic-overlay`; see `docs/plans/courseware-external-skills-triage.md`).

#### docs/plans/courseware-phase1.md **[ORPHAN]**

Title: "Courseware Phase 1 — the course: cards, rules, and the authoring skill" | 510 lines

References:
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → docs/testing.md (mention)

#### docs/plans/external-skills-harvest.md **[ORPHAN]**

Title: "External skills harvest — evaluation backlog" | 314 lines

References:
- → CLAUDE.md (mention)
- → CODE-STYLE.md (mention)
- → FRONTEND.md (mention)
- → docs/ideas.md (mention)
- → docs/glossary.md (mention)
- → docs/testing.md (mention)

#### docs/plans/interface-as-cards.md

Title: "The interface as cards — design" | 437 lines

Referenced by:
- CLAUDE.md:143 (mention) — | Interface-as-cards design | `docs/plans/interface-as-cards.md` |
- docs/ideas.md:586 (mention) — **Superseded by `docs/plans/interface-as-cards.md`** (2026-07 design
- docs/implemented-plans/nav-card.md:11 (mention) — First implementation slice of `docs/plans/interface-as-cards.md`. Small on
- docs/plans/chat-husks.md:8 (mention) — `docs/plans/interface-as-cards.md` ("Chat / Husks").
- docs/plans/query-cards.md:22 (mention) — species deferred from `docs/plans/interface-as-cards.md` — the piece that

References:
- → docs/ideas.md (mention)
- → docs/plans/query-cards.md (mention)
- → docs/implemented-plans/nav-card.md (mention)
- → docs/plans/chat-husks.md (mention)

#### docs/plans/pdf-intake-design.md

Title: "PDF Intake" | 179 lines

Referenced by:
- CLAUDE.md:141 (mention) — | PDF intake design | `docs/plans/pdf-intake-design.md` |
- docs/plans/README.md:49 (mention) — `pdf-intake-design.md` (not yet implemented), `source-editor.md`.
- docs/plans/user-story-audit-followups.md:55 (mention) — - **D4 (PDF) — design only.** `docs/plans/pdf-intake-design.md` reviewed and its

References:
- → docs/glossary.md (link)
- → docs/asset-manifests.md (link)

#### docs/plans/prompt-surface-ia-review.md

Title: "Prompt Surface Cleanup — IA Review" | 988 lines

Referenced by:
- docs/implemented-plans/job-xml-purge.subplan.md:25 (mention) — (`prompt-surface-ia-review.md`, Track 1). The parent plan's original Track 1

References:
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)
- → CODE-STYLE.md (mention)
- → docs/implemented-plans/job-xml-purge.subplan.md (mention)

#### docs/plans/query-cards.md

Title: "Query cards — the "select and arrange cards" vocabulary" | 363 lines

Referenced by:
- docs/plans/interface-as-cards.md:281 (mention) — | Landmarks page | query card (`type: landmark`) | Trivial; machinery proof. **Shipped 2026-07 as an instrument card** (

References:
- → docs/landmarks.md (mention)
- → docs/plans/interface-as-cards.md (mention)
- → CODE-STYLE.md (mention)

#### docs/plans/README.md

Title: "docs/plans/ — proposals and in-flight plans" | 60 lines

Referenced by:
- docs/plans/boxes-as-packages-v2.md:517 (mention) — run, docs rewrite (`adding-a-box.md`, `deploy/README.md`, a real `README.md` with the

References:
- → docs/implemented-plans/selection-commentary.md (mention)
- → docs/implemented-plans/markdoc-tags-design.md (mention)
- → docs/implemented-plans/markdoc-format-investigation.md (mention)
- → docs/implemented-plans/shared-frontend-backend-code.subplan.md (mention)
- → docs/implemented-plans/narration-mode-design.md (mention)
- → docs/plans/triage-design.md (mention)
- → docs/plans/pdf-intake-design.md (mention)
- → docs/plans/source-editor.md (mention)
- → docs/activities-design.md (mention)
- → docs/capture-pipeline-redesign.md (mention)
- → docs/event-bus-design.md (mention)
- → docs/design-card-views.md (mention)
- → docs/photo-storage-investigation.md (mention)
- → docs/design-vision.md (mention)
- → docs/stack-decisions.md (mention)

#### docs/plans/source-editor.md

Title: "Source Editor Plan" | 138 lines

Referenced by:
- CLAUDE.md:142 (mention) — | Source editor plan | `docs/plans/source-editor.md` |
- docs/plans/README.md:49 (mention) — `pdf-intake-design.md` (not yet implemented), `source-editor.md`.

#### docs/plans/triage-design.md

Title: "Triage — Design" | 262 lines

Referenced by:
- docs/DESIGN.md:3 (mention) — > - §2 ("Input → Inbox → preprocessing/triage") talks about a single "triage" phase. The formal three-stage pipeline tha
- docs/IMPLEMENTATION.md:3 (mention) — > - References to a single "triage" agent / "triage" run-mode / `--agent triage` predate both the reactor and the new so
- docs/agent-knowledge.md:243 (mention) — - **Modify landmark `<triage-destination>`** — edit a directory's landmark to change pipeline routing rules (the cross-c
- docs/box-layout.md:52 (mention) — | `box/inbox/intake/` | Items being prepared before triage (transcription, OCR, filename normalization). See `docs/plans
- docs/cli-restructure.md:88 (mention) — > **Namespace note (2026-05-20):** This group was originally proposed as `cb intake`, but the bare `cb intake` is now oc
- docs/connectors.md:84 (mention) — - `intake-utils.ts` — `createOrAppendIntakeJob()` for creating reactor inbox-processing jobs (legacy reactor path, disti
- docs/design-vision.md:9 (mention) — **Categories** form the triage stage for incoming items. Material arrives from multiple sources—document scans, voice in
- docs/ideas.md:434 (mention) — - **Relation to landmarks/triage-design.** `docs/plans/triage-design.md` already sketches a typed-routing pipeline using
- docs/knowledge-audit-rerun-2026-07-03.md:245 (mention) — internals live in dev-repo source and `docs/plans/triage-design.md`, which is
- docs/landmarks.md:33 (mention) — A landmark is pure YAML frontmatter (no body) with one or more **roles**. The `navigation` role carries the bookmark fie
- docs/photo-storage-investigation.md:63 (mention) — This maps directly to the intake stage in the triage design (see `docs/plans/triage-design.md`). Canonical optimization 
- docs/plans/README.md:48 (mention) — - → `plans/` (still open): `triage-design.md` (in progress),
- docs/plans/pai-review/README.md:60 (mention) — | Pipeline | Algorithm doctrine (`$PAI/PAI/ALGORITHM/v6.3.0.md`, 673 lines of prompt) | reactor + intake→triage→handle i
- docs/user-stories.md:1658 (mention) — **Design alignment:** Matches triage-design.md §5 exactly, with all three confidence levels implemented as specified inc

References:
- → docs/photo-storage-investigation.md (mention)

#### docs/plans/user-story-audit-followups.md

Title: "User-story audit — follow-up plans" | 425 lines

Referenced by:
- docs/ideas.md:1537 (mention) — Surfaced by the user-story audit (`docs/plans/user-story-audit-followups.md` D9).

References:
- → docs/user-stories.md (mention)
- → docs/calendar.md (mention)
- → docs/ideas.md (mention)
- → docs/plans/pdf-intake-design.md (mention)

#### docs/plans/web-page-commentary.md

Title: "Web-page commentary capture" | 559 lines

Referenced by:
- docs/implemented-plans/webpage-card-and-commentary.md:30 (link) — [`web-page-commentary.md`](./web-page-commentary.md) (which is otherwise

References:
- → CODE-STYLE.md (mention)
- → CLAUDE.md (mention)
- → docs/landmarks.md (mention)

### docs/plans/pai-review/

#### docs/plans/pai-review/information-layout.md

Title: "Information layout — how PAI organizes context, memory, and state" | 231 lines

Referenced by:
- docs/plans/pai-review/README.md:18 (link) — | [information-layout.md](./information-layout.md) | How PAI organizes information: context loading, MEMORY tiers, knowl
- docs/plans/pai-review/prompts.md:26 (link) — loaded on demand (see [information-layout.md](./information-layout.md)); the

References:
- → docs/agent-knowledge.md (mention)
- → docs/box-layout.md (mention)
- → CLAUDE.md (mention)
- → docs/plans/pai-review/telos.md (link)
- → docs/plans/pai-review/prompts.md (link)
- → docs/plans/pai-review/isa.md (link)

#### docs/plans/pai-review/isa.md

Title: "ISA — the Ideal State Artifact" | 226 lines

Referenced by:
- docs/plans/pai-review/README.md:15 (link) — | [isa.md](./isa.md) | The ISA primitive — spec quotes, a real example, what it actually is, what cb should take |
- docs/plans/pai-review/information-layout.md:159 (link) — decisions, evidence in a single artifact (see [isa.md](./isa.md)). The sync

#### docs/plans/pai-review/prompts.md

Title: "The actual prompts — quoted and annotated" | 358 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:198 (mention) — in `prompt-report.ts` updated; `docs/prompts.md` regenerated).
- docs/cli-restructure.md:22 (mention) — - **`cb init-rules` standalone removed.** File moved from `src/cli/commands/init-rules.ts` to `src/core/init-rules.ts` (
- docs/ideas.md:866 (mention) — `pnpm prompt-report` generates `docs/prompts.md` — a full inventory of every prompt, instruction, and rule in the system
- docs/maintenance.md:16 (mention) — | Prompt report | `pnpm prompt-report` | After prompt or schema-instruction changes | `docs/prompts.md` |
- docs/plans/pai-review/README.md:17 (link) — | [prompts.md](./prompts.md) | The actual prompt text — system prompt, CLAUDE.md, Algorithm doctrine — quoted and annota
- docs/plans/pai-review/information-layout.md:64 (link) — (see [prompts.md](./prompts.md) §3) naturally sits.
- src/dev/CLAUDE.md:8 (mention) — | `prompt-report.ts` | Generates `docs/prompts.md` (system-wide prompt inventory) | `docs/maintenance.md` |

References:
- → CLAUDE.md (mention)
- → docs/plans/pai-review/information-layout.md (link)
- → docs/plans/pai-review/telos.md (link)

#### docs/plans/pai-review/README.md

Title: "PAI review — comparison substrate for Callback Box planning" | 103 lines

Referenced by:
- docs/plans/pai-review/telos.md:4 (mention) — - `$PAI/PAI/USER/TELOS/` — nine source files + `README.md` + generated summary + `CURRENT_STATE/`/`IDEAL_STATE/` dirs

References:
- → docs/plans/pai-review/isa.md (link)
- → docs/plans/pai-review/telos.md (link)
- → docs/plans/pai-review/prompts.md (link)
- → CLAUDE.md (mention)
- → docs/plans/pai-review/information-layout.md (link)
- → docs/plans/triage-design.md (mention)
- → docs/scheduler.md (mention)

#### docs/plans/pai-review/telos.md

Title: "TELOS and the identity pair — PAI's user-description layer" | 201 lines

Referenced by:
- docs/plans/pai-review/README.md:16 (link) — | [telos.md](./telos.md) | TELOS life-context files + the identity pair — full template quotes, mapping onto cb's person
- docs/plans/pai-review/information-layout.md:60 (link) — [telos.md](./telos.md)), it belongs in the always-loaded tier.
- docs/plans/pai-review/prompts.md:349 (link) — and the proposed personality-card autonomy section in [telos.md](./telos.md)):

References:
- → docs/plans/pai-review/README.md (mention)
- → CLAUDE.md (mention)

### docs/scheduled/

#### docs/scheduled/csp-violation-review.md

Title: "Scheduled routine: CSP violation review" | 93 lines

Referenced by:
- docs/content-security-policy.md:76 (mention) — The routine is a runbook: see `docs/scheduled/csp-violation-review.md`. To harden
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
- docs/plans/boxes-as-packages-v2.md:399 (mention) — - **Per-box OS users / socket permissions / secrets split** (`docs/unimplemented-plans/box-user-account-spec.md`
- docs/unimplemented-plans/README.md:17 (mention) — | `box-user-account-spec.md` | Derivative of boxes-as-packages.md; the OS-user-as-box-identity idea is deferred to the i
- docs/unimplemented-plans/boxes-as-packages.md:11 (link) — **Related:** [Box as Linux User Account spec](box-user-account-spec.md) — tightens this proposal by adopting the OS user

References:
- → docs/unimplemented-plans/boxes-as-packages.md (link)

#### docs/unimplemented-plans/boxes-as-packages.md

Title: "Design Exploration: Boxes as Code Repositories" | 706 lines

Referenced by:
- docs/plans/boxes-as-packages-v2.md:4 (mention) — **Supersedes:** `docs/unimplemented-plans/boxes-as-packages.md` (2025 design exploration). This plan re-derives that
- docs/unimplemented-plans/README.md:16 (mention) — | `boxes-as-packages.md` | Superseded by `../plans/boxes-as-packages-v2.md` (2026-07-03), which re-derived the design ag
- docs/unimplemented-plans/box-user-account-spec.md:4 (link) — **Relationship to other docs:** Builds on the [boxes-as-packages design exploration](boxes-as-packages.md), which propos

References:
- → docs/plans/boxes-as-packages-v2.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (link)
- → docs/server-operations.md (mention)
- → CLAUDE.md (mention)
- → docs/ideas.md (link)

#### docs/unimplemented-plans/README.md **[ORPHAN]**

Title: "Unimplemented plans" | 18 lines

References:
- → docs/unimplemented-plans/boxes-as-packages.md (mention)
- → docs/plans/boxes-as-packages-v2.md (mention)
- → docs/unimplemented-plans/box-user-account-spec.md (mention)

### src/connectors/

#### src/connectors/CLAUDE.md

Title: "Connectors" | 23 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:17 (mention) — - `src/connectors/CLAUDE.md` (25 lines)
- CLAUDE.md:94 (mention) — **Connectors** — Sync external services with the box filesystem. Each implements `Connector.sync()`. See `src/connectors
- docs/glossary.md:36 (mention) — **connector** — Code that syncs an external service (Gmail, RSS, Telegram, ...) with the box filesystem. Implements `Con

References:
- → src/services/CLAUDE.md (mention)

### src/core/reactor/

#### src/core/reactor/CLAUDE.md

Title: "Reactor" | 23 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:18 (mention) — - `src/core/reactor/CLAUDE.md` (23 lines)
- src/core/reactor/DESIGN.md:66 (mention) — - **System prompt** tells the agent what context it already has (job XML, referenced files, schema instructions, rules f

References:
- → src/core/reactor/DESIGN.md (link)

#### src/core/reactor/DESIGN.md

Title: "Reactor Design" | 111 lines

Referenced by:
- src/core/reactor/CLAUDE.md:3 (link) — See [DESIGN.md](DESIGN.md) for the full architecture, flow, and rationale.

References:
- → src/core/reactor/CLAUDE.md (mention)

### src/dev/

#### src/dev/CLAUDE.md

Title: "Dev Scripts" | 17 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:19 (mention) — - `src/dev/CLAUDE.md` (34 lines)
- docs/implemented-plans/box-retrospectives.md:414 (mention) — glossary entries, the two knowledge-audit entries, `src/dev/CLAUDE.md`

References:
- → docs/knowledge-audits.md (mention)
- → docs/plans/pai-review/prompts.md (mention)
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
- CLAUDE-MD-REVIEW.md:20 (mention) — - `src/services/CLAUDE.md` (123 lines, after fix)
- CLAUDE.md:92 (mention) — **Services** — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have ob
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

