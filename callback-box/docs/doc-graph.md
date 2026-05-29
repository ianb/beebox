# Documentation Graph Report

Generated: 2026-05-28T00:07:36Z
Total documents: 75

## Issues

### Orphaned Documents (no incoming references)

These documents are not referenced by any other document.

- **docs/architecture/01-what-is-this.md** — "What Is This Thing?" (66 lines)
- **docs/architecture/02-cards-and-memory.md** — "Cards and Memory" (99 lines)
- **docs/attach-implementation.md** — "Implementation spec: `.attach/` directories" (344 lines)
- **docs/capture-pipeline-redesign.md** — "Capture Pipeline Redesign" (128 lines)
- **docs/chat-schedules.md** — "Chat Schedules" (94 lines)
- **docs/design-card-views.md** — "Card View Plugin System" (876 lines)
- **docs/design-vision.md** — "Callback Box: Design Vision and Architecture" (68 lines)
- **docs/event-bus-design.md** — "Event Bus Design" (142 lines)
- **docs/gmail-setup.md** — "Gmail Connector Setup" (85 lines)
- **docs/google-drive.md** — "Google Drive Integration" (140 lines)
- **docs/landmark-curation.md** — "Landmark Curation" (48 lines)
- **docs/prompt-logging.md** — "Prompt Logging for Agent Invocations" (212 lines)
- **docs/scheduler.md** — "Scheduler" (93 lines)
- **docs/telegram-setup.md** — "Telegram Connector Setup" (136 lines)
- **docs/todo-security.md** — "Security TODOs" (25 lines)
- **test/manual/README.md** — "Manual tests" (21 lines)

### Broken References

These references point to files that don't exist.

- **CLAUDE-MD-REVIEW.md:282** → `CONVENTIONS.md` (at-include)
  Context: 2. ~~**`@CONVENTIONS.md` import syntax** and the mixed-scope problem.~~
- **docs/agent-knowledge.md:329** → `view:store/path/to/file.md` (link)
  Context: - **Expected level: Knows directly** — the chat system prompt describes the `[Display Name](view:store/path/to/file.md)`
- **docs/knowledge-audits.md:50** → `MAP.md` (at-include)
  Context: - `context_dir` — box-relative subdirectory to run the agent from. Sets the SDK's `cwd` there and adds the box root to `
- **docs/prompt-audits.md:47** → `tone-design.md` (link)
  Context: Stock LLM phrases ("Great question!", "Let me unpack that," "That's a real tension") often come from prompt language tha

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
- → docs/box-layout.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/connectors.md (mention)
- → CONVENTIONS.md (at-include) **[BROKEN]**
- → docs/testing.md (mention)
- → docs/maintenance.md (mention)
- → docs/knowledge-audits.md (mention)
- → CODE-STYLE.md (at-include)

#### CLAUDE.md

Title: "Callback Box" | 147 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:1 (mention) — # CLAUDE.md Review — 2026-04-28
- CLAUDE.md:14 (mention) — Overmind and Procfile.dev are gone. The router (`bin/router.mjs`) spawns the same two processes (Vite, Fastify) directly
- docs/EXAMPLE_FILES.md:55 (mention) — ├── CLAUDE.md
- docs/IMPLEMENTATION.md:671 (mention) — CLAUDE.md              # Base instructions for all agents
- docs/activities-design.md:46 (mention) — Live at `<box>/activities/<name>/src/`. The `src/` subdirectory is deliberate — the activity directory isn't just code, 
- docs/activities-retrospective.md:21 (mention) — Each "activity-shaped" use case turned out to be better served by adding the specific capability (a card type, a schedul
- docs/adding-schemas.md:178 (mention) — 5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
- docs/agent-knowledge.md:7 (mention) — 1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CL
- docs/attach-implementation.md:154 (mention) — Throughout prompts, generated docs, agent instructions, and `CLAUDE.md` mentions, the user-facing terminology is "card a
- docs/box-layout.md:9 (mention) — A box is a directory marked by a `.cb-box` file. It's a git repository (`cb init` initialises one), and the working tree
- docs/boxes-as-packages.md:406 (mention) — The boxes are physically still at `~/src/boxes/<box>/` (outside the callback monorepo, so agents working inside a box do
- docs/cards-as-markdown.md:231 (mention) — The explanation-length test (see Test results section) confirms this is modest, not dramatic: the full Cards section in 
- docs/design-vision.md:49 (mention) — - Small additions like a `CLAUDE.md` file with custom prompts are preferred to elaborate new structures
- docs/glossary.md:20 (mention) — **boxholder** — The human a box belongs to. Used in shared prose where "the user" is ambiguous (since agents are also "u
- docs/ideas.md:140 (mention) — Connected concern: subagents in callback-box don't inherit CLAUDE.md or rules (per [[claude-code-memory-concerns]] entry
- docs/knowledge-audits.md:14 (mention) — - After touching CLAUDE.md, schemas, prompts, or anything that changes what an agent should know.
- docs/maintenance.md:7 (mention) — The system carries a lot of agent-facing surface: CLAUDE.md and rule files, schemas with embedded `instructions`, prompt
- docs/prompt-logging.md:3 (mention) — When agents run in a callback box (via `cb wakeup`, `cb reactor`, procedures, etc.), you can capture the full API traffi
- docs/stack-decisions.md:1168 (mention) — `CLAUDE.md` for the user-facing workflow. The old Overmind-based dev
- docs/testing-gaps.md:93 (mention) — - **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DE

References:
- → CLAUDE.md (mention)
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
- → docs/maintenance.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/ssr-render-testing.md (mention)
- → docs/calendar.md (mention)
- → docs/pdf-intake-design.md (mention)
- → docs/source-editor.md (mention)
- → docs/ideas.md (mention)
- → docs/glossary.md (mention)
- → CODE-STYLE.md (at-include)

#### CODE-STYLE.md

Title: "Code Style" | 60 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:39 (mention) — 5. **Split CONVENTIONS.md** into `CODE-STYLE.md` (general — typecheck/lint,
- CLAUDE-MD-REVIEW.md:445 (at-include) — 14. Verify `@CODE-STYLE.md` import syntax does what's intended.
- CLAUDE.md:114 (mention) — When you get corrected on a convention, pattern, or workflow that wasn't documented, update CLAUDE.md, CODE-STYLE.md, FR
- CLAUDE.md:146 (at-include) — @CODE-STYLE.md
- FRONTEND.md:3 (mention) — UI palette, primitives, and the `className` rule. Backend code never needs to load this; CODE-STYLE.md covers convention

References:
- → FRONTEND.md (mention)

#### FRONTEND.md

Title: "Frontend Conventions" | 108 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:40 (mention) — error handling, code style; ~58 lines) and `FRONTEND.md` (data-source
- CLAUDE.md:67 (mention) — src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see FRONTEND.md
- CODE-STYLE.md:3 (mention) — General coding conventions for backend and frontend. UI palette and primitive reference live in FRONTEND.md.
- FRONTEND.md:107 (mention) — New primitives live in `components/ui/<Name>.tsx`, accept `className`, merge via `cn()`, and document their semantic rol
- docs/ideas.md:383 (mention) — Method: do one sweep through `CLAUDE.md`, `FRONTEND.md`, the schemas, and `docs/` collecting terms-of-art, then write en
- docs/narration-mode-design.md:193 (mention) — Color and primitive choices follow the box's semantic palette (see `FRONTEND.md`); the accent role is appropriate.

References:
- → CODE-STYLE.md (mention)
- → docs/data-source-tagging.md (mention)
- → FRONTEND.md (mention)

#### README.md

Title: "callback-box" | 2 lines

Referenced by:
- docs/cards-as-markdown.md:72 (mention) — - `README.md` — plain markdown, not a card
- docs/design-card-views.md:46 (mention) — README.md               → [Source]

#### THINKING_CLAUDE.md

Title: "Thinking Machine Mode" | 93 lines

Referenced by:
- docs/prompt-logging.md:81 (mention) — Contents of /Users/.../THINKING_CLAUDE.md (project instructions, checked into the codebase):

### deploy/

#### deploy/CLAUDE.md

Title: "Deploy" | 26 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:15 (mention) — - `deploy/CLAUDE.md` (8 lines)

References:
- → deploy/README.md (mention)

#### deploy/README.md

Title: "Deploy" | 191 lines

Referenced by:
- CLAUDE.md:131 (mention) — | Deployment | `deploy/README.md` |
- deploy/CLAUDE.md:3 (mention) — Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.
- docs/server-operations.md:3 (link) — Reference for the running callback-box server (production at `box.example.com`). For initial provisioning scripts see 

### docs/

#### docs/activities-design.md

Title: "Activities — Design Proposal" | 311 lines

Referenced by:
- docs/activities-retrospective.md:7 (link) — An "Activity" was a reusable container for non-default chat shapes (language learning, notebook, guided journaling, etc.
- docs/narration-mode-design.md:333 (mention) — - **Activities** (`docs/activities-design.md`): being phased out in favor of composable feature flags. Narration is the 

References:
- → docs/activities-retrospective.md (link)
- → CLAUDE.md (mention)

#### docs/activities-retrospective.md

Title: "Activities — Retrospective" | 44 lines

Referenced by:
- docs/activities-design.md:3 (link) — > **Status: removed.** The Activities system was built and then removed in May 2026 in favor of piecemeal opt-in feature
- docs/narration-mode-design.md:5 (link) — > Note: this doc references the Activities system as a coordinate ("the infrastructure that makes activities being phase

References:
- → docs/activities-design.md (link)
- → CLAUDE.md (mention)
- → docs/narration-mode-design.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/IMPLEMENTATION.md (mention)

#### docs/adding-a-box.md

Title: "Adding a New Box" | 149 lines

Referenced by:
- CLAUDE.md:133 (mention) — | Adding a box | `docs/adding-a-box.md` |
- docs/ideas.md:455 (mention) — For now: manually copy secret files to new boxes. See `docs/adding-a-box.md` step 7.
- docs/server-operations.md:147 (link) — - [`adding-a-box.md`](./adding-a-box.md) — per-box setup (secrets, connectors, box directory layout).

#### docs/adding-api-endpoints.md

Title: "Adding API Endpoints" | 247 lines

Referenced by:
- CLAUDE.md:128 (mention) — | Adding API endpoints | `docs/adding-api-endpoints.md` |

#### docs/adding-schemas.md

Title: "Adding a New Card Schema" | 192 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:241 (mention) — - `src/schemas/` — `docs/adding-schemas.md` exists; might just need a one-line
- CLAUDE.md:125 (mention) — | Adding a card type | `docs/adding-schemas.md` |
- docs/EXAMPLE_FILES.md:4 (mention) — > - **Schema authoring**: For how to add a new schema today, see `docs/adding-schemas.md`.
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a cardworks schema. The atomic unit of data in a box. Named `Title.type.card` (e.g.
- docs/migrations.md:147 (mention) — - `docs/adding-schemas.md` — when a *schema* change (not a data shape change) is the right move instead of a migrator

References:
- → CLAUDE.md (mention)

#### docs/agent-knowledge.md

Title: "Agent Knowledge Audit: What It Should Know and How to Verify" | 493 lines

Referenced by:
- docs/testing.md:375 (link) — See [agent-knowledge.md](agent-knowledge.md) for the full knowledge taxonomy and test prompt guide.

References:
- → CLAUDE.md (mention)
- → docs/connectors.md (mention)
- → docs/triage-design.md (mention)
- → view:store/path/to/file.md (link) **[BROKEN]**

#### docs/attach-implementation.md **[ORPHAN]**

Title: "Implementation spec: `.attach/` directories" | 344 lines

References:
- → CLAUDE.md (mention)
- → docs/box-layout.md (mention)

#### docs/attach-manifests.md

Title: "Attach Manifests" | 255 lines

Referenced by:
- docs/glossary.md:30 (mention) — **asset manifest** — `manifest.json` inside each `.attach/` directory recording every asset's size, mtime, and sha256. C
- docs/ideas.md:396 (mention) — - `docs/attach-manifests.md` — rename the doc concept to "asset manifest"; reserve "attachment" for the broader director
- docs/pdf-intake-design.md:67 (link) — All the binaries are assets — tracked via the asset manifest, not committed to git. The card itself, the manifest, and t

References:
- → docs/ideas.md (mention)

#### docs/box-layout.md

Title: "Box Layout" | 148 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:215 (mention) — `docs/box-layout.md`. Covers marker files, `box/`, `store/`, `config/`,
- CLAUDE.md:134 (mention) — | Box layout reference | `docs/box-layout.md` |
- docs/attach-implementation.md:161 (mention) — - `docs/box-layout.md`

References:
- → CLAUDE.md (mention)
- → docs/triage-design.md (mention)
- → docs/client-debug-log.md (mention)

#### docs/box-user-account-spec.md

Title: "Spec: Box as Linux User Account" | 402 lines

Referenced by:
- docs/boxes-as-packages.md:6 (link) — **Related:** [Box as Linux User Account spec](box-user-account-spec.md) — tightens this proposal by adopting the OS user

References:
- → docs/boxes-as-packages.md (link)

#### docs/boxes-as-packages.md

Title: "Design Exploration: Boxes as Code Repositories" | 701 lines

Referenced by:
- docs/box-user-account-spec.md:4 (link) — **Relationship to other docs:** Builds on the [boxes-as-packages design exploration](boxes-as-packages.md), which propos

References:
- → docs/box-user-account-spec.md (link)
- → docs/server-operations.md (mention)
- → CLAUDE.md (mention)
- → docs/ideas.md (link)

#### docs/calendar.md

Title: "Calendar Integration" | 89 lines

Referenced by:
- CLAUDE.md:140 (mention) — | Calendar integration | `docs/calendar.md` |
- docs/EXAMPLE_FILES.md:60 (mention) — └── calendar.md
- docs/IMPLEMENTATION.md:675 (mention) — calendar.md          # Rules for calendar operations

#### docs/capture-pipeline-redesign.md **[ORPHAN]**

Title: "Capture Pipeline Redesign" | 128 lines

No references in or out.

#### docs/cards-as-markdown.md

Title: "RFC: Cards as Markdown + YAML Frontmatter" | 2553 lines

Referenced by:
- CLAUDE.md:52 (mention) — See `src/core/install-validation-hooks.ts`. The hook commands embed the absolute path to the installing `bin/cb` so they
- docs/DESIGN.md:4 (mention) — > - §3–§4 describe an XML envelope as the canonical card format. As of May 2026, most schemas are YAML frontmatter + mar
- docs/EXAMPLE_FILES.md:2 (mention) — > - **Card format**: Most schemas are now YAML frontmatter + markdown body, not XML. The XML examples below show the old
- docs/IMPLEMENTATION.md:4 (mention) — > - Card format: most schemas are now YAML frontmatter + markdown body, not XML. Anywhere this doc shows an XML envelope
- docs/glossary.md:22 (mention) — **card** — A typed file validated by a cardworks schema. The atomic unit of data in a box. Named `Title.type.card` (e.g.
- docs/migrations.md:145 (mention) — - `docs/cards-as-markdown.md` — design rationale for the YAML-frontmatter format these migrators target

References:
- → docs/migrations.md (mention)
- → README.md (mention)
- → CLAUDE.md (mention)

#### docs/chat-schedules.md **[ORPHAN]**

Title: "Chat Schedules" | 94 lines

No references in or out.

#### docs/cli-restructure.md

Title: "`cb` CLI Restructure — Plan" | 163 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:186 (mention) — `docs/cli-restructure.md`. Summary:

References:
- → docs/triage-design.md (mention)
- → docs/maintenance.md (mention)
- → CLAUDE-MD-REVIEW.md (mention)

#### docs/client-debug-log.md

Title: "Client Debug Log" | 68 lines

Referenced by:
- CLAUDE.md:108 (mention) — - **Check client debug logs when debugging frontend issues.** The browser forwards console errors to the server. Read th
- docs/box-layout.md:110 (mention) — | `client-debug.log` | Browser console errors forwarded from the frontend. See `docs/client-debug-log.md`. |
- docs/server-operations.md:141 (link) — For SSH-only debugging: `ssh root@<server> tail /home/callback/boxes/<box>/.callback-box/client-debug.log`. See [`client

#### docs/connectors.md

Title: "Connectors" | 86 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:255 (mention) — - Add a connector (`docs/connectors.md` exists — is it a how-to or a
- CLAUDE.md:129 (mention) — | Connectors | `docs/connectors.md` |
- docs/agent-knowledge.md:205 (mention) — - **Expected level: Discoverable** — the agent would need to look at `config/connectors/` and/or `docs/generated/connect

References:
- → src/services/CLAUDE.md (mention)
- → docs/triage-design.md (mention)

#### docs/data-source-tagging.md

Title: "Data Source Tagging Convention" | 89 lines

Referenced by:
- FRONTEND.md:7 (mention) — UI elements that display data from a known source (card, commit, session, etc.) must be tagged with `data-cb-source` att

#### docs/design-card-views.md **[ORPHAN]**

Title: "Card View Plugin System" | 876 lines

References:
- → README.md (mention)

#### docs/design-vision.md **[ORPHAN]**

Title: "Callback Box: Design Vision and Architecture" | 68 lines

References:
- → docs/triage-design.md (mention)
- → CLAUDE.md (mention)

#### docs/DESIGN.md

Title: "Callback Box: comprehensive design notes" | 531 lines

Referenced by:
- CLAUDE.md:120 (mention) — | Design rationale | `docs/DESIGN.md` |
- docs/IMPLEMENTATION.md:8 (mention) — This document describes how to build Callback Box, complementing DESIGN.md with concrete implementation details.
- docs/testing-gaps.md:93 (mention) — - **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DE

References:
- → docs/triage-design.md (mention)
- → docs/cards-as-markdown.md (mention)

#### docs/doc-graph.md

Title: "(no title)" | 1 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:46 (mention) — 6. **Regenerated `docs/doc-graph.md`** to reflect the split (doc went from
- docs/ideas.md:610 (mention) — Implemented as `docs/doc-graph.md` (auto-generated cross-reference report). See CLAUDE.md Doc Map.
- docs/maintenance.md:17 (mention) — | Doc graph | `pnpm doc-graph` | After restructuring docs | `docs/doc-graph.md` |
- docs/testing.md:517 (mention) — `npx tsx src/dev/doc-graph.ts > docs/doc-graph.md` — scans all `.md` files, extracts cross-references, reports orphans a
- src/dev/CLAUDE.md:9 (mention) — | `doc-graph.ts` | Generates `docs/doc-graph.md` (cross-reference graph + orphan/broken-ref report) | `docs/maintenance.

#### docs/event-bus-design.md **[ORPHAN]**

Title: "Event Bus Design" | 142 lines

No references in or out.

#### docs/EXAMPLE_FILES.md

Title: "Callback Box: Example Files" | 820 lines

Referenced by:
- CLAUDE.md:122 (mention) — | Card examples | `docs/EXAMPLE_FILES.md` |
- docs/IMPLEMENTATION.md:228 (mention) — See EXAMPLE_FILES.md for RRULE examples and other card/schema samples.
- docs/IMPLEMENTATION.md:277 (link) — Config includes credential references, polling intervals, filters, etc. Agents can read these to understand what's avail

References:
- → docs/cards-as-markdown.md (mention)
- → docs/adding-schemas.md (mention)
- → CLAUDE.md (mention)
- → docs/calendar.md (mention)

#### docs/glossary.md

Title: "Glossary" | 53 lines

Referenced by:
- CLAUDE.md:144 (mention) — | Glossary | `docs/glossary.md` |
- docs/ideas.md:370 (mention) — `docs/glossary.md` is scoped to Proper Nouns — names we coined and general words we've narrowed to project-specific mean
- docs/pdf-intake-design.md:19 (link) — **Intake-time extraction.** When a PDF arrives (`cb import`, capture endpoint, email connector), the intake path runs do

References:
- → docs/ideas.md (mention)
- → CLAUDE.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/attach-manifests.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/procedure-implementation.md (mention)
- → src/services/CLAUDE.md (mention)

#### docs/gmail-setup.md **[ORPHAN]**

Title: "Gmail Connector Setup" | 85 lines

References:
- → docs/google-setup.md (mention)

#### docs/google-drive.md **[ORPHAN]**

Title: "Google Drive Integration" | 140 lines

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
- docs/server-operations.md:126 (link) — **Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — 

References:
- → docs/server-operations.md (link)

#### docs/ideas.md

Title: "Ideas & Planned Features" | 936 lines

Referenced by:
- CLAUDE.md:143 (mention) — | Feature ideas | `docs/ideas.md` |
- docs/attach-manifests.md:247 (mention) — Noted in `docs/ideas.md`.
- docs/boxes-as-packages.md:697 (link) — - **Interaction with the [Markdown cards idea](ideas.md#markdown-cards-replacing-xml).** Both touch the schema-definitio
- docs/glossary.md:14 (mention) — **Open question — capitalization.** Proper nouns in English are normally capitalized. We may want to write "Asset" and "
- docs/ideas.md:890 (mention) — This `ideas.md` plus scattered TODOs across the monorepo is the current state of issue tracking. It works for a single a
- docs/prompt-audits.md:5 (link) — Many of the lenses here, and a number of the related entries in [ideas.md](ideas.md), originated from working through th

References:
- → docs/prompt-audits.md (mention)
- → CLAUDE.md (mention)
- → docs/narration-mode-design.md (link)
- → docs/triage-design.md (mention)
- → docs/glossary.md (mention)
- → FRONTEND.md (mention)
- → docs/attach-manifests.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/IMPLEMENTATION.md (mention)
- → docs/doc-graph.md (mention)
- → docs/testing.md (mention)
- → docs/ideas.md (mention)

#### docs/IMPLEMENTATION.md

Title: "Callback Box: Implementation Guide" | 1018 lines

Referenced by:
- CLAUDE.md:121 (mention) — | Implementation guide | `docs/IMPLEMENTATION.md` |
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `s
- docs/ideas.md:537 (mention) — `cb` currently has only layer 1. Layer 2 would be straightforward to generate from the existing command definitions (yar

References:
- → docs/triage-design.md (mention)
- → docs/cards-as-markdown.md (mention)
- → docs/DESIGN.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/EXAMPLE_FILES.md (link)
- → CLAUDE.md (mention)
- → docs/calendar.md (mention)

#### docs/knowledge-audits.md

Title: "Knowledge Audits" | 65 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:439 (mention) — script to its full doc). Created `docs/knowledge-audits.md` for the
- CLAUDE.md:138 (mention) — | Knowledge audits | `docs/knowledge-audits.md` |
- docs/maintenance.md:31 (mention) — **Full guide:** `docs/knowledge-audits.md` (test structure, recording results, interpreting failures).
- src/dev/CLAUDE.md:7 (mention) — | `knowledge-audit.ts` | Runs YAML-defined tests against a real box agent | `docs/knowledge-audits.md` |

References:
- → CLAUDE.md (mention)
- → docs/maintenance.md (mention)
- → MAP.md (at-include) **[BROKEN]**

#### docs/landmark-curation.md **[ORPHAN]**

Title: "Landmark Curation" | 48 lines

References:
- → docs/landmarks.md (mention)

#### docs/landmarks.md

Title: "Landmarks" | 164 lines

Referenced by:
- CLAUDE.md:135 (mention) — | Landmarks (navigation surface) | `docs/landmarks.md` |
- docs/landmark-curation.md:5 (mention) — For the design and schema of the card itself, see `docs/landmarks.md` and `docs/generated/card-landmark.md`.

References:
- → docs/triage-design.md (mention)

#### docs/maintenance.md

Title: "Code Maintenance" | 97 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:403 (mention) — the first place; or a periodic sweep listed in `docs/maintenance.md`.
- CLAUDE.md:137 (mention) — | Periodic maintenance | `docs/maintenance.md` |
- docs/cli-restructure.md:127 (mention) — - **Card normalization story.** `cb format` was deleted (80-line one-off normalizer that re-serialized cards to flat XML
- docs/knowledge-audits.md:17 (mention) — `docs/maintenance.md` lists this alongside the other periodic tasks.
- docs/migrations.md:146 (mention) — - `docs/maintenance.md` — where `cb migrate` and `clean-broken-refs.ts` sit in the broader maintenance surface
- src/dev/CLAUDE.md:8 (mention) — | `prompt-report.ts` | Generates `docs/prompts.md` (system-wide prompt inventory) | `docs/maintenance.md` |

References:
- → CLAUDE.md (mention)
- → docs/doc-graph.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/migrations.md (mention)
- → docs/architecture/CLAUDE.md (mention)

#### docs/migrations.md

Title: "Box Migrations" | 160 lines

Referenced by:
- CLAUDE.md:127 (mention) — | Box migration runbook | `docs/migrations.md` |
- docs/cards-as-markdown.md:44 (mention) — **Tracking which migrations have been applied per box** is handled by `cb migrate` against the per-box append-only manif
- docs/maintenance.md:55 (mention) — **Author guide + runbook:** `docs/migrations.md` (how to write a new migrator with the noisy-mode `_migrate-warnings` he

References:
- → docs/cards-as-markdown.md (mention)
- → docs/maintenance.md (mention)
- → docs/adding-schemas.md (mention)

#### docs/narration-mode-design.md

Title: "Narration Mode — Design" | 465 lines

Referenced by:
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `s
- docs/ideas.md:254 (link) — Conceptual inverse of narration mode (see [narration-mode-design.md](narration-mode-design.md)). Narration is user-talks

References:
- → docs/activities-retrospective.md (link)
- → FRONTEND.md (mention)
- → docs/activities-design.md (mention)

#### docs/pdf-intake-design.md

Title: "PDF Intake" | 166 lines

Referenced by:
- CLAUDE.md:141 (mention) — | PDF intake design | `docs/pdf-intake-design.md` |

References:
- → docs/glossary.md (link)
- → docs/attach-manifests.md (link)

#### docs/photo-storage-investigation.md

Title: "Photo storage investigation: the ledger box is 20G" | 187 lines

Referenced by:
- docs/triage-design.md:153 (mention) — **Photo and PDF canonicalization is an intake step.** Raw phone images (HEIC/JPEG) arrive in `inbox/intake/`, get transc

References:
- → docs/triage-design.md (mention)

#### docs/procedure-implementation.md

Title: "Procedures" | 133 lines

Referenced by:
- CLAUDE.md:130 (mention) — | Procedures | `docs/procedure-implementation.md` |
- docs/glossary.md:38 (mention) — **procedure** — A multi-step workflow defined as a `*.procedure.card` (currently still XML; one of the deferred Markdoc-

#### docs/prompt-audits.md

Title: "Prompt Audits" | 203 lines

Referenced by:
- docs/ideas.md:70 (mention) — Universality is the point: the same rubric applies wherever the agent commits to something below fact level — hypotheses
- docs/prompt-audits.md:174 (mention) — **Useful: what-changed closers.** One or two sentences naming what changed and where: "Added the pre-tool-brevity audit 

References:
- → docs/ideas.md (link)
- → tone-design.md (link) **[BROKEN]**
- → docs/prompt-audits.md (mention)

#### docs/prompt-logging.md **[ORPHAN]**

Title: "Prompt Logging for Agent Invocations" | 212 lines

References:
- → CLAUDE.md (mention)
- → THINKING_CLAUDE.md (mention)

#### docs/scheduler.md **[ORPHAN]**

Title: "Scheduler" | 93 lines

No references in or out.

#### docs/server-operations.md

Title: "Server Operations" | 148 lines

Referenced by:
- CLAUDE.md:132 (mention) — | Server operations | `docs/server-operations.md` |
- docs/boxes-as-packages.md:361 (mention) — - **`CB_DIAG_API_KEY` becomes per-box** (it lives in each box's `.env`). The bypass curl pattern in `server-operations.m
- docs/health-checks.md:9 (link) — The server runs `claude update` nightly via `claude-update.timer` → `claude-update.service` → `deploy/claude-update.sh` 

References:
- → deploy/README.md (link)
- → docs/health-checks.md (link)
- → docs/client-debug-log.md (link)
- → docs/adding-a-box.md (link)

#### docs/source-editor.md

Title: "Source Editor Plan" | 138 lines

Referenced by:
- CLAUDE.md:142 (mention) — | Source editor plan | `docs/source-editor.md` |

#### docs/ssr-render-testing.md

Title: "SSR Render Testing (`cb render`)" | 177 lines

Referenced by:
- CLAUDE.md:139 (mention) — | SSR page rendering (`cb render`) | `docs/ssr-render-testing.md` |

#### docs/stack-decisions.md

Title: "Stack Decisions" | 1186 lines

Referenced by:
- docs/activities-retrospective.md:43 (mention) — The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `s

References:
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
- docs/stack-decisions.md:802 (mention) — Core doctest system is **done** and working well. 931 tests across 53 files. See `docs/testing-gaps.md` for detailed cov
- docs/testing.md:531 (link) — See [testing-gaps.md](testing-gaps.md) for detailed plans. Key ideas:

References:
- → docs/DESIGN.md (mention)
- → CLAUDE.md (mention)

#### docs/testing.md

Title: "Testing" | 537 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:372 (mention) — `docs/testing.md`). What's missing is the *practice*:
- CLAUDE.md:123 (mention) — | Testing philosophy | `docs/testing.md` |
- docs/ideas.md:676 (mention) — Implemented as `cb session <id> --tool-report` + `@session-critique` subagent. See `docs/testing.md` § Session Critiques

References:
- → src/services/CLAUDE.md (mention)
- → docs/agent-knowledge.md (link)
- → docs/doc-graph.md (mention)
- → docs/testing-gaps.md (link)

#### docs/todo-security.md **[ORPHAN]**

Title: "Security TODOs" | 25 lines

No references in or out.

#### docs/triage-design.md

Title: "Triage — Design" | 262 lines

Referenced by:
- docs/DESIGN.md:3 (mention) — > - §2 ("Input → Inbox → preprocessing/triage") talks about a single "triage" phase. The formal three-stage pipeline tha
- docs/IMPLEMENTATION.md:3 (mention) — > - References to a single "triage" agent / "triage" run-mode / `--agent triage` predate both the reactor and the new so
- docs/agent-knowledge.md:243 (mention) — - **Modify landmark `<triage-destination>`** — edit a directory's landmark to change pipeline routing rules (the cross-c
- docs/box-layout.md:51 (mention) — | `box/inbox/intake/` | Items being prepared before triage (transcription, OCR, filename normalization). See `docs/triag
- docs/cli-restructure.md:88 (mention) — > **Namespace note (2026-05-20):** This group was originally proposed as `cb intake`, but the bare `cb intake` is now oc
- docs/connectors.md:83 (mention) — - `intake-utils.ts` — `createOrAppendIntakeJob()` for creating reactor inbox-processing jobs (legacy reactor path, disti
- docs/design-vision.md:9 (mention) — **Categories** form the triage stage for incoming items. Material arrives from multiple sources—document scans, voice in
- docs/ideas.md:362 (mention) — - **Relation to landmarks/triage-design.** `docs/triage-design.md` already sketches a typed-routing pipeline using `<tri
- docs/landmarks.md:33 (mention) — A landmark is a root `<landmark>` with one or more **role** child elements. The navigation role (`<navigation>`) carries
- docs/photo-storage-investigation.md:63 (mention) — This maps directly to the intake stage in the triage design (see `docs/triage-design.md`). Canonical optimization (AVIF 

References:
- → docs/photo-storage-investigation.md (mention)

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
- src/dev/CLAUDE.md:10 (mention) — | `generate-doc-images.ts` | Generates illustrations for `docs/architecture/` | `docs/architecture/CLAUDE.md` |

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

### src/connectors/

#### src/connectors/CLAUDE.md

Title: "Connectors" | 23 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:17 (mention) — - `src/connectors/CLAUDE.md` (25 lines)
- CLAUDE.md:95 (mention) — **Connectors** — Sync external services with the box filesystem. Each implements `Connector.sync()`. See `src/connectors
- docs/glossary.md:36 (mention) — **connector** — Code that syncs an external service (Gmail, RSS, Telegram, ...) with the box filesystem. Implements `Con

References:
- → src/services/CLAUDE.md (mention)

### src/core/reactor/

#### src/core/reactor/CLAUDE.md

Title: "Reactor" | 24 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:18 (mention) — - `src/core/reactor/CLAUDE.md` (23 lines)
- src/core/reactor/DESIGN.md:77 (mention) — - **System prompt** tells the agent what context it already has (job XML, referenced files, schema instructions, rules f

References:
- → src/core/reactor/DESIGN.md (link)

#### src/core/reactor/DESIGN.md

Title: "Reactor Design" | 122 lines

Referenced by:
- src/core/reactor/CLAUDE.md:3 (link) — See [DESIGN.md](DESIGN.md) for the full architecture, flow, and rationale.

References:
- → src/core/reactor/CLAUDE.md (mention)

### src/dev/

#### src/dev/CLAUDE.md

Title: "Dev Scripts" | 13 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:19 (mention) — - `src/dev/CLAUDE.md` (34 lines)

References:
- → docs/knowledge-audits.md (mention)
- → docs/maintenance.md (mention)
- → docs/doc-graph.md (mention)
- → docs/architecture/CLAUDE.md (mention)

### src/services/

#### src/services/CLAUDE.md

Title: "Services" | 126 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:20 (mention) — - `src/services/CLAUDE.md` (123 lines, after fix)
- CLAUDE.md:93 (mention) — **Services** — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have ob
- docs/connectors.md:67 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation.
- docs/glossary.md:40 (mention) — **service** — A typed interface wrapping an external dependency, with real and fake implementations. Fakes have observab
- docs/testing.md:123 (mention) — External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full s
- src/connectors/CLAUDE.md:15 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation: interfaces, fakes, call logging, and testing patt

### test/manual/

#### test/manual/README.md **[ORPHAN]**

Title: "Manual tests" | 21 lines

No references in or out.

