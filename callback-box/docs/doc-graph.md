# Documentation Graph Report

Generated: 2026-05-01T19:53:00Z
Total documents: 62

## Issues

### Orphaned Documents (no incoming references)

These documents are not referenced by any other document.

- **docs/activities-design.md** — "Activities — Design Proposal" (298 lines)
- **docs/architecture/01-what-is-this.md** — "What Is This Thing?" (66 lines)
- **docs/architecture/02-cards-and-memory.md** — "Cards and Memory" (99 lines)
- **docs/capture-pipeline-redesign.md** — "Capture Pipeline Redesign" (128 lines)
- **docs/chat-schedules.md** — "Chat Schedules" (94 lines)
- **docs/design-card-views.md** — "Card View Plugin System" (948 lines)
- **docs/event-bus-design.md** — "Event Bus Design" (142 lines)
- **docs/gmail-setup.md** — "Gmail Connector Setup" (85 lines)
- **docs/google-drive.md** — "Google Drive Integration" (140 lines)
- **docs/prompt-logging.md** — "Prompt Logging for Agent Invocations" (212 lines)
- **docs/scheduler.md** — "Scheduler" (93 lines)
- **docs/stack-decisions.md** — "Stack Decisions" (1107 lines)
- **docs/telegram-setup.md** — "Telegram Connector Setup" (136 lines)
- **docs/todo-security.md** — "Security TODOs" (25 lines)
- **src/activities/polyglot/setup-prompt.md** — "(no title)" (24 lines)

### Broken References

These references point to files that don't exist.

- **CLAUDE-MD-REVIEW.md:281** → `CONVENTIONS.md` (at-include)
  Context: 2. ~~**`@CONVENTIONS.md` import syntax** and the mixed-scope problem.~~
- **docs/agent-knowledge.md:328** → `view:store/path/to/file.md` (link)
  Context: - **Expected level: Knows directly** — the chat system prompt describes the `[Display Name](view:store/path/to/file.md)`
- **docs/prompts.md:223** → `view:store/notes/meeting.md` (link)
  Context: - `[Meeting Notes](view:store/notes/meeting.md)` — renders markdown inline

## Document Inventory

### ./

#### CLAUDE-MD-REVIEW.md

Title: "CLAUDE.md Review — 2026-04-28" | 441 lines

Referenced by:
- docs/cli-restructure.md:148 (mention) — Once the migration is complete and the review (`CLAUDE-MD-REVIEW.md`) is also gone, delete this file. The state of the C

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
- → docs/TESTING-NEWS-PROCEDURE.md (mention)
- → docs/cli-restructure.md (mention)
- → docs/prompts.md (mention)
- → docs/box-layout.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/connectors.md (mention)
- → CONVENTIONS.md (at-include) **[BROKEN]**
- → docs/testing.md (mention)
- → docs/maintenance.md (mention)
- → docs/knowledge-audits.md (mention)
- → CODE-STYLE.md (at-include)

#### CLAUDE.md

Title: "Callback Box" | 121 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:1 (mention) — # CLAUDE.md Review — 2026-04-28
- CLAUDE.md:65 (mention) — **Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md). `~/src/boxes/test1/` is the
- docs/EXAMPLE_FILES.md:50 (mention) — ├── CLAUDE.md
- docs/IMPLEMENTATION.md:668 (mention) — CLAUDE.md              # Base instructions for all agents
- docs/activities-design.md:46 (mention) — Live at `<box>/activities/<name>/src/`. The `src/` subdirectory is deliberate — the activity directory isn't just code, 
- docs/adding-schemas.md:174 (mention) — 5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
- docs/agent-knowledge.md:7 (mention) — 1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CL
- docs/box-layout.md:9 (mention) — A box is a directory marked by a `.cb-box` file. It's a git repository (`cb init` initialises one), and the working tree
- docs/ideas.md:9 (mention) — - Custom subagents don't inherit CLAUDE.md or `.claude/rules/` (only built-in subagents do)
- docs/knowledge-audits.md:14 (mention) — - After touching CLAUDE.md, schemas, prompts, or anything that changes what an agent should know.
- docs/maintenance.md:7 (mention) — The system carries a lot of agent-facing surface: CLAUDE.md and rule files, schemas with embedded `instructions`, prompt
- docs/prompt-logging.md:3 (mention) — When agents run in a callback box (via `cb wakeup`, `cb process-news`, procedures, etc.), you can capture the full API t
- docs/testing-gaps.md:93 (mention) — - **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DE

References:
- → FRONTEND.md (mention)
- → CLAUDE.md (mention)
- → src/services/CLAUDE.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/client-debug-log.md (mention)
- → CODE-STYLE.md (mention)
- → docs/DESIGN.md (mention)
- → docs/IMPLEMENTATION.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/testing.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/connectors.md (mention)
- → docs/procedure-implementation.md (mention)
- → deploy/README.md (mention)
- → docs/server-operations.md (mention)
- → docs/adding-a-box.md (mention)
- → docs/box-layout.md (mention)
- → docs/maintenance.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/ssr-render-testing.md (mention)
- → docs/calendar-plan.md (mention)
- → docs/source-editor.md (mention)
- → docs/ideas.md (mention)
- → CODE-STYLE.md (at-include)

#### CODE-STYLE.md

Title: "Code Style" | 60 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:39 (mention) — 5. **Split CONVENTIONS.md** into `CODE-STYLE.md` (general — typecheck/lint,
- CLAUDE-MD-REVIEW.md:438 (at-include) — 14. Verify `@CODE-STYLE.md` import syntax does what's intended.
- CLAUDE.md:93 (mention) — When you get corrected on a convention, pattern, or workflow that wasn't documented, update CLAUDE.md, CODE-STYLE.md, FR
- CLAUDE.md:120 (at-include) — @CODE-STYLE.md
- FRONTEND.md:3 (mention) — UI palette, primitives, and the `className` rule. Backend code never needs to load this; CODE-STYLE.md covers convention

References:
- → FRONTEND.md (mention)

#### FRONTEND.md

Title: "Frontend Conventions" | 108 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:40 (mention) — error handling, code style; ~58 lines) and `FRONTEND.md` (data-source
- CLAUDE.md:47 (mention) — src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see FRONTEND.md
- CODE-STYLE.md:3 (mention) — General coding conventions for backend and frontend. UI palette and primitive reference live in FRONTEND.md.
- FRONTEND.md:107 (mention) — New primitives live in `components/ui/<Name>.tsx`, accept `className`, merge via `cn()`, and document their semantic rol

References:
- → CODE-STYLE.md (mention)
- → docs/data-source-tagging.md (mention)
- → FRONTEND.md (mention)

#### README.md

Title: "callback-box" | 2 lines

Referenced by:
- docs/design-card-views.md:47 (mention) — README.md               → [Source]

#### THINKING_CLAUDE.md

Title: "Thinking Machine Mode" | 93 lines

Referenced by:
- docs/prompt-logging.md:81 (mention) — Contents of /Users/.../THINKING_CLAUDE.md (project instructions, checked into the codebase):

### deploy/

#### deploy/CLAUDE.md

Title: "Deploy" | 10 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:15 (mention) — - `deploy/CLAUDE.md` (8 lines)

References:
- → deploy/README.md (mention)

#### deploy/README.md

Title: "Deploy" | 191 lines

Referenced by:
- CLAUDE.md:108 (mention) — | Deployment | `deploy/README.md` |
- deploy/CLAUDE.md:3 (mention) — Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.
- docs/server-operations.md:3 (link) — Reference for the running callback-box server (production at `box.example.com`). For initial provisioning scripts see 

### docs/

#### docs/activities-design.md **[ORPHAN]**

Title: "Activities — Design Proposal" | 298 lines

References:
- → CLAUDE.md (mention)
- → src/activities/polyglot/instance-claude-template.md (mention)

#### docs/adding-a-box.md

Title: "Adding a New Box" | 149 lines

Referenced by:
- CLAUDE.md:110 (mention) — | Adding a box | `docs/adding-a-box.md` |
- docs/ideas.md:25 (mention) — For now: manually copy secret files to new boxes. See `docs/adding-a-box.md` step 7.
- docs/server-operations.md:104 (link) — - [`adding-a-box.md`](./adding-a-box.md) — per-box setup (secrets, connectors, box directory layout).

#### docs/adding-api-endpoints.md

Title: "Adding API Endpoints" | 247 lines

Referenced by:
- CLAUDE.md:105 (mention) — | Adding API endpoints | `docs/adding-api-endpoints.md` |

#### docs/adding-schemas.md

Title: "Adding a New Card Schema" | 187 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:240 (mention) — - `src/schemas/` — `docs/adding-schemas.md` exists; might just need a one-line
- CLAUDE.md:104 (mention) — | Adding a card type | `docs/adding-schemas.md` |

References:
- → CLAUDE.md (mention)

#### docs/agent-knowledge.md

Title: "Agent Knowledge Audit: What It Should Know and How to Verify" | 492 lines

Referenced by:
- docs/testing.md:379 (link) — See [agent-knowledge.md](agent-knowledge.md) for the full knowledge taxonomy and test prompt guide.

References:
- → CLAUDE.md (mention)
- → docs/connectors.md (mention)
- → view:store/path/to/file.md (link) **[BROKEN]**

#### docs/box-layout.md

Title: "Box Layout" | 145 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:214 (mention) — `docs/box-layout.md`. Covers marker files, `box/`, `store/`, `config/`,
- CLAUDE.md:111 (mention) — | Box layout reference | `docs/box-layout.md` |

References:
- → CLAUDE.md (mention)
- → docs/client-debug-log.md (mention)

#### docs/calendar-plan.md

Title: "Calendar Integration Plan" | 74 lines

Referenced by:
- CLAUDE.md:116 (mention) — | Calendar integration plan | `docs/calendar-plan.md` |

#### docs/capture-pipeline-redesign.md **[ORPHAN]**

Title: "Capture Pipeline Redesign" | 128 lines

No references in or out.

#### docs/chat-schedules.md **[ORPHAN]**

Title: "Chat Schedules" | 94 lines

No references in or out.

#### docs/cli-restructure.md

Title: "`cb` CLI Restructure — Plan" | 149 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:186 (mention) — `docs/cli-restructure.md`. Summary:

References:
- → docs/prompts.md (mention)
- → CLAUDE-MD-REVIEW.md (mention)

#### docs/client-debug-log.md

Title: "Client Debug Log" | 68 lines

Referenced by:
- CLAUDE.md:87 (mention) — - **Check client debug logs when debugging frontend issues.** The browser forwards console errors to the server. Read th
- docs/box-layout.md:107 (mention) — | `client-debug.log` | Browser console errors forwarded from the frontend. See `docs/client-debug-log.md`. |
- docs/server-operations.md:98 (link) — For SSH-only debugging: `ssh root@<server> tail /home/callback/boxes/<box>/.callback-box/client-debug.log`. See [`client

#### docs/connectors.md

Title: "Connectors" | 87 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:254 (mention) — - Add a connector (`docs/connectors.md` exists — is it a how-to or a
- CLAUDE.md:106 (mention) — | Connectors | `docs/connectors.md` |
- docs/agent-knowledge.md:205 (mention) — - **Expected level: Discoverable** — the agent would need to look at `config/connectors/` and/or `docs/generated/connect

References:
- → src/services/CLAUDE.md (mention)

#### docs/data-source-tagging.md

Title: "Data Source Tagging Convention" | 89 lines

Referenced by:
- FRONTEND.md:7 (mention) — UI elements that display data from a known source (card, commit, session, etc.) must be tagged with `data-cb-source` att

#### docs/design-card-views.md **[ORPHAN]**

Title: "Card View Plugin System" | 948 lines

References:
- → README.md (mention)

#### docs/DESIGN.md

Title: "Callback Box: comprehensive design notes" | 528 lines

Referenced by:
- CLAUDE.md:99 (mention) — | Design rationale | `docs/DESIGN.md` |
- docs/IMPLEMENTATION.md:5 (mention) — This document describes how to build Callback Box, complementing DESIGN.md with concrete implementation details.
- docs/testing-gaps.md:93 (mention) — - **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DE

#### docs/doc-graph.md

Title: "(no title)" | 1 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:46 (mention) — 6. **Regenerated `docs/doc-graph.md`** to reflect the split (doc went from
- docs/ideas.md:118 (mention) — Implemented as `docs/doc-graph.md` (auto-generated cross-reference report). See CLAUDE.md Doc Map.
- docs/maintenance.md:17 (mention) — | Doc graph | `npm run doc-graph` | After restructuring docs | `docs/doc-graph.md` |
- docs/testing.md:521 (mention) — `npx tsx src/dev/doc-graph.ts > docs/doc-graph.md` — scans all `.md` files, extracts cross-references, reports orphans a
- src/dev/CLAUDE.md:9 (mention) — | `doc-graph.ts` | Generates `docs/doc-graph.md` (cross-reference graph + orphan/broken-ref report) | `docs/maintenance.

#### docs/event-bus-design.md **[ORPHAN]**

Title: "Event Bus Design" | 142 lines

No references in or out.

#### docs/EXAMPLE_FILES.md

Title: "Callback Box: Example Files" | 815 lines

Referenced by:
- CLAUDE.md:101 (mention) — | Card examples | `docs/EXAMPLE_FILES.md` |
- docs/IMPLEMENTATION.md:225 (mention) — See EXAMPLE_FILES.md for RRULE examples and other card/schema samples.
- docs/IMPLEMENTATION.md:274 (link) — Config includes credential references, polling intervals, filters, etc. Agents can read these to understand what's avail

References:
- → CLAUDE.md (mention)

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
- docs/server-operations.md:83 (link) — **Periodic health check:** see [`health-checks.md`](./health-checks.md#claude-update-nightly-claude-code-self-update) — 

References:
- → docs/server-operations.md (link)

#### docs/ideas.md

Title: "Ideas & Planned Features" | 226 lines

Referenced by:
- CLAUDE.md:118 (mention) — | Feature ideas | `docs/ideas.md` |

References:
- → CLAUDE.md (mention)
- → docs/adding-a-box.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → docs/doc-graph.md (mention)
- → docs/prompts.md (mention)
- → docs/testing.md (mention)

#### docs/IMPLEMENTATION.md

Title: "Callback Box: Implementation Guide" | 1027 lines

Referenced by:
- CLAUDE.md:100 (mention) — | Implementation guide | `docs/IMPLEMENTATION.md` |

References:
- → docs/DESIGN.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/EXAMPLE_FILES.md (link)
- → CLAUDE.md (mention)

#### docs/knowledge-audits.md

Title: "Knowledge Audits" | 61 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:432 (mention) — script to its full doc). Created `docs/knowledge-audits.md` for the
- CLAUDE.md:114 (mention) — | Knowledge audits | `docs/knowledge-audits.md` |
- docs/maintenance.md:29 (mention) — **Full guide:** `docs/knowledge-audits.md` (test structure, recording results, interpreting failures).
- src/dev/CLAUDE.md:7 (mention) — | `knowledge-audit.ts` | Runs YAML-defined tests against a real box agent | `docs/knowledge-audits.md` |

References:
- → CLAUDE.md (mention)
- → docs/maintenance.md (mention)

#### docs/maintenance.md

Title: "Code Maintenance" | 80 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:428 (mention) — `docs/maintenance.md` (periodic tasks doc); kept `generate-doc-images.ts`
- CLAUDE.md:113 (mention) — | Periodic maintenance | `docs/maintenance.md` |
- docs/knowledge-audits.md:17 (mention) — `docs/maintenance.md` lists this alongside the other periodic tasks.
- src/dev/CLAUDE.md:8 (mention) — | `prompt-report.ts` | Generates `docs/prompts.md` (system-wide prompt inventory) | `docs/maintenance.md` |

References:
- → CLAUDE.md (mention)
- → docs/prompts.md (mention)
- → docs/doc-graph.md (mention)
- → docs/knowledge-audits.md (mention)
- → docs/architecture/CLAUDE.md (mention)

#### docs/procedure-implementation.md

Title: "Procedures" | 133 lines

Referenced by:
- CLAUDE.md:107 (mention) — | Procedures | `docs/procedure-implementation.md` |

#### docs/prompt-logging.md **[ORPHAN]**

Title: "Prompt Logging for Agent Invocations" | 212 lines

References:
- → CLAUDE.md (mention)
- → THINKING_CLAUDE.md (mention)

#### docs/prompts.md

Title: "Prompt Report" | 4154 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:198 (mention) — `prompt-report.ts` prose since `docs/prompts.md` references it);
- docs/cli-restructure.md:111 (mention) — | `cb init-rules` (standalone) | `generateRules()` function called by `cb init`; standalone CLI has no callers. **Howeve
- docs/ideas.md:180 (mention) — `npm run prompt-report` generates `docs/prompts.md` — a full inventory of every prompt, instruction, and rule in the sys
- docs/maintenance.md:16 (mention) — | Prompt report | `npm run prompt-report` | After prompt or schema-instruction changes | `docs/prompts.md` |
- src/dev/CLAUDE.md:8 (mention) — | `prompt-report.ts` | Generates `docs/prompts.md` (system-wide prompt inventory) | `docs/maintenance.md` |

References:
- → view:store/notes/meeting.md (link) **[BROKEN]**

#### docs/scheduler.md **[ORPHAN]**

Title: "Scheduler" | 93 lines

No references in or out.

#### docs/server-operations.md

Title: "Server Operations" | 105 lines

Referenced by:
- CLAUDE.md:109 (mention) — | Server operations | `docs/server-operations.md` |
- docs/health-checks.md:9 (link) — The server runs `claude update` nightly via `claude-update.timer` → `claude-update.service` → `deploy/claude-update.sh` 

References:
- → deploy/README.md (link)
- → docs/health-checks.md (link)
- → docs/client-debug-log.md (link)
- → docs/adding-a-box.md (link)

#### docs/source-editor.md

Title: "Source Editor Plan" | 138 lines

Referenced by:
- CLAUDE.md:117 (mention) — | Source editor plan | `docs/source-editor.md` |

#### docs/ssr-render-testing.md

Title: "SSR Render Testing (`cb render`)" | 179 lines

Referenced by:
- CLAUDE.md:115 (mention) — | SSR page rendering (`cb render`) | `docs/ssr-render-testing.md` |

#### docs/stack-decisions.md **[ORPHAN]**

Title: "Stack Decisions" | 1107 lines

References:
- → docs/state-management-comparison.md (mention)
- → docs/testing-gaps.md (mention)

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
- docs/testing.md:535 (link) — See [testing-gaps.md](testing-gaps.md) for detailed plans. Key ideas:

References:
- → docs/DESIGN.md (mention)
- → CLAUDE.md (mention)

#### docs/TESTING-NEWS-PROCEDURE.md

Title: "Testing the News Procedure" | 264 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:61 (mention) — `docs/TESTING-NEWS-PROCEDURE.md` — genuinely unreferenced anywhere.

#### docs/testing.md

Title: "Testing" | 541 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:371 (mention) — `docs/testing.md`). What's missing is the *practice*:
- CLAUDE.md:102 (mention) — | Testing philosophy | `docs/testing.md` |
- docs/ideas.md:184 (mention) — Implemented as `cb session <id> --tool-report` + `@session-critique` subagent. See `docs/testing.md` § Session Critiques

References:
- → src/services/CLAUDE.md (mention)
- → docs/agent-knowledge.md (link)
- → docs/doc-graph.md (mention)
- → docs/testing-gaps.md (link)

#### docs/todo-security.md **[ORPHAN]**

Title: "Security TODOs" | 25 lines

No references in or out.

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
- docs/maintenance.md:71 (mention) — **When to run:** after editing `docs/architecture/*.md` text that drives image prompts, or after editing `.mmd` Mermaid 
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

### src/activities/polyglot/

#### src/activities/polyglot/instance-claude-template.md

Title: "{displayName}" | 22 lines

Referenced by:
- docs/activities-design.md:256 (mention) — instance-claude-template.md  # CLAUDE.md content for each new instance

#### src/activities/polyglot/setup-prompt.md **[ORPHAN]**

Title: "(no title)" | 24 lines

No references in or out.

### src/connectors/

#### src/connectors/CLAUDE.md

Title: "Connectors" | 45 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:17 (mention) — - `src/connectors/CLAUDE.md` (25 lines)
- CLAUDE.md:75 (mention) — **Connectors** — Sync external services with the box filesystem. Each implements `Connector.sync()`. See `src/connectors
- docs/ideas.md:61 (mention) — `src/connectors/google-calendar.ts` uses `getGoogleAuth()` + direct REST calls and `ical.js` inline, with no service abs

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
- → docs/prompts.md (mention)
- → docs/maintenance.md (mention)
- → docs/doc-graph.md (mention)
- → docs/architecture/CLAUDE.md (mention)

### src/services/

#### src/services/CLAUDE.md

Title: "Services" | 126 lines

Referenced by:
- CLAUDE-MD-REVIEW.md:20 (mention) — - `src/services/CLAUDE.md` (123 lines, after fix)
- CLAUDE.md:73 (mention) — **Services** — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have ob
- docs/connectors.md:68 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation.
- docs/testing.md:124 (mention) — External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full s
- src/connectors/CLAUDE.md:15 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation: interfaces, fakes, call logging, and testing patt

