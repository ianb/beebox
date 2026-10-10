---
title: "Comments on exhibit pages, typed or spoken"
status: active
workstream: exhibits-rethink
issues: []
---
# Comments on exhibit pages, typed or spoken

A person reading an exhibit selects some text, or nothing, and leaves a remark,
typed or dictated. The remark goes to the same comment store that holds document
comments, addressed to the exhibit's workstream, so the agent finds it with the
`bin/comments list --workstream <name>` call it already makes at pickup.

**Issues addressed:** none. The queue was searched for `exhibit`, `comment`,
`voice`, `dictat`, and `transcri`. Two adjacent items exist and neither is
resolved here: `issues/features/2026-08-22-orphaned-comment-namespaces-after-a-cull.md`
(orphans in the comment store; the new namespace inherits the same posture, see
Failure modes) and `issues/exploration/2026-08-19-independent-origin-for-dev-surfaces.md`
(why exhibits are on their own origin; unchanged here).

## Design

No design section: this is dev tooling on the boxholder's machine, not a box
surface. The boxholder's stated wants are the specification:

- *"I'd like commenting. And voice."*
- *"It doesn't have to be super high fidelity … Not as robust necessarily as
  the live app."*
- *"Commenting could capture the text and nearest/previous header."*
- *"If you can reuse components from beebox also that's cool."*

## Smallest fix and budget

**Smallest fix.** A textarea on the exhibit page that posts the whole text as a
comment on the exhibit, no selection, no voice. About 80 source lines. It fails
the stated want on both counts (text capture, voice).

**Chosen design.** Four tracks: the store namespace and CLI address, the two
exhibits-origin routes, the page panel, and docs. Estimated changed lines
(additions plus deletions):

| Part | Source | Tests |
|---|---|---|
| Track 1: store namespace, `bin/comments` address, service `add` target | 120 | 80 |
| Track 2: exhibits-origin comment and transcribe routes | 110 | 110 |
| Track 3: page panel (toggle, composer, Speak, saved state), heading lookup, recorder fix | 220 | 80 |
| Track 4: docs | 0 | 0 |
| **Total** | **450** | **270** |

Authored docs: about 60 lines across three files. No generated output. Not a
BIG CHANGE.

What the fuller design buys over the smallest fix: the remark arrives with the
quoted text and the heading it sits under, so the agent knows which claim it is
about (the plan's job to be done in `document-comments.md`), and it can be
spoken, which the boxholder asked for because they are reading, not typing.

The first draft also had the page list and remove existing comments (a GET and
a DELETE route, a waiting list, a Remove button). The cross-model review (codex
gpt-6-sol, 2026-10-10) pointed out that comments are consumed and cleared by
the agent, so a second management surface exceeds the stated job. Cut: the
page saves and confirms; `bin/comments` reads and clears.

## Stated preferences this plan trades against

- `beebox/docs/engineering-principles.md` **8** (one way to do each thing):
  exhibit comments go into the existing comment store and come out through the
  existing `bin/comments`, rather than a second store under the exhibit
  directory and a second read verb. Cost: the store gains a third namespace.
- **3** (validate at boundaries): the exhibits route validates the scope
  segments before anything else, and the store validates the exhibit address
  before it touches disk.
- **13** (a control shows the state the system is in): the Speak button is
  disabled with the reason when the recorder is unavailable; after a save the
  panel says where the comment went and who reads it; the route's error text
  is shown rather than a generic failure.
- `AGENTS.md` root, "Minimize invented concepts" (memory
  `feedback_minimal_concepts_prefer_primitives`): the address form
  `exhibit:<ws>/<name>` is one new spelling, used identically by `list`,
  `show`, `clear`, and `add`. No new CLI verb, no new flag.
- Precedent: the focus route in `workstreams-app/src/server/exhibits/app/api.ts:283-298`
  (injected runner, 204 or 409 with `{message, detail}`; refuses reserved
  scopes before touching the store) and the `ReplyInSessionButton` in
  `workstreams-app/src/frontend/exhibits/boot/Container.tsx:63-97` (plain
  `fetch`, no tRPC). Both are reused as the shape here.
- `workstreams-app/src/server/main/transcribe-openai.ts:11-18` argues against
  widening what this app imports from beebox. Honored: nothing new is imported
  from beebox. The boxholder's "reuse components from beebox" is answered with
  the workstreams-app recorder and anchor helpers, which already exist and have
  no dependencies; beebox's voice stack is realtime, xstate-based, and tied to
  the box (see What already exists).

## What already exists

| Need | Exists at | Decision |
|---|---|---|
| Short dictation recorder | `workstreams-app/src/frontend/lib/recorder.ts` — `startRecording(maxBytes)` returns `{ stop(): Promise<Recording>, cancel() }`; `recorderAvailability()`; no imports | **Reuse**, with one fix: if the `MediaRecorder` constructor throws (:82) the stream from `getUserMedia` (:79) is never released. Wrap and release. |
| Selection capture with quoted text and a heading | `workstreams-app/src/frontend/lib/selection-anchor.ts:71-96` — `captureSelection(root)`; `sectionFor` (:53-64) | **Reuse, with one change.** `sectionFor` walks previous *siblings* up the ancestor chain, so a heading that is not a sibling of any ancestor is missed: in the exhibit page the title is in `<header>` and figures in `<main>`, and a `<figcaption>` under `<figure>` under a heading's `<section>` sibling has no heading in its chain. Change it to the nearest heading that precedes the selection in document order within `root`. The dashboard's browse page gets the same improvement. |
| Transcription | `workstreams-app/src/server/main/transcribe-openai.ts` — `createTranscribeService()`, whisper-1, `BBX_OPENAI_API_KEY`; `createFakeTranscribeService(text)` for tests; contract and `MAX_AUDIO_BYTES = 700_000` in `src/server/transcribe-contract.ts` | **Reuse**; inject into the exhibits app the way `runFocus` is injected (`backend.ts:54`) |
| Comment store with locking, marker, containment | `bin/lib/comments-store.ts` — `Subject` (:97-99), `subjectKey` (:145-154), `subjectFromStorePath` (:410-428) | **Extend** with a third scope |
| CLI the agent already runs at pickup | `bin/comments.ts` — `subjectsFor` (:132-143), `toRepoRelative` (:106-114) | **Extend** with the `exhibit:` address |
| Server side comments service (subprocess to `bin/comments`) | `workstreams-app/src/server/comments-service.ts` — `cliEntrySchema` scope enum (:25-30), `add` (:102-116), `waiting` (:97-101) | **Extend** `add` with an exhibit target; `waiting` keeps its `relPath` row contract and skips exhibit subjects (its only consumer is the dashboard's tRPC `waiting`, whose output schema requires `relPath`, `comments-router.ts:53`) |
| Composer UI with Speak | `workstreams-app/src/frontend/components/CommentLayer.tsx:36-130` | **Rebuild** the small composer in the exhibits bundle. Reason: it calls `trpc.comments.*` against `/workstreams/api/trpc` on the dashboard origin, which the exhibits cookie cannot reach (`exhibits/app/auth.ts:9-10`), and it uses `.button`/`.pill`/`.comment-*` classes that live only in the dashboard stylesheet. The logic is copied, the component is not. |
| Exhibits-origin mutating route with Origin check | `exhibits/app/api.ts` focus route (:283-298); `originAllowed` in `auth.ts:42,103` | **Reuse the shape**; new routes in the same plugin inherit the auth |
| beebox voice | `beebox/src/frontend/src/hooks/useRealtimeTranscription/hook.ts`, `lib/audio/recorder.ts` (`ChunkedRecorder`, 20 s chunks) | **Not reused**: realtime pipeline on xstate with mic-tab locks and earcons; workstreams-app has no xstate dependency and the exhibits bundle needs a 10-second dictation, not a live transcript |
| beebox `data-bbx-source` tagging | `beebox/src/frontend/src/lib/source-tag.ts` | **Not needed**: the capture here is by selection inside one known root, so no per-element provenance tag is required |

## Prior art (external)

No design decision depends on an external premise. The text-fragment
polyfill is already in use (`selection-anchor.ts`), and the Whisper API is
already in use (`transcribe-openai.ts`). Nothing adopted; no ACKNOWLEDGEMENTS
entry.

## Ontology

- **Exhibit** (exists): a directory `<store>/<workstream>/<name>/` with
  `exhibit.json` (`workstreams-app/src/shared/exhibits.ts`). Identified by
  `<workstream>/<name>`. NOT an app under `apps/`.
- **Scope** (exists, `api.ts` `scopeDir`): the `<workstream>/<name>` or
  `apps/<name>` pair a route operates on.
- **Comment** (exists, `bin/lib/comments-store.ts:70-85`): `id, at, origin,
  body, quoted?, section?, fragment?, workstream, worktree`. Unchanged. For an
  exhibit comment, `workstream` is the exhibit's first scope segment, `main`
  included: `bin/comments list --workstream main` is how a main-checkout
  session reads them, and the route and panel say so. `worktree` is the
  checkout the exhibits listener runs from, which is what the CLI records for
  any `add`.
- **Subject** (exists, extended): which namespace a comments file lives in.
  Gains `{ scope: "exhibit"; workstream: string; exhibit: string }`. NOT a
  repo path. Its store key is `exhibit/<workstream>/<exhibit>.comments.yaml`.
- **Exhibit address** (new spelling, not a new noun): `exhibit:<workstream>/<name>`,
  the string `bin/comments` prints for an exhibit subject and accepts wherever
  it accepts a path. The workstream segment obeys `validWorktreeName`
  (`/^[a-zA-Z0-9_-]+$/`); the exhibit segment obeys the exhibits' own rule
  (`exhibitSegmentSchema`, `workstreams-app/src/shared/exhibits.ts:65-69`:
  letters, digits, `.`, `_`, `-`, starting with a letter or digit), because
  exhibit names may contain a dot and `bin/exhibits add` already accepts them.
- **Comment panel** (new, page-side): the container's commenting control on
  default and `index.tsx` tier pages. NOT present on `index.html` pages
  (served raw, `handler.ts:145-150`) and NOT present on `apps/` pages (no
  workstream to route to).

## Tracks / scope

### Track 1 — Exhibit subjects in the comment store and CLI

**What.** The store, the CLI, and the service's `add` learn a third subject
scope.

**Why.** `assertRelPath` refuses absolute paths and `toRepoRelative` leaves a
path outside the checkout as is, so an exhibit directory has no subject today
(`bin/comments.ts:106-114`, `comments-store.ts:130-142`).

**Direction.**

- `Subject` gains `{ scope: "exhibit"; workstream: string; exhibit: string }`.
  `subjectKey` validates the workstream with `validWorktreeName`, the exhibit
  name with a copy of the exhibit segment rule (the store imports nothing from
  workstreams-app; the rule is one regex), and returns
  `path.join("exhibit", workstream, `${exhibit}${COMMENTS_SUFFIX}`)`. A new
  refusal kind `bad-exhibit-name` joins `CommentPathRefusal`.
  `subjectFromStorePath` decodes `exhibit/<ws>/<name>.comments.yaml` with
  exactly three segments and round-trips it like the others.
- `bin/comments.ts`: a `parseExhibitAddress(input): {workstream, exhibit} | null`
  that matches `/^exhibit:([^/]+)\/([^/]+)$/u`. `subjectsFor` returns the single
  exhibit subject when the address parses; the tracked/worktree pair otherwise.
  `describeSubject` prints `exhibit:<ws>/<name>`. `add` without `--workstream`
  defaults to the address's workstream for an exhibit subject.
- `comments-service.ts`: `cliEntrySchema.subject` becomes a discriminated
  union over the three scopes. `add` takes
  `target: { relPath: string; worktree: string | null } | { exhibit: { workstream: string; exhibit: string } }`
  and passes the path or the `exhibit:` address to the CLI; its one existing
  caller (`comments-router.ts` `add`) passes the path form. `waiting` keeps
  returning `{ relPath, comments }` rows and skips exhibit subjects.
  `forDocument` and `clear` are unchanged.
- `src/shared/comments.ts`: no change; the comment record is unchanged.

**Vocabulary lock-ins.** `scope: "exhibit"`, store directory `exhibit/`,
address prefix `exhibit:`, refusal kind `bad-exhibit-name`.

**First implementation chunk.** Store and CLI with doctests in
`bin/test/lib/comments-store.doctest.md` (key round-trip, bad workstream
segment refused, a dotted exhibit name accepted, `.hidden` refused, a hand-made
`exhibit/x.comments.yaml` with two segments reports as malformed) and a CLI
doctest `bin/test/comments-exhibit.doctest.md` (`add exhibit:ws/name --body …`
defaults the workstream, `list --workstream ws` shows it, `show`, `clear`, bad
address refused with exit 1).

### Track 2 — Comment and transcribe routes on the exhibits origin

**What.** Two routes in `exhibitsApiPlugin`, beside focus:

- `POST /api/:ws/:exhibit/comments` body `{ body, origin, quoted?, section?, fragment? }` → `201 { id, workstream }`
- `POST /api/transcribe` body `transcribeInputSchema` → `200 { text }`

**Why.** The page cannot reach the dashboard's tRPC (different origin, different
credential), and the exhibits listener has no transcription service wired in
(`backend.ts:84` wires it only into the main app).

**Direction.**

- `buildExhibitsApp` gains two injected services beside `runFocus`:
  `comments: Pick<CommentsService, "add">` and `transcribe: TranscribeService`.
  `backend.ts` passes `createCommentsService({ repoRoot })` and the same
  `createTranscribeService()` instance the main app uses. Tests pass fakes.
- The comment route, in order: `requireSegment` on both params (400), refuse
  `apps` with `409 { message: "Apps have no workstream to send a comment to." }`
  before any store access (so `scopeDir`'s create-on-first-write for apps
  cannot leave a directory behind), then `scopeDir` (404 when the exhibit does
  not exist), then the write. `workstream` is `:ws`, `main` included.
- POST validates with a Zod schema reusing the field limits from
  `comments-router.ts:65-84` (body 1–10k, quoted ≤10k, section ≤500, fragment
  ≤4096), and maps `CommentsCliError` to `409 { message, detail }` like the
  focus route does for its runner.
- `/api/transcribe` is registered on the json plugin. Its body limit is the
  existing `DOCUMENT_BODY_LIMIT` (1 MiB), which covers base64 of
  `MAX_AUDIO_BYTES` (4/3 of 700 kB is 933 kB); the route still enforces
  `MAX_AUDIO_BYTES` on the decoded size and answers 413 as the tRPC route does.
  It maps `TranscriptionNotConfiguredError` to 412 and the refused and shape
  errors to 502, with the error message as `{ error }` through the plugin's
  existing error handler.
- Mutating methods already require a same-origin `Origin` header (`auth.ts`).
  Nothing new.
- The not-found handler's route list gains the two routes.

**Vocabulary lock-ins.** Route paths above.

**First implementation chunk.** Routes plus doctests in
`workstreams-app/test/server/exhibits.api.doctest.md`: 201 with the fake
service called with the exhibit target and `workstream: demo-ws`; `main`
routes `main`; `apps` 409 and no directory created; bad segment 400; missing
exhibit 404; CLI failure 409 with detail; transcribe happy path with the fake
service, oversize 413, not-configured 412.

### Track 3 — The comment panel in the container

**What.** A "Comment" toggle in the container header next to "Reply in the
session". When on: selecting text inside the document opens a composer with
the quoted text and the heading above it; a "Comment on the whole exhibit"
control opens it with no anchor. The composer has a textarea, Speak, Comment,
and Cancel. After a save it shows "Saved for <workstream>. The agent reads it
with bin/comments at its next pickup." and closes.

**Why.** This is the want. The toggle is the precedent from
`CommentLayer.tsx:144` and `SourceViewOverlay.tsx`: selection is normal
reading behaviour and must not open a composer unless asked.

**Direction.**

- New `workstreams-app/src/frontend/exhibits/boot/CommentPanel.tsx`, imported
  by `Container.tsx`. Props: `scope`, `contentRef` (a ref to the element that
  wraps the prose and the page). Mounted only when the scope does not start
  with `apps/`, beside the existing button condition.
- Capture: on `mouseup` inside `contentRef` while on and no draft is open,
  `captureSelection(contentRef.current)`; a null result (collapsed selection)
  does nothing.
- Submit: `fetch(`/api/${scope}/comments`, { method: "POST", body: JSON })`.
  Speak: `startRecording(MAX_AUDIO_BYTES)`; on stop, `fetch("/api/transcribe")`
  and append the text to the textarea, origin `voice`.
- Mic release: a `mounted`/`wanted` ref. The composer's unmount effect cancels
  a live session, and the `startRecording` promise handler cancels the session
  immediately when it resolves after the composer was closed (the permission
  prompt can outlive the composer; `CommentLayer.tsx:59` does not cover that).
- Pure decisions in `boot/comment-requests.ts`: the POST body from an anchor,
  a body, and an origin (optional fields omitted, never `undefined`); the
  user-facing message from a failed response (`{message, detail}`, `{error}`,
  or the status line, the same rule `refusalDetail` in `Container.tsx` applies,
  moved there and shared); the transcript append rule (empty body takes the
  text, otherwise a space joins); the saved message from the 201 body.
- Styling: Tailwind utilities, matching the existing header. No
  `.button`/`.pill` classes, no highlight rule.
- `selection-anchor.ts` `sectionFor`: nearest preceding heading in document
  order within `root` (`root.querySelectorAll("h1,h2,h3,h4,h5,h6")`, last one
  that `compareDocumentPosition` places before the range start). The exhibit
  title `<h1>` is inside `contentRef`, so a selection with no nearer heading
  reports the exhibit title.
- `recorder.ts`: release the stream if `new MediaRecorder` throws.

**Vocabulary lock-ins.** None beyond the routes.

**First implementation chunk.** The component plus
`workstreams-app/test/frontend/exhibits/boot.comment-requests.doctest.md` for
the pure functions; the static render in `boot.container.doctest.md` shows the
toggle for a store scope and not for `apps/`. There is no DOM
implementation available to this package's tests (`linkedom` is declared only
by `canvas-loop`), so the heading lookup and the click path are checked by hand
(see What will hold this).

### Track 4 — Docs

`workstreams-app/docs/exhibits.md` gains a "Comments" section (how to read
them: `bin/comments list --workstream <ws>`, address form, which tiers show
the control and that `index.html` pages do not). `bin/AGENTS.md`'s
document-comments section notes the `exhibit:` address. The exhibits-rethink
plan's status section links here.

## Could this be simpler?

**Simplest version:** a comments file inside the exhibit directory
(`<exhibit>/comments.yaml`), written by the exhibits listener directly, read
by `bin/exhibits comments <ws>/<name>`. No store change, no CLI change, about
half of Track 1 saved.

**What the fuller plan buys:** the agent's pickup step is one call,
`bin/comments list --workstream`, which root `AGENTS.md` already instructs. A
second file and a second verb would be a second thing to remember, and the
boxholder's own evidence is that remarks that are not surfaced in the agent's
path get missed (the 133 unanswered exhibit asks that started the parent
plan). Principle 8.

**Cut after review:** reading and removing comments from the page (see Smallest
fix and budget).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Address segment is not a valid name (`exhibit:a/b/c`, `exhibit:../x/y`, `exhibit:ws/.hidden`) | Track 1 doctest | segment rules in `subjectKey`, `InvalidCommentPathError` | Clear: CLI prints the reason, route returns 400 before the CLI runs |
| Hand-made `exhibit/<ws>.comments.yaml` (two segments) in the store | Track 1 doctest | `subjectFromStorePath` returns null → listed as unreadable entry | Clear |
| `bin/comments` fails under the route (store marker missing, lock timeout) | Track 2 doctest | `CommentsCliError` → 409 `{message, detail}` | Clear: panel shows detail |
| Comment on `apps/<name>` | Track 2 doctest, asserts no directory | 409 before any store access | Clear |
| Comment on a `main/<name>` exhibit | Track 2 doctest | routed to `main`; the saved message names it | Clear: the reader runs `bin/comments list --workstream main` |
| Transcribe without `BBX_OPENAI_API_KEY` | Track 2 doctest | 412 with the service's message | Clear: shown under the textarea, text can still be typed |
| Recording exceeds the cap | existing recorder stops at the cap; route 413 | yes | Clear |
| Mic permission denied | none (browser prompt) | `startRecording` throws → shown as `recordingProblem` | Clear |
| Composer closed while the permission prompt is open | none (browser prompt) | late-resolve cancel in Track 3 | Clear by the indicator light going off |
| `MediaRecorder` constructor throws | none (browser) | stream released, error shown | Clear |
| Selection has no preceding heading | hand check (no DOM tier) | `section` omitted; quoted text intact | Silent by design |
| Selection spans outside the content root | `captureSelection` returns null | yes | Silent by design: nothing to comment on |
| Comment left on an exhibit whose workstream is later culled | none | same as the orphan issue: the store keeps it, `list` shows it | Silent until read; accepted, filed already |
| Exhibit page served by the main-checkout app while a worktree's listener has the new routes | none | the old frame has no panel; nothing posts | Silent, transition only, ends at merge |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED: the only authoring surface is the
  panel; the route fixes `workstream` from the scope and the CLI fixes it from
  the address.
- **Stale ref** — ADDRESSED: the exhibit is a directory that survives culls;
  a comment on a deleted exhibit stays listed with its address, and
  `bin/comments clear exhibit:ws/name` removes it.
- **Two agents touching the same card** — not applicable: the store uses
  `withFileLock` per file (`comments-store.ts:49`).
- **Hand-edit drift** — ADDRESSED: a malformed store file is reported, not
  thrown on, by the existing `subject: null` path.
- **Fabricated free-form value** — not applicable: the boxholder writes the body.
- **Validation error UX** — ADDRESSED: route messages are sentences and the
  panel shows them verbatim.
- **Partial migration / transition state** — ADDRESSED in Failure modes: no
  data shape changes; the old frame simply lacks the control until merge.

## NOT in scope

- **Comments on `index.html` tier pages.** The container is not rendered
  there, so a raw page shows no control and gives no hint. The review flagged
  this as a decision for the boxholder; the plan proceeds with the two
  container tiers, which is every page `bin/exhibits add` creates, and the
  docs state the gap.
- **Comments on `apps/` pages.** No workstream to route to; refused with a
  reason.
- **Reading or removing comments from the page.** The agent reads and clears
  with `bin/comments`; a mistaken comment is one `bin/comments clear --id`.
- **Highlighting existing comments on the page.** Follows from the above.
- **Clicking a figure to comment on the image.** Captions are text and
  selectable; that covers the figures the parent plan added.
- **Dashboard rendering of exhibit comments.** `waiting` keeps its path rows.
- **Phone or tailnet access.** The exhibits origin is loopback; the mic needs a
  secure context, which loopback is.
- **Comments on the exhibits list pages.** Server-rendered, no bundle.

## Open design questions

None inside the chunks. One lean recorded: the Comment toggle is a header
button, not a keyboard shortcut, because an exhibit page is often opened from a
notification and read with the mouse.

## Knowledge audits

Skipped: dev tooling on the boxholder's machine, no box-agent-facing concept.
The agent-facing part is the existing `bin/comments list` call, already
documented in root `AGENTS.md`.

## What will hold this after it ships

- Store and CLI: the existing `bin/test/lib/comments-store.doctest.md` tier,
  which runs the store in a temp root, plus a CLI doctest in `bin/test/`
  running `bin/comments` against a temp `BBX_COMMENTS_ROOT`. Cheap.
- Routes: `workstreams-app/test/server/exhibits.api.doctest.md`, which already
  boots the exhibits app with an injected focus runner; the comments and
  transcribe services are injected the same way. No new tier, no new mock
  style: the fake transcribe service exists, and the comments fake is a
  recording `add` behind the `Pick<CommentsService, "add">` interface.
- Panel: the pure request and message functions in their own doctest; the
  static render in `boot.container.doctest.md`. No DOM tier is added: the
  heading lookup and the event wiring are a few lines each, and the hand check
  exercises them.
- The whole path by hand once: a standalone listener with
  `BBX_EXHIBITS_ROOT` and `BBX_COMMENTS_ROOT` pointed at temp roots, a typed
  comment and a spoken one, then `bin/comments list --workstream`.

## Implementation order

1. Track 1 (store, CLI, service). One commit.
2. Track 2 (routes, injection in `backend.ts`). One commit. Depends on 1.
3. Track 3 (panel, heading lookup, recorder fix). One commit. Depends on 2.
4. Track 4 (docs) plus the hand check. One commit.
5. Cross-model diff review; fixes.

All on `worktree-exhibits-rethink`, on top of the parent plan, because the
panel lives in the container that plan rewrote. Both ship together.

## Rollout shape

Done when the doctests named per track pass, the existing suites stay green
(workstreams-app tap and node, bin doctests, lint, typecheck, doc-check), and
the hand check produces one spoken comment visible in `bin/comments list`.
No migration: the store gains a directory, existing files are untouched.

## Review record

- Plan review round 1 (codex gpt-6-sol, 2026-10-10,
  `scratch/cross-model/2026-10-10T22-47-08-209Z-codex.md`): eight findings.
  Adopted: route `main` comments to `main` and say so (1); document-order
  heading lookup (2); exhibit segment rule in the store (3, found independently
  before the review); `waiting` keeps its row contract (4); cut GET, DELETE,
  list, and Remove (5); late-resolve mic cancel and recorder release (7);
  refuse `apps` before any store access (8). Left to the boxholder: raw
  `index.html` pages get no control (6).
- Diff review round 1 (codex gpt-6-sol, 2026-10-10,
  `scratch/cross-model/2026-10-10T23-14-19-647Z-codex.md`): three findings,
  all applied in commit 9debbc05e: a second Speak click while the permission
  prompt is open could start a second microphone (guarded with a starting
  state); the recorder released the track only on Stop or Cancel, so a
  recording that hit the byte cap left the indicator on until Stop (the stop
  handler is installed before recording starts, and `start()` failures
  release too); an explicit empty `--workstream` on an exhibit address was
  turned into the exhibit's workstream (absent defaults, empty means unrouted).
  The reviewer's other traces (dotted name round trip, omitted origin, selection
  inside a heading, Cancel during a pending prompt) found no discrepancy.

## Implementation status

Implemented in the exhibits-rethink worktree, 2026-10-10, all four tracks, on
top of the parent plan. Hand check against a standalone listener with a temp
comment store: commenting on, a selection in a figure caption opened the
composer quoting the caption under the page title (the nearest heading above
it in document order), the typed remark came back from
`bin/comments list --workstream exhibits-rethink` with that quote and heading,
and `POST /api/transcribe` returned the sentence from a synthesized WAV through
the real transcription service. The Speak button's browser path (microphone
permission, MediaRecorder) was not exercised: no microphone in the check.
Not merged.
