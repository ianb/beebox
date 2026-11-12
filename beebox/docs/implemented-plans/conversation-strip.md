---
title: "Conversation strip and tour cards"
status: implemented
workstream: demo-support
issues: []
---
# Conversation strip and tour cards

**Implementation record.** Tracks A, B and C are implemented (about 1,340 added lines against an estimate of about 1,050). Not done: the tour file `test/tours/conversation-strip.tour.ts`; reaching a strip in the running app needs a tour card and a strip set by an agent turn or by hand. Not verified: a box-supplied strip view rendered in a real box (Track C is covered by unit tests only), the native iOS shell, and real voice checkpoints driving a tour.

A conversation gets one optional docked region, the strip, across the top of
its page: under the app bar, above both the cards and the messages. The strip
shows one card, small, and stays in place whichever of them the person is
looking at. Only a card type that declares a strip rendering can
go there. The first such type is `tour`: an ordered list of beats with one
marked current. The box agent sets and clears the strip; the person can
dismiss it. Boxes can supply their own strip-capable types.

**Issues addressed:** none closed. Related, and left open:
`issues/features/2026-09-08-agent-show-card-action.md` (an agent action that
shows a card; the strip is a narrower action with its own surface),
`issues/features/2026-08-29-listening-note-mode.md` (the box listens while
other people talk), `issues/docs-and-chores/2026-05-22-demo-readiness.md`
(the presenter's script; a tour card can hold one, but this plan does not
write it), `issues/features/2026-10-05-box-agent-interface-screenshots.md`
(the box explaining its interface). Searched the queue for "strip", "docked",
"pinned card", "sticky", "presenter": no issue proposes this surface.

## Design

### Situations

- When I am showing my box to four colleagues and talking for ten minutes, I
  want the part of the talk I am on, and the cards and controls that go with
  it, to stay in one fixed place, so I can open the right thing without
  scrolling back through the conversation or giving up the card I am showing.
- When Tomas opens the family box for the first time and asks "what is all
  this?", he wants the box to walk him through it a step at a time, so he can
  click around the real interface and still see which step he is on and what
  comes next.
- When Priya is halfway through a walk-through and gets a phone call, she
  wants to come back to the conversation the next day and find the walk where
  she left it, so she does not start again.
- When Priya is in an ordinary conversation about the week's schedule, she
  does not want a strip to appear because the agent thought a walk-through
  would help. The strip takes space from the conversation; it appears only
  when she asked for something that uses it.
- When the walk is over, or it turns out to be wrong, Priya wants it gone in
  one action, and she does not want it to come back by itself.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Presenting | Show; the agent keeps the tour card current | Strip across the top of the page; the tour card | Waits to be looked at. No sound, no notification |
| First-time walk-through | Show, after the person asks | Strip; a tour card the agent writes | Waits to be looked at |
| Returning the next day | Show the same card at the same beat | Strip, restored with the conversation | Waits to be looked at |
| Ordinary conversation | Quiet | No strip | None |
| Finished or wrong | Remove on the person's dismiss | Strip disappears; the card stays in the box | None |

The strip is the place for state: one current thing, replaced in place. The
conversation is a stream. Today the only place for state is a full card in
the cards pane, where it competes with the card the person is looking at.
The strip belongs to the conversation but not to the conversation pane. It
spans the page, so it is visible when the cards cover the messages, on the
desktop and on the phone (boxholder, 2026-11-11: it sits on top of the page,
not inside the chat). It takes its own row and pushes the page content down;
it does not cover content.

### Spirit

- **Serves:** "You should be able to see the gears" and "It should feel
  possible". A tour is a card: a file with history that the person can open,
  read, and edit. Its links point into the real interface. A box can add its
  own strip type from the same pieces.
- **Risks:** "It should feel like a place". An agent that fills the top of
  the conversation uninvited turns the place into a slideshow. Guards: the
  agent sets the strip only when the person asked for a walk-through, a
  presentation, or the strip by name (stated in the agent guidance, checked
  by a knowledge audit); the strip has a fixed maximum height; the person
  dismisses it in one click, and the agent is told it was dismissed.
- **Risks:** "The best stuff comes from the people". A tour written during
  someone's talk must not put words in their mouth. Guard: the tour type's
  instructions say a beat title names what the person said or asked for, in
  their words.

### Trust

Setting the strip starts at the top rung only inside a request: when the
person asked for a walk-through or a presentation aid, the agent sets the
strip without a confirmation, because the action is visible at once,
changes no box content beyond the tour card, and is undone with one click.
Without such a request the agent does not set it. A dismissal moves the
action down: the snapshot reports `strip="dismissed"` until the person asks
again. Nothing here is recorded as learned trust; it is per conversation.

### When it goes wrong or does nothing

- The agent names a card that does not exist, or a card whose type has no
  strip rendering: `bbx chat strip set` fails with a sentence that says
  which, and nothing changes on screen.
- The strip's card is deleted or retyped later: the strip shows one line,
  "This card can no longer be shown here: <path>", with the dismiss button.
- A link in a beat points at a card or control that is not there: the link
  shows the existing broken-link treatment. The other links work.
- The tour's `current` names no beat: the strip shows the beat titles with
  none marked. `bbx validate` reports the mismatch to the agent at write time.
- The agent is slow or wrong about the current beat: the person clicks
  another beat title in the strip to read that beat. This does not change the
  card. To correct the agent they say so in the conversation.
- Nothing to show: no strip region is rendered and the conversation has its
  full height.

### Walkthrough

Presenting. Before the talk I tell the agent, in my own words, that I am
about to present and give it my outline. The agent writes
`_content/tours/Box_Demo.tour.card` with one `##` heading per beat and
`current:` set to the first, then runs `bbx chat strip set
/_content/tours/Box_Demo.tour.card`. The server checks the card and stores
the path in the conversation's settings; the open page receives the change
and the strip appears across the top of the page with the beat titles in a row and
the first beat's links below. I talk, with narration mode on, and say "send
checkpoint". The agent reads the partial message, edits `current:` and adds
links under that beat, and commits. The card's file change reaches the page
and the strip redraws. I click a link; the card opens beside the
conversation; the strip does not move. At the end I click dismiss. The tour
card remains in the box with its history.

## Smallest fix and budget

Smallest fix: no engine change. The agent posts a callout per checkpoint.
Rehearsed on 2026-11-11 on the worktree test box: four checkpoints, four
callouts, 4 to 9 seconds each, links valid. It fails the first situation in
one way: the callouts scroll, and there is no place that shows what is next.

Chosen design, three tracks:

| Track | Source | Tests |
|---|---|---|
| A. Strip state, command, snapshot | ~220 | ~180 |
| B. Strip region and `tour` type | ~330 | ~200 |
| C. Box-supplied strip views | ~60 | ~60 |

About 1,050 changed lines. Authored docs (box doc, schema instructions, view
doc source) about 90 lines, reported separately. Not a BIG CHANGE.

What the fuller design buys over a hard-coded tour widget: the strip accepts
a card by declared capability, so the second use (a box's own type) needs no
engine change.

## Stated preferences this plan trades against

- "Minimize invented concepts; prefer primitives" (boxholder). The plan adds
  two nouns, strip and tour, and reuses the feature-flag control plane for
  state, `FileView` for rendering, and the view `modes` declaration for
  capability. It adds no new event, no new persistence file, and no registry.
- `docs/plans/agent-points-at-ui.md`, NOT in scope: *"A spotlight tour.
  Rejected in the issue with reasons. Multiple `control:` links in one
  message stay independent; clicking one points at one."* A tour card does
  not chain pointers. Every link in a beat is an independent click. The card
  orders prose; it does not drive the interface.
- The same plan *"deliberately does **not** add ... a mid-turn push
  channel"*. This plan adds none: it uses the existing
  `chat-features-changed` push, which `FeatureStore.set` already fires
  mid-turn when called from a route.
- `docs/implemented-plans/sidecar-shell.md` records "A landmark or context
  strip beside the card" as closed wontfix. That strip sat beside a card and
  described the place. This one spans the top of the page and holds a card
  the person asked for.
- `beebox/code-style.md`: "No default parameters", "Max 2 positional
  parameters", no `as`. Ordinary compliance.
- Agent guidance "only ever grows unless pruned" (root `AGENTS.md`). The
  always-loaded chat prompt gains three sentences; the rest goes in the
  `tour` schema instructions and one box doc with a `read-when`.

## What already exists

- **Per-conversation settings, the feature flags.** `src/core/chat/features.ts:1`:
  *"Chat feature flags — the control plane shared by user UI, agent
  (`<chat-app>` deltas), and landmark seeding."* Reuse. They are persisted
  (`src/core/chat/session/history.ts`, `SessionHistoryEntry.features`),
  pushed (`src/webapp/routes/chat/register.ts:226`:
  `eventBus.emitTransient("chat-features-changed", …)`), re-read on reload
  (`src/frontend/src/api-chat.ts:180`, `chat.features.query`), set by the
  person (`control-procedures.ts:338`, `setFeature`), and serialized into
  every turn's snapshot (`features.ts`, `composeChatAppSnapshot`).
- **Feature values are a closed set.** `features.ts`, `isValidValue`:
  `return f.allowedValues.includes(value);`. Extend, see Track A.
- **Agent CLI to its own session.** `src/cli/commands/chat/ui.ts`:
  `resolveChatSessionId()`, `loopbackHeaders()`, POST to
  `/${boxName}/api/chat/ui/request`. Reuse the pattern.
- **A docked region above the conversation.**
  `src/frontend/src/components/intention/IntentionStrip.tsx`, mounted at
  `chat/workspace/WorkspaceCanvas/view.tsx` row 1. It shows a landmark's
  intention, not a card, and sits above the cards on desktop. Not reused;
  it is the layout precedent. The strip mounts above the whole workspace
  grid.
- **Card rendering by surface.** `components/file-view-types.ts:5`:
  `export type FileViewMode = "chat" | "companion" | "embed";` and
  `file-type-registry.ts`, `RendererProps.mode`. `FileView` loads the card,
  refreshes it on file change, and picks the renderer or the bound box view
  (`FileView/view.tsx:266-286`). Reuse with a fourth mode.
- **Box views declare modes that nothing reads.** `core/views/types.ts:126`:
  `export type ViewMode = "page" | "chat";`; `compile.ts:353`:
  `modes: imported.modes ?? ["page"]`. Reuse the declaration; give it its
  first consumer.
- **`control:` links render in any markdown.** `markdown-link/link.tsx`
  sends `case "control"` to `ControlPointer`, *"not in a chat-only
  override"*. Reuse.
- **A card type with a scoped renderer.** `src/schemas/todo-view.ts` and
  `src/frontend/src/renderers/todo-view.tsx`; checklist in
  `docs/cards/schemas.md`, "Files to Touch". Follow it.

## Prior art (external)

No design decision depends on an external premise. The pattern is a common
one (a pinned header above a message list); no library is adopted. The
earlier rejection of memory-atlas's chained-pointer tour is covered under
stated preferences.

## Ontology

- **strip** — the docked region across the top of one conversation's page. One
  per conversation. Identified by the conversation. It is NOT a pane, a tab,
  or an overlay, and it is not the intention strip
  (`IntentionStrip.tsx`, which keeps its name).
- **strip state** — the value of the conversation feature `strip`: `none`,
  `dismissed`, or a box path starting with `/` to a card. Existing noun:
  feature (`features.ts`, `FeatureDescriptor`).
- **strip rendering** — a renderer's output when its surface mode is
  `strip`. A built-in renderer declares it with `strip: true` on its
  `FileRenderer`; a box view declares it with `"strip"` in its exported
  `modes`. A card type is **strip-capable** when its renderer or bound view
  declares it.
- **tour** — a card type. An ordered list of beats and the name of the
  current one. NOT a dev tour (`beebox/test/tours/`, a scripted browser
  walk for developers); box-facing text never uses "tour" for that.
- **beat** — one `##` section of a tour card's body: the heading is its
  title, the markdown under it is its content. Identified by its title,
  unique within the card. NOT a todo and has no status.
- **current beat** — the beat whose title equals the card's `current`
  field. Zero or one.

## Tracks / scope

### Track A. Strip state, command, snapshot

- **What.** A feature `strip` that holds the strip state; a command the
  agent runs to set or clear it; the state in the per-turn snapshot.
- **Why.** The agent has no way to place a card in front of the person that
  survives scrolling and reload.
- **Direction.**
  - `FeatureDescriptor` gains three optional fields: `accepts?: (value:
    string) => boolean` (extra legal values beyond `allowedValues`),
    `agentDelta?: false` (the agent cannot set it with a `<chat-app>` tag),
    and `omitDefault?: true` (leave it out of the snapshot at its default).
    `isValidValue` returns `allowedValues.includes(value) || accepts?.(value)
    === true`. `parseChatAppDeltas` drops a delta for an `agentDelta: false`
    feature with the existing warning.
  - Descriptor: `{ name: "strip", allowedValues: ["none", "dismissed"],
    default: "none", accepts: isBoxCardPath, agentDelta: false, omitDefault:
    true, uiKind: "select", label: "Conversation strip" }`. `isBoxCardPath`
    accepts a string that starts with `/`, ends with `.card`, and has no
    `..` segment; full resolution happens in the route.
  - `src/shared/strip-types.ts`: `export const BUILTIN_STRIP_TYPES =
    ["tour"] as const;`.
  - `src/core/chat/strip.ts`: `resolveStripCard(boxRoot, ref):
    Promise<Result<{ path: string; type: string }, StripRefusal>>`. It
    resolves the ref with `parseRef`/`resolveRefPath`, reads the card type
    from the filename, and accepts the type when it is in
    `BUILTIN_STRIP_TYPES` or `stripViewFor(metas, type)` returns a view.
    `stripViewFor` lives in `src/shared/strip-types.ts` and is the one rule
    for both sides: among views with the type in `rendersCardTypes` and
    `"strip"` in `modes`, the first by slug order. The page uses the same
    function to pick the view in strip mode (Track C), so a type with an
    earlier page-only view and a later strip view is accepted by the
    command and rendered by the later view. `StripRefusal` is `"not-found" | "not-a-card" |
    "not-strip-capable"`.
  - Route `POST /api/chat/strip`, body `{ session: string, card: string |
    null }`, loopback-authenticated like `/api/chat/ui/request`. `card: null`
    sets `none`. Otherwise it calls `resolveStripCard`, then
    `target.setFeature("strip", path)`. Responses: 200 `{ strip }`; 404
    `{ error: "no-session" }`; 422 `{ error: <StripRefusal>, message }`.
  - CLI `bbx chat strip set <card>` and `bbx chat strip clear`
    (`src/cli/commands/chat/strip.ts`), classified in
    `src/cli/entry/surface-data.ts` beside `chat ui`. Success prints one
    line. A refusal prints the message and exits 1. Messages:
    "no card at <ref>"; "<ref> is not a card"; "<type> cards cannot be shown
    in the strip; strip-capable types in this box: tour, …".
  - Snapshot: no new plumbing. `strip="/…​.card"` or `strip="dismissed"`
    appears with the other features; absent when `none`.
  - Prompt (`src/core/chat/session/prompts.ts`, the `<chat-app>` section),
    three sentences: what `strip` in the snapshot means; `bbx chat strip set
    <card>` / `clear`, and that only strip-capable types are accepted; set it
    only when the person asked for a walk-through, a presentation aid, or the
    strip, and never again after `dismissed` until they ask.
- **Vocabulary lock-ins.** Feature name `strip`; values `none`,
  `dismissed`; verb `bbx chat strip set|clear`; `BUILTIN_STRIP_TYPES`.
- **First implementation chunk.** Descriptor fields, the `strip` feature,
  `isBoxCardPath`, and their tests in `test/core/chat/features.test.ts`.

### Track B. Strip region and `tour` type

- **What.** The region on the page; the `strip` surface mode; the `tour`
  schema and its renderer.
- **Why.** State needs a surface, and the surface needs one type to show.
- **Direction.**
  - `FileViewMode` and `RendererProps.mode` gain `"strip"`. In `FileView`,
    `strip` takes the frameless path that `embed` takes, at every place the
    code tests `mode === "embed"` (`FileView/view.tsx:181`, `:213`, `:241`,
    `:247`, `:320`): no `ThemedFileCard`, no header, no renderer toggle, no
    todo summary, no selection sink. Without this the card would render
    inside `ThemedFileCard`'s heading, Properties control, and footer
    (`view.tsx:327`). A helper `isFrameless(mode)` replaces the five tests.
    The renderer receives `mode="strip"`.
  - `FileRenderer` gains `strip?: true`. In strip mode `FileView` considers
    only renderers with `strip: true`, plus a bound box view whose `modes`
    include `"strip"` (Track C). With none, or when the card fails to load,
    it renders the one-line notice from the design.
  - `components/chat/ConversationStrip.tsx`: a `<section aria-label="Strip">`
    that renders nothing unless the feature value is a path. It holds
    `<FileView path mode="strip" onNavigate={workspace.open}>` in a box with
    a maximum height of `min(12rem, 30vh)` and its own vertical scroll, and
    a dismiss button that calls the existing `setChatFeature`
    with `dismissed`. Pure decision `stripCardPath(features): string | null`
    is exported for a test.
  - Mount: `WorkspaceCanvas` takes a `strip: ReactNode` prop and renders it
    as a sibling before the workspace grid, full width, so it sits above the
    intention strip, the cards, and the messages in every layout (split,
    cards only, messages only, phone). When there is no workspace
    (`if (!workspace) return children;`) it renders the strip before
    `children`. `InteractiveChatBody` passes `<ConversationStrip>` built from
    `model.chatFeatures`. The region is outside the message scroller, so a
    height change is a viewport resize for the scroll controller
    (`components/chat/AGENTS.md`, the scroll rules); run `/dev/chat-scroll`
    `runAll()` after the change, as that file requires.
  - Schema `src/schemas/tour.ts`: `cardSchema("tour", { brief: "An ordered
    walk-through with a current step", category: "authored", fields: {
    current: z.string().optional(), body: body(z.string()) }, validate,
    instructions })`. The `body` field is required for the card to hold
    beats at all: `src/core/card-io.ts`, `validateCardBody`: *"Schemas
    without a body field reject any non-whitespace body content."* `validate`
    fails when the body has no `##` heading, when two headings are equal, or
    when `current` is set and matches no heading; the message lists the
    headings. Instructions cover: the shape; that beat titles use the
    person's words; links and `control:` pointers under a beat; move
    `current` as the walk advances; `bbx chat strip set`; when not to.
  - `src/shared/tour-beats.ts`: `parseTourBeats(body: string): { title:
    string; markdown: string }[]`. A beat runs from a line starting `## ` to
    the next one; text before the first heading is the tour's introduction
    and is not a beat. Headings inside fenced code are ignored.
  - Renderer `src/frontend/src/renderers/tour.tsx` and
    `components/TourCard.tsx`, registered with `strip: true`. Strip mode: a
    row of beat titles as buttons (`aria-current="step"` on the current
    one), then the selected beat's markdown through `Markdown/body.tsx`.
    The selected beat follows `current` until the person clicks a title;
    a change of `current` in the card selects the new current beat again.
    Other modes: the introduction, then every beat in order with the
    current one marked.
  - Registration: `src/schemas.ts`, the template list, `renderers.ts`, per
    `docs/cards/schemas.md`.
  - Box doc `docs/box/conversation-strip.md` with a `read-when`, mapped in
    `src/core/docs-gen/package-docs/core.ts`.
- **Vocabulary lock-ins.** Type `tour`; field `current`; beats as `##`
  headings; surface mode `strip`; `FileRenderer.strip`.
- **First implementation chunk.** `parseTourBeats` and the `tour` schema
  with `validate`, with tests. No UI.

### Track C. Box-supplied strip views

- **What.** A box view that exports `modes` containing `"strip"` renders its
  bound card types in the strip.
- **Why.** The boxholder requires that boxes add their own strip types.
- **Direction.** `ViewMode` becomes `"page" | "chat" | "strip"`
  (`core/views/types.ts`), and the meta schema's enum
  (`webapp/views/compiler/meta-import.ts:88`) accepts it. `ViewProps` gains
  `mode: "page" | "strip"`; `BoundAgentViewRenderer` receives a `strip`
  flag from `ActiveFileRenderer` and passes `mode`. The views listing
  already carries `modes`. `view-bindings.ts` keeps its page binding rule
  (first view by slug) and adds `useStripViewBinding(type)`, which applies
  `stripViewFor` to the same cached listing; `FileView` uses it in strip
  mode. View doc source
  (`src/core/views/doc/core.ts`) gains one paragraph.
- **Vocabulary lock-ins.** `modes` value `"strip"`; view prop `mode`.
- **First implementation chunk.** The type and enum change with the
  `resolveStripCard` test for a box view.

## Could this be simpler?

Simplest version: a `tour` feature whose value is a card path, rendered by a
hard-coded tour component, with no capability declaration. It fails the
boxholder's stated requirement that only declared types go in the strip and
that boxes add their own; the second strip type would need an engine change.
The capability costs one optional field on `FileRenderer`, one enum value,
and one function.

Simpler than a new session field, route family, bus event, and query: reuse
the feature flags. That is the chosen design. What it costs: a feature whose
value is not from a closed list, the first such. The alternative adds a
second control plane with its own persistence and push for one value.

Not simpler: letting the agent set the strip with a `<chat-app strip=…/>`
tag and dropping the command. Deltas apply at turn end and an invalid one is
dropped with a server log line the agent never sees (`features.ts`,
`parseChatAppDeltas`: `console.warn(…)` and `continue`). A refused card must
be visible to the agent, per the design's "wrong or nothing".

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `set` names a missing card or a non-card | Planned: `strip.test.ts` | 422 with message | Clear to the agent |
| `set` names a type with no strip rendering | Planned: `strip.test.ts` | 422 naming capable types | Clear to the agent |
| `set` ref escapes the box with `..` | Planned: `strip.test.ts` | `resolveRefPath` fails closed | Clear to the agent |
| Session is not live when the command runs | Planned: route test | 404 `no-session` | Clear to the agent |
| Card deleted or renamed after `set` | Planned: `stripCardPath` and FileView strip notice test | One-line notice with dismiss | Clear to the person; the snapshot still names the old path (accepted: the agent sees the path and can check it) |
| Stored value from a newer or older engine is not valid | Existing: `resolveFeatures` drops it with a warning | Falls to `none` | Silent to the person; acceptable, the strip is absent |
| Tour `current` matches no beat | Planned: schema validate test, renderer test | Validation error at write; strip shows no current | Clear to both |
| Strip height change moves the reading point | Planned: `/dev/chat-scroll` run; no new automated test | Scroll controller rule for viewport resize | Would be visible; verified by hand |
| Box view declares `strip` but throws in strip mode | Existing view error boundary | Error shown in the strip region | Clear |
| Two browser tabs: one dismisses | Existing features push | Both update | Clear |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED. `<chat-app strip=…>` is dropped
  (`agentDelta: false`); the prompt names the command. The audit below
  checks the agent reaches for the command.
- **Stale ref** — ADDRESSED for display (notice line). The stored path is
  not rewritten when a card moves. DEFERRED: following a move, see NOT in
  scope.
- **Two agents touching the same card** — ADDRESSED by existing rules: the
  tour card is an ordinary card and edits go through the card lock. Only
  the chat agent of that conversation has a reason to edit it.
- **Hand-edit drift** — ADDRESSED. A person renames a heading and `current`
  no longer matches: validation reports it, the strip shows no current beat.
- **Fabricated free-form value** — ADDRESSED in guidance: beat titles use
  the person's words. GAP, narrow: nothing checks this mechanically.
- **Validation error UX** — ADDRESSED. Messages are full sentences that
  name the ref, the type, and the legal choices.
- **Partial migration / transition state** — none. No stored data changes
  shape; an old client ignores the unknown feature value.

## NOT in scope

- **A strip that covers content.** The strip takes its own row. A free
  overlay was set aside because its effect on scrolling is hard to reason
  about (boxholder, 2026-11-11).
- **The person moving the current beat by clicking.** That writes the card
  from the strip. The click only selects a beat to read.
- **Following a card rename.** The stored path is not updated.
- **Putting a card in the strip by hand from the interface.** The person
  asks the agent.
- **Guidance for listening to a presentation.** The boxholder supplies that
  as a briefing in the conversation (2026-11-11).
- **Landmark-seeded strips.** The feature flags support seeding; no place
  needs it yet.
- **A strip rendering for any existing type.** No default; a type opts in
  (boxholder, 2026-11-11).
- **Self-controlled placement or size.** The strip's frame is fixed.
- **Collapsing the strip.** Cut after plan review (codex gpt-6-sol,
  2026-11-11); dismiss covers the need until someone misses it.
- **Native iOS shell.** The strip is web DOM above the workspace and
  appears there in the web view. No Swift change, no bridge change.

## Open design questions

- Should `bbx chat ui` list the strip's controls? Lean: exclude the region
  as the cards pane is excluded, because its content is card content.
- Is `tour` the right name beside the dev tours? Lean: yes for the box;
  revisit if box-facing docs ever need to mention dev tours.

## Knowledge audits

One `knows_directly` entry in `src/dev/knowledge-audits.yaml`: asked to walk
a newcomer through the box and keep the steps in view, the agent writes a
`tour` card and runs `bbx chat strip set`; asked nothing of the kind, it
does not. Run against the worktree test box and record the status.

## What will hold this after it ships

- Pure functions under unit tests: `isValidValue` with `accepts`,
  `parseChatAppDeltas` refusing `strip`, `composeChatAppSnapshot` omitting
  the default, `resolveStripCard`, `stripViewFor` (an earlier-slug page-only
  view and a later-slug strip view for one type), `parseTourBeats`, the
  `tour` validate
  hook, `stripCardPath`.
- A route test for `POST /api/chat/strip` with a fake session registry, in
  the tier the `self-note` route uses.
- A frontend logic test for the tour renderer's beat selection.
- One tour, `test/tours/conversation-strip.tour.ts`: open a conversation
  with a strip set, checkpoint, dismiss. It is the walk, not the anchor.
- No new test tier.

## Implementation order

1. Track A chunk 1: descriptor fields, `strip` feature, tests.
2. Track B chunk 1: `parseTourBeats`, `tour` schema, registration, tests.
3. Track A rest: `resolveStripCard`, route, CLI, surface classification,
   prompt sentences, tests.
4. Track B rest: `strip` mode in `FileView`, `ConversationStrip`, mount,
   tour renderer, scroll check, box doc.
5. Track C.
6. Knowledge audit entry, run; the tour.

Chunks 1 and 2 are independent. 3 needs 1 and 2. 4 needs 1 and 2. 5 needs 3
and 4.

## Rollout shape

Done when these pass: `test/core/chat/features.test.ts` (new cases),
`test/core/chat/strip.test.ts`, the route test, `test/schemas/tour.test.ts`,
`test/shared/tour-beats.test.ts`, the frontend tests for `stripCardPath` and
the tour renderer logic, `pnpm typecheck`, `pnpm lint:changed`,
`pnpm layout-check`; the knowledge audit is run and recorded; the strip is
seen working in a browser on the worktree test box at desktop and phone
width. No migration: no existing data changes shape.
