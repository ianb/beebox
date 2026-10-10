---
title: "Exhibits rethink: show, do not ask"
status: draft
workstream: exhibits-rethink
issues: []
---
# Exhibits rethink: show, do not ask

An exhibit is a page an agent builds to show the developer rendered work:
labeled screenshots, a document, or a small interactive page. Today every
exhibit also carries an **ask** with an answer form, and the dashboard keeps a
queue of unanswered asks. This plan removes the ask, writes the rule for
phrasing an exhibit in terms the developer can read without the plan, and
makes the session-finished desktop notification open the exhibit page.

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
and find opening a link out of terminal text annoying. The ask prose is written
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

Authored docs: `workstreams-app/docs/exhibits.md` loses its ask sections
(about 90 lines) and gains the phrasing section (about 25); root `AGENTS.md`
and `.claude/skills/browse/SKILL.md` change one paragraph each. Not a BIG
CHANGE.

What the fuller version buys: the concept count drops by three (ask type,
disposition, ask queue), which removes the surface that rots, per the
boxholder preference for fewer invented concepts (memory
`minimal-concepts-prefer-primitives`). Track 3 puts the page one click from the
notification the developer already acts on.

## Stated preferences this plan trades against

- **The original design** ([workstream-exhibits](workstream-exhibits.md),
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
  anywhere after this lands. Accepted loss: no decision was ever recorded
  through those labels, and the choices that were made live in chat and in
  the plans. The boxholder confirms this in the review of this plan.
- `readManifest(dir, { requireAsk })` loses its option; `requireAsk` is threaded through `store.ts:154,181,235,252` and `app/handler.ts:86,131,248,261,289,303`.
- The container renders `prose` as a paragraph under the title, with no badge
  and no form. Instruments keep `EventLog`, `Storage`, `postCapture`.
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
  `exhibits-queue-service.ts`, `disposition.ts` (move `DATA_DIR` to
  `store.ts`), the nav link, the route, the tRPC procedure, the service
  method, the two queue doctests, and the ask scenarios in the CLI and
  container doctests.
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

## Could this be simpler?

Simplest: Track 2's guidance alone, no code. It fails on the two stated
problems that are mechanical: the notification still focuses the terminal, so
the link-in-text delivery stays, and the queue keeps collecting unanswered
rows nobody clears. The developer named both as the problem.

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
| A store page's `index.tsx` imports `DispositionForm` or `askTypeLabels` | none (store pages are untracked) | the import-time catch in `boot.tsx:48-63` renders "This page failed to load" with the error | clear |
| The final message has a tokenless exhibits URL (token file unreadable) | none | falls back to tab focus; the CLI already warned on stderr when it printed that URL | clear at creation, silent at click; accepted |
| The final message carries two exhibit URLs | none | first wins by rule | clear (Track 2 rule) |
| `open` is unavailable or the browser is closed | none | `open` launches the default browser; a failure exits silently in the detached subshell | silent, accepted: the terminal tab still has the URL |
| A `--caption` count exceeds the figure count | CLI doctest | error | clear |
| `bin/exhibits list --json` consumers read `answered` | searched: no reader in the repo besides the doctest | removed | clear (field absent) |
| A manifest in the store does not parse and no queue shows it | CLI doctest: `list` prints the row with `problem` and exits non-zero | yes | clear |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. There is no type to pick. The
  only free text is `prose` and `caption`, governed by the doc rule.
- **Stale ref:** ADDRESSED. Exhibit directories are never deleted by this plan;
  URLs stay valid.
- **Two agents touching the same card:** not applicable; no shared writes.
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

## Open design questions

- Whether `bin/exhibits list` should drop rows whose workstream has no live
  worktree, or show the age. Lean: leave `list` as a plain inventory; the
  orphan report covers lifecycle.

## Knowledge audits

Skip: dev-repo tooling, not box-loaded guidance. The dev audit
(`knowledge-audit --dev`) could check that a session knows exhibits carry no
ask; run it once after landing if the suite is cheap, record the result in the
implemented plan.

## What will hold this after it ships

- Doctests already reach the manifest schema, the container, the CLI, and the
  exhibits API. The legacy lift gets one case in `exhibits.api.doctest.md` or
  a new `store.doctest.md`; the CLI changes get cases in
  `bin/test/exhibits.cli.doctest.md`.
- Track 3 has no automated test; it is a 20-line edit to a personal hook,
  verified by hand once.

## Implementation order

1. Track 1, chunk 1: schema with lift, container without the form, CLI without
   `--ask`, doctests. Commit.
2. Track 1, chunk 2: remove the queue (service, route, page, nav, tests), move
   `DATA_DIR`, update `pages.ts`, docs. Commit.
3. Track 2: doc section, `--caption`, CLI doctests, root `AGENTS.md`.
   Commit.
4. Move `workstream-exhibits.md` to `implemented-plans/`. Commit.
5. Track 3: edit `~/.claude/hooks/notify.sh` (outside git), verify by hand.
6. Cross-model review of the diff; adjudicate; report.

## Rollout shape

Done when: `pnpm --filter workstreams-app test` and the `bin/test` doctests
pass with no reference to `ask`, `disposition`, or `askQueue` left in
`workstreams-app/src` or `bin/exhibits`; one legacy exhibit from the store
renders with its old prose; one new exhibit created from this worktree renders
with captions; and a click on the Stop notification opens that page. No data
migration: the store is read-compatible.
