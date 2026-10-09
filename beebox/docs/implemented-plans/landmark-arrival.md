---
title: "Landmark arrival"
status: implemented
workstream: journey-walks-oct
issues:
  - ../../../issues/closed/bugs/2026-10-08-landmark-switch-opens-empty-chat-not-the-place.md
  - ../../../issues/closed/bugs/2026-10-08-landmark-card-shows-its-config-not-its-places.md
  - ../../../issues/closed/bugs/2026-09-21-fresh-chat-reservation-suppresses-openers.md
---
# Landmark arrival

A person who goes to a place (a landmark) meets an empty chat or the
landmark's configuration. This plan makes a landmark card render as the place
page, makes arrival in a place's chat open the place on the desktop layout,
fixes the bug that hides openers on a fresh chat, and moves openers from
briefing cards to landmarks.

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

## Decisions from the boxholder (2026-10-08)

The boxholder accepted every recommendation below. The options are kept for
the record.

- **(a) Root arrival: option 1** ("Sure"). The root follows the rule.
- **(b) Place page beside another place's chat: option 3** ("OK, I think that
  makes sense"). Hide "Start something"; show a link to go to that place.
- **(c) Phone: no card opens on arrival** (see Direction).
- **(d) Place page with an entry point: option 1** ("OK, we'll try it").
  Browse and chat links only.
- **(e) Fallback openers: option 1** ("sounds fine to show none").
- **(f) Size: approved** ("that's fine") at about 2,150 changed lines.

### Options as presented

Each item names the options and the planner's recommendation. Tracks below
are written as if the recommendation is accepted; each names what changes if
it is not.

**(a) Root arrival.** Does the arrival rule apply to the root place?
- Option 1: yes. An empty or new root chat on the desktop layout opens the root place's
  arrival target (its single entry point, else the root place page).
- Option 2: no. The root is an exception; root chats never open a card.
- **Recommendation: option 1.** The design states the rule without an exception
  (design: "Arriving at a place with no cards open opens the place"), and the
  root is a landmark. The duplicate-openers problem is solved locally: a place
  page shown beside an empty, unstarted chat **in the same place** hides its
  "Start something" group, because the chat already shows the same openers.
  If option 2: Track D's `arrivalTarget` returns null for `dir === ""`; nothing else changes.

**(b) A place page shown beside a chat bound to a different place.** Wren's
root chat links to the Chemistry landmark. What does Chemistry's
"Start something" group do?
- Option 1: send the opener into the visible (root) chat.
- Option 2: switch to Chemistry's chat, then send.
- Option 3: hide "Start something"; show a "Go to Chemistry" link that opens
  Chemistry's chat (`useOpenLandmarkChat`). No cross-place sending.
- **Recommendation: option 3.** Option 1 sends a place's first move into
  another place's chat (review finding 9). Option 2 changes the conversation
  as a side effect of a click (frontend.md, "Workspace presentation").

**(c) Settled; see Direction.** On the phone layout arrival opens no card.
Boxholder (2026-10-08): *"on mobile we don't want a card opening
automatically, we only have enough room for one card or the chat, and the
chat would get preference"*.

**(d) Reaching the place page when the place has an entry point.** Arrival
opens the entry-point card, so the landmark card is not opened by arrival.
- Option 1: reachable from Browse (the folder header's landmark label) and from chat links only.
- Option 2: also add an "Open place page" row to the here menu.
- **Recommendation: option 1 for now.** Add option 2 later if people miss it.

**(e) Fallback openers.** A place whose landmark lists no openers.
- Option 1: it shows none.
- Option 2: it inherits the root's openers (today's briefing reader does this,
  `chat/router.ts:212-217`).
- **Recommendation: option 1.** The root's openers are onboarding prompts
  ("Let me tell you what this box is for.") and read wrong in a Lending chat.
  The design's rule is that a place carries its own openers.

**(f) Size approval.** The revised estimate is about 2,150 changed lines
(see *Smallest fix and budget*), a **BIG CHANGE**. Implementation needs the
boxholder's approval at this size.

## Design

[landmark-arrival.design.md](landmark-arrival.design.md). Its "Decided
(2026-10-08)" section and the "A place carries its own openers" rule are
boxholder decisions; this plan treats them as settled. The phone rule in
item (c) above is a later boxholder decision that narrows "Arriving at a
place with no cards open opens the place" to the desktop layout.

## Smallest fix and budget

**Smallest fix for the reported problems** (about 250 changed lines):
read the root briefing at its real path and drop the `sessionInput === "new"`
gate (openers show); register a landmark renderer that reuses
`LandmarkLinks`/`LandmarkGroup` fed by `landmarks.forDir` (the card shows its
places); open the landmark card on arrival when the chat has no saved
arrangement. It would fix the three issues but leaves openers on briefings,
which the boxholder decided against; it shows unnamed `expand` results as an
unlabeled flat list, which the design's "see the gears" guard rejects; and it
keeps the zero-entries inference the opener issue asks to avoid.

**Chosen design, four tracks.** Estimates are additions plus deletions.
Deletions are included (the briefing reader, `chat.openers`, briefing
instructions).

| Track | Source | Tests | Notes |
|---|---|---|---|
| A. Openers on an unstarted chat (`unstarted` from resolution, accepted/rejected send, draft guard) | 90 | 160 | |
| B. Openers move to landmarks (schema, reader removal, templates, guidance, fail-closed migration) | 520 | 420 | migration runner, plan, verify about 260 of the source |
| C. Place page (forDir payload fields, renderer, send context, landmark Properties) | 310 | 240 | no new procedure |
| D. Arrival (store candidate, provider transition, cancellation) | 80 | 100 | no new procedure, no new hook file |
| **Total** | **1,000** | **920** | |

Authored documentation: about 230 lines (`docs/landmarks.md` rendering,
schema, and arrival sections; `docs/cards/migrations.md` entry;
`docs/box/landmark-curation.md`; one knowledge-audit entry). Schema
instructions prose is counted in source. Generated output, reported
separately: the `briefing-seed` hash in `src/core/template-stock-hashes.ts`
(`pnpm template-stock:update`), the regenerated `docs/doc-graph.*`, and each
box's regenerated `box-docs/`, `.claude/rules/card-*.md`, and
`_content/briefing.md`.

**BIG CHANGE.** Source, tests, and authored docs total about 2,150 lines,
over the 2,000-line threshold. The review-driven cuts removed about 300
lines: the `landmarks.place` and `landmarks.arrival` procedures, the
separate `usePlaceArrival` fetch, the Properties change for every body-less
type, and the `chat.openers` procedure (openers now come from the
`landmarks.forDir` payload). The review-driven additions put about 330 lines
back: the migration's plan and verify phases, conflict failure, stock-briefing
recognition and its order test; `unstarted` carried from resolution with its
tests; accepted/rejected opener sends; the cross-place link; arrival
cancellation. Tests are the larger share of the additions because each
failure the review named gets its own case. The separable piece, if the size
must come down, is still Track B (about 940 lines with tests), but the
decision record says the move ships with this work. Approval: Decisions
needed, item (f).

## Stated preferences this plan trades against

- **Principle 8, one way to do each thing** (`docs/engineering-principles.md`).
  Openers today live on briefings and the place page needs them on the
  landmark; keeping both readers would be two ways. Track B removes the
  briefing field and the `chat.openers` reader; the empty chat and the place
  page both read `landmarks.forDir`.
- **Principle 4, resilient and never silent; bbx-migration "Be noisy about
  data loss".** The migration fails closed. An unresolved briefing (a conflict
  with an existing landmark list, or a non-root briefing with no landmark)
  makes the run exit with a hard failure and names the path. A warning would
  let the run record itself as applied (`migration-run.ts:153-154`:
  *"A soft (per-card) failure records the migration and continues"*).
- **Principle 10, testability.** Each decision (unstarted chat, arrival
  target, place sections, expand label, opener move) is a pure function with
  a doctest; the frontend has no DOM or effect harness
  (`src/frontend/test/` doctests use `renderToStaticMarkup`, see
  `src/frontend/test/components/PersonView.person-view.doctest.md:8-9`).
- **`beebox/CLAUDE.md` "Work only on the requested problem."** The Properties
  change is limited to landmark cards. The draft guard (Track A) also applies
  to the empty-chat openers; it is named under Track A with the reason.
- **Memory: minimize invented concepts.** No new card field beyond
  `navigation.openers`; no new store; no new tRPC procedure; arrival reuses
  `openCard` and the provider's existing navigation decision; the place page
  reuses `landmarks.forDir`.
- **Precedent:** `landmark-symbol` (`src/scripts/migrate/landmark-symbol.ts:21-24`)
  for a surgical YAML move inside landmark cards: *"Deliberately not merged
  into one YAML rewrite of the whole file: the edit is surgical … and
  `parse`→`stringify` would reorder and reflow every other key"*.

## What already exists

- **Opener send path.** `src/frontend/src/components/chat/everywhere/InteractiveChat/actions.ts:110-113`:
  *"const handleSendOpener = useCallback((text: string) => { inputStore.set(text); handleSend(); }"*.
  It returns nothing. `runSend` can still decline silently after that: *"if (sendInFlightRef.current) return;
  if (sendDisabledReason !== undefined) return;"* (`:72-73`).
- **Once-only click rule.** `ChatOpeners.tsx:27-35` `clickOpener(...)`: *"if (deps.alreadySent) return false;
  deps.markSent(); deps.onSendOpener(text); return true;"*. It marks the set sent **before** the send, and
  the send cannot report a refusal (review finding 8). Doctested in
  `src/frontend/test/components/chat/everywhere/InteractiveChat/ChatOpeners.chat-openers.doctest.md`.
- **Opener gate (the Track A bug).** `InteractiveChat/shell.tsx:78-80`:
  *"const isNew = params.sessionInput === "new"; const openersQuery = trpc.chat.openers.useQuery(..., { enabled: isNew });"*.
  A reserved fresh chat is a `session` target
  (`resolve-conversation.ts:61`: *"target: { kind: "session", sessionId: reserved.sessionId, contextDir }"*),
  and the shell passes *"sessionInput={sessionId ?? "new"}"* (`BoxConversationShell/view.tsx:85`).
- **Reservation receipts: the resolver already knows "fresh".** `fresh()` (`resolve-conversation.ts:47-71`)
  reserves a session and stores a receipt (`:55-56` *"receipts.put({ sessionId: reserved.sessionId, contextDir, engine, …"*),
  or returns a `start` target (`:67-70`). A resolved session keeps its receipt only while it has no history:
  `retireUsedReceipt` (`:79-83`) *"if (data.history.total === 0) return; … receipts?.remove(data.sessionId)"*.
  The selection hook also forgets a receipt on the first user message
  (`use-conversation-selection.ts:28-31`). An existing session with zero entries and no receipt is a
  different state; the issue asks to keep the two apart (issue lines 33-35: *"Preserve the difference between a fresh
  empty reservation and an existing conversation"*).
- **Opener reader (removed by Track B).** `src/webapp/trpc/routers/chat/router.ts:109-131` (`readBriefingOpeners`) and
  `:204-222` (`openers` procedure), with the root-fallback rule at `:212-217`.
- **Root path bug in that reader (found while planning).** `readBriefingOpeners` joins
  `path.posix.join(dir, "briefing.briefing.card")` (`:110`), so the root (`dir` `""`) reads
  `<boxRoot>/briefing.briefing.card`. The root briefing lives at `_content/briefing.briefing.card`
  (`src/core/box/guidance-surfaces.ts:88`; `src/core/docs-gen/compile/core.ts:81`). A probe against a
  `makeTmpBox` box with the briefing at `_content/briefing.briefing.card` returned
  `{"openers":[]}` for both `{}` and `{ contextDir: "_content/lending" }`. So **no v3 box shows root
  openers today**; the migration does not remove anything a person currently sees at the root.
  `test/webapp/trpc/routers/chat.openers.doctest.md` writes the briefing at the box root, so it encodes the bug.
- **`landmarks.forDir`** (`src/webapp/trpc/routers/landmarks/router.ts:137-164`): globs
  `${landmarkScanRelDir(input.dir)}/*.landmark.card` (`:145`), takes *"matches.toSorted()[0]"* (`:152`), and
  returns `loadLandmarkPayload(relPath, { boxRoot, derive: true })` (`:154`). `loadLandmarkPayload`
  (`landmarks/payload.ts:86-137`) computes the pruned subtree once (`:109` *"const derived = derive ? await
  prunedSubtree(boxRoot, dir) : undefined"*) and passes it to `resolveLandmark` (`:110-115`). The chat already
  queries it for its own directory (`InteractiveChat/LandmarkLinksPanel.tsx:47-50`, input
  *"{ dir: contextDir ?? "" }"*); so do the here menu (`AppNav/PlacePill.tsx:119-122`) and Browse
  (`pages/browse/BrowsePage.tsx:77`). Track B, C, and D extend its payload instead of adding procedures.
- **Landmark link resolution.** `src/core/landmark/resolve/core.ts:77-106` `resolveLandmark`
  (listed, derived entry-point/primary, nested landmarks, unnamed expands flattened at `:102-103`; named expands
  as `ResolvedGroup`s at `:98-100`, capped at `GROUP_CHILD_CAP = 50`, `:62`). `ResolvedLink.source` is
  *"\"listed\" | \"derived\" | \"expand\""* (`resolve/link-build.ts:30`). Nested-landmark rows are
  `source: "derived"` (`derived-links.ts:114`) and carry the nested landmark's level as `prominence` when it has one
  (`:115`), so a row's `source` and `prominence` cannot tell a nested place from a derived card.
- **Entry-point lookup.** `derived-links.ts:121-131` `nestedEntryPoint` filters the pruned subtree
  *"e.kind === "card" && e.level === "entry-point""* and takes the first. Arrival uses the same filter on the
  subtree `loadLandmarkPayload` already holds, but requires exactly one.
- **Link and group components.** `src/frontend/src/components/landmarks/LandmarkSection.tsx`
  `LandmarkLinks` (`:143-179`), `LandmarkGroup` (`:181-221`, collapsed by default), `LinkTile`
  missing branch (`:265-272`, shows the name and "Missing"). Reuse with two small props.
- **Type-specific renderer precedent.** `src/frontend/src/renderers/person.tsx`:
  *"selector: { type: "person" }, renderer: { name: "Person", …, priority: 100 }"*. Reuse the shape.
- **Workspace transition (where arrival goes).** `WorkspaceProvider/provider.tsx:109-149` is one effect.
  It returns early unless *"routeReady && routeBound"* (`:110`), deduplicates on a route stamp (`:112-114`),
  and asks `decideWorkspaceNavigation` (`:128-129`). On `restore-snapshot` it replaces the store from the
  history entry (`:130-139`, *"if (decision.entry.snapshot !== serializeWorkspaceState(store.get())) store.replace(decision.state)"*).
  On `keep-current` it only reveals the conversation (`:145-147`). Every non-restore path ends in
  *"projectHistory(true, …)"* (`:148`), which writes the store's snapshot into the history entry with
  `replace` (`:95-108`). `decideWorkspaceNavigation` (`workspace/history.ts:166-179`) returns
  `restore-snapshot` when the entry carries a snapshot for this identity (`:175-176`), else `keep-current`
  when there is no card URL (`:178`). An asynchronous dispatch after `:148` competes with the next pass's
  `restore-snapshot` (review finding 4); arrival therefore happens inside the `keep-current` branch.
- **Per-conversation workspace store.** `WorkspaceProvider/workspace-browser-store.ts:97-130` `select`
  restores the conversation's arrangement from memory (`:102-107`) or from `sessionStorage` (`:113-123`,
  *"const raw = storage.getItem(key)"*; legacy key `:116-117`), else `createEmptyWorkspaceState()` (`:103`).
  It does not report which happened. `adopt` (`:142-149`) moves the current arrangement to a new id. Each
  `dispatch` saves (`:155-161`).
- **Phone layout.** The provider takes `const mobile = useMobileChatViewport();
  const viewport = mobile ? "mobile" : "desktop";` (`provider.tsx:74-75`). The reducer's `openCard`
  foregrounds the card only on mobile: *"} else next = { ...next, mobileView: { kind: "card", path: action.target.path } };"*
  (`state-reducer.ts:34`). Arrival checks `viewport === "desktop"` before it dispatches.
- **Composer region.** `InteractiveChat-layout/view.tsx:237`:
  *"<div ref={composer} className="bbx-composer-material flex flex-col w-full max-w-5xl mx-auto min-w-0">"*
  wraps the selection notice, status banners, and composer. The composer textarea's change handler is
  `InteractiveChat-composer/view.tsx:118`.
- **Place switch.** `PlacePill.tsx:210` *"onSelectLandmark={(dir) => { void openLandmarkChat(dir); }}"* →
  `hooks/useOpenLandmarkChat.ts:33-35` *"await conversation.select({ kind: "landmark", contextDir: dir }); void navigate(...)"*.
  Unchanged; the place page's "Go to" link (decision b) calls the same hook.
- **Browse target.** `lib/browse-card-state.ts:63-65` `browseCardTarget(state)` returns
  *"{ path: SYSTEM_CARD_PATHS.browse, viewer: null, params: {}, viewState: browseStateToViewState(state) }"*.
  The empty place page's folder link opens `browseCardTarget({ directory })`.
- **Properties field split.** `ThemedFileCardProperties` renders `<CardFacts …/>` (`PropertiesFace.tsx:41`).
  `CardFacts` splits with *"splitCardFields(data.frontmatter ?? {}, { hasBodyField: data.schema?.hasBodyField ?? null, mode: "page" })"*
  and shows only `properties` under Fields (`CardProperties.tsx:37`, `:63-66`). `splitCardFields` sends type
  fields to the front when the type has no body field (`lib/card-field-faces.ts:56`
  *"const typeFieldFace: Face = embed || hasBodyField !== true ? "front" : "properties";"*). A landmark has no body,
  so once the Place renderer replaces the front, its fields show nowhere but the Source view.
  Precedent for a landmark-only branch on this face: `PropertiesFace.tsx:62`
  *"const isLandmark = isCard && data.type === "landmark";"*.
- **Opener validation.** `src/schemas/briefing.tsx:42-50` (`OPENER_MAX_LENGTH = 120`, one line, non-blank). Moved, not rewritten.
- **Root landmark install.** `src/core/box/structure/defaults.ts:238`
  *"createLandmarkTemplate({ label: await boxSlug(boxRoot), symbol: "📦" })"*. An existing root landmark
  with a role is never rewritten (`:249` *"if (hasRole) return null;"*); a new one goes through
  `installTemplateFile` at `_content/Box.landmark.card` (`:255-259`), so it can be a tracked template.
- **Briefing seed and template sync.** `createBriefingTemplate` (`briefing.tsx:260-270`) seeds two openers
  (`:262-264`). `installBriefing` (`defaults.ts:276-283`) installs it with
  *"priorStockHashes: TEMPLATE_STOCK_HASHES["briefing-seed"].superseded"* (`:281`); the ledger is
  `template-stock-hashes.ts:34-40`. The installer overwrites a file whose hash matches the last install
  or any prior stock hash (`install-template-file.ts:387-399`, *"|| priorStockHashes.includes(localHash)"*).
  So template sync can replace an untouched stock briefing, openers included, before the migration reads it
  (review finding 3).
- **Migration harness and exit codes.** `runMigration` (`src/scripts/migrate/_harness.ts:94-142`) returns
  after listing files in a dry run (`:107-110`), so a dry run never converts or warns. Per-file failures are
  collected (`:130-132`) and exit 2 (`:141`). Exit 2 is `SOFT_FAILURE_EXIT` (`core/migration-run.ts:153-154`),
  which records the migration. Any other non-zero code is a hard failure: the sweep returns
  *"status: "failed""* and records no manifest entry (`core/migration-sweep.ts:238-241`). The harness keeps a
  tracked template's ledger in step for the matched file only (`_harness.ts:119-126`,
  `recordAutomatedTemplateRewrite`, `core/template-update.ts:71-72`).
- **Lenient frontmatter.** `src/cards/schema.ts:557-563`: *"an unknown frontmatter key is stripped in
  memory, so a card that has drifted past its schema still loads … surfaced separately as a lint
  *warning*"*. This is the transition state for an un-migrated briefing.
- **Opener curation procedure.** `templates/procedures/process-retrospective.procedure.card:267-400`,
  step `openers`, finds briefings with `grep -q '^openers:'` (`:286`) and tells the agent
  *"Remove the `openers:` field entirely once the box is in regular use"* (`:358-360`). Rewritten for landmarks.
- **Briefing compile.** `compileBriefing(fields: BriefingFields, directoryLabel?: string)` (`briefing.tsx:209`)
  emits openers (`:223`) so the agent sees them every turn; `compileBriefings` compiles only the root briefing
  (`compile/core.ts:77-108`).

## Prior art (external)

No decision here depends on an external premise. All mechanisms are in-repo
(card renderers, tRPC, the migration runner, the workspace store). Search
skipped for that reason.

## Ontology

- **Place** (existing): a directory marked by a `*.landmark.card`; logical `dir` (`""` for the root,
  whose card is `_content/*.landmark.card`, `root-dir.ts:21-36`). Not a chat; a chat binds to one by `contextDir`.
- **Landmark card** (existing, `src/schemas/landmark.ts`): the place's file. After this plan it renders as the place page.
- **Place page** (new rendering, renderer name `Place`): what a landmark card shows. Points at the
  place's resolved links and its openers. Not a collection view and not a directory view.
- **Opener** (existing term): one line, ≤120 characters, sent as the person's message when clicked.
  Moves from `briefing.openers` to `navigation.openers` on the landmark. Not an agent-first turn.
- **Place openers** (rebuilt): `landmarks.forDir({ dir }).landmark.openers`. No landmark → none. No
  inheritance from the root (decision e).
- **Unstarted chat** (new name for an existing state): a conversation the resolver created for this tab and
  that has no committed turn: a `start` target, or a `session` target that still holds this tab's reservation
  receipt. Carried as `ResolvedConversation.unstarted`. Not "a session with zero entries": an existing empty
  session without a receipt is not unstarted.
- **Saved arrangement** (existing data, new name): the `WorkspaceState` stored for a conversation
  identity in this browser tab's memory or `sessionStorage`. An arrangement with no cards still counts as saved.
- **Arrival candidate** (new store flag): set by `select` when it found no saved arrangement; cleared by
  any user interaction with the selected chat or by being taken.
- **Arrival target** (new payload field `arrival`): the single `entry-point` card in the place's pruned
  subtree when there is exactly one, else the landmark card.
- **Entry point** (existing prominence level, `src/shared/prominence.ts`): unchanged.
- **Expand group** (existing `ResolvedGroup`): on the place page every `expand` is a group; an unnamed
  one gets a plain-words label from its query.
- **Nested place link** (new `ResolvedLink.source` value `"place"`): the row for a nested landmark, today
  `source: "derived"` (`derived-links.ts:114`). Needed because `prominence` cannot separate it (see What already exists).
- **Stock briefing** (existing data, named here): a briefing whose sha256 equals the `briefing-seed`
  `current` hash or one of its `superseded` hashes (`template-stock-hashes.ts:34-40`).

## Tracks / scope

Implementation order follows dependency: A has none; B gives the landmark
`openers` that A's chat and C's page read; D reads B's payload field `arrival`
and is verified against C.

### Track A — Openers on an unstarted chat

- **What.** Show openers on any unstarted chat. Make an opener click report whether it was sent.
- **Why.** Every 2026-10-08 walk opened on "Start a conversation." with no openers
  (issue re-encounter list). The reserved fresh chat is a `session` target, so the gate never opens.
- **Direction.**
  - `ResolvedConversation` (`resolve-conversation.ts:23`) gains `unstarted: boolean`, set where the
    resolver already knows it:
    - `fresh()` returns `unstarted: true` for the reserved session (`:61`) and the `start` target (`:67-70`);
    - the `restore` request (`:87`): true for a `start` target, else `receipts?.get(sessionId) !== undefined`;
    - the bootstrapped session (`:117-119`): `data.history.total === 0 && params.receipts?.get(data.sessionId) !== undefined`,
      read after `retireUsedReceipt`;
    - the initial restored state (`use-conversation-selection.ts:33`): true for a restored `start` target.
    An existing session with zero entries and no receipt resolves `unstarted: false`.
  - The conversation context exposes `unstarted` beside `rendered`; `BoxConversationShell/view.tsx:85-91` passes
    it to `InteractiveChat`. `useChatBinding` (`shell.tsx:67-81`) replaces `isNew` with `unstarted` and reads
    openers from `trpc.landmarks.forDir.useQuery({ dir: contextDir ?? "" }, { enabled: unstarted && contextDir !== null })`
    (`data.landmark?.openers ?? []`). The rendering condition in `messages.tsx:283-289`
    (`messages.length === 0 && !isStreaming`) is unchanged; it hides openers once the first message lands,
    so `unstarted` does not need to flip on send.
  - `handleSendOpener(text): "accepted" | "rejected"` (`actions.ts:110-113`). Rejected, with nothing written to the
    composer, when the composer holds non-blank text (toast "Send or clear your draft first."), when
    `sendInFlightRef.current` is true, or when `sendDisabledReason !== undefined` (the two silent returns at
    `:72-73`). Accepted otherwise: `inputStore.set(text); handleSend()`. The decision is a pure
    `openerSendDecision({ draft, inFlight, disabledReason })` in `InteractiveChat/opener-send.ts`.
  - `clickOpener` (`ChatOpeners.tsx:27-35`) calls `onSendOpener` first and calls `markSent` only when it returns
    `"accepted"`. A rejected click leaves the buttons enabled. The draft survives conversation switches
    (`shell.tsx:10-12`), so a rejection is reachable on any empty chat.
- **Vocabulary lock-ins.** `unstarted`; `openerSendDecision`; `"accepted" | "rejected"`.
- **First implementation chunk.** `unstarted` in `resolve-conversation.ts` with cases in the existing
  `resolve-conversation.doctest.md`: reserved fresh; `start` fallback; reload of a reserved session with its
  receipt (unstarted); existing empty session without a receipt (not unstarted); resumed session with history
  (not unstarted). Then `openerSendDecision` and the `clickOpener` sequence (rejected → not marked, buttons
  enabled; accepted → marked; second click after acceptance → no call). No open question inside.

### Track B — Openers move to landmarks

- **What.** Add `navigation.openers` to the landmark schema; ship it on the `landmarks.forDir` payload;
  delete `chat.openers` and `readBriefingOpeners`; remove `openers` from the briefing schema; migrate existing
  briefings; move the stock openers from the briefing seed to the root landmark template; rewrite the agent guidance.
- **Why.** Boxholder decision (design, "Decided"): one concept in one place. The root path bug above
  also means today's reader serves no root openers on a v3 box.
- **Direction.**
  - Schema: `LandmarkNavigation` (`landmark.ts:100-106`) gains `openers: z.array(OpenerEntry).optional()`.
    `OpenerEntry` and `OPENER_MAX_LENGTH` move from `briefing.tsx:42-50` to `landmark.ts` unchanged.
    The field sits under `navigation` beside `chat-app` (`:105`), the existing per-place chat seed. An invalid
    opener makes the landmark fail `parseLandmarkFields`, which shows as a parse warning row on the
    Landmarks page (`docs/landmarks.md`, "Parse warnings").
  - Reader: `LandmarkPayload` (`payload.ts:29-55`) gains `openers: string[]` (trimmed, blanks dropped).
    `chat.openers` (`chat/router.ts:204-222`) and `readBriefingOpeners` (`:109-131`) are deleted, with
    `test/webapp/trpc/routers/chat.openers.doctest.md`. No landmark in the directory → `forDir` returns
    `landmark: null` → no openers (decision e). A landmark that exists → its list is the answer, even when empty.
  - Briefing: remove `openers` from `BriefingSchema.fields` (`briefing.tsx:66`), the instructions
    block (`:93-96`, `:108-129`). Add one instructions line: "Chat openers live on the place's landmark
    (`navigation.openers`)."
  - Agent visibility: `compileBriefing` keeps emitting `**Opener:**` lines, now from the root landmark.
    Its signature becomes `compileBriefing(fields, { directoryLabel, openers })` (two-parameter rule,
    `code-style.md`); `compileBriefings` (`compile/core.ts:77-108`) reads the root landmark's
    `navigation.openers` and passes them.
  - Templates: `createBriefingTemplate` drops its two openers (`pnpm template-stock:update`, as its doc comment
    requires, `briefing.tsx:256-258`). The two strings become `STOCK_ROOT_OPENERS` in `landmark.ts`.
    `createLandmarkTemplate` takes an optional `openers` list; `installRootLandmark` passes `STOCK_ROOT_OPENERS`.
  - Guidance. Landmark instructions (`landmark.ts:168-230`) gain `openers` in the YAML example and a
    short "Openers" paragraph: openers are one-line first moves shown on the place page and on an
    empty chat in the place; a place with none shows none; when you build a place for a recurring job, you may
    add up to three for its standing first moves; the root's onboarding openers fade as the box is used.
    `docs/box/landmark-curation.md` gets two sentences. The retro procedure's `openers` step
    (`process-retrospective.procedure.card:267-400`) finds landmarks with an indented `openers:` line instead of
    briefings, judges each place's openers against that place's chats, and replaces "Remove the `openers:`
    field entirely once the box is in regular use" with the new rule. It still adds nothing to a place with no `openers:`.
  - **Migration `briefing-openers-2026-10`** (script, `src/scripts/migrate/briefing-openers/`, appended to
    `MIGRATIONS`). It fails closed. It does not use `runMigration`, because the harness has no whole-box
    plan or verify phase and its per-file failure is the soft exit 2 that records the migration
    (`_harness.ts:141`, `migration-run.ts:153-154`). It reuses the harness's conventions (`<boxRoot> [--apply]`,
    one summary line, `recordAutomatedTemplateRewrite` for tracked files).
    - **Pure core** `planOpenerMoves(inputs) → { moves, failures }` (`plan.ts`). Input per `*.briefing.card`
      anywhere in the box: its path, text, sha256, and the first sorted `*.landmark.card` in the same physical
      directory (the rule `forDir` uses, `router.ts:152`) with its text. YAML edits use `parseDocument`, as
      `landmark-symbol` does. Cases, per briefing:
      1. **Untouched stock briefing** (sha256 in `briefing-seed` `current` or `superseded`), at
         `_content/briefing.briefing.card`: rewrite it to the current `createBriefingTemplate()` text; if the root
         landmark has no `navigation.openers` key, set it to `STOCK_ROOT_OPENERS`; if the root landmark has the
         key (any list, `[]` included), leave it. This covers both orders: the old stock seed with openers, and the
         new stock seed written by template sync before the migration ran (review finding 3). It also matches what
         a new box gets.
      2. **No `openers` key** (and not case 1) → `already`.
      3. **Landmark in the same directory, no `navigation.openers` key** → set `navigation.openers` to the
         briefing's list (create `navigation` if absent); remove `openers` from the briefing → `converted`.
      4. **Landmark in the same directory with a `navigation.openers` key** (any list, `[]` included). The
         landmark list is authoritative and is never appended to. If the briefing's list equals it after trimming,
         remove `openers` from the briefing → `converted`. Otherwise → **failure** `conflict`:
         *"<briefing>: openers differ from <landmark> navigation.openers; resolve by hand"*.
      5. **Root briefing (`_content/`) with no root landmark** → create `_content/Box.landmark.card` with the
         content `installRootLandmark` writes (box slug label, 📦) plus the briefing's openers, then case 3.
      6. **Non-root briefing with openers and no landmark in its directory** → **failure** `no-place`:
         *"<briefing>: openers have no landmark in this directory; add a landmark here or move them by hand"*.
         Alternatives considered: create a landmark (adds a new place to every menu, a visible change the
         boxholder did not ask for); move to the nearest ancestor landmark (changes which place shows them);
         keep them on the briefing (the reader is gone, so they would be stranded and the convergence check could
         never pass). Chats bind to the nearest landmark directory (`chat/router.ts:184`
         *"const contextDir = await nearestLandmarkDir(…)"*), so no new chat reads such a briefing today; the
         openers are reachable only from an old session bound to a directory whose landmark was later removed.
         There is no resolution that keeps visible behavior without a person's choice, so the run fails.
    - **Runner** (`run.ts`), three phases per box:
      1. *Plan*: read every briefing and landmark input, call `planOpenerMoves`. Any failure → print each
         failure with its path, write nothing, `process.exit(1)` (a hard failure: no manifest entry, later
         migrations wait, `migration-sweep.ts:238-241`). The box is untouched, so a retry after a manual fix is clean.
         Without `--apply` the runner stops here and prints the planned moves and failures (a real dry run, unlike
         `_harness.ts:107-110`).
      2. *Apply*: write each move. For each written path that `readVersions` tracks (the root briefing; a root
         landmark installed through `installTemplateFile`), call `recordAutomatedTemplateRewrite` with the before
         and after text, as `_harness.ts:119-126` does for its matched file.
      3. *Verify* (the convergence check): re-scan every `*.briefing.card`; parse the frontmatter; any card still
         carrying an `openers` key → print the paths and `process.exit(1)`. Also `--verify` alone runs only this
         phase, for the post-rollout check.
      Idempotent: a second run plans no moves and verifies clean.
    - With repair enabled (the hourly convergence schedule), a hard failure gives the in-box agent a bounded
      repair attempt; `docs/cards/migrations.md` ("Admission, snapshots, and failures") says *"substantive deletion
      or choosing between divergent content requires the boxholder's answer"*, so a `conflict` becomes a question to
      the boxholder. The deploy sweep is script-only and leaves the box on the old migration set until it is resolved.
- **Vocabulary lock-ins.** `navigation.openers`; `STOCK_ROOT_OPENERS`; migration name `briefing-openers-2026-10`;
  failure kinds `conflict`, `no-place`.
- **Implementation notes (2026-10-08).**
  - The migration has a third failure kind, `malformed`: an `openers` value that is not a list of strings, or
    YAML that does not parse where an edit is needed. It fails the box the same way.
  - An empty or null briefing `openers:` has nothing to move, so it is removed even where the directory has no
    landmark; case 6 applies only to a non-empty list.
  - Parked template mirrors under `_config/_template-updates/` are skipped by plan and verify; the installer
    rewrites them.
  - Schema modules may not import one another (the `member-imports` commit check), so the briefing field
    removal (step 3) landed with the schema move (step 2).
  - The briefing instructions keep the stock-purpose sentence ("When the purpose is still the stock stub…");
    it is about `{% purpose %}`, not about where openers live.
  - `installRootLandmark` never rewrites an existing root landmark that has a role, so template sync cannot
    add the stock openers to an existing box's root landmark before or after the migration.
  - The knowledge audit cannot run on the worktree's test1 clone directly: the clone keeps uncommitted setup
    changes (`package.json` link) that the audit's box guard refuses. Run it on a disposable `git clone` of the
    clone with `.beebox/box.json` copied in.
  - (2026-10-08, review fix) The plan checks every landmark it would write with `parseLandmarkFields`; a moved
    opener the schema rejects (blank, multi-line, over 120 characters) is `malformed` and fails the box.
- **First implementation chunk.** Schema field + `OpenerEntry` move + `openers` on `LandmarkPayload` + a
  `landmarks.forDir` doctest (landmark at `_content/`, per-place list, place with no list gives `[]`, empty list is
  an answer, no landmark gives `landmark: null`, malformed opener makes the landmark unparsed).

### Track C — Place page

- **What.** A `Place` renderer for `.landmark.card`: symbol and label; "Start something" with the
  place's openers (subject to decisions a and b); then the resolved links in tiers; fields under Properties.
- **Why.** Opening a landmark shows its frontmatter and "No body content"
  (`CardBody.tsx:121`); the walks found it empty three times (issue).
- **Direction.**
  - Server, no new procedure. `landmarks.forDir` input gains `expandsAsGroups: z.boolean().optional()`. When
    true, `loadLandmarkPayload` gives every unnamed `expand` a `group` label from `expandLabel(query)` before
    calling `resolveLandmark`, so each expand resolves as its own `ResolvedGroup` with an exact `count`
    (`resolve/core.ts:98-100`); `resolveLandmark` itself is unchanged. The menus omit the flag and keep the flat list.
    `expandLabel` (pure, `core/landmark/expand-label.ts`): `*.<type>.card` → "Every <type> card here";
    `**/*.<type>.card` → "Every <type> card here and in folders below"; anything else → "Cards matching <query>".
  - `LandmarkPayload` gains `arrival: string` (Track D) beside `openers` (Track B). Both come from data
    `loadLandmarkPayload` already holds, so no caller pays a second read.
  - `ResolvedLink.source` gains `"place"` for nested landmark rows (`derived-links.ts:114`). No
    consumer outside `core/landmark/resolve` reads `source` (searched `src/` for `.source ===` and
    `source: "derived"`).
  - Frontend: `renderers/landmark.tsx`, `selector: { type: "landmark" }`, priority 100, lazy
    `components/PlaceView/view.tsx`. The container queries
    `landmarks.forDir({ dir: <card's directory>, expandsAsGroups: true })` and owns loading (`StatusMessage`),
    error (`ErrorText` + retry), and data. The card's directory is the path's parent (`_content` for the root;
    `forDir` maps it, `landmarkScanRelDir`, `root-dir.ts:34-36`). If `payload.path` differs from the opened card
    (two landmarks in one folder; the convention is one), the page shows `ErrorText` naming both paths instead of
    the other card's links. The presentational part takes the payload and a pure `placeSections(payload)`
    (`components/PlaceView/sections.ts`) that returns `{ kind: "empty" }` when there are no links and no groups,
    else ordered sections: entry points (`source "derived"`, `prominence "entry-point"`), primary
    (`"derived"`, `"primary"`), places (`"place"`), pinned (`"listed"`), then each group. Empty → "Nothing here
    yet." and the folder as a link that opens `browseCardTarget({ directory })` (`browse-card-state.ts:63-65`).
    A group with `count === 0` shows "None yet" under its label. Groups render open on this page
    (`LandmarkGroup` gains `defaultOpen`). A missing curated link keeps its row; `LinkTile`'s missing branch adds
    `line-through` to the name (this also changes the Landmarks page and Browse header, which use the same tile).
    Section heading wording is reviewed on the exhibit (below).
  - "Start something". `InteractiveChatBody` (`view.tsx:261-272`) provides a `PlaceChatContext` around
    `WorkspaceCanvas` (`:270`) with `{ contextDir, showsOwnOpeners, sendOpener }`: the chat's bound directory,
    whether the chat is currently showing its own openers (`unstarted` and no messages), and
    `actions.handleSendOpener`. A pure `startSomething({ payloadDir, openers, chat })` decides:
    - no context (the page outside a chat) → hidden;
    - `openers` empty → hidden;
    - same place and `showsOwnOpeners` → hidden; the chat already shows them (decision a);
    - same place otherwise → shown; a click goes through `clickOpener` and the accepted/rejected send (Track A);
    - different place → hidden, and a "Go to <label>" link calls `useOpenLandmarkChat(boxSlug)(payload.dir)`
      (decision b).
    Same place compares `payload.dir` with the chat's `contextDir`; both are logical dirs (`""` for the root,
    `normalizeLandmarkDir`, `root-dir.ts:62-64`).
  - Properties, landmark only: `CardFacts` (`CardProperties.tsx:37`) shows a landmark's type fields under
    Fields: for `data.type === "landmark"` (the test `PropertiesFace.tsx:62` already makes) it merges the split's
    `front` into `properties`. `splitCardFields` and its three other callers are unchanged, so `question`,
    `todo-view`, and other body-less types keep today's Properties.
- **Vocabulary lock-ins.** Renderer name `Place`; `forDir` input `expandsAsGroups`; payload fields `openers`,
  `arrival`; `source: "place"`; `expandLabel`; `placeSections`; `startSomething`; `PlaceChatContext`.
- **Implementation notes (2026-10-08).**
  - The chat and the page share the opener buttons, so the layout check (rule 3) moved `ChatOpeners.tsx` and
    `opener-send.ts` from `InteractiveChat/` to `components/openers/`, beside `place-chat.ts` (`PlaceChatContext`,
    `startSomething`). `useRefetchOnFileChange` moved to `hooks/`; the page refetches on file changes.
  - The "Go to <label>" link shows beside another place's chat whether or not the place has openers.
  - The card header already shows the mark and label, so the page draws them only in an embed.
  - Section headings: "Start here", "Main cards", "Places inside", "Pinned". Entry-point rows carry no tag.
  - `showsOwnOpeners` is `unstarted && no messages && not streaming`; `ChatBodyProps` gains `unstarted`.
  - An unnamed `expand` with an empty query gets no group label (it lists nothing). Without derivation
    (`derive: false`) `arrival` is the landmark card.
  - The app has no dark mode (`prefers-color-scheme` changes nothing); the theme check used a post-it card
    theme with the spectrum system theme.
  - (2026-10-08, review fix) A listed link whose card is also a derived entry point or primary card keeps that
    level as its `prominence` (the listed row still wins the dedup); `placeSections` puts it in that tier, not Pinned.
- **First implementation chunk.** `expandLabel` + `expandsAsGroups` + `source: "place"` + payload `openers` and
  `arrival`, with a `forDir` doctest on a fixture place (entry point, primary, nested place, curated missing link,
  unnamed expand with matches, unnamed expand with none, named group; without the flag the unnamed expand stays flat).

### Track D — Arrival

- **What.** On the desktop layout, when a conversation is selected and this tab has no saved arrangement for
  it, open the place's arrival target beside the chat. On the phone layout, open nothing.
- **Why.** Choosing "Lending" in the place menu showed a blank chat (issue). The design rule:
  "Arriving at a place with no cards open opens the place." Phone rule: decision (c).
- **Direction.**
  - Arrival target, on the server: `loadLandmarkPayload` sets `arrival` from the pruned subtree it already
    computed (`payload.ts:109`): the entries with `kind === "card" && level === "entry-point"`; exactly one →
    that card's box-relative path; otherwise the landmark card's path. Applies to the root too (decision a).
  - Store: `select` (`workspace-browser-store.ts:97-130`) sets `arrivalCandidate = true` only when it found
    nothing in memory (`:102-107`) and `raw === null && legacy === null` (`:115-117`). New methods:
    `takeArrival(): boolean` returns the flag and clears it; `cancelArrival()` clears it. `adopt` (`:142-149`)
    and `dispatch` (`:155-161`) clear it: an adopted fresh chat keeps its arrangement, and any card action by
    the person ends the pending arrival. A pointer, focus, or key event anywhere in the chat pane
    (transcript included, not only the composer) also calls `cancelArrival()` (review round 2, finding 5).
  - Provider transition (`provider.tsx:109-149`). The arrival is decided and consumed inside this effect, in
    the branch that today produces `keep-current`, before `projectHistory` (`:148`) writes the history entry:
    - `useWorkspaceController` queries `trpc.landmarks.forDir.useQuery({ dir: conversationTarget.contextDir },
      { enabled: viewport === "desktop" && store.hasArrival() })`. Same input as the chat's openers query (Track A),
      so React Query shares one request.
    - After the guard at `:110`, and before the route-stamp check at `:113`: if `store.hasArrival()` and the
      viewport is desktop and the query has not settled (success or error), return. The query's settled state
      is an effect dependency, so the effect runs again when it lands. On the phone layout the effect never waits.
    - `restore-snapshot` (`:130-139`): call `store.takeArrival()` and discard the result. A history snapshot is
      a saved arrangement.
    - `keep-current` (`:145-147`): `const arrive = store.takeArrival()`; pure
      `arrivalOpens({ arrive, viewport, tabCount, target })` in `workspace/arrival.ts` is true only when
      `arrive`, `viewport === "desktop"`, the state has no tabs, and `target` (the payload's `arrival`) is non-null.
      When true, `store.dispatch({ type: "openCard", target: parseViewUrl(target), label, at, viewport })`; then
      the existing `projectHistory(true, …)` at `:148` writes one history entry that already holds the card.
      Because the card is in the store before the snapshot is written, the next pass's `restore-snapshot`
      restores the same state; there is nothing to race.
    - `open-url` (`:140-144`): `takeArrival()` and discard; the URL's card is the person's intent.
    - A failed query logs `console.warn` with the directory and opens nothing (code-style "Logging levels").
  - Cancellation. A pending arrival exists only between `select` and the query settling. Any user interaction
    with the selected chat cancels it: `ChatView`'s composer region (`InteractiveChat-layout/view.tsx:237`) gets
    `onFocusCapture`, `onPointerDownCapture`, and `onKeyDownCapture` handlers that call `workspace.cancelArrival()`;
    opening a card from the transcript or a menu goes through `open`/`dispatch` (`provider.tsx:158-180`), which
    reach `store.dispatch` and clear the flag.
  - Reload. `sessionStorage` survives a reload in the same tab, and the history entry keeps `bbxWorkspace`.
    After an arrival opened a card, the store saved it on dispatch, so reload restores it (`restore-snapshot`)
    and does not arrive again. If the person closed the card, `closeTab` saved an arrangement with no cards, so
    reload restores the empty arrangement and does not arrive again. If arrival opened nothing (phone, or no
    landmark) and the person did nothing, nothing was saved, so reload evaluates arrival again with the same result.
  - Back. Arrival adds no history entry (it rides `projectHistory(true)`, a replace). Back leaves the place chat
    the way it does today. Forward returns to that entry; its snapshot holds the arrived card, `select` finds the
    saved arrangement, and no second arrival runs.
- **Vocabulary lock-ins.** `arrival` (payload field); `arrivalCandidate`, `takeArrival`, `cancelArrival`,
  `hasArrival`; `arrivalOpens`.
- **Implementation notes (2026-10-08).**
  - `arrivalOpens` lives in `WorkspaceProvider/arrival.ts`: the layout check moves a module used by one
    directory into it.
  - The cancellation handlers sit on the whole chat desk (transcript, cards, composer). They count only
    events whose target is inside the desk's DOM: the app-bar chips are React portals published from the
    chat, so their events bubble through the desk's React tree.
  - With `sessionStorage` unavailable, a selection with nothing in memory is a candidate (nothing is saved);
    a storage read that throws is not.
  - The arrived card's target is built from the path (`viewer: null`), not parsed with `parseViewUrl`.
  - The schema instructions no longer call the landmark card "not a visitable file"; boxes get the new line
    on their next guidance refresh.
  - `pnpm doc-check` does not ask for `docs/doc-graph.md`; regenerating it in a worktree also lists
    gitignored walk notes, so it was left as is.
  - (2026-10-08, review fix) The provider decides the navigation first; only `keep-current` waits for `forDir`
    (`arrivalWaits` in `arrival.ts`). A card URL or a history snapshot opens at once while the query is pending.
- **First implementation chunk.** `arrival` on the payload + doctest cases (one entry point, two, none, root,
  background place) inside Track C's `forDir` fixture doctest; then `arrivalOpens` and the store flag.

## Could this be simpler?

The simplest version is the ~250-line fix in *Smallest fix and budget*. It
fails on four named cases:

- It keeps openers on briefings, against the boxholder's decision, and keeps two concepts for one
  thing (principle 8). The place page would read a briefing to show "Start something".
- It shows unnamed `expand` results as an unlabeled flat list with no "None yet", so A-lending's
  `*.loan.card` place shows a list with no words for what it is, and an empty one disappears. The
  design names this guard explicitly ("each expanded group says in words what it lists").
- Arrival on "landmark card always" ignores the decided rule "a place with one entry point opens
  that card", so Tomas and Priya get the page instead of the list they set as the front door.
- It infers "fresh" from zero entries, which the opener issue asks not to do.

Cut after review (each was in the previous draft): the `landmarks.place` and `landmarks.arrival`
procedures (the `forDir` payload carries the page data and the arrival target); the separate
`usePlaceArrival` fetch and hook (arrival lives in the provider's existing transition); the Properties
change for every body-less type (landmark only); the `chat.openers` procedure and its new file
(the chat reads openers from `forDir`). Over-builds considered and dropped earlier: a separate
place-resolution module; a persisted "visited" flag per conversation (the store already knows whether
it restored anything); a back-compat reader for briefing openers (the migration fails closed instead).

## Subplans

None. The migration is a single deterministic script; no sub-question needs its own design step.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| An existing empty session shows openers as if fresh | Planned (`resolve-conversation` case: no receipt) | `unstarted` from the receipt | Clear |
| Opener click clobbers a half-typed draft | Planned (`openerSendDecision`) | Rejected + toast | Clear |
| Rejected opener click disables the buttons | Planned (`clickOpener` sequence) | Mark sent only on `"accepted"` | Clear |
| Root openers never found (path bug) recurs | Planned (`forDir` doctest with `_content/Box.landmark.card`) | `landmarkScanRelDir` | Would be silent; the doctest is the guard |
| Landmark with an invalid opener disappears from menus | Planned (schema doctest) | Existing parse-warning row | Clear |
| Migration appends to or overrides an explicit landmark list | Planned (`planOpenerMoves` case 4, `[]` and non-empty) | List is authoritative; differ → `conflict` | Clear: hard failure names both paths |
| Non-root briefing with openers and no landmark | Planned (case 6) | `no-place` failure, nothing written | Clear: hard failure names the path |
| Template sync replaces the stock briefing before the migration | Planned (end-to-end: `installBriefing` first, then the migrator) | Stock recognition (case 1) | Clear |
| Migration records itself as applied with openers left on a briefing | Planned (verify phase case) | Verify phase exits 1 | Clear |
| Arrival dispatch races the history snapshot replace | Planned (`arrivalOpens`; browser: first selection, reload, Back) | Arrival inside the `keep-current` branch before `projectHistory` | Clear |
| Arrival opens a card after the person started typing | Planned (store: `cancelArrival` then `takeArrival` is false; browser: focus composer before the query lands) | Composer-region capture handlers; `dispatch` clears | Clear (nothing opens) |
| Arrival opens a card on a phone | Planned (`arrivalOpens` mobile case; 375px browser check) | Desktop-only check | Clear |
| Slow or failed `forDir` delays or blocks the workspace | Planned (failed-query case logs and settles) | Wait only while a candidate exists on desktop; error settles | Visible: warn log |
| Arrival on a background (housekeeping) place | Planned (`forDir` fixture case) | Opens landmark card (no entry points under background) | Clear |
| "Start something" sends into another place's chat | Planned (`startSomething` different-place case) | Hidden + "Go to" link (decision b) | Clear |
| Two landmarks in one folder; the page shows the other's links | Planned (`PlaceView` markup case) | `ErrorText` naming both paths | Clear |
| Group capped at 50 hides items | Existing (`resolve.schema.doctest.md`) | "+N more" note | Clear |

No silent failure is accepted. The previous draft's accepted gap (template
sync before migration loses the stock openers) is closed by case 1 and its
order test.

## Agent-flow / user-flow edge cases

- **Wrong field.** The agent writes `openers:` at the landmark's top level instead of under
  `navigation`. ADDRESSED: unknown top-level key is stripped with a lint warning
  (`cards/schema.ts:557-563`); the instructions example shows the nested form; knowledge audit below.
- **Wrong card.** The agent adds openers to a briefing from habit. ADDRESSED: same lint warning;
  briefing instructions point to the landmark. The migration's `--verify` would also report it.
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
  (deploy holds admission). A box whose migration failed (conflict or no-place) keeps its briefing openers,
  stripped in memory by the lenient loader, and shows no openers until a person resolves the failure. The
  failure is visible as a failed migration and, under repair, a question. ADDRESSED.
- **Untouched stock briefing on an established box.** Case 1 gives the root landmark the stock onboarding
  openers. A box that never edited its briefing then shows them on new root chats until the retro step
  fades them. ADDRESSED: that is what a new box shows, and the retro owns their removal.
- **Place switch into a chat whose cards were saved in another tab.** GAP by design: arrangements
  are per tab (`sessionStorage`), so a new tab counts as no saved arrangement and arrival opens the
  place. Recorded as a consequence, not a bug to fix here.

## NOT in scope

- **Arrival on the phone layout** (decision c).
- **Agent-first turns** (the tutor issue). Openers are clicks by the person.
- **A collection view or directory view.** The page renders the landmark's existing resolution.
- **Changing nested-landmark rows** to the "exactly one entry point" rule. They keep "first entry
  point" (`derived-links.ts:121-131`); aligning them is a separate behavior change.
- **A place-page row in the here menu** (decision d).
- **Properties for other body-less types** (`question`, `todo-view`). Their fields still show only in Source.
- **Rebinding chats or moving `contextDir`.**
- **Directory briefings in compiled guidance** (`compile/core.ts:103-104` TODO). Unchanged.
- **iOS.** No iOS surface reads openers (searched `ios-app/` for `openers`); the native shell renders
  the web transcript and card panels.
- **Saved arrangements across tabs or devices.**

## Open design questions

The open items are in *Decisions needed from the boxholder* near the top:
(a) root arrival, (b) a place page beside another place's chat, (d) reaching
the place page when it has an entry point, (e) fallback openers, (f) size.
Item (c) is settled. No open question sits inside a first implementation chunk:
each chunk's code is the same under either option, except Track D's root case,
which is one line.

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

- Backend doctests (`test/`): `landmarks.forDir` payload (`openers`, `arrival`, `expandsAsGroups`,
  `source: "place"`); `expandLabel`; landmark schema accepts and rejects openers; `compileBriefing` emits root
  landmark openers; `planOpenerMoves` for every case (1 with the old and the new stock hash, 2, 3, 4 equal,
  4 differ with `[]` and with a non-empty list, 5, 6) and an idempotent second plan; one end-to-end run per order on
  a `makeTmpBox` box: (i) migrator on the old stock seed, (ii) `installBriefing` first, then the migrator; both end
  with `STOCK_ROOT_OPENERS` on the root landmark, the briefing at the current stock hash, and the template ledger
  in step; (iii) a conflict box exits 1 and writes nothing; (iv) `--verify` exits 1 on a planted briefing `openers`.
  `chat.openers.doctest.md` is deleted with the procedure.
- Frontend doctests (`src/frontend/test/`): `resolve-conversation` `unstarted` cases; `openerSendDecision`;
  the `clickOpener` sequence; `placeSections`; `startSomething` (no context, same place unstarted, same place
  started, different place); `arrivalOpens` (desktop, mobile, tabs present, null target, not a candidate);
  `workspace-browser-store` candidate flag (set on nothing saved; not set on memory or storage hit; cleared by
  `adopt`, `dispatch`, `cancelArrival`, and `takeArrival`), extending `workspace.workspace-pane-storage.doctest.md`,
  which already injects storage; `PlaceView` static markup with a loaded payload (as the PersonView doctest does):
  empty place, "None yet", struck missing link, "Start something" hidden without a context, "Go to" link for a
  different place, mismatch error.
- Browser checks with `bin/browse` on the worktree's A-lending walk box
  (`~/src/box-worktrees/journey-walks-oct/a-lending-2026-10-08`, fictional) and the test1 clone:
  - desktop, first selection: place menu → Lending opens "Lending list" beside the Lending chat;
  - desktop, reload after arrival: the same card, no second card; close it and reload: nothing opens;
  - desktop, Back after arrival: leaves the place chat with no extra step; Forward: the card is back, once;
  - desktop, cancellation: throttle the network, choose Lending, focus the composer and type before the
    response lands: no card opens;
  - 375px: place menu → Lending shows the chat only;
  - a resumed chat with a saved card is unchanged;
  - a chat link to the Chemistry landmark (D-chemistry box) from a root chat shows the page with a
    "Go to" link and no "Start something";
  - a new empty place shows "Nothing here yet."; the fresh root chat shows the two stock openers and,
    under decision (a), the root page beside it without "Start something";
  - clicking an opener with a draft in the composer shows the toast and leaves the buttons enabled;
  - Properties on a landmark lists `navigation`.
  One exhibit (`bin/exhibits add`, ask `react`) with these captures, for the section wording and the root page.

## Implementation order

Commit boundaries; the plan ships in one piece when every chunk is done and the boxholder says so.

1. Track A: `unstarted` in resolution and the shell, `openerSendDecision`, `clickOpener`, doctests.
2. Track B schema and reader: `navigation.openers`, `OpenerEntry` move, payload `openers`, shell reads
   `forDir`, delete `chat.openers` and its doctest.
3. Track B briefing side: remove the field and instructions, `compileBriefing` openers from the root
   landmark, `STOCK_ROOT_OPENERS`, seed and root landmark templates, `pnpm template-stock:update`.
4. Track B migration: `planOpenerMoves` + doctest, `run.ts` with plan/apply/verify, `MIGRATIONS` entry,
   `docs/cards/migrations.md` paragraph. Then the migration verification below.
5. Track B guidance: landmark instructions, `docs/box/landmark-curation.md`, retro `openers` step,
   knowledge audit entry and run.
6. Track C server: `expandLabel`, `expandsAsGroups`, `source: "place"`, payload `arrival`, doctests.
7. Track C frontend: renderer, `PlaceView`, `placeSections`, `PlaceChatContext`, `startSomething`,
   `LandmarkGroup.defaultOpen`, struck missing tile, landmark Properties, doctests.
8. Track D: store flag, provider transition, `arrivalOpens`, composer-region cancellation, doctests.
9. Docs: `docs/landmarks.md` (schema field; replace "A place marker, not a visitable file" and
   "There is no landmark full form" with the place page; arrival, desktop only), browse pass, exhibit,
   cross-model review.

**Migration verification (step 4).**

*Production inventory, 2026-10-08 (read-only, counts only).* 31 briefing
cards. 23 have no openers. 5 with openers are parked template copies under
`_config/_template-updates/`, which the migration skips. 3 are root briefings
beside `_content/Box.landmark.card`: one untouched stock seed (case 1) and two
customized (case 3). No landmark lists openers, so no conflict case exists.
Every production shape is one already applied on a local copy.


1. *Inventory, read-only.* List every briefing and the opener shape around it on every box the migration
   will run on. Local: `~/src/boxes/*/` and `~/src/box-worktrees/*/*/`. Production: the coordinator runs the
   command below; the agent writes it and does not run it. It prints paths and hashes only, no card content;
   the output stays out of tracked files (paths can be private; record it in `private-issues/` if kept).

   ```bash
   deploy/prod-ssh "su - beebox -c 'bash -s'" <<'EOF'
   set -euo pipefail
   cd /home/beebox/boxes
   for box in */; do
     box=${box%/}
     find "$box" -name .git -prune -o -name '*.briefing.card' -print | while IFS= read -r f; do
       dir=$(dirname "$f")
       has=$(grep -c '^openers:' "$f" || true)
       sha=$(sha256sum "$f" | cut -d' ' -f1)
       lm=$(find "$dir" -maxdepth 1 -name '*.landmark.card' | sort | head -n1)
       if [ -z "$lm" ]; then lmo=none
       elif grep -qE '^[[:space:]]+openers:' "$lm"; then
         # a fingerprint of the list, so equal and differing lists can be told apart
         lmo="listed:$(sed -n '/^[[:space:]]*openers:/,/^[[:space:]]*[a-z-]*:[[:space:]]*$/p' "$lm" | sha256sum | cut -c1-12)"
         bo="$(sed -n '/^openers:/,/^[a-z-]*:/p' "$f" | sha256sum | cut -c1-12)"
         lmo="$lmo briefing-openers:$bo"
       else lmo=absent; fi
       printf '%s\t%s\topeners=%s\tsha=%s\tlandmark=%s\tlandmark-openers=%s\n' \
         "$box" "${f#"$box"/}" "$has" "$sha" "${lm#"$box"/}" "$lmo"
     done
   done
   EOF
   ```

   The local run is the same body with `cd ~/src/boxes` (and again for each `~/src/box-worktrees/<name>/`).
   Classify each row into the `planOpenerMoves` cases by `openers=`, whether `sha=` is a `briefing-seed` hash,
   whether the briefing is under `_content/`, and `landmark-openers=`. Any row that would be case 4 (differ) or
   case 6 is reported to the boxholder before deploy.
2. *Apply on resettable copies, one per distinct shape.* For each shape the inventory found, copy one local box
   holding it to the scratchpad (a git checkout, so `git reset --hard` restores it), then run
   `run.ts <copy>` (plan output), `run.ts <copy> --apply`, `bbx validate`, and `run.ts <copy> --verify`, then `bbx engine migrate` on the copy, because a standalone script run does not write the manifest entry (review round 2). A shape
   found only on production gets a `makeTmpBox` fixture reproducing its row, not a copy of production content,
   unless the boxholder approves a copy.
3. *Check the result on each copy:* the copy's `_config/migrations.jsonl` gets the `briefing-openers-2026-10`
   entry when `bbx engine migrate` runs it, and does not when a conflict copy fails; regenerated
   `card-landmark.md`/`card-briefing.md` no longer teach briefing openers; and in the browser, a fresh chat in each
   migrated place shows the openers the inventory row predicted.

## Rollout shape

- **Done when:** the doctests named above pass under `pnpm test:changed`; `pnpm typecheck` and
  `pnpm lint:changed` are clean; the browser checks above pass; the migration verification above is done for
  every inventoried shape; the knowledge audit is run and recorded.
- **Migration ordering on production boxes.** The deploy controller holds each box closed, runs
  `bbx engine migrate --sweep` (script-only), then refreshes generated docs, then reopens
  (`docs/cards/migrations.md`, "Automatic convergence and generated guidance"). A box that fails the
  migration (conflict or no-place) records no manifest entry and keeps its later migrations pending; the
  inventory step exists so this is known before deploy. The hourly `box-convergence` schedule retries and, with
  repair, asks the boxholder. Template sync order does not matter (case 1). New boxes are seeded all-applied and
  get openers from the root landmark template.
- **Convergence check.** The run is converged only when `run.ts <box> --verify` exits 0 on every box (locally),
  and the production inventory command above, re-run by the coordinator after deploy, shows `openers=0` on every
  row. Then grep each box's `.claude/rules/` and `_content/briefing.md` for briefing `openers` guidance
  (bbx-migration: "confirm it rather than assuming").
- **Generated guidance.** The schema `instructions` regenerate each box's
  `.claude/rules/card-landmark.md` and `card-briefing.md` and the engine's `box-docs/` on the
  post-migration refresh. The retro procedure template updates through `installProcedures`'
  template tracker; a box that edited its copy parks the update, and its old step then finds no
  briefing openers and skips, which is harmless.
- **Legacy cleanup.** No compatibility reader is added, so no deferred cleanup issue is needed. The
  migration leaves no briefing with openers on a converged box.

## Scenario walks

Each walk traces the code path after this plan. Line numbers are today's.

**Tomas, A-lending, desktop, place menu → Lending (arrival on an entry point).**
1. `PlacePill.tsx:210` calls `openLandmarkChat("_content/lending")`; `useOpenLandmarkChat.ts:34`
   selects `{ kind: "landmark", contextDir }`.
2. `resolve-conversation.ts:94-95` asks `chat.lastSessionForDirectory`; with a prior chat it
   bootstraps it (`:104-119`, `unstarted: false`), else `fresh` reserves one (`:47-61`, `unstarted: true`).
3. The provider sees the new identity (`provider.tsx:83,93`); `select` finds nothing saved in this
   tab and sets the arrival candidate. The provider's `forDir({ dir: "_content/lending" })` query starts;
   the effect waits for it.
4. The payload lands. Its pruned subtree has one entry point, `Lending_List.lending-list.card`
   (`prominence: entry-point` in the fixture), so `arrival` is that path. The route has no card, so the decision
   is `keep-current` (`history.ts:178`). `takeArrival()` is true, the viewport is desktop, there are no tabs:
   `openCard`, then `projectHistory(true)`. The list opens beside the chat; the history entry holds it.
5. If the chat is unstarted, the shell's openers come from the same payload. The fixture landmark has no
   `openers`, so the chat shows "Start a conversation." (no root fallback, decision e).
6. Nothing is written by arriving. Left behind: this tab's saved arrangement now holds the list card.

**Tomas, phone.** Steps 1-2 as above. In step 3 the provider does not wait (viewport mobile). In step 4
`arrivalOpens` is false; the chat shows alone. Decision (c).

**Priya, resume with cards.** Step 3 differs: `select` restores her saved arrangement from
`sessionStorage` (`workspace-browser-store.ts:113-123`), so no candidate is set and the provider does not
wait. Her three cards show as she left them. In a new browser tab the same chat has no saved arrangement and
arrival opens the entry point; recorded as a known consequence.

**Wren, chat link to Chemistry, from a root chat.** The agent's link targets
`_content/courses/Intro_Chemistry.attach/Intro_Chemistry.landmark.card`. `WorkspaceCanvas`
routes the click to `workspace.open` (`WorkspaceCanvas/view.tsx:59`). The renderer registry
selects `Place` by type. `PlaceView` queries `forDir({ dir: "_content/courses/Intro_Chemistry.attach",
expandsAsGroups: true })`, which resolves three curated links ("where I left off", "the course", "session
plan"; one target, the course card, is outside the landmark directory) and no expands. `placeSections`
returns one "pinned" section. The chat's `contextDir` is `""`, not the page's dir, so `startSomething`
hides the group and shows "Go to Intro Chemistry" (decision b).

**Juni, empty place, desktop.** A new `Garden.landmark.card` with only a label. Arrival: no entry points,
so `arrival` is the landmark card, and it opens. The page's payload has no links and no groups;
`placeSections` returns `empty`; the page shows "Nothing here yet." and a link to the Garden folder. The chat
is unstarted; Garden has no openers, so the chat shows "Start a conversation." and the page shows no
"Start something". If Juni clicks into the composer before the payload lands, `cancelArrival` runs and no
page opens.

**Tomas taps "Log a new loan".** Precondition: the Lending landmark lists it under
`navigation.openers` (the agent wrote it, per the new instructions). On an unstarted Lending chat,
the shell's `forDir` query returns it, `ChatOpeners` renders it (`messages.tsx:283-289`), and a click runs
`clickOpener` → `handleSendOpener` → `openerSendDecision` accepts on an empty composer →
`inputStore.set` + `handleSend` (`actions.ts:70-113`) → `markSent`. With a draft in the composer the click is
rejected with the toast and the buttons stay enabled. On the place page beside a started Lending chat the same
send arrives through `PlaceChatContext`. Beside the unstarted Lending chat the page hides the group (decision a).
