---
title: "Views declare named check states"
status: implemented
workstream: box-feedback-bugs
issues:
  - ../../../issues/closed/features/2026-11-09-views-declare-named-check-states.md
---
# Views declare named check states

A view module may export `checkStates`, a list of named inputs (a card path
and view parameters). `bbx view check` renders each one as well as its
automatic states and names it in a failure, and `bbx view states <slug>`
prints the page path that opens each one, for `bbx browser open` and
`screenshot --card`.

**Issues addressed:** `issues/features/2026-11-09-views-declare-named-check-states.md`.
`bin/issues search "check states"` and `"view state"` found one related item,
not addressed: `issues/features/2026-11-09-chat-links-that-set-an-open-views-state.md`
(a chat link could later name a state; see NOT in scope).

## Design

No design section: the surface is a box-agent authoring convention and two CLI
outputs. No card type, page, or record a person reads changes. The boxholder
approved the issue's proposal ("sounds good, make it happen", 2026-11-09) and
earlier preferred the cheap form: card path and parameters only.

## Smallest fix and budget

Smallest fix: read the export and add each declared state to the list
`render-one` already loops over (`src/cli/commands/view/render-one.ts:158`:
*"for (const [index, current] of states.entries())"*). That alone gives the
check. `bbx view states` is the second, small part; it gives screenshots a
URL without a new browser flag.

Estimate: source about 150 changed lines (meta schema and runner, ViewMeta
default, check-states, render-one, a `states` subcommand); tests about 150;
authored docs about 30. Not a BIG CHANGE.

## Stated preferences this plan trades against

- Minimal concepts (boxholder memory, "prefer primitives"): a state is a
  card path plus the view's existing `params`; no new prop, no fake data.
- Partly checked does not fail (boxholder, 2026-11-09: *"failing on
  incomplete probably is incorrect I guess, just because it'll wedge
  things"*). A declared state whose card is gone is reported partly checked,
  not failed: cards move and are archived, and that must not wedge the check.
- Bias toward strict: a malformed `checkStates` export (bad name, duplicate
  name, wrong shape) is a validation error for the view, as a bad `layout` is.

## What already exists

- Metadata exports: `src/webapp/views/compiler/meta-import.ts` runner copies
  `rendersCardTypes` (*"if (Array.isArray(mod.rendersCardTypes)) out.rendersCardTypes = mod.rendersCardTypes;"*)
  and validates with `importedViewMetaSchema`. `layout` is passed through
  whatever its type *"so the schema rejects a bad value"*. Reuse: `checkStates`
  passes through the same way.
- `ViewMeta` (`src/core/views/types.ts:135`) and its defaults in
  `src/webapp/views/compiler/compile.ts:315` and `:354`. Reuse.
- Check states: `src/cli/commands/view/check-states.ts` `checkStates({rendersCardTypes, boxCardPaths, loads})`
  returns `{ states, untested }`; a `CheckState` is `{ label, params }`. Extend
  it; rename the function `statesToCheck` so the export name is not shared.
- The per-state render loop and failure line `View render failed [<label>, <stage>]`
  in `render-one.ts:173`. Reuse; a declared state's label is its name.
- View page URLs: the `/views/$` route parses `<path>?<query>` with
  `parseViewUrl` (`src/frontend/src/main/router.tsx:235`); `view` is the
  viewer override and other keys are `params`
  (`src/frontend/src/lib/view-url.ts`, *"Reserved query keys — never passthrough `params`"*).
  Reuse: a state's page path is `/views/<path>?<params>` (see Ontology).
- `bbx browser screenshot --card` captures the open card
  (`src/core/browser/card-shot/run.ts`). Unchanged.

## Prior art (external)

Storybook "stories" (named component inputs, rendered per name) is the model
the boxholder named. Evaluated only; nothing copied. No decision depends on an
external premise.

## Ontology

- **Check state** (exists, `check-states.ts` `CheckState`): one set of inputs
  the check renders a view with; `label` names it in output.
- **Declared state** (new, `DeclaredCheckState` in `src/core/views/types.ts`):
  an entry of the view's `checkStates` export. Identified by `name` within its
  view. Has `path` (required: the card the view opens on, given to it as
  `params.path`; every view attaches to a card type, per `bbx view lint`) and
  `params?` (other view parameters). It is NOT `viewState` (authored
  navigation state) and carries no data.
- **Automatic state** (exists): "no card", and one sampled card per
  `rendersCardTypes` type.
- **State page path** (new output only): `/views/<path>?<params>`. The card
  opens in the view bound to its type: the first view by slug whose
  `rendersCardTypes` has it (`src/frontend/src/lib/view-bindings.ts`,
  *"if (!map.has(type)) map.set(type, { slug: meta.slug, name: meta.name })"*).
  The `view` query key names a renderer by display name, not slug, so the
  path does not use it.

## Tracks / scope

### Track 1: the export and the check

- What: read `checkStates` with the view's metadata; render each declared
  state after the automatic ones.
- Why: the check cannot reach a state that needs parameters (`?select=O`),
  and a view author has no way to name one.
- Direction:
  - `export const checkStates = [{ name: "oxygen", path: "_content/chem/Periodic_Table.chem.card", params: { select: "O" } }];`
  - Schema: `z.array(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), path: z.string().min(1).optional(), params: z.record(z.string(), z.string()).optional() }).strict())`,
    names unique (a `superRefine`). `params.path` together with `path` is an
    error: `path` is the one place to give the card.
  - `ViewMeta.checkStates: DeclaredState[]`, default `[]`.
  - `statesToCheck` takes `declared` and appends
    `{ label: name, params: { ...params, ...(path ? { path } : {}) } }`.
    A declared `path` not among the received cards gives an untested remark
    (`state <name>: <path> is not among the cards the view receives; not checked`)
    and no state.
  - Output: failures read `View render failed [oxygen, after effects]: …`.
- Vocabulary lock-ins: export `checkStates`; fields `name`, `path`, `params`.
- First chunk: schema + runner + ViewMeta + `statesToCheck` + render-one, with
  the tests below.

### Track 2: `bbx view states <slug>`

- What: print each declared state's name and page path.
- Why: `screenshot --card` captures the open card; the agent needs the URL to
  open the state first. A `--state` flag on screenshot would need the view
  slug as well as the name, and would make the browser command compile views.
- Direction: `bbx view states <slug>` prints one line per state:
  `oxygen  /views/_content/chem/Periodic_Table.chem.card?select=O`. A state
  whose card opens in another view prints that view's slug in place of a
  path. A view with no declared states prints nothing and exits 0. An unknown
  slug or invalid metadata exits 1.
- Vocabulary lock-ins: subcommand name `states`.
- First chunk: the command, its test, and the docs in `views/doc/testing.ts`.

### Changes from the cross-model plan review (codex gpt-6-sol)

- An invalid metadata export used to leave the defaults (no dependencies) and
  the check passed. `getViewMeta` now sets `ViewMeta.metadataError`, and
  `render-one` fails on it; `bbx view states` refuses it too.
- `?view=<slug>` dropped from the page path (see Ontology). `bbx view states`
  prints, in place of a path, the view a state's card would open in when that
  is another view.
- `path` is required, so every state has a page path.
- `params` may not use `path`, `view`, `viewState` or `fragment`: the app
  keeps them for itself, and the view would never receive them.
- A declared card of a type not in `rendersCardTypes` is partly checked: the
  app never opens the view on it.
- `ViewMeta` is also the `views.list` API payload (`src/webapp/trpc/routers/views.ts`);
  the two new fields ride along, and the frontend reads neither.

## Could this be simpler?

Simplest: Track 1 only, and agents build the URL by hand from the export.
That works but makes every agent re-derive the reserved `view=` key and the
encoding; Track 2 is about 40 lines and removes that. A browser `--state` flag
is the fuller version the issue named; it is not built (see Track 2, Why).

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Declared card moved or archived | planned | untested remark, exit 0 | clear (`~ partly checked`) |
| Malformed export (bad name, duplicate, extra key) | planned | schema rejects; view listed invalid | clear |
| `params.path` and `path` both given | planned | schema error | clear |
| Declared state crashes | planned | failure names the state | clear |
| Many declared states exhaust the per-view timeout | no | settle budget is shared per state (`render-one.ts:160`) | clear: remaining states report "still loading" |
| Param value needs URL encoding (`&`, space) | planned | `encodeURIComponent` | clear |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong field: `params: { path }` instead of `path` — ADDRESSED, schema error.
- Stale ref: card moved — ADDRESSED, partly checked; `bbx mv` does not rewrite
  paths in `.tsx` files (existing behavior; filed as
  `issues/closed/features/2026-11-09-mv-lists-old-path-mentions-outside-tracked-refs.md`, which `bbx mv` now does for `.md` files only).
- Two agents: not applicable; the export is source code.
- Hand-edit drift: name with capitals or spaces — ADDRESSED, schema error with the path.
- Fabricated value: a state cannot carry data, so it cannot fake a pass.
- Validation error UX: the meta-import error names the field path
  (`checkStates.0.name: …`), as other exports do.
- Transition: views without the export get `[]`; nothing changes for them.

## NOT in scope

- `viewState` in a state: authored navigation state needs the chat-link
  issue's design; not now.
- Mocked data (fake `readFile`/adapter answers): the issue defers it until a
  view needs it.
- Declared states replacing the automatic sample: they add to it; replacing
  would let a declaration hide the not-found branch.
- `screenshot --card --state`: see Track 2.
- Chat links naming a state: the related issue owns it.

## Open design questions

None inside the chunks. Later: whether a declared state should be able to
turn off the automatic card sample for a type.

## Knowledge audits

The export is a new agent-facing convention. Add one `knows_directly` entry
("how does a view make `bbx view check` render it with `?select=O`?") in
`src/dev/knowledge-audits.yaml` and run it once against the worktree's test1
clone.

## What will hold this after it ships

- `check-states.test.ts` (pure): declared states appended; a missing card is
  an untested remark.
- `command.render-one.settled.test.ts` (spawned CLI): a declared state that
  crashes fails with its name; a moved card is partly checked.
- A meta-import test for the schema errors.
- A `states` command test for the printed paths and encoding.

## Implementation order

1. Track 1 (schema, ViewMeta, `statesToCheck`, render-one, tests).
2. Track 2 (`bbx view states`, test, docs in `views/doc/testing.ts` and the
   generated command docs).
3. Knowledge audit entry and run.
4. Walk: in the worktree's test1 clone, declare a state on a card view, run
   `bbx view check`, run `bbx view states`, open the printed path with
   `bbx browser open`, and `screenshot --card`. Confirm the bound view opens and receives the param.
   Done 2026-11-09 on test1: `bbx view check` named a failing `doubled` state;
   the printed path opened the recipe view showing `scale: 2`.

## Rollout shape

Done when the tests above pass, the walk shows the state rendered in the
browser, and typecheck, lint and layout-check pass. No data migration.
