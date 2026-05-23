# Callback Box

A personal assistant infrastructure built on Claude Code. You give it inputs (voice memos, emails, web clippings), agents process them, and the system takes actions or asks questions. The filesystem is state, Git is history, the `cb` CLI is the universal interface.

This is not an app — it's a system that Claude Code operates. The human teaches by setting up rules, answering questions, and correcting mistakes. All of that is captured in files and commits.

## Development

**Dev server** — `overmind start` (uses `Procfile.dev`). Vite on port 3210 (main), Fastify on 3211. Access UI at `http://localhost:3210/test1/`.

**Testing** — `npm test` runs tap. Pre-commit hook runs typecheck + lint automatically.
- `npm run typecheck` — TypeScript (both backend and frontend)
- `npm run lint` — ESLint
- Tests are doctests (`.doctest.md`) in `test/`. See `.claude/rules/doctest.md` for syntax.
- Three tiers: pure function doctests, route doctests (`makeTestServer()`), filesystem doctests (`makeTmpBox()`)
- Use `t.check(actual, expected)` for string comparisons. Objects serialize as `JSON.stringify(val, null, 2)`.
- Run tests before committing. If tests fail, fix them. If a test failure is clearly pre-existing and unrelated to your changes, note it but don't ignore your own failures.

**Deploy** — Post-commit hook auto-deploys via `deploy/deploy.sh` (rsync to server). Server runs as `callback` user at `/opt/callback/`. The server runs `tsx` directly (not compiled `dist/`).

## Cards

Cards are the core data format. The current format is **YAML frontmatter + markdown body** (Phase 2, May 2026); a handful of schemas with inline-attributed structure (guide, recipe, procedure, procedure-run, capture-session, landmark) remain on the older **XML body** until cardworks grows Markdoc-style body tags. Both formats coexist behind the loader.

```
---
type: memo
status: new
created: 2026-05-22T10:00:00Z
---
Body content as plain markdown.
```

**Schemas** live in `src/schemas/`. Phase-2 cards use `cardSchema(type, { fields, instructions? })` from cardworks. Legacy XML cards use `element(tagName, ...)`. `src/schemas/registry.ts` lists both sets (`cardSchemas[]` for frontmatter, `schemas[]` for XML); boxes can add local schemas under `config/schemas/`. The `type:` field in frontmatter (or root element tag for XML) selects the schema.

**Loading:** `src/core/card-io.ts` `loadCardFile(absPath, ctx)` returns a discriminated `FrontmatterLoadedCard | XmlLoadedCard`. Most consumer code uses `parseCardText()` directly when it already has the file contents. Mutations to frontmatter cards are parse-mutate-reserialize via `yaml`'s `parse`/`stringify`.

**Naming**: `Name.type.card` — the type determines which schema validates it (e.g. `Meeting_Notes.memo.card`). Attachments live in a sibling `Name.attach/` directory; refs starting with `attach/` resolve into this scope. No two cards in the same directory may share a basename (lint error).

**Schemas can include `instructions`** — prose embedded in the schema that's injected into agent context when processing cards of that type.

**Validation**: Cards validate on load. `cb validate` checks all cards (or a list of files, or `--staged`). Boxes get two hooks installed during `cb init`:

- `.claude/settings.json` — PostToolUse hook that runs `cb validate --hook` after Edit/Write/MultiEdit. On a card path with errors it exits 2 with the error on stderr so Claude Code surfaces it to the agent (warning, not blocking).
- `.git/hooks/pre-commit` — runs `cb validate --staged`, blocks commits that include cards failing validation.

See `src/core/install-validation-hooks.ts`. The hook commands embed the absolute path to the installing `bin/cb` so they don't depend on the user's PATH. See `docs/cards-as-markdown.md` for the format design and migration history; `scripts/migrate-*.ts` + `scripts/_migrate-warnings.ts` are the per-schema migrators with noisy-mode field-loss detection.

## Source Layout

```
src/cli/          CLI commands (wakeup, validate, execute-commands, etc.)
src/core/         Wakeup cycle, agent invocation, state, procedure engine
src/connectors/   External integrations (rss, gmail, telegram, etc.)
src/webapp/       Fastify server, API routes, SSE
  routes/         HTTP route handlers
  trpc/           tRPC router and sub-routers
src/frontend/     React UI (Vite, separate tsconfig)
  src/pages/          Routed top-level pages (ChatPage, DashboardPage, AdminPage, ...) — subject to restrict-component-classes; can only use outer-layout classes
                      Pages with their own supporting components live in a subdirectory that holds a `components/` child for them (e.g. `pages/news/NewsPage.tsx` + `pages/news/PrintBriefView.tsx` + `pages/news/components/brief/...`). Any directory named `components/` is exempt from the rule, so page-local appearance lives there.
  src/components/     Reusable feature components (Sidebar, CommitTimeline, FileView, dashboard/, ...) — shared across pages
  src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see FRONTEND.md
  src/renderers/      File-type renderers (markdown, image, sheet, recipe, directory, ...)
  src/machines/       XState state machines
  src/hooks/          Shared React hooks
  src/lib/            Helpers (cn, source-tag, view-url, trpc, audio-context, ...)
  src/ssr/            Server-side rendering setup for `cb render`
src/schemas/      Card type definitions (Zod + cardworks: cardSchema for frontmatter, element for legacy XML)
src/services/     Service interfaces, real + fake implementations
src/scenario/     Scenario loader/runner (multi-step end-to-end fixtures)
src/dev/          Dev tools (knowledge audits, doc image generation)
src/lib/          Cross-cutting helpers
src/types/        Ambient type declarations
src/test-lib/     Test utilities, doctest infrastructure
test/             Doctest files
deploy/           Server provisioning and deployment scripts
plugins/          Claude Code plugins (card-validator hook)
```

**Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md). `~/src/boxes/test1/` is the primary test box. Box layout: `box/inbox/`, `box/jobs/`, `box/commands/`, `box/questions/`, `store/archive/`, `config/`.

**cardworks** (`~/src/cardworks`) — XML card library. Parsing, serialization, validation, JSX. Edit as needed — it's part of this ecosystem.

## Key Concepts

**Wakeup cycle** — `cb wakeup` syncs connectors → processes inbox → executes commands → archives → schedules next wakeup.

**Services** — Every external dependency is wrapped in a typed interface with real + fake implementations. Fakes have observable state for testing. See `src/services/CLAUDE.md`.

**Connectors** — Sync external services with the box filesystem. Each implements `Connector.sync()`. See `src/connectors/CLAUDE.md`.

**Procedures** — Multi-step workflows defined in XML. Engine in `src/core/`. Config in box at `config/procedures/`, runs at `procedure/runs/`.

## Behavioral Notes

- **Read before writing.** Don't guess file formats, XML structures, or API shapes. Read the schema, read the existing code, read the test patterns. This project has specific conventions that differ from defaults.
- **Doctests are the primary test format.** They're markdown files with executable code blocks. Read `.claude/rules/doctest.md` before writing tests. Common mistakes: using JS object notation instead of JSON in expected output, forgetting `continue` blocks share scope.
- **Two TypeScript configs.** Backend uses the root tsconfig, frontend uses `src/frontend/tsconfig.json`. Both must pass for `npm run typecheck`.
- **HTTP endpoints go in tRPC by default.** Add a procedure under `src/webapp/trpc/routers/`, validate input with Zod, call from the frontend via `trpc.<router>.<procedure>`. Raw Fastify routes in `src/webapp/routes/` are only for things that don't fit the tRPC request/response shape: SSE/streaming, file upload/download, OAuth redirects, webhooks. Older raw routes are tech debt — migrate when you touch the area.
- **Frontend uses UI primitives and a semantic palette.** Read FRONTEND.md before writing UI — covers the primitive reference, color roles, and the `className`-only-for-outer-layout rule (enforced by `restrict-component-classes`).
- **Git trailers are structured metadata.** Commits use trailers like `Created-By: connector-name`. Commits go through plain `git commit`; the per-box `.git/hooks/pre-commit` (installed by `cb init`) runs `cb validate --staged` and blocks invalid card commits.
- **All cross-process locks go through `src/lib/file-lock.ts`.** Don't roll your own with `proper-lockfile` or hand-built `.lock` files — the primitive handles PID liveness, sleep, and crash recovery. In-process async serialization (e.g. a `Map<id, Promise>` chain) is a different problem and stays separate.
- **Check client debug logs when debugging frontend issues.** The browser forwards console errors to the server. Read them with `curl https://box.example.com/<box>/api/debug-log` or check `.callback-box/client-debug.log` in the box directory. See `docs/client-debug-log.md`.
- **Leave the repo clean when committing.** Fix any lint/type/test errors you encounter (even pre-existing ones) and make enough commits that nothing half-done is left lying around.
- **Keep source and docs generic — never hardcode personal names.** This is a generic tool; any box can be adopted by any user. Refer to "the user" or "the boxholder" in shared text (source, prompts, schemas, docs, rules). Names are only fine in per-box config, throwaway replies, and personal memory.

## Improving These Instructions

When you get corrected on a convention, pattern, or workflow that wasn't documented, update CLAUDE.md, CODE-STYLE.md, FRONTEND.md, `.claude/rules/`, or `docs/` so the next agent doesn't repeat the mistake. One-line additions preferred.

## Guides

| Topic | Location |
|-------|----------|
| Design rationale | `docs/DESIGN.md` |
| Implementation guide | `docs/IMPLEMENTATION.md` |
| Card examples | `docs/EXAMPLE_FILES.md` |
| Testing philosophy | `docs/testing.md` |
| Doctest syntax | `.claude/rules/doctest.md`, `src/test-lib/docs/` |
| Adding a card type | `docs/adding-schemas.md` |
| Card format & migration history | `docs/cards-as-markdown.md` |
| Box migration runbook | `docs/migrations.md` |
| Adding API endpoints | `docs/adding-api-endpoints.md` |
| Connectors | `docs/connectors.md` |
| Procedures | `docs/procedure-implementation.md` |
| Deployment | `deploy/README.md` |
| Server operations | `docs/server-operations.md` |
| Adding a box | `docs/adding-a-box.md` |
| Box layout reference | `docs/box-layout.md` |
| Landmarks (navigation surface) | `docs/landmarks.md` |
| Client debug log | `docs/client-debug-log.md` |
| Periodic maintenance | `docs/maintenance.md` |
| Knowledge audits | `docs/knowledge-audits.md` |
| SSR page rendering (`cb render`) | `docs/ssr-render-testing.md` |
| Calendar integration | `docs/calendar.md` |
| PDF intake design | `docs/pdf-intake-design.md` |
| Source editor plan | `docs/source-editor.md` |
| Feature ideas | `docs/ideas.md` |
| Glossary | `docs/glossary.md` |

@CODE-STYLE.md
