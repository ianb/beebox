---
title: "Exhibits rethink: show, do not ask"
status: active
workstream: exhibits-rethink
issues: []
---
# Exhibits rethink: show, do not ask

An exhibit is a page an agent builds to show the developer rendered work:
labeled screenshots, a document, or a small interactive page. Today every
exhibit also carries an **ask** with an answer form, and the dashboard keeps a
queue of unanswered asks. This plan removes the ask, writes the rule for
phrasing an exhibit in terms the developer can read without the plan, makes
the session-finished desktop notification open the exhibit page, gives the
page a button that brings up the session's terminal tab so a reaction is one
click away, and lists each workstream's exhibits on the dashboard.

## Implementation status

Implemented in the exhibits-rethink worktree, 2026-10-10, all five tracks.
Hand check against a standalone run of this worktree's listener
(`BBX_EXHIBITS_ROOT` pointed at the real store): a legacy `decide` exhibit
renders its old prose; the focus route answers 204 for this worktree, 409
with the CLI's reason for a workstream with no live session, 409 before
spawning for `apps/` and `main`, 403 for a foreign `Origin`, 400 for a
traversal segment; the browser button reaches the route; the workstream list
API carries each workstream's exhibits and surfaces an unreadable store as a
warning. The Stop hook edit (Track 3) is in `~/.claude/hooks/notify.sh`.
Codex (gpt-6-sol) reviewed the plan twice and the diff once; every finding
was applied. Not merged.

**Issues addressed:** none filed directly. Related, not addressed:
[orphaned comment namespaces after a cull](../../../issues/features/2026-08-22-orphaned-comment-namespaces-after-a-cull.md)
cites the exhibits store's orphan report as precedent; it is untouched here.
Searched `issues/` for `exhibit`, `ask queue`, `disposition`: the only hits on
the ask mechanism are closed
([file asks as agent-flagged attention](../../../issues/closed/features/2026-08-22-file-asks-agent-flagged-attention.md)).

## Design

No design section: this changes a developer tool in the monorepo, not what a
person experiences of the box.

### Why (the evidence, 2026-10-10)

Read from `~/src/workstream-exhibits/` and the Claude transcripts:

| Measure | Value |
|---|---|
| Exhibits in the store | 138 |
| With a recorded answer | 4 |
| Answered through the page's form | 0 |
| Waiting, ask `fyi` / `react` / `confirm` / `decide` | 66 / 36 / 19 / 12 |
| Waiting and older than 7 days | 94 (oldest 52 days) |
| Workstreams with exhibits that still have a worktree | 8 of about 40 |
| Developer chat messages that name a figure label (A1, B2) | 2 of 3,783 |
| Developer chat messages that paste an exhibits URL back | 5 |

All four answers were written by an agent after the developer replied in chat
(each `disposition.json` says "Recorded by the agent from the chat answer").
The two interactive pages in `tiling-backgrounds/` logged 194 and 347 events,
so the instrument tier is used. The developer's statement, 2026-10-10: they do
open exhibits, almost always answer in chat, often miss that an exhibit exists,
find opening a link out of terminal text annoying, still want to react to
exhibits with several choices, and would like the dashboard's workstream list
to show each workstream's exhibits. The ask prose is written
in plan vocabulary they have not read ("one global card field, prominence:
entry-point | primary | background"; "Slice 1 of the plugins plan").

## Smallest fix and budget

**Smallest fix:** change the guidance only. Tell agents to put the exhibit URL
on the first line of the final message and to phrase prose by what the page
shows. No code. This leaves the queue growing at its current rate (about 130
unanswered rows in 52 days), the answer form that has never been used, and the
link-in-text delivery the developer finds annoying.

**Chosen:** three tracks.

| Track | Source and test lines (adds + deletes) |
|---|---|
| 1. Remove the ask, the answer form, and the queue | about 1,250, mostly deletions |
| 2. Phrasing rule, `--caption` | about 80 |
| 3. Notification opens the exhibit | about 30 (outside git, `~/.claude/hooks/notify.sh`) |
| 4. "Reply in the session" button on the page | about 120 |
| 5. Exhibits on the workstream list and detail pages | about 200, half reused from the queue scan |

Authored docs: `workstreams-app/docs/exhibits.md` loses its ask sections
(about 90 lines) and gains the phrasing section (about 25); root `AGENTS.md`
and `.claude/skills/browse/SKILL.md` change one paragraph each. Not a BIG
CHANGE.

What the fuller version buys: the concept count drops by three (ask type,
disposition, ask queue), which removes the surface that rots, per the
boxholder preference for fewer invented concepts (memory
`minimal-concepts-prefer-primitives`). Track 3 puts the page one click from the
notification the developer already acts on; Track 4 puts the chat one click
from the page, so reacting costs look, click, type. Track 5 reuses the queue's
store scan as a plain inventory, so an exhibit is findable from the workstream
it belongs to rather than from a queue of questions.

## Stated preferences this plan trades against

- **The original design** ([workstream-exhibits](../implemented-plans/workstream-exhibits.md),
  "Job to be done"): *"I want one queue that says what is waiting on me and
  what each item costs."* This plan removes that queue. Trade: the queue was
  never answered through its own surface in 52 days; chat is the channel the
  developer uses. The job is served by the chat turn and the notification.
- **Engineering principle 4** (visible failure over silent skip) shaped the
  queue's broken-row reporting. Removing the queue removes those rows; a
  manifest that does not parse still renders an error page on the exhibits
  origin (`workstreams-app/src/server/exhibits/app/pages.ts:116`).
- **No wildcard deletes** (memory `no-wildcard-deletes`): nothing in this plan
  deletes store content. The 134 waiting exhibits stay on disk.

## What already exists

- Manifest schema with a required `ask`: `workstreams-app/src/shared/exhibits.ts:33-38`
  (*"A workstream exhibit always states its ask"*), optional for committed apps
  at `:41-43`. Reused with `ask` removed.
- Disposition reader: `workstreams-app/src/server/exhibits/disposition.ts`
  (71 lines). `DATA_DIR` at `:16` is imported by `app/api.ts:25`; it moves to
  `store.ts`. The rest is deleted.
- Answer form: `workstreams-app/src/frontend/exhibits/DispositionForm.tsx`
  (163 lines), mounted from `Container.tsx:87-90`. Deleted.
- Ask queue: `workstreams-app/src/server/main/exhibits-queue-service.ts`
  (139 lines), tRPC route `server/api/router.ts:116-118`, service interface
  `server/services.ts:73-75`, page `frontend/pages/AsksPage.tsx` (110),
  grouping `frontend/lib/ask-queue.ts` (39), nav link `frontend/main/App.tsx:16`,
  route `frontend/main/router.tsx:59`. Deleted.
- Tests on the removed parts: `workstreams-app/test/frontend/lib/ask-queue.doctest.md`
  (206 lines), `test/server/main/exhibits-queue-service.doctest.md` (415),
  one scenario in `test/frontend/exhibits/Container.doctest.md:46`, the
  `--ask`/`--option`/disposition cases in `bin/test/exhibits.cli.doctest.md`
  (lines 81-84, 120-150, 194). Deleted or rewritten.
- CLI: `bin/exhibits` validates `--ask` and `--option` (lines 205-214) and
  reports `answered` in `list` (`add_row`, lines 346-380). Changed.
- Store listing on the exhibits origin: `store.ts:226-264` reads the
  disposition per row. The `askType`, `answered`, `problem` fields go.
- Figure labels: `bin/exhibits add` labels figures `A1`, `A2`, ... in argument
  order (`bin/exhibits`, the `figures_json` loop in `add`) and has no caption flag; the manifest schema
  already allows `caption` (`shared/exhibits.ts:28-32`). Track 2 adds the flag.
- Desktop notification: `~/.claude/hooks/notify.sh` (outside git). On Stop it
  reads `last_assistant_message` into the body (line 154) and, on click, runs
  `focus-tab.sh` for the session's tty (line 236). Codex sessions call the
  same script from `~/.codex/hooks.json`
  (`issues/bugs/2026-10-05-codex-hook-failures-show-no-output.md:93`).
- Printed URLs carry the machine token: `exhibit_url` at `bin/exhibits:153-160`
  prints `http://127.0.0.1:3230/<ws>/<slug>/?token=<t>`. The notification can
  open that URL as printed; no new auth path.
- Orphan reporting: `bin/workstreams:1029-1041` reports store directories with
  no live worktree and never deletes. Unchanged.
- Focusing a session's terminal tab: `bin/workstreams focus <name>`
  (`bin/workstreams:283-306`) reads the session registry's `tty` and runs
  `terminal_focus_tty` (`bin/lib/terminal-tabs.sh:22-43`, AppleScript against
  Terminal.app). The dashboard already exposes it as the `focus` action
  (`shared/actions.ts:7`; `frontend/components/WorkstreamActions.tsx:47-54`
  offers it when the agent is live) through `createActionCommandRunner`
  (`server/main/actions-service.ts:66-80`), which spawns `bin/workstreams`.
  Track 4 reuses the CLI; it does not re-implement the AppleScript.
- The session registry records the tty at SessionStart
  (`.claude/hooks/session-start-registry.sh`, via
  `wt_session_from_claude_ancestor` in `bin/lib/session-workstream.sh`);
  Codex sessions have `agent: "codex"` rows (`bin/lib/session-registry.sh:131`).
- Per-workstream exhibit listing already exists on the exhibits origin:
  `GET /:ws/` renders `renderExhibitList` over `listExhibits`
  (`app/handler.ts:280-291`). Track 5 links there and reuses the store scan
  (`store.ts:listWorkstreams`, `readManifest`) that the queue service
  (`exhibits-queue-service.ts:53-66`) wraps today.
- The workstream list and detail pages: `frontend/pages/WorkstreamsPage.tsx`
  rows and `WorkstreamDetailPage.tsx`, fed by `workstreams.list` and
  `workstreams.detail` (`server/api/router.ts:36-45`); the detail procedure
  joins issues onto the row and is the model for joining exhibits.
- Phrasing guidance for decisions already exists as a boxholder memory
  (`ask-decisions-with-context`, 2026-10-09). Track 2 moves its substance into
  the exhibits doc, where agents load it.

## Prior art (external)

No decision here depends on an external premise. The notification tool
(`alerter`) is already in use and already returns a click outcome.

## Ontology

- **Exhibit** (exists, `shared/exhibits.ts`): a directory in the store with a
  manifest, content files, and captured data. After this plan its manifest is
  `{ title, created, prose?, figures? }`.
- **Prose** (renamed in place): one short paragraph the page shows above the
  figures. It says what the page shows. What the agent will do next, and any
  question, live in chat. Today it is `ask.prose`; it becomes top-level
  `prose`.
- **Figure** (exists): `{ label, file, caption? }`. The caption says where in
  the app the figure was taken and what to look at.
- **Instrument** (exists, informal): an exhibit with its own `index.tsx` or
  `index.html`. Keeps its event log and documents.
- **Committed app** (exists, `dev/apps/`): unchanged. Its manifest already
  omits `ask` (`dev/apps/story-eval/exhibit.json`).
- **Exhibit inventory** (replaces the ask queue's scan): per workstream, the
  list of `{ slug, title, created, path }` read from the store. No state
  beyond what the manifest holds.
- Removed nouns: **ask type**, **disposition**, **ask queue**.

## Tracks / scope

### Track 1: remove the ask, the answer form, and the queue

**What.** The manifest drops `ask`. The container drops the ask header and
the answer form. The workstreams app drops the asks tab, its route, its tRPC
procedure, its service, and the grouping helper. `bin/exhibits` drops
`--ask` and `--option` and the answered state in `list`.

**Why this needs to change.** The answer path has never been used. The queue
grows by every exhibit and shrinks only when an agent hand-writes a
disposition. It competes with the surfaces the developer does use.

**Direction.**

- `exhibitManifestSchema` becomes `{ title, created, prose?: string, figures? }`.
  `appManifestSchema` is the same schema; the two merge.
- Reading legacy manifests: `readManifest` lifts `ask.prose` into `prose` when
  `prose` is absent, then strips `ask`. One place, read side only. Nothing
  writes `ask` again. The 138 existing exhibits keep rendering their title,
  prose, figures, and documents. The old `ask.type` and `ask.options` (the
  choice labels the form showed, `DispositionForm.tsx:29-32`) are not shown
  anywhere after this lands. Proposed as an accepted loss: no decision was ever recorded
  through those labels, and the choices that were made live in chat and in
  the plans. Accepted by the boxholder, 2026-10-10.
- `readManifest(dir, { requireAsk })` loses its option; `requireAsk` is threaded through `store.ts:154,181,235,252` and `app/handler.ts:86,131,248,261,289,303`.
- The container renders `prose` as Markdown under the title, through the
  `Markdown` component the default renderer already uses for `doc.md`
  (`frontend/exhibits/DefaultExhibit.tsx:51`, `components/Markdown.tsx`). Today
  the ask prose is a plain `<p>` (`Container.tsx:79`), so a list or emphasis
  an agent wrote came out as one run-on paragraph (boxholder, 2026-10-10). No
  badge and no form. Instruments keep `EventLog`, `Storage`, `postCapture`.
- The default renderer's figure block shows `caption` under each image, as it
  does today.
- `bin/exhibits add`: `--prose` stays, optional. `--ask` and `--option` are
  rejected with a message that names this plan ("exhibits no longer carry an
  ask; say what you want in chat"). `list` prints workstream, slug, title,
  created date; `--json` drops `answered`, `decidedAt`, `problem`.
- `list` today skips a manifest that does not parse with a stderr line and
  exits 0 (`bin/exhibits:351`), and the ask queue was the surface that showed
  such a row. With the queue gone, `list` keeps the row with `problem` set
  and exits non-zero after printing, so an incomplete inventory is never
  mistaken for a complete one.
- Delete: `DispositionForm.tsx`, `AsksPage.tsx`, `lib/ask-queue.ts`,
  `disposition.ts` (move `DATA_DIR` to `store.ts`), the nav link, the route,
  the tRPC procedure `exhibits.askQueue`, the `ask-queue` doctest, and the
  ask scenarios in the CLI and container doctests.
- `exhibits-queue-service.ts` becomes `exhibits-inventory-service.ts`: the
  same store scan (`scanTarget`, `listWorkstreams`, `readManifest`) minus
  disposition and ask fields, returning `{ workstream, slug, title, created,
  path, problem }` rows for Track 5. Its doctest is rewritten to the new rows,
  keeping the broken-manifest and missing-store cases.
- `pages.ts:116-121` (the broken-manifest page) describes the new shape.
- Docs: `workstreams-app/docs/exhibits.md` loses "Ask types", "The ask
  queue", and the disposition paragraphs. Root `AGENTS.md` "Record and show
  work" loses the ask sentence. `.claude/skills/browse/SKILL.md:73` keeps its
  sentence (it names no ask).
- `workstream-exhibits.md` gets `status: implemented` and moves to
  `implemented-plans/`, with a two-line note that the acceptance pass never
  ran and this plan removed Track E and the disposition.

**Vocabulary lock-ins.** `prose` as the manifest field and CLI flag. No
`ask`, `askType`, `disposition`, `askQueue` anywhere after this lands.

**First implementation chunk.** Schema change with the legacy lift and its
doctest; container without the form; CLI without `--ask`; both doctests
green. The queue removal is the second chunk.

### Track 2: phrasing rule and captions

**What.** A section in `workstreams-app/docs/exhibits.md` that says how to
write `prose` and captions, and a `--caption` flag so captions are easy to
supply.

**Why this needs to change.** The developer reads the exhibit without having
read the plan. Current prose names plan tracks, slices, internal field names,
and branch names. A caption-less figure is a spot-the-difference puzzle, as
the current doc already says.

**Direction.**

The doc section, in full:

> ## Writing for someone who did not read the plan
>
> The developer opens an exhibit cold. Write every sentence for that reader.
>
> - **Say where you are and what you see.** A caption names the page or
>   control in the app as a person using the box would ("the Properties panel
>   of a recipe card, after tapping Appearance"), then what to look at. Not
>   "B2: Properties now; Appearance is folded".
> - **Say what changes for a person using the box.** When the figures show a
>   choice, each one is described by what the person gets, not by its
>   implementation ("the list stays readable at phone width" rather than
>   "stack-as-flex-column").
> - **No plan vocabulary.** Track names, slice numbers, field names, branch
>   names, and nouns the plan introduced do not appear unless the figure
>   shows them on screen. If a noun needs the plan to decode, define it in
>   one clause or drop it.
> - **Ask in chat, decide in chat.** The exhibit shows what is; it does not
>   propose, default, or ask. What you will do next and any question go in
>   your final message, with the exhibit URL on its first line.

- `--caption <text>` on `bin/exhibits add`, repeatable; the n-th caption pairs
  with the n-th figure file in argument order. More captions than figures is
  an error. Fewer is allowed. The count check runs with the other argument
  checks, before the exhibit directory is created, so a refusal leaves no
  half-made exhibit occupying the slug (today `add` makes the directory at
  `bin/exhibits:243-269` and only then loops over files).
- No automated jargon check. A regex cannot catch the real offenders ("one
  global card field, prominence: entry-point | primary | background") and
  would refuse an on-screen "Track A". The rule is judgment, kept in the doc.
- Root `AGENTS.md` "Record and show work" paragraph becomes: *"Show useful UI
  screenshot evidence as one labeled exhibit. Write its prose and captions by
  what a person sees in the app, not by plan or code names. Put the exhibit
  URL on the first line of the message that presents it; ask any question in
  chat. ..."* with the existing cull and permanent-app sentences kept.

**Vocabulary lock-ins.** `--caption`.

**First implementation chunk.** The doc section, `--caption`, and two CLI
doctest cases (caption pairing; too many captions refused with no directory
left behind).

### Track 3: the finished-session notification opens the exhibit

**What.** When a Stop notification's last message contains an exhibits URL,
the notification title says an exhibit is ready and a click opens that URL
in the browser instead of focusing the terminal tab.

**Why this needs to change.** The developer misses that an exhibit exists and
finds opening a link from terminal text annoying. The notification is the
surface they already act on.

**Direction.** In `~/.claude/hooks/notify.sh`, Stop branch:

```sh
EXHIBIT_URL=$(field '.last_assistant_message' \
  | grep -oE 'http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9._/-]+/?\?token=[A-Za-z0-9_-]+' | head -n 1)
if [ -n "$EXHIBIT_URL" ]; then
  TITLE="🖼 $LABEL — exhibit ready"
fi
```

and in the click branch:

```sh
*licked*)
  if [ -n "$EXHIBIT_URL" ]; then open "$EXHIBIT_URL"
  elif [ -n "$MY_TTY" ]; then "$HOME/.claude/hooks/focus-tab.sh" "/dev/$MY_TTY"; fi ;;
```

The match keys on `?token=`, which only `bin/exhibits` prints
(`bin/exhibits:156`), rather than on the port, because `EXHIBITS_PORT`
overrides the port (`bin/exhibits:35`). A tokenless exhibits URL (printed
only when the token file cannot be read, `bin/exhibits:157-160`) is not
matched and the click focuses the tab as today. The first URL in the message
wins, which is why Track 2 puts the URL on the first line. The URL is opened
as printed, token included, so a browser that has never seen the exhibits
origin still gets a page. This file is outside
git; the change is recorded here and in the developer's hook file only.

**Vocabulary lock-ins.** None.

**First implementation chunk.** The edit above, tested by hand: one `bin/exhibits
add` from this worktree, the URL on the first line of the final message, the
click opens the page.

### Track 4: a "Reply in the session" button on the page

**What.** The container shows one button under the title. Clicking it brings
the workstream's live terminal tab to the front, so the developer can type a
reaction where the agent is listening.

**Why this needs to change.** The developer answers in chat. After reading a
page with several figures, the next step today is finding the right tab among
many. The dashboard already has a Focus button per workstream; the exhibit
page is where the developer is when they want it.

**Direction.**

- The exhibits origin gains `POST /api/:ws/:exhibit/focus` (no body). The
  handler resolves `ws` as it does for any scope, then spawns
  `bin/workstreams focus <ws>` through the same runner the workstreams
  origin uses (`createActionCommandRunner`, moved or imported so both
  listeners share it). Stdout is ignored; a non-zero exit returns 409 with the
  CLI's last stderr line as `detail` ("no live session for <ws> — use
  resume").
- Committed apps (`apps/<name>`) and the `main` workstream have no registry
  row; the route returns 409 with that message and the button shows it.
- The container renders the button for store exhibits only, labeled
  "Reply in the session". On 409 it shows the detail inline, with a link to
  the dashboard's workstream list, where the row's Resume button lives
  (`WorkstreamActions.tsx:65-71`; the detail page has no actions).
- Raw `index.html` exhibits are served unchanged with no container
  (`app/handler.ts:143-148`), so they get no button. The doc says so; a raw
  page that wants one calls the route itself.
- This is a new, bounded authority on the exhibits origin. Today that origin
  holds none (`app/handler.ts:1-7`; `docs/exhibits.md`, "Access"). After this
  track it holds exactly one: bring any live workstream's terminal tab to the
  front. The `Origin` check (`app/auth.ts:85-109`) keeps other origins out; it
  does not tell a developer's click from a store page's own script, so an
  agent-written page can trigger a focus, for its own workstream or another
  named one. The worst effect is a terminal tab coming forward. It cannot
  resume, close, or archive a workstream, and the route takes no text. The
  doc's "Access" section states this grant. Granted by the boxholder, 2026-10-10.

**Vocabulary lock-ins.** Route name `focus`, matching the action verb.

**First implementation chunk.** The route with its doctest (a stub runner:
success, CLI failure with stderr detail, unknown workstream), the button,
and the container doctest case. Hand check: open a store exhibit from this
worktree, click, the tab comes forward.

### Track 5: exhibits on the workstream list and detail

**What.** Each workstream row on the dashboard lists its exhibits by title,
each a link to the page, newest first, with a link to the per-workstream
index on the exhibits origin. The workstream detail page shows the same list
with dates.

**Why this needs to change.** Today the only index of exhibits is the ask
queue, organized by question type. The developer thinks in workstreams; a
workstream's page should show what its agent has put up.

**Direction.**

- `ExhibitsService` (renamed from the queue's interface) gains
  `inventory(): Promise<ExhibitInventory>` with
  `{ origin, storeProblem, entries: ExhibitInventoryEntry[] }`, where an entry
  is `{ workstream, slug, path, title: string | null, created: string | null,
  problem: string | null }`. A broken manifest yields a row with null title
  and date and the parse problem, as the queue scan does today
  (`exhibits-queue-service.ts:46-66`). Committed apps are not included (they
  belong to no workstream).
- `workstreams.list` returns, per row, `exhibits: ExhibitInventoryEntry[]`
  sorted by `created` descending with broken rows last; the result's existing
  `warnings` list gains the inventory's `storeProblem` when set, so an
  unreadable store reads as a warning, not as zero exhibits everywhere.
  `workstreams.detail` returns the same rows for its name. The join is by
  directory name, as the issue join is today.
- `WorkstreamsPage` rows show the titles as links (slug and problem for a
  broken row), and one "all" link to the exhibits origin's index for the
  workstream; `WorkstreamDetailPage` gets an "Exhibits" section after Issues
  with title, date, and link per entry.
- Links to the exhibits origin carry no token, as the asks page's links did
  (`AsksPage.tsx:23-26`): the browser holds the cookie after one visit, and
  the 401 page names `bin/exhibits url`.
- A workstream with store content but no live worktree (an orphan) still has
  rows in the inventory, but the dashboard shows only registered or live
  workstreams, so orphan exhibits stay reachable only through the exhibits
  origin's own index and the sweep report. Accepted; it matches today.

**Vocabulary lock-ins.** `exhibits` as the row field; `inventory` as the
service method; `title` and `created` nullable on an inventory row.

**First implementation chunk.** The inventory service and its doctest
(renamed from the queue doctest), the two tRPC additions, and the two page
changes.

## Could this be simpler?

Simplest: Track 2's guidance alone, no code. It fails on the two stated
problems that are mechanical: the notification still focuses the terminal, so
the link-in-text delivery stays, and the queue keeps collecting unanswered
rows nobody clears. The developer named both as the problem.

Tracks 4 and 5 could be skipped: the dashboard's Focus button and the
exhibits origin's own per-workstream index exist. They fail on the stated
problem: the developer is on the page when they want the terminal, and in the
workstream list when they want to know what an agent showed. Each track reuses
the mechanism that exists (the focus CLI; the store scan) and adds one route or
one join.

Next simplest: Tracks 2 and 3, keep the ask as an optional label. This keeps
three concepts (ask type, disposition, queue) with zero use, and the `fyi`
type the design doc itself predicted would rot the queue. Removing beats
keeping, per the preference for fewer invented concepts.

What Track 1 does not do: it does not add an expiry or a cull. With no queue,
staleness has nothing to report against. The orphan report in `bin/workstreams
sweep` stays as the only lifecycle signal.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A legacy manifest has `ask` but no `prose`; the page shows no intro | Track 1 doctest: legacy manifest renders `ask.prose` | lift in `readManifest` | clear |
| A legacy manifest has `ask` with a `type` the new schema does not know | same doctest (`ask` is stripped, not validated) | strip | clear |
| An old agent session runs `bin/exhibits add --ask` after landing | CLI doctest: `--ask` is refused with the new message | yes | clear |
| A store page's `index.tsx` imports `DispositionForm` or `askTypeLabels` | none (store pages are untracked; the catch itself is untested) | the import-time catch in `boot.tsx:48-63` renders "This page failed to load" with the error | clear by reading the code, not verified |
| The final message has a tokenless exhibits URL (token file unreadable) | none | falls back to tab focus; the CLI already warned on stderr when it printed that URL | clear at creation, silent at click; accepted |
| The final message carries two exhibit URLs | none | first wins by rule | clear (Track 2 rule) |
| `open` is unavailable or the browser is closed | none | `open` launches the default browser; a failure exits silently in the detached subshell | silent, accepted: the terminal tab still has the URL |
| A `--caption` count exceeds the figure count | CLI doctest | error | clear |
| `bin/exhibits list --json` consumers read `answered` | searched: no reader in the repo besides the doctest | removed | clear (field absent) |
| A manifest in the store does not parse and no queue shows it | CLI doctest: `list` prints the row with `problem` and exits non-zero | yes | clear |
| Focus clicked for a workstream whose session ended; the registry tty is stale | route doctest with a failing runner | `bin/workstreams focus` checks `terminal_agent_on_tty` and exits 1 with a message; the page shows it | clear |
| Focus clicked from an `apps/` page or a `main` exhibit | route doctest | 409 before spawning | clear |
| Terminal.app is not the terminal (iTerm) | none | the CLI's AppleScript fails; the page shows "Terminal has no tab" | clear, accepted: same limit as the dashboard's Focus |
| The inventory scan hits a broken manifest | inventory doctest | row with null title and date and `problem`, sorted last; both pages show the slug and problem | clear |
| The store root is missing or unmarked | inventory doctest (kept from the queue doctest) | `storeProblem` becomes a `workstreams.list` warning | clear |
| Two workstreams share a store directory name with different case | none | the store rejects names outside the segment schema; the join is exact | clear |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. There is no type to pick. The
  only free text is `prose` and `caption`, governed by the doc rule.
- **Stale ref:** ADDRESSED. Exhibit directories are never deleted by this plan;
  URLs stay valid.
- **Two agents touching the same card:** not applicable; no shared writes.
  A double click on the focus button spawns two `bin/workstreams focus`
  runs; both focus the same tab.
- **Hand-edit drift:** ADDRESSED. A hand-written manifest with `ask` still
  renders through the lift; a manifest with neither `prose` nor `ask` renders
  figures only.
- **Fabricated free-form value:** ADDRESSED. Prose describes the visible
  page only; a claim about behavior belongs in chat, next to the evidence.
- **Validation error UX:** ADDRESSED. `--ask` and a caption overrun are
  refused before any directory is made, with a one-line reason.
- **Partial migration / transition state:** ADDRESSED. The lift makes the
  read side accept both shapes forever; the write side changes in one commit.
  A worktree branched before this lands still has the old CLI and writes
  `ask`; its exhibits render through the lift.

## NOT in scope

- **Reaching exhibits from the phone (Remote Control).** The exhibits origin
  is loopback only. Sending figures into the chat as files is a different
  change; offer to file it.
- **Expiring or culling old exhibits.** With no queue there is no waiting
  state; the orphan report in `bin/workstreams sweep` stays as is.
- **Recording decisions somewhere durable.** Decisions made in chat already go
  to plan docs and issues; no new record.
- **Changing the Codex-side notification path.** Codex sessions call the same
  `notify.sh`, so Track 3 covers them without a separate change.
- **Backfilling captions or prose on the 138 existing exhibits.** They stay as
  written.
- **A `--open` default at creation.** Considered; the developer chose the
  notification path instead (2026-10-10).
- **Typing a reply into the terminal from the page.** The focus button
  brings the tab forward; it never injects text. Sending keystrokes to a
  session is a different trust level.
- **Showing exhibits for orphan workstreams on the dashboard.** The dashboard
  lists workstreams, not store directories.

## Open design questions

None. Decided 2026-10-10 by the boxholder: the exhibits origin holds the
focus authority ("yeah, of course"); the old `decide` exhibits lose their
option labels ("not concerned about old exhibits now").
- Whether `bin/exhibits list` should drop rows whose workstream has no live
  worktree, or show the age. Lean: leave `list` as a plain inventory; the
  orphan report covers lifecycle.

## Knowledge audits

Skip: dev-repo tooling, not box-loaded guidance. The dev audit
(`knowledge-audit --dev`) could check that a session knows exhibits carry no
ask; run it once after landing if the suite is cheap, record the result in the
implemented plan.

## What will hold this after it ships

- Doctests already reach the manifest schema, the container, the CLI, the
  exhibits API, and the queue scan (which becomes the inventory). The focus
  route gets a doctest with a stubbed runner; `createActionsService` already
  takes `runCommand` as an injected dependency (`server/main/backend.ts:72`),
  so the stub is a function, not a mock of `spawn`. No existing doctest
  exercises the real runner; none is added. The legacy lift gets one case in `exhibits.api.doctest.md` or
  a new `store.doctest.md`; the CLI changes get cases in
  `bin/test/exhibits.cli.doctest.md`.
- Track 3 has no automated test; it is a 20-line edit to a personal hook,
  verified by hand once.

## Implementation order

1. Track 1, chunk 1: schema with lift, container without the form, CLI without
   `--ask`, doctests. Commit.
2. Track 1, chunk 2: remove the queue (service, route, page, nav, tests), move
   `DATA_DIR`, update `pages.ts`, docs. Commit.
3. Track 5: rename the queue service to the inventory, add the joins and
   the page sections. Commit. (Before Track 2, because it finishes the
   removal in `workstreams-app`.)
4. Track 4: the focus route, shared runner, button. Commit.
5. Track 2: doc section, `--caption`, CLI doctests, root `AGENTS.md`.
   Commit.
6. Move `workstream-exhibits.md` to `implemented-plans/`. Commit.
7. Track 3: edit `~/.claude/hooks/notify.sh` (outside git), verify by hand.
8. Cross-model review of the diff; adjudicate; report.

## Rollout shape

Done when: `pnpm --filter workstreams-app test` and the `bin/test` doctests
pass with no reference to `ask`, `disposition`, or `askQueue` left in
`workstreams-app/src` or `bin/exhibits`; one legacy exhibit from the store
renders with its old prose; one new exhibit created from this worktree renders
with captions; its "Reply in the session" button brings this worktree's tab
forward; the dashboard row for this workstream lists it by title; and a click on the
Stop notification opens that page. No data
migration: the store is read-compatible.
