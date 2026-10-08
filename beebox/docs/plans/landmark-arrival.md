---
title: "Landmark arrival"
status: draft
workstream: journey-walks-oct
issues:
  - ../../../issues/bugs/2026-10-08-landmark-switch-opens-empty-chat-not-the-place.md
  - ../../../issues/bugs/2026-10-08-landmark-card-shows-its-config-not-its-places.md
  - ../../../issues/bugs/2026-09-21-fresh-chat-reservation-suppresses-openers.md
---
# Landmark arrival

A person who goes to a place (a landmark) meets an empty chat or the
landmark's configuration. This plan makes a landmark card render as the place
page, makes arrival in a place's chat open the place, fixes the bug that hides
openers on a fresh chat, and moves openers from briefing cards to landmarks.

**Issues addressed:** the frontmatter lists the three issues this plan
resolves. The following issues are related only; this plan does not close
them, and they are deliberately left out of the frontmatter so the finish step
does not close them:

- [A course session cannot open with the tutor speaking first](../../../issues/features/2026-10-08-course-session-cannot-open-with-the-tutor.md):
  a course landmark gains an `openers:` list, but an agent-first turn stays unbuilt.
- [Landmarks can restore a pinned baseline of cards](../../../issues/features/2026-09-08-landmark-scoped-pinned-card-baseline.md):
  "entry point, else place page" is the default until that exists (design, "Decided").
- [Collection views are badly defined](../../../issues/features/2026-08-19-collection-views-are-badly-defined.md):
  the place page lists the landmark's existing resolved links; it is not a collection view.
- [A chat binds to a landmark once and never moves](../../../issues/bugs/2026-08-25-chats-bind-to-a-landmark-once-and-never-move.md):
  arrival keys on the chat's existing binding and does not change it.
- [The front door is an empty text box](../../../issues/features/2026-08-23-first-screen-says-nothing-about-what-this-is.md)
  and [First-run experience](../../../issues/features/2026-07-20-first-run-experience.md):
  the openers fix restores the two stock openers on a new box's first chat.
- [A course landmark in the attach folder shows twice](../../../issues/bugs/2026-10-08-course-landmark-in-attach-folder-shows-twice.md):
  same nested-landmark resolution; not changed here.
- [Directories as viewable things](../../../issues/features/2026-07-28-directories-as-viewable-things.md):
  the place page is a card renderer, not a directory view.

Queue searches run (`bin/issues search --all`): `landmark`, `openers`,
`collection view`, `tutor`, `baseline`, `entry-point`, `briefing`. No duplicate
of the three resolved issues was found.

## Design

[landmark-arrival.design.md](landmark-arrival.design.md). Its "Decided
(2026-10-08)" section and the "A place carries its own openers" rule are
boxholder decisions; this plan treats them as settled.

## Smallest fix and budget

**Smallest fix for the reported problems** (about 250 changed lines):
read the root briefing at its real path and drop the `sessionInput === "new"`
gate (openers show); register a landmark renderer that reuses
`LandmarkLinks`/`LandmarkGroup` fed by `landmarks.forDir` (the card shows its
places); open the landmark card on arrival when the chat has no saved
arrangement. It would fix the three issues but leaves openers on briefings,
which the boxholder decided against, and it shows unnamed `expand` results as
an unlabeled flat list, which the design's "see the gears" guard rejects.

**Chosen design, four tracks** (estimates are additions plus deletions):

| Track | Source | Tests | Notes |
|---|---|---|---|
| A. Openers on an unstarted chat | 50 | 60 | pure `showsOpeners` + draft guard |
| B. Openers move to landmarks (schema, reader, templates, guidance, migration) | 420 | 330 | migration is about 150 of the source |
| C. Place page (server tiers + renderer + send context + Properties fields) | 400 | 330 | |
| D. Arrival (server target + workspace hook) | 130 | 150 | |
| **Total** | **1,000** | **870** | |

Authored documentation: about 250 lines (`docs/landmarks.md` rendering and
schema sections, `docs/cards/migrations.md` entry, `docs/box/landmark-curation.md`,
schema instructions prose is counted in source above, one knowledge-audit
entry). Generated output, reported separately: the `briefing-seed` hash in
`src/core/template-stock-hashes.ts` (`pnpm template-stock:update`), the
regenerated `docs/doc-graph.*`, and each box's regenerated `box-docs/`,
`.claude/rules/card-*.md`, and `_content/briefing.md`.

**BIG CHANGE.** Source, tests, and authored docs total about 2,120 lines, over
the 2,000-line threshold. The size comes from scope the boxholder set: four
tracks, two of them bug fixes, one a schema move that requires a migration
(bbx-migration: "If you're changing on-disk shape and *any* box already holds
the old form, you need a migration"), and tests at the doctest tier for each
decision. No track adds a framework or a new test tier. This needs the
boxholder's approval at this size before implementation starts. If the size
must come down, Track B's migration and guidance (about 600 lines with tests)
is the separable piece, but the decision record says the move ships with this
work.

## Stated preferences this plan trades against

- **Principle 8, one way to do each thing** (`docs/engineering-principles.md`).
  Openers today live on briefings and the place page needs them on the
  landmark; keeping both readers would be two ways. Track B removes the
  briefing field instead of adding a second source.
- **Principle 4, resilient and never silent.** A non-root briefing whose
  directory has no landmark keeps its `openers:` and the migration prints a
  warning, rather than dropping them (bbx-migration: "A warning is data the
  migrator silently drops").
- **Principle 10, testability.** Each decision (unstarted chat, arrival
  target, place sections, expand label, opener move) is a pure function with
  a doctest; the frontend has no DOM or effect harness
  (`src/frontend/test/` doctests use `renderToStaticMarkup`, see
  `src/frontend/test/components/PersonView.person-view.doctest.md:8-9`).
- **`beebox/CLAUDE.md` "Work only on the requested problem."** Two changes
  reach past the landmark: the Properties fields rule (Track C) applies to
  every type-specific renderer, and the draft guard (Track A) applies to the
  empty-chat openers too. Both are named under Tracks with the reason.
- **Memory: minimize invented concepts.** No new card field beyond
  `navigation.openers`; no new store; arrival reuses `openCard`; the place
  page reuses `resolveLandmark` by giving unnamed expands a group label.
- **Precedent:** `landmark-symbol` (`src/scripts/migrate/landmark-symbol.ts:19-24`)
  for a surgical YAML move inside landmark cards: *"Deliberately not merged
  into one YAML rewrite of the whole file: the edit is surgical … and
  `parse`→`stringify` would reorder and reflow every other key"*.

## What already exists

- **Opener send path.** `src/frontend/src/components/chat/everywhere/InteractiveChat/actions.ts:110-113`:
  *"const handleSendOpener = useCallback((text: string) => { inputStore.set(text); handleSend(); }"*.
  Reuse for the place page. It overwrites the composer draft; Track A adds a guard.
- **Once-only click rule.** `ChatOpeners.tsx:27-35` `clickOpener(...)`, already doctested
  (`src/frontend/test/components/chat/everywhere/InteractiveChat/ChatOpeners.chat-openers.doctest.md`). Reuse.
- **Opener gate (the Track A bug).** `InteractiveChat/shell.tsx:78-80`:
  *"const isNew = params.sessionInput === "new"; const openersQuery = trpc.chat.openers.useQuery(..., { enabled: isNew });"*.
  A reserved fresh chat is a `session` target
  (`resolve-conversation.ts:61`: *"target: { kind: "session", sessionId: reserved.sessionId, contextDir }"*),
  and the shell passes *"sessionInput={sessionId ?? "new"}"* (`BoxConversationShell/view.tsx:85`).
- **Opener reader.** `src/webapp/trpc/routers/chat/router.ts:109-131` (`readBriefingOpeners`) and
  `:204-222` (`openers` procedure). Its fallback rule (`:212-217`): *"A directory with no briefing of its
  own inherits the root briefing's openers … A briefing that EXISTS and lists none is an answer, not a gap"*.
  Rebuilt to read landmarks (Track B).
- **Root path bug in that reader (found while planning).** `readBriefingOpeners` joins
  `path.posix.join(dir, "briefing.briefing.card")` (`:110`), so the root (`dir` `""`) reads
  `<boxRoot>/briefing.briefing.card`. The root briefing lives at `_content/briefing.briefing.card`
  (`src/core/box/guidance-surfaces.ts:88`; `src/core/docs-gen/compile/core.ts:81`). A probe against a
  `makeTmpBox` box with the briefing at `_content/briefing.briefing.card` returned
  `{"openers":[]}` for both `{}` and `{ contextDir: "_content/lending" }`. The doctest
  `test/webapp/trpc/routers/chat.openers.doctest.md` writes the briefing at the box root, so it encodes the
  bug. Fixing only the shell gate would therefore still show no openers. The landmark reader uses
  `landmarkScanRelDir` (`src/core/landmark/root-dir.ts:34-36`), which maps `""` to `_content`.
- **Opener validation.** `src/schemas/briefing.tsx:42-50` (`OPENER_MAX_LENGTH = 120`, one line, non-blank). Moved, not rewritten.
- **Landmark link resolution.** `src/core/landmark/resolve/core.ts:77-106` `resolveLandmark`
  (listed, derived entry-point/primary, nested landmarks, unnamed expands flattened; named expands
  as `ResolvedGroup`s capped at `GROUP_CHILD_CAP = 50`, `:62`). `loadLandmarkPayload`
  (`src/webapp/trpc/routers/landmarks/payload.ts:86-137`) wraps it with the pruned-subtree walk.
  `landmarks.forDir` (`router.ts:137-164`) is what the Browse header
  (`pages/browse/components/BrowseSidebarBody/BrowseLandmarkHeader.tsx:40-49`) and the here menu use. Reuse.
- **Link and group components.** `src/frontend/src/components/landmarks/LandmarkSection.tsx`
  `LandmarkLinks` (`:143-179`), `LandmarkGroup` (`:181-221`, collapsed by default), `LinkTile`
  missing branch (`:265-272`, shows the name and "Missing"). Reuse with two small props.
- **Entry-point lookup.** `derived-links.ts:121-131` `nestedEntryPoint` filters the pruned subtree
  *"e.kind === "card" && e.level === "entry-point""* and takes the first. Arrival reuses the same filter
  but requires exactly one.
- **Type-specific renderer precedent.** `src/frontend/src/renderers/person.tsx`:
  *"selector: { type: "person" }, renderer: { name: "Person", …, priority: 100 }"*. Reuse the shape.
- **Per-conversation workspace store.** `WorkspaceProvider/workspace-browser-store.ts:97-130` `select`
  restores the conversation's saved arrangement from `sessionStorage` or starts from
  `createEmptyWorkspaceState()`; it does not report which happened. Extended (Track D).
- **Navigation decision.** `workspace/history.ts:166-179` `decideWorkspaceNavigation` returns
  `restore-snapshot`, `open-url`, or `keep-current`; the provider acts on it at `provider.tsx:128-149`.
  Arrival hooks the `keep-current` path.
- **Place switch.** `PlacePill.tsx:210` *"onSelectLandmark={(dir) => { void openLandmarkChat(dir); }}"* →
  `useOpenLandmarkChat.ts:33-36` *"await conversation.select({ kind: "landmark", contextDir: dir }); void navigate(...)"*.
  Unchanged; arrival happens downstream.
- **Root landmark install.** `src/core/box/structure/defaults.ts:238`
  *"createLandmarkTemplate({ label: await boxSlug(boxRoot), symbol: "📦" })"*. Reused by the migration and given stock openers.
- **Briefing seed.** `briefing.tsx:260-266` seeds two openers; it is a managed stock template
  (`src/core/box/templates.ts:160`). Its openers move to the root landmark template.
- **Lenient frontmatter.** `src/cards/schema.ts:557-563`: *"an unknown frontmatter key is stripped in
  memory, so a card that has drifted past its schema still loads … surfaced separately as a lint
  *warning*"*. This is the transition state for an un-migrated briefing.
- **Opener curation procedure.** `templates/procedures/process-retrospective.procedure.card:267-400`,
  step `openers`, finds briefings with `grep -q '^openers:'` (`:286`) and tells the agent
  *"Remove the `openers:` field entirely once the box is in regular use"* (`:358-360`). Rewritten for landmarks.
- **Properties field split.** `src/frontend/src/lib/card-field-faces.ts:56`
  *"const typeFieldFace: Face = embed || hasBodyField !== true ? "front" : "properties";"*.
  A landmark has no body, so its fields currently go only on the front; `CardFacts`
  (`themes/ThemedFileCard/CardProperties.tsx:37`) would show no Fields section once a renderer replaces the front.

## Prior art (external)

No decision here depends on an external premise. All mechanisms are in-repo
(card renderers, tRPC, the migration harness, the workspace store). Search
skipped for that reason.

## Ontology

- **Place** (existing): a directory marked by a `*.landmark.card`; logical `dir` (`""` for the root,
  whose card is `_content/*.landmark.card`, `root-dir.ts:21-36`). Not a chat; a chat binds to one by `contextDir`.
- **Landmark card** (existing, `src/schemas/landmark.ts`): the place's file. Not visitable today in the
  sense of rendering anything useful; after this plan it renders as the place page.
- **Place page** (new rendering, renderer name `Place`): what a landmark card shows. Points at the
  place's resolved links and its openers. Not a collection view and not a directory view.
- **Opener** (existing term): one line, ≤120 characters, sent as the person's message when clicked.
  Moves from `briefing.openers` to `navigation.openers` on the landmark. Not an agent-first turn.
- **Place openers lookup** (rebuilt): the landmark in the chat's `contextDir` answers; if that directory
  has no landmark card, the root landmark answers. Same rule as today with the landmark in place of the briefing.
- **Unstarted chat** (new name for an existing state): a conversation with no committed turn: a
  `start` target, or a `session` target whose history has zero entries and no pending messages.
  Not "a resumed chat with no messages" (a committed chat always has entries).
- **Saved arrangement** (existing data, new name): the `WorkspaceState` stored for a conversation
  identity in this browser tab's `sessionStorage`. An arrangement with no cards still counts as saved.
- **Arrival target** (new): for a non-root place, the single `entry-point` card in the place's pruned
  subtree when there is exactly one, else the landmark card. Null for the root (see Direction, Track D).
- **Entry point** (existing prominence level, `src/shared/prominence.ts`): unchanged.
- **Expand group** (existing `ResolvedGroup`): on the place page every `expand` is a group; an unnamed
  one gets a plain-words label from its query.
- **Nested place link** (new `ResolvedLink.source` value `"place"`): the row for a nested landmark, today
  `source: "derived"` (`derived-links.ts:114`). Lets the page put nested places in their own tier.

## Tracks / scope

Implementation order follows dependency: A has none; B gives the landmark
`openers` that C reads; D needs nothing from C but is verified against it.

### Track A — Openers on an unstarted chat

- **What.** Show openers on any unstarted chat, not only on `sessionInput === "new"`.
- **Why.** Every 2026-10-08 walk opened on "Start a conversation." with no openers
  (issue re-encounter list). The reserved fresh chat is a `session` target, so the gate never opens.
- **Direction.**
  - Extract `showsOpeners({ sessionInput, loading, totalEntries, pendingCount }): boolean` into
    `InteractiveChat/chat-openers-gate.ts`: true when `sessionInput === "new"`, or when not
    `loading`, `totalEntries === 0`, and `pendingCount === 0`. `useChatBinding` (`shell.tsx:67-81`)
    takes the snapshot values and uses it for both `enabled` and the returned list. The rendering
    condition in `messages.tsx:283-289` (`messages.length === 0 && !isStreaming`) is unchanged.
    The "existing session with no messages" case the old comment guards against cannot have
    `totalEntries === 0`, so the distinction the issue asks to keep is kept.
  - Draft guard: `handleSendOpener` (`actions.ts:110-113`) refuses when the composer holds text,
    with a toast "Send or clear your draft first." It does not overwrite the draft. The composer
    draft survives conversation switches (`shell.tsx:10-12`), so this is reachable on the empty
    chat today and on the place page after Track C.
- **Vocabulary lock-ins.** `showsOpeners` name and inputs.
- **First implementation chunk.** `chat-openers-gate.ts` + doctest cases (new, reserved-empty,
  reserved-loading, committed, pending) in the existing ChatOpeners doctest; wire into `shell.tsx`;
  draft guard + a `clickOpener`-style pure check. No open question inside.

### Track B — Openers move to landmarks

- **What.** Add `navigation.openers` to the landmark schema; read it in `chat.openers` and the place
  page; remove `openers` from the briefing schema; migrate existing briefings; move the stock openers
  from the briefing seed to the root landmark template; rewrite the agent guidance.
- **Why.** Boxholder decision (design, "Decided"): one concept in one place. The root path bug above
  also means today's reader serves no root openers on a v3 box.
- **Direction.**
  - Schema: `LandmarkNavigation` (`landmark.ts:100-106`) gains `openers: z.array(OpenerEntry).optional()`.
    `OpenerEntry` and `OPENER_MAX_LENGTH` move from `briefing.tsx:42-50` to `landmark.ts` unchanged.
    The field sits under `navigation` beside `chat-app` (the existing chat seed, `:89-94`), because
    `navigation` is the human-facing role. The design writes it as `openers:`; this is that field.
    An invalid opener makes the landmark fail `parseLandmarkFields`, which today shows as a parse
    warning row on the Landmarks page (`docs/landmarks.md`, "Parse warnings"), the same treatment
    as any other bad landmark field.
  - Reader: move the `openers` procedure out of `chat/router.ts` (369 lines today) into
    `chat/openers-procedure.ts`, spread like `chatBootstrapProcedure`. For `dir`, glob
    `${landmarkScanRelDir(dir)}/*.landmark.card` (as `landmarks.forDir` does, `router.ts:145-152`),
    take the first sorted match, `parseLandmarkFields`, return `navigation.openers` trimmed. No
    landmark in `dir` → repeat for `""`. A landmark that exists → its list is the answer, even when
    empty or unparseable (same "an answer, not a gap" rule). Input stays `{ contextDir? }`.
  - Behaviour change, accepted: today a place without a briefing inherits the root's openers.
    After, a place shows only its own; the root's onboarding openers show only in root chats.
    This is the design's rule ("The root landmark holds the box's onboarding openers").
  - Briefing: remove `openers` from `BriefingSchema.fields` (`briefing.tsx:66`), the instructions
    block (`:93-96`, `:108-129`), and `openerLine`/its use in `compileBriefing` (`:196-223`).
    Add one instructions line: "Chat openers live on the place's landmark (`navigation.openers`)."
  - Agent visibility: `compileBriefing` emits openers today so the agent "has to see its current
    suggestions on every turn to curate them" (`:221-223`). `compileBriefings` compiles only the
    root briefing (`compile/core.ts:77-108`). Keep that exact visibility: `compileBriefings` reads
    the root landmark's `navigation.openers` and passes them to `compileBriefing(fields, { openers })`,
    which emits the same `**Opener:**` lines.
  - Templates: `createBriefingTemplate` drops its two openers (run `pnpm template-stock:update`, as
    its doc comment requires, `briefing.tsx:256-258`). `createLandmarkTemplate` takes an optional
    `openers` list; `installRootLandmark` passes the two stock openers.
  - Guidance. Landmark instructions (`landmark.ts:168-230`) gain `openers` in the YAML example and a
    short "Openers" paragraph: openers are one-line first moves shown on the place page and on an
    empty chat in the place; when you build a place for a recurring job, you may add up to three for
    its standing first moves; keep only openers still useful in this place; the root's onboarding
    openers fade as the box is used. `docs/box/landmark-curation.md` gets two sentences. The retro
    procedure's `openers` step (`process-retrospective.procedure.card:267-400`) finds landmarks with
    an indented `openers:` line instead of briefings, judges each place's openers against that
    place's chats, and replaces "Remove the `openers:` field entirely once the box is in regular use"
    with the new rule. It still adds nothing to a place with no `openers:`.
  - Migration `briefing-openers-2026-10` (script, `src/scripts/migrate/briefing-openers.ts`, harness,
    appended to `MIGRATIONS`). Pure core `moveOpeners({ briefingText, landmarkText })` →
    `{ briefing, landmark, warnings }`, editing YAML with `parseDocument` as `landmark-symbol` does.
    Per `briefing.briefing.card`:
    - no `openers` key → `already`;
    - landmark card in the same directory (the root's is `_content/*.landmark.card`) → append the
      briefing's openers to `navigation.openers` (create `navigation` if absent), skipping ones
      already present; remove `openers` from the briefing; write both → `converted`;
    - root with no landmark card → create it with the same content `installRootLandmark` writes
      (box slug label, 📦), then move as above (two local boxes have
      a root briefing with openers and no `_content` landmark);
    - non-root with no landmark → leave the briefing unchanged and warn
      `"<path>: openers kept on the briefing; no landmark in this directory"`. Such a directory has no
      place, so moving the openers would change which place shows them; leaving them keeps the data,
      and the lenient loader's unknown-key lint warning keeps them visible. A local scan found no
      non-root briefing with openers.
    Idempotent: a second run reports `already` for every briefing. The `_warnings.ts`
    `ElementSpec` is XML-shaped; this YAML migrator emits its warnings through the harness's
    collector as `landmark-symbol` does.
- **Vocabulary lock-ins.** `navigation.openers`; migration name `briefing-openers-2026-10`;
  `chat.openers` input unchanged.
- **First implementation chunk.** Schema field + `OpenerEntry` move + the new reader in
  `openers-procedure.ts` + the rewritten `chat.openers` doctest (landmark at `_content/`, per-place,
  no-landmark fallback to root, empty list is an answer, malformed landmark gives `[]`, escape rejected).

### Track C — Place page

- **What.** A `Place` renderer for `.landmark.card`: symbol and label; "Start something" with the
  place's openers; then the resolved links in tiers; fields under Properties.
- **Why.** Opening a landmark shows its frontmatter and "No body content"
  (`CardBody.tsx:120-121`); the walks found it empty three times (issue).
- **Direction.**
  - Server: `landmarks.place({ path })` in `landmarks/router.ts`. Input is a box-relative card path
    ending `.landmark.card` (reject otherwise), namespace-checked like `forDir`. It calls
    `loadLandmarkPayload(path, { boxRoot, derive: true, expandsAsGroups: true })`. The new option
    gives every unnamed `expand` a `group` label from `expandLabel(query)` before calling
    `resolveLandmark`, so each expand resolves as its own `ResolvedGroup` with an exact `count`; no
    change to `resolveLandmark` itself. `expandLabel` (pure, `core/landmark/expand-label.ts`):
    `*.<type>.card` → "Every <type> card here"; `**/*.<type>.card` → "Every <type> card here and in
    folders below"; anything else → "Cards matching <query>". `LandmarkPayload` gains
    `openers: string[]` (from `navigation.openers`; cheap, so every caller gets it).
  - `ResolvedLink.source` gains `"place"` for nested landmark rows (`derived-links.ts:114`). No
    consumer outside `core/landmark/resolve` reads `source` (searched `src/` for `.source ===` and
    `source: "derived"`).
  - Frontend: `renderers/landmark.tsx`, `selector: { type: "landmark" }`, priority 100, lazy
    `components/PlaceView/view.tsx`. The container queries `landmarks.place` and owns loading
    (`StatusMessage`), error (`ErrorText` + retry) and data. The presentational part takes the
    payload and a pure `placeSections(payload)` (`components/PlaceView/sections.ts`) that returns
    `{ kind: "empty" }` when there are no links and no groups, else ordered sections:
    entry points (`source "derived"`, `prominence "entry-point"`), primary (`"derived"`, `"primary"`),
    places (`"place"`), pinned (`"listed"`), then each group. Empty → "Nothing here yet." and the
    folder as a link that opens the Browse system card at that directory (the target
    `replaceBrowseDetailTarget` builds, `provider.tsx:44-49`). A group with `count === 0` shows
    "None yet" under its label. Groups render open on this page (`LandmarkGroup` gains
    `defaultOpen`). A missing curated link keeps its row; `LinkTile`'s missing branch adds
    `line-through` to the name (this also changes the Landmarks page and Browse header, which use
    the same tile). Section heading wording is reviewed on the exhibit (below).
  - "Start something": shown when `openers.length > 0`. Clicking sends through
    `useSendOpener()`, a context provided in `InteractiveChatBody` (`view.tsx:262-272`) around
    `WorkspaceCanvas`, whose value is `actions.handleSendOpener`. Card panels render inside that
    tree (`view.tsx:270`), and so do chat embeds. Outside a chat (no provider) the group is not shown.
    The group reuses `clickOpener` per click and re-enables after the send settles.
  - Properties: `CardFacts` takes `typeFieldsOnBack: boolean`, passed by `PropertiesFace` as
    `active.name !== "Card"` (the same test `PropertiesFace.tsx:95` already makes). When true,
    `splitCardFields` puts type fields under Properties. This reaches every body-less type whose
    type-specific renderer is active (for example `question`, `todo-view`): today their fields show
    nowhere except the Source view. That widening is deliberate and is checked in the browse pass.
- **Vocabulary lock-ins.** Renderer name `Place`; procedure `landmarks.place`; `source: "place"`;
  `expandLabel`; `placeSections`; `useSendOpener`.
- **First implementation chunk.** `expandLabel` + `expandsAsGroups` + `source: "place"` +
  `openers` on the payload + `landmarks.place`, with a doctest on a fixture place (entry point,
  primary, nested place, curated missing link, unnamed expand with matches, unnamed expand with none,
  named group).

### Track D — Arrival

- **What.** When a conversation is selected and this tab has no saved arrangement for it, open the
  place's arrival target beside the chat.
- **Why.** Choosing "Lending" in the place menu showed a blank chat (issue). The design rule:
  "Arriving at a place with no cards open opens the place."
- **Direction.**
  - Server: `landmarks.arrival({ dir })` → `{ path: string } | null`. Null for `dir === ""` and for a
    directory with no landmark. Else: the pruned subtree's entry-point cards (filter as
    `nestedEntryPoint`); exactly one → that card's path; otherwise the landmark card's path.
  - Store: `select` (`workspace-browser-store.ts:97-130`) records whether it restored a saved
    arrangement (`memory` hit or `sessionStorage` value present) and exposes
    `takeArrivalCandidate(): boolean`, true once per identity when nothing was saved. `adopt` does
    not create a candidate (a fresh chat adopting its new session id keeps its arrangement).
  - Decision (pure, `workspace/arrival.ts`): `arrivalOpens({ candidate, decision, tabs, target })`
    opens only when the candidate flag is set, the navigation decision was `keep-current` (no card in
    the route, no history snapshot), and the state still has no tabs. Hook `usePlaceArrival` (own file,
    called from `useWorkspaceController`) fetches `landmarks.arrival` for the conversation target's
    `contextDir`, re-checks identity and emptiness after the fetch, then dispatches
    `openCard` with `replace` so Back does not gain a step.
  - Root excluded: the design's situations are all non-root places, and on a new box the root page
    would sit beside an empty chat showing the same openers twice. Open question 1 asks the boxholder.
  - Both viewports use the existing `openCard` reducer; on a phone that foregrounds the card
    (`state-reducer.ts:34`), which serves Tomas's in-the-store glance. Open question 2.
- **Vocabulary lock-ins.** `landmarks.arrival`; `takeArrivalCandidate`; `arrivalOpens`.
- **First implementation chunk.** `landmarks.arrival` + doctest (one entry point, two, none, root,
  no landmark, background place).

## Could this be simpler?

The simplest version is the ~250-line fix in *Smallest fix and budget*. It
fails on three named cases:

- It keeps openers on briefings, against the boxholder's decision, and keeps two concepts for one
  thing (principle 8). The place page would read a briefing to show "Start something".
- It shows unnamed `expand` results as an unlabeled flat list with no "None yet", so A-lending's
  `*.loan.card` place shows a list with no words for what it is, and an empty one disappears. The
  design names this guard explicitly ("each expanded group says in words what it lists").
- Arrival on "landmark card always" ignores the decided rule "a place with one entry point opens
  that card", so Tomas and Priya get the page instead of the list they set as the front door.

Over-builds considered and dropped: a separate place-resolution module (the
`expandsAsGroups` option reuses `resolveLandmark`); a persisted "visited"
flag per conversation (the store already knows whether it restored anything);
a back-compat reader for briefing openers (the migration runs before a
deployed box reopens, and the lenient loader covers the window); root arrival.

## Subplans

None. The migration is a single deterministic script; no sub-question needs its own design step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Reserved chat still loading shows openers for a moment, then a real history replaces them | Planned (`showsOpeners` loading case) | `loading` input | Clear |
| Opener click clobbers a half-typed draft | Planned (guard check) | Track A guard + toast | Clear |
| Root openers never found (path bug) recurs in the new reader | Planned (`chat.openers` doctest writes `_content/Box.landmark.card`) | `landmarkScanRelDir` | Would be silent; the doctest is the guard |
| Landmark with an invalid opener disappears from menus | Planned (schema doctest) | Existing parse-warning row | Clear |
| Migration finds a root briefing with openers and no root landmark | Planned (migration doctest) | Creates the root landmark | Clear |
| Migration finds non-root briefing with openers and no landmark | Planned | Leaves data, warns | Clear (warning + lint) |
| Template sync replaces an untouched briefing seed before the migration runs (dev box) | No | None: the two stock openers are lost | Silent; accepted (see below) |
| Arrival fetch resolves after the person opened a card or switched chat | Planned (`arrivalOpens` re-check) | Identity + emptiness re-check | Clear (nothing happens) |
| Arrival on a background (housekeeping) place | Planned (`landmarks.arrival` case) | Opens landmark card (no entry points under background) | Clear |
| Place page beside a chat bound to another place sends the opener to that other chat | No | None (Open question 3) | Visible: the message lands in the visible chat |
| `landmarks.place` given a non-landmark or escaping path | Planned | Input refine + namespace check | Clear (BAD_REQUEST) |
| Group capped at 50 hides items | Existing (`resolve.schema.doctest.md`) | "+N more" note | Clear |
| Properties now lists fields for other body-less types | No (browse check) | — | Visible change, intended |

> **Critical gap (accepted):** template sync before migration on a box whose
> root briefing is still the untouched stock seed. `installBriefing` takes the
> new seed (no openers) through the stock-hash allowlist
> (`defaults.ts:276-284`), and the migration then finds nothing to move, so
> the root landmark gets no openers. Production deploys migrate before the docs
> refresh (`docs/cards/migrations.md`, "Automatic convergence"), so this is
> reachable only on a local box that ran a chat or `bbx engine init` between
> code update and migration, and only while its briefing is untouched stock.
> The loss is two stock suggestions on an unused box.

## Agent-flow / user-flow edge cases

- **Wrong field.** The agent writes `openers:` at the landmark's top level instead of under
  `navigation`. ADDRESSED: unknown top-level key is stripped with a lint warning
  (`cards/schema.ts:557-563`); the instructions example shows the nested form; knowledge audit below.
- **Wrong card.** The agent adds openers to a briefing from habit. ADDRESSED: same lint warning;
  briefing instructions point to the landmark.
- **Stale ref.** A curated link's target is deleted. ADDRESSED: row stays, struck through
  (Track C). A derived target deleted mid-walk is dropped and logged (`derived-links.ts:73-80`).
- **Two agents touching the same card.** Retro step and chat agent both edit a landmark's openers.
  ADDRESSED by existing box commit flow; the retro step edits only `openers:` and its diff gate
  (`process-retrospective.procedure.card:402-404`) is retargeted to the landmark.
- **Hand-edit drift.** A boxholder writes a 200-character opener. ADDRESSED: validation error;
  the landmark shows as a parse problem rather than silently losing its openers.
- **Fabricated free-form value.** Openers are free text from the agent. ADDRESSED as today: one
  line, ≤120 characters, phrased from the person's side (instructions).
- **Validation error UX.** The moved refinements keep their messages ("an opener must be a single line").
- **Partial migration / transition state.** Between deploy and migration the box is closed
  (deploy holds admission). On a box where the migration has not run, the briefing's `openers` are
  stripped in memory and the landmark has none, so chats show no openers until it runs. ADDRESSED.
- **Place switch into a chat whose cards were saved in another tab.** GAP by design: arrangements
  are per tab (`sessionStorage`), so a new tab counts as no saved arrangement and arrival opens the
  place. Recorded under Open questions as a consequence, not a bug to fix here.

## NOT in scope

- **Root arrival.** Considered; deferred to the boxholder (Open question 1).
- **Agent-first turns** (the tutor issue). Openers are clicks by the person.
- **A collection view or directory view.** The page renders the landmark's existing resolution.
- **Changing nested-landmark rows** to the "exactly one entry point" rule. They keep "first entry
  point" (`derived-links.ts:121-131`); aligning them is a separate behaviour change.
- **A place-page row in the here menu.** With an entry point, arrival opens the entry card and the
  place page is reachable from the Browse header label and chat links only. Considered; Open question 4.
- **Rebinding chats or moving `contextDir`.**
- **Directory briefings in compiled guidance** (`compile/core.ts:103-104` TODO). Unchanged.
- **iOS.** No iOS surface reads openers (searched `ios-app/` for `openers`); the native shell renders
  the web transcript and card panels.
- **Saved arrangements across tabs or devices.**

## Open design questions

1. **Root arrival.** Should a fresh or resumed root chat with no saved arrangement open the root
   place page? Lean: not in this plan. On a new box it duplicates the openers beside the empty chat;
   on an established box it would put a home page beside every new root chat, which no situation in
   the design walks.
2. **Phone arrival.** Should arrival foreground the card on a phone (current `openCard` behaviour)?
   Lean: yes for an entry-point card (Tomas's glance); for an empty place page it hides the composer
   Juni needs. Verify both at 375px; if Juni's case reads wrong, skip foregrounding when the target
   is the landmark card and the place is empty.
3. **Openers on a place page beside another place's chat.** Wren's root chat links to Chemistry;
   "Start something" would send into the root chat. Lean: send into the chat beside (the attention
   snapshot names the landmark card), as the design says; switching chats on a click would be an
   implicit conversation change (frontend.md, "Workspace presentation").
4. **Reaching the place page when the place has an entry point.** Lean: add an "Open place page" row
   to the here menu in a follow-up, after seeing whether people miss it.

## Knowledge audits

New agent-facing concept: openers live on the place's landmark. Add to
`src/dev/knowledge-audits.yaml`:

- `landmark-openers-placement` (`knows_directly`): prompt "When I open Lending I want a button that
  says 'Log a new loan'." Expect an edit to the Lending landmark's `navigation.openers`, not the
  briefing. Run against the worktree test box clone
  (`pnpm knowledge-audit run --box ~/src/box-worktrees/journey-walks-oct/test1 --filter landmark-openers-placement`)
  after adding a Lending landmark fixture, and record the status comment.
- Re-run `starter-what-can-you-do` once to confirm the stock opener still reaches the agent's guide.

## What will hold this after it ships

All at the doctest tier; no new tier and no mocks of the chat machine.

- Backend doctests (`test/`): `chat.openers` rewritten for landmarks (the old file encodes the root
  path bug); `landmarks.place`; `landmarks.arrival`; `expandLabel`; landmark schema accepts and
  rejects openers; `compileBriefing` emits root landmark openers; the migration's pure
  `moveOpeners` (every branch, idempotent second run) plus one end-to-end run on a `makeTmpBox` box
  through the harness.
- Frontend doctests (`src/frontend/test/`): `showsOpeners`; the draft guard; `placeSections`;
  `arrivalOpens`; `workspace-browser-store` `takeArrivalCandidate` (extend
  `workspace.workspace-pane-storage.doctest.md`, which already injects storage); `PlaceView`
  static markup with a loaded payload (as the PersonView doctest does): empty place, "None yet",
  struck missing link, "Start something" hidden without a send context.
- Browser checks with `bin/browse` on the worktree's A-lending walk box
  (`~/src/box-worktrees/journey-walks-oct/a-lending-2026-10-08`, fictional) and the test1 clone,
  desktop and 375px: place menu → Lending opens "Lending list" beside an empty Lending chat; a resumed
  chat with a saved card is unchanged; a chat link to the Chemistry landmark (D-chemistry box) shows
  the page; a new empty place shows "Nothing here yet."; the fresh root chat shows the two stock
  openers; clicking one sends it; Properties on a landmark lists `navigation`. One exhibit
  (`bin/exhibits add`, ask `react`) with these captures, for the section wording and phone layout.

## Implementation order

Commit boundaries; the plan ships in one piece when every chunk is done and the boxholder says so.

1. Track A: `showsOpeners`, shell wiring, draft guard, doctests.
2. Track B schema and reader: `navigation.openers`, `OpenerEntry` move, `openers-procedure.ts`,
   rewritten `chat.openers` doctest.
3. Track B briefing side: remove the field, instructions, `compileBriefing` opener input from the
   root landmark, seed and root landmark templates, `pnpm template-stock:update`.
4. Track B migration: `moveOpeners` + doctest, script, `MIGRATIONS` entry, `docs/cards/migrations.md`
   paragraph; dry-run then apply on the worktree test1 clone and on a copy of the A-lending box;
   `bbx validate`; confirm manifest entry and regenerated `card-landmark.md`/`card-briefing.md`.
5. Track B guidance: landmark instructions, `docs/box/landmark-curation.md`, retro `openers` step,
   knowledge audit entry and run.
6. Track C server: `expandLabel`, `expandsAsGroups`, `source: "place"`, payload `openers`,
   `landmarks.place`, doctests.
7. Track C frontend: renderer, `PlaceView`, `placeSections`, `useSendOpener` provider,
   `LandmarkGroup.defaultOpen`, struck missing tile, `typeFieldsOnBack`, doctests.
8. Track D: `landmarks.arrival`, store candidate, `arrivalOpens`, `usePlaceArrival`, doctests.
9. Docs: `docs/landmarks.md` (schema field; replace "A place marker, not a visitable file" and
   "There is no landmark full form" with the place page; arrival), browse pass, exhibit,
   cross-model review.

## Rollout shape

- **Done when:** the doctests named above pass under `pnpm test:changed`; `pnpm typecheck` and
  `pnpm lint:changed` are clean; the browse pass matches the five scenarios walked below; the
  knowledge audit is run and recorded.
- **Migration ordering on production boxes.** The deploy controller holds each box closed, runs
  `bbx engine migrate --sweep` (script-only; `briefing-openers-2026-10` is a script), then refreshes
  generated docs, then reopens (`docs/cards/migrations.md`, "Automatic convergence and generated
  guidance"). So no production box serves the new schema against un-migrated briefings. The hourly
  `box-convergence` schedule retries a box that was busy. New boxes are seeded all-applied and get
  openers from the root landmark template instead.
- **Generated guidance.** The schema `instructions` regenerate each box's
  `.claude/rules/card-landmark.md` and `card-briefing.md` and the engine's `box-docs/` on the
  post-migration refresh. The retro procedure template updates through `installProcedures`'
  template tracker; a box that edited its copy parks the update, and its old step then finds no
  briefing openers and skips, which is harmless. After rollout, grep each box's `.claude/rules/` and
  `_content/briefing.md` for `openers` to confirm convergence (bbx-migration: "confirm it rather
  than assuming").
- **Legacy cleanup.** No compatibility reader is added, so no deferred cleanup issue is needed.
  Briefings the migration left with openers (non-root, no landmark) carry a lint warning; none
  exist locally.

## Scenario walks

Each walk traces the code path after this plan. Line numbers are today's.

**Tomas, A-lending, place menu → Lending (arrival on an entry point).**
1. `PlacePill.tsx:210` calls `openLandmarkChat("_content/lending")`; `useOpenLandmarkChat.ts:34`
   selects `{ kind: "landmark", contextDir }`.
2. `resolve-conversation.ts:94-95` asks `chat.lastSessionForDirectory`; with a prior chat it
   bootstraps it (`:104-119`), else `fresh` reserves one (`:47-61`).
3. The provider sees the new identity (`provider.tsx:83,93`); `select` finds nothing saved in this
   tab and sets the arrival candidate. The route has no card, so the decision is `keep-current`
   (`history.ts:178`).
4. `usePlaceArrival` fetches `landmarks.arrival({ dir: "_content/lending" })`. The box's pruned
   subtree has one entry point, `Lending_List.lending-list.card` (`prominence: entry-point` in the
   fixture), so it returns that path. The hook dispatches `openCard`; the list opens beside the chat.
5. If the chat is unstarted, `showsOpeners` is true and `chat.openers` reads
   `_content/lending/Lending.landmark.card`. The fixture landmark has no `openers`, so the list is
   empty and the chat shows "Start a conversation." (no root fallback, because a landmark exists).
6. Nothing is written by arriving. Left behind: this tab's saved arrangement now holds the list card.

**Priya, resume with cards.** Step 3 differs: `select` restores her saved arrangement from
`sessionStorage` (`workspace-browser-store.ts:113-123`), so no candidate is set and `arrivalOpens`
returns false. Her three cards show as she left them. In a new browser tab the same chat has no
saved arrangement and arrival opens the entry point; recorded as a known consequence.

**Wren, chat link to Chemistry.** The agent's link targets
`_content/courses/Intro_Chemistry.attach/Intro_Chemistry.landmark.card`. `WorkspaceCanvas`
routes the click to `workspace.open` (`WorkspaceCanvas/view.tsx:59`). The renderer registry
selects `Place` by type. `landmarks.place` resolves three curated links ("where I left off", "the
course", "session plan"; one target, the course card, is outside the landmark directory) and no
expands. `placeSections` returns one "pinned" section. If her chat is a root chat, "Start
something" (if the landmark had openers) would send into the root chat (Open question 3).

**Juni, empty place.** A new `Garden.landmark.card` with only a label. Arrival: no entry points
→ the landmark card opens. `landmarks.place` returns no links and no groups; `placeSections`
returns `empty`; the page shows "Nothing here yet." and a link to the Garden folder. The chat is
unstarted; Garden has no openers, so the composer sits under "Start a conversation." On a phone
the page is foregrounded (Open question 2).

**Tomas taps "Log a new loan".** Precondition: the Lending landmark lists it under
`navigation.openers` (the agent wrote it, per the new instructions). On an unstarted Lending chat,
`chat.openers` returns it, `ChatOpeners` renders it (`messages.tsx:283-289`), and a click runs
`clickOpener` → `handleSendOpener` → the draft guard passes on an empty composer →
`inputStore.set` + `handleSend` (`actions.ts:70-113`). On the place page the same function arrives
through `useSendOpener`. In a resumed Lending chat the arrival card is the list, not the page, so
the button is reachable only by opening the landmark card (Open question 4).
