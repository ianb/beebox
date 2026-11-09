---
title: "bbx view check renders card views with a card and waits for their data"
status: active
workstream: box-feedback-bugs
issues:
  - ../../../issues/closed/bugs/2026-11-09-view-check-passes-views-that-crash-after-load.md
---
# bbx view check renders card views with a card and waits for their data

`bbx view check` passes views that crash once their data loads or once they
get a real card path. This plan makes the check render each card-type view
with a real card as well as without one, and render each view a second time
in a DOM with effects run and `readFile` answered from the box, so a crash
after loading fails the check.

**Issues addressed:** `issues/closed/bugs/2026-11-09-view-check-passes-views-that-crash-after-load.md`.
Queue search (`bin/issues search "view check render effects card path"`) found
no duplicate. The agent-applied migrations plan's Open question 4 is the same
card-path gap (`docs/implemented-plans/agent-applied-migrations.md:483`:
*"Card-bound views render differently per `params.path`; checking only the
default passes unexercised branches (Critical gap)."*); it has no issue file.
Related, not addressed: `issues/features/2026-11-09-chat-links-that-set-an-open-views-state.md`.

## Design

No design section: this changes a developer-facing check that box agents run.
It changes no surface, card type, or record a person reads. The output line
format changes; the Direction below gives it.

## Smallest fix and budget

Smallest fix for the reported cases: (1) render each `rendersCardTypes` view
once more with `params.path` set to one card of each type; (2) a second
render in jsdom with effects run and `readFile` real. Both are needed: the
reported crash needed (2), and the planted-throw report needed (1).

Chosen design is that smallest fix plus a note line for a view that is still
loading at the end of the settle budget. One track.

Estimate: about 220 changed source lines (new `settle.ts` about 130, check
states about 40, command wiring and output about 50) and about 160 test lines.
Docs: about 20 lines in the views doc source. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Strictness by default (boxholder memory, "bias toward strict"): a settled
  render fails views that today pass. That is the point; a box whose views
  crash after load had a false green.
- Stop over-engineering rare failures (boxholder memory): no mocked-data
  states, no sampling of more than one card per type.
- `beebox/AGENTS.md` "no features beyond the task": declared test states are
  a proposal in Open questions, not built.

## What already exists

- `renderView` (`src/cli/commands/view/command.ts:127`) compiles for Node,
  loads cards, and renders once with `renderToString`. Reused: the settled
  render is added after it, in the same child.
- `buildProps` (`command.ts:74`) builds `ViewProps` with throwing async
  helpers. Reused for the first frame; the settled render overrides the
  helpers.
- `checkOneView` (`command.ts:216`) spawns `bbx view render-one` per view with
  a SIGKILL timeout, stdout ignored (`stdio: ["ignore", "ignore", "pipe"]`).
  Changed to read stdout for note lines.
- `listBoxCardFiles` (`src/core/list-cards.ts`) lists box cards. Reused to
  find a card of each type.
- `loadViewCards` (`src/core/views/cards.ts:61`) gives the `cards` prop.
  Reused unchanged.
- jsdom is a runtime dependency (`beebox/package.json`, `"jsdom": "^26.1.0"`
  under `dependencies`); happy-dom is dev-only. The settled render uses jsdom.
- `NodeViewHostProvider` (`beebox/view-widgets`) supplies widget context.
  The spike below rendered widgets through it with `react-dom/client`.

Spike (2026-11-09, worktree box clone, script not kept): jsdom globals,
`createRoot` from `react-dom/client`, `act`, an error boundary, and a real
`readFile`. A view that reads a file in `useEffect` and then reads a `const`
before its declaration failed with
`ReferenceError: Cannot access 'lines' before initialization`; `todos` and
`recipe` rendered; `recipe` without `params.path` rendered "This recipe card
is not available." and with a card path rendered the recipe.

## Prior art (external)

- React 18.3 exports `act` from `react`; `react-dom/test-utils` `act` prints a
  deprecation warning (seen in the spike). Adopted: import `act` from `react`.
- Error boundaries catch errors thrown in render and in effects, not in
  promise callbacks (React docs, "Catching rendering errors with an error
  boundary", https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary).
  A `setState` after load that leads to a throwing render is caught, which is
  the reported case. Evaluated only.

## Ontology

- **check state** (new): one set of inputs the check renders a view with:
  a label and `params`. Two kinds in v1: the default state (`params` empty,
  label `no card`) and a card state (`params.path` set to one card, label the
  card path). Not a `viewState` (`ViewTarget.viewState`, authored navigation
  state); not a persisted record.
- **first frame** (existing behavior, new name in output): the
  `renderToString` render.
- **settled render** (new): the DOM render with effects run until no helper
  call is pending, or the settle budget ends.
- **settle budget** (new): the time limit for the settled render of one
  state, 5 seconds, inside the per-view timeout (default 30 seconds,
  `command.ts:201`).
- **partial remark** (new): one reason a view that rendered was not fully
  checked, for example "still loading after 5.0s" or "1 write not performed".
  A view with any is **partly checked**, not failed and not `✓`.

## Tracks / scope

### Track 1: check states and the settled render

- **What.** `render-one` renders each check state twice: first frame, then
  settled render. Any thrown error fails the view and names the state and
  render.
- **Why.** The reported view passed the check and crashed when opened
  (issue text); card views pass on their "card not found" branch.
- **Direction.**
  - `checkStates({ rendersCardTypes, boxCardPaths, loads })` (`view/check-states.ts`):
    `[{ label: "no card", params: {} }]` plus, for each type in
    `rendersCardTypes`, the first box card of that type by sorted path that
    loads (`loadViewCards` on that one path, so a card that does not parse is
    not the sample): `{ label: <path>, params: { path: <path> } }`. A type with
    no card that loads is a partial remark.
  - `settledRender({ boxRoot, View, props, Host, budgetMs })` (`view/settle.ts`):
    installs jsdom globals once per process, renders inside an error boundary
    and `NodeViewHostProvider` with `createRoot`, steps `act` with a 10 ms
    tick until no helper call has been pending for 250 ms, or the budget ends.
    Then unmounts.
  - Budget. `render-one` takes the sweep's `--timeout`; each state's budget is
    the smaller of 5 seconds and its share of the time left (less a 2 second
    margin), so the states fit inside the per-view kill.
  - Helpers in the settled render: `readFile` reads through
    `resolveBoxNamespacePathOnDisk` in read mode, the policy for a view's
    dependency files (`src/core/views/cards.ts:85`), with the browser's HTTP
    byte-range meaning (`src/frontend/src/hooks/useViewFileHelpers.ts:131`:
    `end` inclusive, negative `start` a tail). `writeFile`, `appendFile` do
    not write and resolve a `ViewFile` for the path; a write makes the state
    partial. `commitFile` resolves `{ committed: false }`. `adapterFetch`
    rejects with an error that says the check does not call adapters.
  - An error left uncaught outside React (an unhandled rejection, a throw in
    a timer) is a console error in the browser. The settled render catches it
    at the process level and makes the state partial; it does not fail.
  - Output. A view that renders in every state but was not fully checked is
    **partly checked**: `~ <slug> (partly checked)` and one indented line per
    remark; it does not fail. The child prints remarks to stdout behind a
    fixed prefix (`bbx-view-check partial: `), so view output there is
    ignored. JSON gains `partial?: string[]`. A failure prints
    `✗ <slug>: View render failed [<state>, first frame|after effects]: <error>`.
  - The child calls `process.exit` after flushing stdout and stderr, so a
    view that leaves an interval running does not hold the child until the
    timeout.
- **Vocabulary lock-ins.** Output words `first frame`, `after effects`, and
  `partly checked`; JSON field `partial`.
- **First implementation chunk.** `check-states.ts` with its test, then
  `settle.ts` with a render-one test for the reported crash shape, then
  wiring and docs.

## Could this be simpler?

Simplest: label the pass "first frame only" and sample a card path, no DOM.
It fails the reported case: the crash is in code that runs only after data
loads, and the agent read a pass as "this view works". A label does not
catch that crash, and the issue asks for a check that does. The DOM render is
one module and uses a dependency already shipped.

Simpler still: one card state only, no default state. Card-type views are
also opened without a card (views list, `view:` links without a path), so the
default state stays.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| View throws after `readFile` resolves (reported case) | New render-one test | Error boundary records it; view fails naming state and render | Clear |
| Card view throws only with `params.path` | New render-one test | Card state renders it | Clear |
| A read still pending at the end of the budget | No (needs a slow read) | Partial remark "still loading" | Clear (`~`) |
| A read started more than 250 ms after the last one ended | No | Not seen; the render counts as settled | Silent; documented in the views doc as data not reached |
| View leaves an interval running after unmount | New test | Child exits explicitly | Clear |
| View writes on mount | New test | Write not performed; partial remark | Clear (`~`) |
| `readFile` path outside box content, not caught by the view | New test | Rejects; process-level handler makes a partial remark | Clear (`~`) |
| The first card of a type does not parse | Unit test | Next card that loads is the sample | Clear |
| Many card states and slow reads | No | Budgets share the per-view timeout | Clear (timeout names the view) |
| Widget needs a browser API jsdom lacks (canvas, ResizeObserver) | No | Throws, view fails with the error | Clear, but a false failure |
| Error in a promise callback that does not re-render (unhandled rejection) | No | Not a failure; the browser does not crash on it either | Silent, matches the app |

> Accepted risk: a widget that needs a browser API jsdom lacks makes the
> check fail a view that works. The error names the missing API. If it
> appears, add a stub for that API in `settle.ts`.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field: not applicable; no authored vocabulary.
- Stale ref: a card state names a card that is moved during the check; the
  view gets `params.path` for a missing card and renders its not-found branch.
  ADDRESSED: same as today's default state.
- Two agents touching the same card: the check does not write. ADDRESSED.
- Hand-edit drift: not applicable.
- Fabricated value: not applicable.
- Validation error UX: the failure line names the state and render, and the
  stack is source-mapped as today. ADDRESSED in Track 1 output.
- Transition state: a view that passed before can fail now. That is the
  intended change; the views doc says so.

## NOT in scope

- Declared test states (named states in the view module): a design for the
  boxholder; see Open questions.
- Mocked data and fake `adapterFetch` answers: needs declared states.
- More than one card per type: considered (q4 lean: capped sample); one per
  type finds the reported class at least cost.
- `bbx browser screenshot` of check states: depends on declared states.
- Checking views in `bbx view check` in parallel: unchanged sequential sweep.

## Open design questions

0. **Cross-model plan review (codex gpt-6-sol), adjudicated.** Accepted:
   no green result for an unfinished state (partly checked); a quiet window
   longer than two ticks; a sample card that loads; budgets inside the
   per-view timeout; the namespace policy and byte ranges of the app's
   `readFile`; a write makes the state partial; a prefixed stdout record.
   Rejected: drop the first frame for card states. The first frame is where a
   render-time helper call is reported, for any state. Open for the
   boxholder: whether **partly checked** should exit non-zero.

1. **Declared test states.** The boxholder compared this to a small
   Storybook. Lean: an optional named export in the view module,
   `export const checkStates = [{ name: "oxygen", path: "...", params: { select: "O" } }]`,
   read by the metadata import like `rendersCardTypes`. The check renders each
   one and reports per name; `bbx browser screenshot --card` could take
   `--state <name>`; chat links could name a state. Mocked data stays out
   until a view needs it. Needs the boxholder's decision before building.

## Knowledge audits

The views doc (`src/core/views/doc/core.ts`, "Testing a View") changes: the
check now runs effects and renders a card of each type. No new concept for an
agent to learn beyond reading the output; no audit.

## What will hold this after it ships

`command.render-one.test.ts` (spawns the built CLI against a temp box) gets
tests for each Failure-modes row marked "New". `check-states.ts` is pure and
gets a unit test. No new tier.

## Implementation order

1. `check-states.ts` and test.
2. `settle.ts`; wire into `renderView`; render-one tests.
3. `checkOneView` notes and output; check test.
4. Views doc and `bbx view check` help text.

## Rollout shape

Done when the render-one tests for the reported crash, the card-path crash,
the endless loader, the lingering interval, and the write-on-mount view pass,
and `bbx view check` passes on the worktree box clone. No data migration.
