---
title: "Small dependency sweep: chalk, get-port, chokidar, cheerio, open, rollup, react-textarea-autosize"
status: implemented
workstream: dep-reduction
issues:
  - ../../../issues/closed/code-quality/2026-10-25-dependency-reduction-sweep.md
---
# Small dependency sweep

Seven packages each do one small job that the platform or a few lines can do.
The boxholder approved removing all seven on 2026-10-27, with two decisions
that change behavior:

- **chalk:** *"we actually don't need colors, agents can't see them, so just
  remove colors!"* CLI output becomes plain text.
- **open:** it is used only by `bbx google-auth`. Asked whether to remove the
  command or keep it without auto-open, the boxholder chose **remove the
  command**. The Admin page's "Connect Google Account" becomes the only way
  to connect Google.

`react-textarea-autosize` moves to CSS `field-sizing: content`; the boxholder
accepted that browsers without it show a fixed-height box.

## Design

The person-facing changes are small and decided above:

- `bbx` output loses its colors. Glyphs such as `✓` and `✗` stay.
- `bbx google-auth` is gone. Messages that told someone to run it now name
  the Admin page.
- The chat composer still grows with its text, from 1 row (desktop) or 2 rows
  (phone) up to 8. On a browser without `field-sizing` (Safari before 26.2,
  older iOS web views), it stays at its minimum height and scrolls.

No further design section: the boxholder made each call directly.

## Smallest fix and budget

Each package is its own small change. The work is one sweep because each is
too small for its own review.

| package | change | estimate |
|---|---|---|
| chalk | delete `fmt`'s color calls; inline the call sites | ~120 call sites in 24 files, about 250 changed lines, mostly mechanical |
| get-port | `beebox/src/lib/free-port.ts`, used by beebox and workstreams-app | ~40 lines + test ~40 |
| chokidar | `fs.watch` in `core/schema-watcher.ts` | ~40 changed + test ~40 |
| cheerio | regex strip in `bbx view`; happy-dom in the ui-scan test fixture | ~40 changed |
| open | delete `cli/commands/google-auth.ts` and its registrations; reword messages and docs | ~200 deleted, ~30 changed |
| rollup | `import type { Rollup } from "vite"` | ~5 |
| react-textarea-autosize | a plain `<textarea>` with `field-sizing: content` and min/max height | ~30 |

The total is about 800 changed lines, half of them deletions. This is not a
BIG CHANGE.

## Stated preferences this plan trades against

- **Operational simplicity.** Seven fewer declarations; `open`'s 11 packages,
  cheerio's 8, and chokidar leave the server.
- **Bias toward strict.** The replacements keep each package's guarantees
  that callers rely on (get-port's in-process reservation, chokidar's write
  coalescing). Where the replacement is weaker, the plan says so.
- **Minimize invented concepts.** `free-port.ts` is the one new module. `fmt`
  goes away instead of becoming a set of identity functions.

## What already exists

- **chalk.** `beebox/src/lib/format.ts:10` *"import { Chalk, type
  ColorSupportLevel } from "chalk";"* defines `fmt` (header, dim, ok, fail,
  warn, kv, status, phase, …), `colorLevel`, and `stripAnsi`.
  `beebox/src/cli/commands/field-test.ts:10` imports chalk directly.
  `beebox/test/lib/format.test.ts` tests `colorLevel` and `stripAnsi`.
  `beebox/src/core/script-env/allowlist.ts:65` passes `TERM` *"color/tty
  detection in spawned `bbx` processes (src/lib/format.ts's chalk)"*.
- **get-port.** `beebox/src/hub/supervisor/child-spawn.ts:84-85` *"const {
  default: getPorts } = await import("get-port"); const port = await
  getPorts();"*. `workstreams-app/src/router/server/real-effects.ts:20,389`
  *"getPort: () => getPorts()"*. The router calls it in parallel
  (`core/worktree-start.ts:63`, `server/workstreams-app-generation.ts:88`)
  and documents the probe-to-bind race it accepts
  (`core/generation.ts:181-187`). get-port 7 keeps an in-process set of
  recently returned ports for 15 s, so two calls in one process do not get
  the same port. A third importer,
  `workstreams-app/src/router/server/workstreams-app-effects.ts:14,295`,
  starts the workstreams app. workstreams-app already imports beebox source
  (`workstreams-app/src/server/document-read.ts:25`).
- **chokidar.** `beebox/src/core/schema-watcher.ts:40` *"const { watch } =
  await import("chokidar");"* watches `src/schemas` with `persistent:
  false`, `ignoreInitial`, a `package.json` ignore, and `awaitWriteFinish: {
  stabilityThreshold: 150 }`. Any event calls `invalidateBoxSchemas`. The
  header records that a missing directory is not watched.
  `beebox/src/core/box/file-watcher.ts:11-25` already moved off chokidar to
  per-directory `fs.watch`.
- **cheerio.** `beebox/src/cli/commands/view/command.ts:115-121`,
  `postProcess`, removes `<script>` and `<style>` from React-rendered HTML.
  `beebox/test/frontend/lib/ui-scan/fixture.ts:18,81` parses fixture markup
  into the ui-scan node shape. Its only users are
  `beebox/src/frontend/test/lib/ui-scan/live-dom/{scan,accessible-name}.test.ts`,
  which run under the frontend's happy-dom (`src/frontend/package.json:50`
  *"happy-dom": "20.14.6"*).
- **open.** `beebox/src/cli/commands/google-auth.ts:97` loads it to open the
  consent URL. The command listens on `127.0.0.1:8976` (`:149`), so it works
  only when browser and box share a machine, and it never prints the URL.
  It is registered at `beebox/src/cli/commands.ts:52` and
  `beebox/src/cli/entry/surface-data.ts:176`. Messages that name it:
  `beebox/src/google/auth-gap.ts:31,63`; docs:
  `beebox/docs/connectors/google-auth.md:79-84,144`,
  `beebox/docs/connectors/drive.md:262`,
  `beebox/docs/server/health-checks.md:195`. The web flow is
  `beebox/src/webapp/trpc/routers/admin/google.ts`, which the docs call
  *"Web admin (recommended)"* (`google-auth.md:69`).
- **rollup.** `beebox/src/frontend/src/dev/bundle-analysis-plugin/bundle-analysis-report.ts:11`
  *"import type { OutputAsset, OutputBundle, OutputChunk } from "rollup";"*.
  The frontend runs Vite 5.4.21, which exports a `Rollup` type namespace.
- **react-textarea-autosize.** Two uses:
  `InteractiveChat-composer/view.tsx:102` (`minRows={1} maxRows={8}`) and
  `InteractiveChat-mobile-row.tsx:42` (`minRows={2} maxRows={8}`). Their
  classes come from `composerTextareaClasses` in
  `InteractiveChat-helpers.ts:110` (*"flex-1 resize-none rounded-lg px-3
  py-2 …"*).

Searched the issue queue for each package name: only the inventory issue
matches.

## Prior art (external)

- `node:util` `styleText` would replace chalk; the decision to drop color
  makes it unnecessary.
- `fs.watch(dir, { recursive: true })` is supported on macOS and Linux in
  Node 24.
- CSS `field-sizing: content` ships in Chrome 123, Safari 26.2, and current
  Firefox. Under it, `rows` has no effect (MDN `field-sizing`).
- get-port's reservation behavior: see its README ("Ports are locked for up
  to 15 seconds").

## Ontology

- **`freePort()`**: in `beebox/src/lib/free-port.ts`. It binds port 0 on
  the default host, as get-port 7 does (dual-stack, so an IPv6-only
  listener also counts as taken), reads the port, closes, and returns it.
  It skips a port it returned in the last 15 s in this process. The check
  and the reservation happen together after the bind resolves, with no
  `await` between them, so parallel calls cannot share a port.

No other new names.

## Tracks / scope

One track, one commit per package.

1. **rollup.** Take the three types from `Rollup` in `vite`. Drop the
   declaration.
2. **chalk.** Delete `fmt`, `colorLevel`, `stripAnsi`, and their test.
   Rewrite each call site to the plain string it produced without color:
   the identity formatters become their argument, and the glyph ones keep
   their glyph (`fmt.ok(x)` → `` `✓ ${x}` ``, `fmt.fail(x)` → `` `✗ ${x}` ``,
   `fmt.phase(n)` → `` `=== ${n} ===` ``, `fmt.kv(k, v)` → `` `${k}: ${v}` ``,
   `fmt.bullet(x)` → `` `  • ${x}` ``). field-test.ts drops its chalk calls.
   `bbx validate` has its own color path
   (`cli/commands/validate/report.ts:22`, which enables color on a TTY and
   feeds the URL, canonical-ref, Markdown, attachment and prominence
   reports); that goes too, keeping the text and glyphs. Its terminal-color
   test changes to plain output. The allowlist's `TERM` comment is
   corrected. If `TERM` has no other
   reason to pass, it stays anyway: removing an env var from spawned
   processes is out of scope.
3. **get-port.** Add `freePort()` and its test: a returned port binds;
   `Promise.all` of several calls returns distinct ports; a port held by an
   IPv6 listener is not returned. Use it in `child-spawn.ts`,
   `real-effects.ts`, and `workstreams-app-effects.ts`. Drop both
   declarations.
4. **chokidar.** `fs.watch(schemasDir, { recursive: true, persistent:
   false })`. Events for a name ending in `package.json` or starting with
   `.` are ignored. Other events reset a 150 ms timer; when it fires, it
   calls `invalidateBoxSchemas`. chokidar's `awaitWriteFinish` waited for
   the file size to hold for 150 ms; this waits for 150 ms without a change
   event. Both let through a writer that pauses longer than 150 ms in the
   middle of a write, and the loader's keep-last-good covers that case
   (`schema-watcher.ts:10-11`). `fs.watch` throws `ENOENT` synchronously for
   a missing directory; the call is wrapped, and the watcher is skipped, as
   the header documents. `registerBoxRoutes` awaits this
   (`webapp/server-box-scope.ts:201`), so a throw would fail box startup.
   `error` events log as before. `close` clears the timer. Tests: a write in
   three chunks 50 ms apart invalidates once, after the last; a box with no
   `src/schemas` starts the watcher without throwing.
5. **cheerio.** `postProcess` removes
   `/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu`. React's server output
   cannot hold `</script` or `</style` inside those elements, so the regex
   cannot cut one short. cheerio's `$.html()` wrapped the fragment in
   `<html><head></head><body>…</body></html>`, and
   `test/cli/commands/view/command.test-command.test.ts:88` pins that, so
   `postProcess` adds the same wrapper. React already serializes `&` as
   `&amp;` (pinned at `:156`). If the existing view tests show any other
   serialization difference, the plan stops for a decision.
   *Decided 2026-10-27:* React's serialization differs from cheerio's in
   text only (`<img/>` for `<img>`, `&#x27;` for `'`, a literal no-break
   space for `&nbsp;`). The boxholder called `bbx view test` "an old self
   debug path … could maybe be removed", so the output is accepted as React
   writes it and the two pinned strings change. Removing the command is
   `issues/closed/features/2026-10-27-consider-removing-bbx-view-test.md`. The
   fixture stays in `beebox/test/`, so beebox declares `happy-dom` (the
   frontend's exact version); moving it into the frontend's tests set off
   an unrelated layout rule for `live-dom/`. The ui-scan fixture parses with happy-dom's
   `Window` and walks DOM nodes instead of cheerio nodes. Drop cheerio.
6. **open.** Delete `google-auth.ts`, its `commands.ts` entry, and its
   `surface-data.ts` row. In `auth-gap.ts`, the two messages say to
   reconnect Google on the box's Admin page. Docs: remove the CLI section
   from `google-auth.md` and the CLI mention from `drive.md` and
   `health-checks.md`. Drop `open`.
7. **react-textarea-autosize.** A plain `<textarea>`. `rows` has no effect
   under `field-sizing: content` (MDN), so the class sets the bounds:
   `box-content` (height then excludes padding and the theme's border,
   such as overprint's 2px), `[field-sizing:content]`, `min-h-[1lh]` or
   `min-h-[2lh]`, and `max-h-[8lh]`. Verify in the browser at desktop and
   phone widths: the minimum, growth to 8 lines, then scrolling, for typed
   text and for a programmatic value change (`setInput`, dictation).

## Could this be simpler?

Each step is already the smallest replacement for its package. The one
choice with a cheaper option: chalk could become identity functions in
`fmt` and leave the 24 files alone. That keeps a concept whose only purpose
was color, which conflicts with *minimize invented concepts*. Inlining is
mechanical. A worker does it with a per-formatter mapping, and typecheck
catches misses.

## Subplans

None.

## Failure modes

- **Port reuse.** Without the reservation window, two box children started
  within a few seconds could get the same port on Linux, which reuses
  freshly closed ports. `freePort()` keeps get-port's 15 s window.
- **Schema watcher on Linux.** Recursive `fs.watch` on Linux sets one
  inotify watch per subdirectory; `src/schemas` is small. A directory
  created after the watch starts is picked up by Node's recursive mode.
- **Event storms.** `fs.watch` reports a save as several events. The 150 ms
  timer coalesces them into one invalidation.
- **Uncolored output that tests match.** A test that matched ANSI output
  fails at typecheck or check. All such tests change in step 2.
- **A box agent or doc that says to run `bbx google-auth`.** After step 6,
  `bbx google-auth` reports an unknown command. The searches in *What
  already exists* list every mention, and each changes in step 6. Box-side
  guidance (`box-docs`, agent guide) has no mention.
- **Composer on an older Safari or iOS web view.** It shows a fixed box
  with scrolling. This was accepted.

## Agent-flow / user-flow edge cases

- A box agent hits a missing Google refresh token. `explainGoogleAuthGap`
  now relays "reconnect Google on the Admin page". Walked:
  `auth-gap.ts:61-64`.
- The boxholder types a long message on the phone. The textarea grows from
  2 to 8 lines and then scrolls, as before.
- A schema author saves a file twice in 100 ms. One invalidation runs
  150 ms after the last event.

## NOT in scope

- `@orama/plugin-data-persistence` (not approved in this round).
- Removing `TERM` from the spawned-process allowlist.
- Changing the `simple-git`, `glob`, and YAML parser consolidation rows.
- The Admin page's Google flow itself.

## Open design questions

None. The two behavior decisions are the boxholder's, recorded above.

## Knowledge audits

None needed. No box guidance names these packages or `bbx google-auth`.
Searched `beebox/box-docs` and `beebox/src/core/agent-guide`: no matches.

## What will hold this after it ships

- `free-port` and `schema-watcher` tests.
- The `bbx view` postProcess test.
- The ui-scan tests, through the happy-dom fixture.

## Implementation order

The steps in *Tracks / scope*, verified one by one. Two workers did steps
2 and 6 in parallel in one index, so the sweep is one commit. After all seven: `pnpm install`, then typecheck and lint in
beebox, the frontend, workstreams-app and the root; change-selected beebox
tests; workstreams-app tests; and the browser check from step 7.

## Rollout shape

It lands as one merge and deploys. No data or config changes.
