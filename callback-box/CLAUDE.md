# Callback Box

A personal assistant and operating system built on Claude Code. You give it inputs (voice memos, emails, web clippings), agents process them, and the system takes actions or asks questions. The filesystem is state, Git is history, the `cb` CLI is the universal interface.

This is not an app — it's a system that Claude Code operates. The human teaches by setting up rules, answering questions, and correcting mistakes. All of that is captured in files and commits.

## Development

**Dev server** — one shared router serves every checkout at `http://localhost:3210/<main|worktree>/<box>/...` (lazy start, idle stop); don't restart it from a worktree session. Contract in the monorepo root CLAUDE.md; mechanism in `bin/CLAUDE.md`.

**Testing** — `pnpm test:changed` runs the tests your diff implicates (or a named file: `pnpm exec tap test/<path>.doctest.md`). `pnpm test` is the full suite: an hourly schedule runs it on `main`; don't run it in a worktree without a reason. Pre-commit hook runs typecheck + lint automatically. Why: `docs/plans/change-based-test-selection.md`.
- `pnpm typecheck` — TypeScript (both backend and frontend)
- `pnpm lint:changed` — ESLint over what your diff touched (seconds); `pnpm lint` is the whole tree — run it when you changed something many files import. Both are behind the machine-wide run semaphore/eslint cache; why: `../issues/closed/code-quality/2026-08-25-lint-runs-contend-like-tests.md`.
- Tests are doctests (`.doctest.md`) in `test/`. See `.claude/rules/doctest.md` for syntax.
- Three tiers: pure function doctests, route doctests (`makeTestServer()`), filesystem doctests (`makeTmpBox()`)
- Use `t.check(actual, expected)` for string comparisons. Objects serialize as `JSON.stringify(val, null, 2)`.
- Run `pnpm test:changed` before committing. Every selected test is one your change implicates, so a failure is yours to fix.

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
  lib/            CLI/session-domain helpers only (session-transcript parsing,
                  fetch) — the generic utilities moved to src/lib/ (see below)
src/core/         Wakeup cycle, agent invocation, state, procedure engine.
                  Prefix-clusters are grouped into subdirs: agent/, box/,
                  chat/ (+ chat/session/), docs-gen/, external/, markdoc/,
                  schedule/, transcription/, triage/, views/ — plus the older
                  agent-guide/, commands/, landmark/, maps/, preactions/,
                  procedure/, reactor/, retro/, search/. Genuine singletons
                  (event-bus, state, card-io, intake, nav, ...) stay loose.
src/connectors/   External integrations (rss, gmail, telegram, etc.)
src/webapp/       Fastify server, API routes, SSE
  routes/         HTTP route handlers
  trpc/           tRPC router and sub-routers
src/hub/          `cb hub`: routes /<slug>/... to per-box `cb serve` children (lazy start, idle-collect, health-check) — see src/hub/CLAUDE.md
src/frontend/     React UI (Vite, separate tsconfig)
  src/pages/          Routed top-level pages (ChatPage, DashboardPage, AdminPage, ...) — subject to restrict-component-classes; can only use outer-layout classes
                      Pages with their own supporting components live in a subdirectory that holds a `components/` child for them (e.g. `pages/landmarks/LandmarksPage.tsx` + `pages/landmarks/components/...`, `pages/browse/`, `pages/capture/`). Any directory named `components/` is exempt from the rule, so page-local appearance lives there.
  src/components/     Reusable feature components, grouped by feature (chat/, history/, dashboard/, admin/, browse/, session-pickers/, view-widgets/, ...); shared shells (FileView, Markdown, AppNav) stay loose
  src/components/ui/  Shared UI primitives (Button, Text, Stack, Image, ...) — see frontend.md
  src/renderers/      File-type renderers (markdown, image, sheet, recipe, directory, ...)
  src/machines/       XState state machines
  src/hooks/          Shared React hooks
  src/lib/            Helpers, grouped: audio/ (recorder, mic, tts, speech),
                      patmatch/ (lexer/compiler), selection/, trpc/; plus loose
                      helpers (cn, source-tag, view-url, ...)
src/schemas/      Card type definitions (Zod + `cardSchema` from src/cards/)
src/services/     Service interfaces, real + fake implementations
src/scenario/     Scenario loader/runner (multi-step end-to-end fixtures)
src/dev/          Dev tools (knowledge audits, doc image generation)
src/lib/          THE single home for generic cross-cutting helpers (no core/
                  deps) — check here before writing your own. atomic-write
                  (writeFileAtomic — the crash-safe whole-file replace every
                  small state/credential store uses), content-hash,
                  mimetype, filename, file-exists, public-url, awake-timeout,
                  sleep, git*/paths/box-shape/box-layout* (promoted from
                  cli/lib), time (getBoxTime), format (chalk), box-config.
src/types/        Ambient type declarations only (.d.ts)
test/             Doctest files (mirror src/ paths; a moved src file keeps its
                  test at the old test/ path unless the test is moved too)
deploy/           Server provisioning and deployment scripts
plugins/          Claude Code plugins (card-validator hook)
```

There's no `src/test-lib/`. Doctest infrastructure is the monorepo-level `agent-doctest/` package (the loader/runner) plus this project's `test/helpers/` (test-server, fake-agent, fixture-replay, etc.).

**Boxes** live at `~/src/boxes/` (outside this repo so agents don't inherit this CLAUDE.md); `~/src/boxes/test1/` is the primary test box. Boxes are packages (`shapeVersion: 2`, the only shape) — the operational box is the `content/` subdirectory, and box code imports only the public `callback-box/{cards,schema,view-widgets}` specifiers, never engine internals. Full on-disk shape: `docs/box-layout.md`.

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
- **Git trailers are structured metadata.** Commits use trailers like `Created-By: connector-name`. Commits go through plain `git commit`; the per-box `.git/hooks/pre-commit` (installed by `cb init`) runs `cb validate --pre-commit` (staged validation + link warning + unlisted-binary guard, one process) and blocks invalid card commits.
- **All box ref/path parsing and resolution goes through `src/shared/ref-path.ts`** (`parseRef` + `resolveRefPath`) — never hand-roll a `path.resolve`, a segment split, or a `#`/`?` strip on a ref. It owns the 3-form rule (leading `/` → box root; `attach/` → the card's own attach scope; else document-relative) and fails closed: a `..` that escapes the box root is `null` everywhere, never clamped.
- **Time discipline.** Get timestamps via `getBoxTime`/`getBoxTimeISO` (`src/lib/time.ts`), not plain `new Date()` — it honors `CB_TIME`/scenario-frozen time for tests. Long-running timeouts must count only awake time via `startAwakeTimeout` (`src/lib/awake-timeout.ts`) — a plain `setTimeout` fires instantly on wake because its underlying clock advances during macOS sleep.
- **All cross-process locks go through `src/lib/file-lock.ts`.** It is now implemented on top of `proper-lockfile` (atomic guard-dir `mkdir`, mtime-freshness stale/crash recovery) — but callers still go through `file-lock.ts`, never `proper-lockfile` directly, and never hand-built `.lock` files. In-process async serialization (e.g. a `Map<id, Promise>` chain — see `card-lock.ts`) is a different problem and stays separate.
- **Check client debug logs when debugging frontend or iOS issues.** Browser errors and native iOS diagnostics share the `debugLog.submit` sink. Read the rolling `.callback-box/client-debug.log` in the box directory; `[ios]` tags native entries. See `docs/client-debug-log.md`.
- **Never change credentials to unblock yourself.** If you hit a login wall while testing, **ask the boxholder** — needing credentials you weren't given is a question for a human, not an obstacle to engineer around. The local credential store is `~/.cb-auth.json` (override `CB_AUTH_FILE`), and it is **global**: one file behind every local box on the machine, *not* per-box like the rest of a box's state, so "it's just a disposable worktree box clone" is not a reason it's safe. `cb auth set-password` also revokes the user's live sessions, and the old password survives only as a scrypt hash — the change cannot be undone. The mutating `cb auth` subcommands now refuse in an agent session unless passed `--agent-confirmed` (`src/lib/agent-context.ts`); that flag asserts *a human explicitly asked for this*, not *I decided it was fine*. Generalize it: before running any command that writes credentials, tokens, or keys, check what file it actually touches — and if a tool tells you it revoked, rotated, or invalidated something, stop and verify the scope instead of reading it as success. (This is written from a real incident, 2026-07-30.)
- **Leave the repo clean when committing.** Fix any lint/type/test errors you encounter (even pre-existing ones) and make enough commits that nothing half-done is left lying around.
- **Keep source and docs generic — never hardcode personal names.** This is a generic tool; any box can be adopted by any user. Refer to "the user" or "the boxholder" in shared text (source, prompts, schemas, docs, rules). Names are only fine in per-box config, throwaway replies, personal memory, and **metadata fields where the name is the data** (`discovered-by:`, `reviewed-by:`, a commit author) — not in prose describing a role. If a sentence still reads correctly with "the boxholder" substituted in, it should have said that; naming the person there bakes one individual into text about a general relationship. When an example genuinely needs named people, boxes, or places, draw from the canonical fictional roster in `docs/example-names.md` rather than inventing one (which risks using a real name).

## Improving These Instructions

When you get corrected on a convention, pattern, or workflow that wasn't documented, update CLAUDE.md, code-style.md, frontend.md, `.claude/rules/`, or `docs/` so the next agent doesn't repeat the mistake. One-line additions preferred.

The same duty applies at creation time: **new infrastructure isn't done until it's discoverable** — a tool, framework, or convention you build gets a doc (or at minimum a pointer in the guides table below) in the same change, at the altitude its importance warrants. Undocumented infrastructure reads as not existing (this happened with tours: built 2026-05, discovered by the boxholder 2026-07).

## Guides

| Topic | Location |
|-------|----------|
| Developer install (from source) | `docs/developer-install.md` |
| Docker install (local + VPS) | `docs/docker-install.md` |
| Agent-driven install (for a user's AI assistant) | `docs/agent-install.md` |
| Engineering principles | `docs/engineering-principles.md` |
| Module map (lib/shared/types boundary) | `docs/module-map.md` |
| Design rationale | `docs/design/README.md` |
| Card examples | `docs/cards-as-markdown.md` (format), `docs/adding-schemas.md` (worked example), `src/schemas/templates*.ts` (template registry) |
| Testing philosophy | `docs/testing.md` |
| Tours (browser walks for UI/a11y review) | `docs/tours.md` |
| Doctest syntax | `.claude/rules/doctest.md`; deeper reference in the monorepo's `agent-doctest/docs/` |
| Adding a card type | `docs/adding-schemas.md` |
| Card format reference | `docs/cards-as-markdown.md` |
| Card format design history (RFC) | `docs/implemented-plans/cards-as-markdown-rfc.md` |
| Box migration runbook | `docs/migrations.md` |
| Cross-platform mobile contract (iOS/Android ↔ box) | `docs/mobile-contract.md` |
| Image orientation (EXIF) contract | `docs/image-orientation.md` |
| Mobile parity matrix (iOS vs Android capabilities) | `docs/mobile-parity.md` |
| Assets (git-annex) | `docs/assets.md` |
| Card validation hooks | `docs/card-validation.md` |
| Adding API endpoints | `docs/adding-api-endpoints.md` |
| Connectors | `docs/connectors.md` |
| Secrets (machine-level store, grants, `cb secrets`) | `docs/secrets.md` |
| Procedures | `docs/procedure-implementation.md` |
| Scheduler daemon (`cb tick`) | `docs/scheduler.md` |
| Deployed-server health-check runbooks | `docs/health-checks.md` |
| Agent-set chat timers (`<schedule>` tag) | `docs/chat-schedules.md` |
| Capturing full agent-invocation API traffic | `docs/prompt-logging.md` |
| Prompt-surface review workflow | `docs/prompt-surface-review.md` (lens catalog: `docs/prompt-audits.md`) |
| Triage pipeline design | `docs/triage.md` |
| Questions subsystem design | `docs/questions.md` |
| Deployment | `deploy/README.md` |
| Server operations | `docs/server-operations.md` |
| Adding a box | `docs/adding-a-box.md` |
| Box layout reference | `docs/box-layout.md` |
| Landmarks (navigation surface) | `docs/landmarks.md` |
| Client debug log | `docs/client-debug-log.md` |
| Chat session lifecycle | `docs/chat-session-lifecycle.md` |
| Which model a box thinks with | `docs/model-policy.md` |
| Chat review (nightly titles + summaries) | `docs/chat-review.md` |
| Content-Security-Policy | `docs/content-security-policy.md` |
| Periodic maintenance | `docs/maintenance.md` |
| Knowledge audits | `docs/knowledge-audits.md` |
| Calendar integration | `docs/calendar.md` |
| PDF intake design | `docs/plans/pdf-intake-design.md` |
| Source editor plan | `docs/plans/source-editor.md` |
| Interface-as-cards design | `docs/plans/interface-as-cards.md` |
| Feature ideas & open issues | `/issues/` (monorepo root) |
| OpenClaw/Hermes comparison & idea triage | `research/openclaw-hermes/README.md` |
| Third-party asset attribution | `docs/attribution.md` |
| Glossary | `docs/glossary.md` |
| Example names for docs/tests | `docs/example-names.md` |

@code-style.md
