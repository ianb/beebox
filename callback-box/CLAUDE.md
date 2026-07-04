# Callback Box

A personal assistant and operating system built on Claude Code. You give it inputs (voice memos, emails, web clippings), agents process them, and the system takes actions or asks questions. The filesystem is state, Git is history, the `cb` CLI is the universal interface.

This is not an app — it's a system that Claude Code operates. The human teaches by setting up rules, answering questions, and correcting mistakes. All of that is captured in files and commits.

## Development

**Dev server** — one shared router serves every checkout at `http://localhost:3210/<main|worktree>/<box>/...` (lazy start, idle stop); don't restart it from a worktree session. Contract in the monorepo root CLAUDE.md; mechanism in `bin/CLAUDE.md`.

**Testing** — `pnpm test` runs tap. Pre-commit hook runs typecheck + lint automatically.
- `pnpm typecheck` — TypeScript (both backend and frontend)
- `pnpm lint` — ESLint
- Tests are doctests (`.doctest.md`) in `test/`. See `.claude/rules/doctest.md` for syntax.
- Three tiers: pure function doctests, route doctests (`makeTestServer()`), filesystem doctests (`makeTmpBox()`)
- Use `t.check(actual, expected)` for string comparisons. Objects serialize as `JSON.stringify(val, null, 2)`.
- Run tests before committing. If tests fail, fix them. If a test failure is clearly pre-existing and unrelated to your changes, note it but don't ignore your own failures.

**Deploy** — auto-deploys on `main` commits only (root CLAUDE.md). Prod runs a resident `cb hub` routing `/<slug>/...` to per-box `cb serve` children executing the bundled `dist/cli.mjs` — not tsx. Because the bundle lives at `dist/` (one level below the package root), resolve package-relative asset paths via `src/lib/package-root.ts` `PACKAGE_ROOT`, never a hardcoded `import.meta.dirname + "../.."`. Server layout, systemd units, rollback lever: `deploy/README.md`.

## Cards

Cards are the core data format. The format is **YAML frontmatter + markdown body** (Phase 2). Every schema is frontmatter; the legacy XML card format, its loader, and the `cardworks` package have been removed (this is about the file format — pseudo-XML elements like `<schedule>` remain a live pattern embedded within markdown bodies and chat text; see `docs/chat-schedules.md`). The card primitives (`cardSchema`, `body`, `splitCardContent`, lint formatting, …) now live in `src/cards/` and are exposed to box-local schemas via the public `callback-box/cards` specifier.

```
---
type: memo
status: new
created: 2026-05-22T10:00:00Z
---
Body content as plain markdown.
```

**Schemas** live in `src/schemas/`. Cards use `cardSchema(type, { fields, instructions? })` from `src/cards/` (box-local schemas import the same via `callback-box/cards`). `src/schemas/registry.ts` lists them in `cardSchemas[]`; boxes can add local schemas under `config/schemas/`. The type is taken from the filename (`Foo.<type>.card`) — there is no `type:` field in frontmatter.

**Loading:** `src/core/card-io.ts` `loadCardFile(absPath, ctx)` returns a `FrontmatterLoadedCard` (cards are frontmatter + markdown body — there is no other body encoding; the old XML loader and its `content-type` marker are gone). Most consumer code uses `parseCardText()` directly when it already has the file contents. Mutations are parse-mutate-reserialize via `yaml`'s `parse`/`stringify` — reserialization reorders frontmatter keys to match the schema's declared field order, not necessarily the original file order.

**Naming**: `Name.type.card` — the type determines which schema validates it (e.g. `Meeting_Notes.memo.card`). Attachments live in a sibling `Name.attach/` directory; refs starting with `attach/` resolve into this scope. No two cards in the same directory may share a basename (lint error).

**Schemas can include `instructions`** — prose embedded in the schema that's injected into agent context when processing cards of that type.

**Validation**: Cards validate on load; `cb validate` checks all cards, a file list, or `--staged`. `cb init` installs per-box hooks (agent-facing PostToolUse warning, commit-blocking pre-commit, background URL checks) — mechanics in `docs/card-validation.md`. Format reference: `docs/cards-as-markdown.md`; full design history (why markdown over XML, migration phases): `docs/implemented-plans/cards-as-markdown-rfc.md`.

## Source Layout

```
src/cli/          CLI commands (wakeup, validate, execute-commands, etc.)
src/core/         Wakeup cycle, agent invocation, state, procedure engine
src/connectors/   External integrations (rss, gmail, telegram, etc.)
src/webapp/       Fastify server, API routes, SSE
  routes/         HTTP route handlers
  trpc/           tRPC router and sub-routers
src/hub/          `cb hub`: routes /<slug>/... to per-box `cb serve` children (lazy start, idle-collect, health-check) — see src/hub/CLAUDE.md
src/frontend/     React UI (Vite, separate tsconfig)
  src/pages/          Routed top-level pages (ChatPage, DashboardPage, AdminPage, ...) — subject to restrict-component-classes; can only use outer-layout classes
                      Pages with their own supporting components live in a subdirectory that holds a `components/` child for them (e.g. `pages/landmarks/LandmarksPage.tsx` + `pages/landmarks/components/...`). Any directory named `components/` is exempt from the rule, so page-local appearance lives there.
  src/components/     Reusable feature components (Sidebar, CommitTimeline, FileView, dashboard/, ...) — shared across pages
  src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see frontend.md
  src/renderers/      File-type renderers (markdown, image, sheet, recipe, directory, ...)
  src/machines/       XState state machines
  src/hooks/          Shared React hooks
  src/lib/            Helpers (cn, source-tag, view-url, trpc, audio-context, ...)
  src/ssr/            Server-side rendering setup for `cb render`
src/schemas/      Card type definitions (Zod + `cardSchema` from src/cards/)
src/services/     Service interfaces, real + fake implementations
src/scenario/     Scenario loader/runner (multi-step end-to-end fixtures)
src/dev/          Dev tools (knowledge audits, doc image generation)
src/lib/          Generic cross-cutting helpers — check here before writing your own
                  (content-hash, mimetype, filename, file-exists, drop-undefined,
                  public-url, awake-timeout, exec-with-timeout, sleep, ...)
src/types/        Ambient type declarations
test/             Doctest files
deploy/           Server provisioning and deployment scripts
plugins/          Claude Code plugins (card-validator hook)
```

There's no `src/test-lib/`. Doctest infrastructure is the monorepo-level `agent-doctest/` package (the loader/runner) plus this project's `test/helpers/` (test-server, fake-agent, fixture-replay, etc.).

**Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md); `~/src/boxes/test1/` is the primary test box. Newer boxes (`shapeVersion: 2`, incl. `test1`) are packages — the operational box is the `content/` subdirectory, and box code imports only the public `callback-box/{cards,schema,view-widgets}` specifiers, never engine internals. Full on-disk shape: `docs/box-layout.md`.

## Key Concepts

**Wakeup cycle** — `cb wakeup` preprocesses inbox items → runs housekeeping + on-wakeup scripts → syncs connectors (creating job cards) → runs one reactor cycle over pending jobs → pushes to the box's git remote. The reactor (`src/core/reactor/DESIGN.md`) is the engine: find jobs → agent processing (batch or per-thread chat) → `cb finalize` flushes outbound. Recurring wakeups come from `cb tick` (`docs/scheduler.md`), not from wakeup itself.

**Services** — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have observable state for testing. See `src/services/CLAUDE.md`.

**Connectors** — Sync external services with the box filesystem. Each implements `Connector.sync()`. See `src/connectors/CLAUDE.md`.

**Procedures** — Multi-step workflows defined as YAML-frontmatter cards. Engine in `src/core/`. Config in box at `config/procedures/`, runs at `procedure/runs/`.

## Behavioral Notes

- **Read before writing.** Don't guess file formats, XML structures, or API shapes. Read the schema, read the existing code, read the test patterns. This project has specific conventions that differ from defaults.
- **Doctests are the primary test format.** They're markdown files with executable code blocks. Read `.claude/rules/doctest.md` before writing tests. Common mistakes: using JS object notation instead of JSON in expected output, forgetting `continue` blocks share scope.
- **Two TypeScript configs.** Backend uses the root tsconfig, frontend uses `src/frontend/tsconfig.json`. Both must pass for `pnpm typecheck`.
- **HTTP endpoints go in tRPC by default.** Add a procedure under `src/webapp/trpc/routers/`, validate input with Zod, call from the frontend via `trpc.<router>.<procedure>`. Real-time/streaming also lives in tRPC now — **subscriptions over the WebSocket** (`useWSS` on the per-box plugin; `events.subscribe` is the global event-bus stream, `events.turnStream` the resumable per-turn chat stream; client routes subscriptions through `wsLink` via the `splitLink` in `lib/trpc.ts`). Raw Fastify routes in `src/webapp/routes/` are only for things that don't fit the tRPC request/response shape: file upload/download, OAuth redirects, webhooks, and the `/chat/send` POST (it needs the request's user + the session registry). Older raw routes are tech debt — migrate when you touch the area.
- **Frontend uses UI primitives and a semantic palette.** Read frontend.md before writing UI — covers the primitive reference, color roles, and the `className`-only-for-outer-layout rule (enforced by `restrict-component-classes`).
- **Git trailers are structured metadata.** Commits use trailers like `Created-By: connector-name`. Commits go through plain `git commit`; the per-box `.git/hooks/pre-commit` (installed by `cb init`) runs `cb validate --staged` and blocks invalid card commits.
- **Time discipline.** Get timestamps via `getBoxTime`/`getBoxTimeISO` (`src/cli/lib/time.ts`), not plain `new Date()` — it honors `CB_TIME`/scenario-frozen time for tests. Long-running timeouts must count only awake time via `startAwakeTimeout` (`src/lib/awake-timeout.ts`) — a plain `setTimeout` fires instantly on wake because its underlying clock advances during macOS sleep.
- **All cross-process locks go through `src/lib/file-lock.ts`.** Don't roll your own with `proper-lockfile` or hand-built `.lock` files — the primitive handles PID liveness, sleep, and crash recovery. In-process async serialization (e.g. a `Map<id, Promise>` chain) is a different problem and stays separate.
- **Check client debug logs when debugging frontend issues.** The browser forwards console errors to the server (now via the `debugLog.submit` tRPC mutation). Read them from the rolling file `.callback-box/client-debug.log` in the box directory. See `docs/client-debug-log.md`.
- **Leave the repo clean when committing.** Fix any lint/type/test errors you encounter (even pre-existing ones) and make enough commits that nothing half-done is left lying around.
- **Keep source and docs generic — never hardcode personal names.** This is a generic tool; any box can be adopted by any user. Refer to "the user" or "the boxholder" in shared text (source, prompts, schemas, docs, rules). Names are only fine in per-box config, throwaway replies, and personal memory.

## Improving These Instructions

When you get corrected on a convention, pattern, or workflow that wasn't documented, update CLAUDE.md, code-style.md, frontend.md, `.claude/rules/`, or `docs/` so the next agent doesn't repeat the mistake. One-line additions preferred.

## Guides

| Topic | Location |
|-------|----------|
| Design rationale | `docs/design/README.md` |
| Card examples | `docs/cards-as-markdown.md` (format), `docs/adding-schemas.md` (worked example), `src/schemas/templates*.ts` (template registry) |
| Testing philosophy | `docs/testing.md` |
| Doctest syntax | `.claude/rules/doctest.md`; deeper reference in the monorepo's `agent-doctest/docs/` |
| Adding a card type | `docs/adding-schemas.md` |
| Card format reference | `docs/cards-as-markdown.md` |
| Card format design history (RFC) | `docs/implemented-plans/cards-as-markdown-rfc.md` |
| Box migration runbook | `docs/migrations.md` |
| Card validation hooks | `docs/card-validation.md` |
| Adding API endpoints | `docs/adding-api-endpoints.md` |
| Connectors | `docs/connectors.md` |
| Procedures | `docs/procedure-implementation.md` |
| Scheduler daemon (`cb tick`) | `docs/scheduler.md` |
| Deployed-server health-check runbooks | `docs/health-checks.md` |
| Agent-set chat timers (`<schedule>` tag) | `docs/chat-schedules.md` |
| Capturing full agent-invocation API traffic | `docs/prompt-logging.md` |
| Triage pipeline design | `docs/triage.md` |
| Deployment | `deploy/README.md` |
| Server operations | `docs/server-operations.md` |
| Adding a box | `docs/adding-a-box.md` |
| Box layout reference | `docs/box-layout.md` |
| Landmarks (navigation surface) | `docs/landmarks.md` |
| Client debug log | `docs/client-debug-log.md` |
| Content-Security-Policy | `docs/content-security-policy.md` |
| Periodic maintenance | `docs/maintenance.md` |
| Knowledge audits | `docs/knowledge-audits.md` |
| SSR page rendering (`cb render`) | `docs/ssr-render-testing.md` |
| Calendar integration | `docs/calendar.md` |
| PDF intake design | `docs/plans/pdf-intake-design.md` |
| Source editor plan | `docs/plans/source-editor.md` |
| Interface-as-cards design | `docs/plans/interface-as-cards.md` |
| Feature ideas | `docs/ideas.md` |
| OpenClaw/Hermes comparison & idea triage | `research/openclaw-hermes/README.md` |
| Glossary | `docs/glossary.md` |

@code-style.md
