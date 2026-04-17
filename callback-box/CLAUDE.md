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

Cards are the core data format. They are XML files validated by Zod schemas via cardworks.

**Naming**: `Name.type.card` — the type determines which schema validates it. Example: `Meeting_Notes.memo.card`, `Weekly_Digest.news-brief.card`. Attachments share the basename: `Voice_Memo.memo.card` + `Voice_Memo.m4a`.

**Structure**: Each card type has a root XML element matching its type name. Schemas are defined in `src/schemas/` using cardworks' `element()` helper with Zod validators. Example:

```xml
<memo status="new">
<created>2024-01-15T10:00:00Z</created>
<content>Some text</content>
<source>text</source>
</memo>
```

**Formatting**: Card XML is flat — no indentation at any nesting level. Text content within elements should use one long line per paragraph, not soft-wrapped at 80 columns. This keeps diffs clean and avoids re-wrapping on edits.

**Schemas can include `instructions`** — prose embedded in the schema definition that tells agents how to handle that card type. These instructions are injected into agent context when processing cards.

**Validation**: Cards are validated on load and before commit (via pre-commit hook/plugin). `cb validate` checks all cards. Never write XML by hand-guessing the format — read the schema first.

**Registry**: `src/schemas/registry.ts` registers all built-in schemas. Boxes can also define local schemas in `config/schemas/`.

## Source Layout

```
src/cli/          CLI commands (wakeup, validate, execute-commands, etc.)
src/core/         Wakeup cycle, agent invocation, state, procedure engine
src/connectors/   External integrations (rss, gmail, telegram, etc.)
src/webapp/       Fastify server, API routes, SSE
  routes/         HTTP route handlers
  trpc/           tRPC router and sub-routers
src/frontend/     React UI (Vite, separate tsconfig)
  src/components/     Page + feature components (ChatPage, CapturePage, AdminPage, ...)
  src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see CONVENTIONS.md
  src/renderers/      File-type renderers (markdown, image, sheet, recipe, directory, ...)
  src/machines/       XState state machines
  src/hooks/          Shared React hooks
  src/lib/            Helpers (cn, source-tag, view-url, trpc, audio-context, ...)
  src/ssr/            Server-side rendering setup for `cb render`
src/schemas/      Card type definitions (Zod + cardworks)
src/services/     Service interfaces, real + fake implementations
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
- **The frontend has two TypeScript configs.** Backend uses the root tsconfig, frontend uses `src/frontend/tsconfig.json`. Both must pass for `npm run typecheck` to succeed.
- **For frontend work, reach for UI primitives.** Use components from `src/frontend/src/components/ui/` (Button, Text, Stack, Image, etc.) before writing raw HTML + appearance classes. Page-level code (outside any `components/` subdirectory) can only use outer-layout classes via `className` — this is enforced by the `personal-vibe-check/restrict-component-classes` ESLint rule. See CONVENTIONS.md for the full palette, primitive reference, and className convention.
- **Don't invent card XML formats.** Every card type has a schema. Read it in `src/schemas/` before creating or modifying cards. The schema's `element()` call defines exactly what attributes and children are valid.
- **Service fakes are domain-specific**, not generic mocks. They have real in-memory state. Read existing fakes before writing new ones.
- **Git trailers are structured metadata.** Commits use trailers like `Created-By: connector-name`. Use `cb commit` which handles validation.
- **Check client debug logs when debugging frontend issues.** The browser forwards console errors to the server. Read them with `curl https://box.example.com/<box>/api/debug-log` or check the log file at `.callback-box/client-debug.log` in the box directory. See `docs/client-debug-log.md`.
- **Fix errors as you find them.** If you encounter lint, type, or test errors — even pre-existing ones from previous work — fix them. Don't leave broken windows.
- **Leave the repo clean when committing.** If there's uncommitted work, make enough commits to leave everything in a clean state. Don't leave half-done changes lying around.

## Improving These Instructions

When you get corrected on something — a convention you missed, a pattern you got wrong, a tool you misused — consider whether the correction reveals a gap in these instructions. If the mistake was caused by missing or unclear guidance here, update this file (or the relevant doc) so the next agent doesn't repeat it. This applies to CLAUDE.md, CONVENTIONS.md, `.claude/rules/` files, and docs/.

Examples of things worth capturing:
- A convention you violated because it wasn't documented
- A pattern you had to discover by reading code that should have been stated upfront
- A common mistake you made that a one-line note here would prevent
- A workflow step (test, lint, build) that has a non-obvious gotcha

Keep additions concise. One line preventing a mistake is better than a paragraph explaining it.

## Guides

| Topic | Location |
|-------|----------|
| Design rationale | `docs/DESIGN.md` |
| Implementation guide | `docs/IMPLEMENTATION.md` |
| Card examples | `docs/EXAMPLE_FILES.md` |
| Testing philosophy | `docs/testing.md` |
| Doctest syntax | `.claude/rules/doctest.md`, `src/test-lib/docs/` |
| Adding a card type | `docs/adding-schemas.md` |
| Adding API endpoints | `docs/adding-api-endpoints.md` |
| Connectors | `docs/connectors.md` |
| Procedures | `docs/procedure-implementation.md` |
| Deployment | `deploy/README.md` |
| Adding a box | `docs/adding-a-box.md` |
| Client debug log | `docs/client-debug-log.md` |
| Feature ideas | `docs/ideas.md` |

@CONVENTIONS.md
