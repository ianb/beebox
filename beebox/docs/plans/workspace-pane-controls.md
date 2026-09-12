---
title: "Workspace panes, focus, and conversation"
status: partial
workstream: paper-cards
issues: []
---
# Workspace panes, focus, and conversation

When a conversation points to a card, inspect it without losing the conversation.
When two cards need comparison, give them both space. On a phone, read one surface
at a time and return to the transcript without losing the cards.

This plan replaces the companion panel's close/pop-out controls with pane-level
focus, move, and conversation controls. It removes the mobile vertical split.
It does not introduce saved workspaces, landmark pinning, or a file picker.

**Issues addressed:** No existing issue is closed wholesale by this plan.
Related: [mobile modal rather than split](../../../issues/features/2026-07-23-mobile-modal-not-split-pane.md)
and [chat input everywhere](../../../issues/features/2026-08-30-chat-input-everywhere.md).
They cover more than these controls and remain open. Deferred issues are listed
under NOT in scope. The [new-chat navigation reset](../../../issues/closed/bugs/2026-09-08-new-chat-card-navigation-resets-start.md)
was a relevant acceptance case and is covered by the route-intent regression.

## Stated preferences this plan trades against

Direct user requirements for this work:

- Controls for the active pane belong beside its tabs, in the former close/pop-out
  location. Each tab keeps its own close action for cleanup of inactive cards.
- Desktop focus is tiered: focused card → previous split → full conversation.
  Leaving focused mode must not jump straight to the full transcript.
- Show conversation toggles only the pane where it was invoked. Putting both
  card panes aside allows one full-width transcript.
- Show cards is a floating transcript control, not another toolbar row. It must
  coexist with the existing floating speech control. Remove the obsolete floating
  thinking indicator, not thinking data or debug rendering.
- When chat is visible, opening a card targets the opposite pane. This can move
  an existing tab out of the cards hidden behind chat. Reuse it; do not duplicate it.
- Mobile has one visible pane. Strip out the vertical split, including the
  fixed-height companion presentation. Retain ambient chat when a card is shown.
- No dragging or arbitrary picker. Directional move acts on the active tab.
- Chat sits on the shared theme background. Callouts are foreground objects and
  should retain that distinction in both transcript and ambient presentation.

These preferences constrain the design, including where it differs from editor
applications. [Engineering principles](../engineering-principles.md) supply the
implementation choices: §1 “Types are structure”; §3 “Validate at boundaries and
during parsing”; §8 “One way to do each thing”; §9 “Formal structure for essential
complexity”; §10 “Testability is architectural, and deeper than usual taste”; §13 “A control shows the state the system is in”.
The existing [chat-everywhere plan](chat-everywhere.md) is the recipient/attention
contract, not permission to replace the conversation controller.

## What already exists

Paths in the source citations below are relative to `beebox/`. Line numbers are
from the paper-cards checkout inspected during planning; refresh them after main
is merged. Quoted text identifies the relevant code when line numbers move.

| Existing boundary and evidence | Reuse / change |
|---|---|
| `src/frontend/src/components/chat/InteractiveChat-view.tsx:291`: `hasCompanion={!mobile` | Replace the gate and mobile route-away owner; the old vertical CSS is currently unreachable here. |
| `src/frontend/src/components/chat/everywhere/use-mobile-card-navigation.ts:13-20`: `A phone foregrounds the inspected card` | Replace route-away with single-pane workspace projection. |
| `src/frontend/src/hooks/useViewNavigate.ts:30`: `overlay.open(target, hint)` | Fold participating ambient/in-card opens into openCard. |
| `src/frontend/src/components/chat/everywhere/card-context-store.ts:10`: `const next = [...cards.values()].at(-1) ?? null;` | Replace mount-order authority with visible workspace activation. |
| `src/frontend/src/components/chat/everywhere/card-context.tsx:30`: `store.focus(owner, ref)` | Hidden retained roots must release attention without unmounting. |
| `src/frontend/src/components/chat/everywhere/use-conversation-route.ts:75`: `if (overlay) window.history.back();` | Preserve Back semantics for mobile transcript covering a card; replace participating route adapter. |
| `src/frontend/src/components/chat/sidecar-tabs.ts:27-30`: `tabs: SidecarTab[];` and `activePath: string \| null;` | Replace the single strip state with two pane records and one global tab identity domain. |
| `sidecar-tabs.ts:82,87-89`: `state.tabs.find((t) => t.target.path === target.path)`; “One tab per path.” | Preserve path identity globally, including updates of viewer/params/viewState in place. |
| `sidecar-tabs.ts:103-105`: “Closing the active tab falls back to its neighbour” | Preserve neighbor selection within the source pane. |
| `sidecar-tabs.ts:46`: `MAX_UNPINNED_TABS = 12` | Retain a total cap of twelve unpinned tabs; protect both pane selections and pinned tabs. Do not double the cap accidentally. |
| `src/frontend/src/components/chat/sidecar-tabs-storage.ts:4`: “sessionStorage, per browser tab, per box, per conversation” | Preserve conversation ownership for this scope. Landmark ownership is explicitly deferred. Add versioned two-pane storage and development-worktree scoping. |
| `sidecar-tabs-storage.ts:27-28`: key includes `boxSlug` and `sessionInput` | Current key does not identify development worktree. Do not import ambiguous foreign legacy state. |
| `src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:53-54`: `parseViewUrl(initialCard)` then `onZoomView({ target, label: target.path })` | Route restoration and link opening currently share a callback. Separate restore from a fresh open intent so replay does not move a tab again. |
| `src/frontend/src/components/chat/InteractiveChat-controls.tsx:178`: `h-[40vh] md:h-full md:w-1/2` | Remove the mobile height/split contract, not just hide its border. |
| `InteractiveChat-controls.tsx:190-191`: `bbx-panel-open-browse` and `bbx-panel-close` | Replace these actions; close-panel must no longer invoke closeAll. Retire old IDs rather than give them new meanings. |
| `InteractiveChat-controls.tsx:195,203`: `tabs.map` and `key={tab.target.path}` | Preserve visited card mounts and scroll positions across focus, aside, and moving. |
| `src/frontend/src/components/chat/everywhere/use-conversation-route.ts:31`: `transcriptVisible = chatPage \|\| overlay` | Replace this visibility authority with workspace projection for participating routes; pathname alone cannot imply visible transcript anymore. |
| `src/frontend/src/components/chat/everywhere/BoxConversationShell.tsx:71,87-94`: one `<InteractiveChat`, `transcriptVisible`, and `<AmbientReplies` | Keep one conversation runtime, composer, and ambient owner. Derive their attention from actual projected visibility. |
| `BoxConversationShell.tsx:63-64`: publication `kind: "selection"` through `beeboxComposerBinding` | Pane actions change attention, never recipient selection or send-time bindings. |
| `src/frontend/src/components/chat/ChatMessages.tsx:136-147`: “Zero-height sticky bar”; `sticky top-2 ... h-0` | Reuse the no-row floating control pattern; coordinate restore/speech positioning. |
| `ChatMessages.tsx:148-150`: `ThinkingCornerMark` and `SpeechMenu` | Remove only the floating thinking decoration. Keep speech operations and menu context. |
| `src/frontend/src/components/chat/CalloutBlock.tsx:35-36`: `border-l-4 border-accent` and `bg-accent-50` | Add theme role styling to this shared foreground surface. |
| `src/frontend/src/components/chat/ambient/AmbientSessionReply.tsx:60`: `<CalloutStack callouts={reply.callouts}` | The same callout host already reaches ambient replies; do not create a second callout renderer. |
| `docs/mobile-contract.md:285-290`: attention carries “focusedRef, and visible/hidden transcript”; “ordinary route movement never retargets” | Preserve the wire shape; change the source of attention, test native publication. |

**Concurrent work:** main advanced during this planning pass (observed
`12c5c0591`), and chat-everywhere has overlapping conversation routing/storage
work. That is an implementation preflight dependency: merge current committed
main into this worktree, inspect any unlanded overlapping work with its owner,
and rebase the plan's adapters on the authoritative shell. Never copy sibling
working-tree edits or overwrite main's staged files. Existing uncommitted theme
work in this checkout remains separate from this planning pass.

## Prior art (external)

- [VS Code Custom Layout](https://code.visualstudio.com/docs/configure/custom-layout)
  separates editor groups from focused presentation. Reuse that distinction,
  not its dragging, arbitrary group creation, or duplicate-editor semantics.
- [WAI-ARIA Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
  specifies tab/panel relationships and keyboard activation. Each desktop card
  strip remains a tablist; pane controls sit outside that tablist. The mobile
  combined strip has one active tab and one visible panel.
- [WAI automatic activation example](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/examples/tabs-automatic/)
  recommends automatic activation only when panels display instantly. Preserve
  the existing tab activation behavior and loading feedback; do not force every
  card to load merely to make a focus transition appear immediate.

No external library supplies this exact chat-background focus ladder. Its
transition semantics come from the requirements above, not editor conventions.

## Tracks / scope

### A. One pane-state decision core

**What / why:** A single pure reducer owns the open tabs, their side, retained
selections, and desktop focus state. Two independent sidecar reducers cannot
atomically move an already-open hidden tab or prevent cross-pane duplicates.

**Direction:** Proposed module group `components/chat/workspace/`. Reuse
`SidecarTab`/`ViewTarget` data and canonical path identity; introduce:

```ts
type PaneId = "left" | "right";
type PaneDisplay = "cards" | "chat";
type Pane = { paths: string[]; activePath: string | null; display: PaneDisplay };
type WorkspaceLayout = { kind: "split" } | { kind: "focus"; pane: PaneId };
type MobileView =
  | { kind: "chat"; returnPath: string | null }
  | { kind: "card"; path: string };
type WorkspaceState = {
  version: 2;
  tabs: Record<string, SidecarTab>;
  panes: Record<PaneId, Pane>;
  layout: WorkspaceLayout;
  lastCardPane: PaneId;
  chatAnchor: PaneId;
  mobileView: MobileView;
  lastInteraction: { kind: "chat" } | { kind: "card"; path: string };
};
```

A pane with no tabs has `activePath: null` and cannot display cards. A pane
showing chat retains its card selection when it has cards. Both displays may
be chat in state, but projection renders one full-width transcript, never two
copies. `chatAnchor` remembers the side most recently changed to chat; this
settles where to open a card from the full-width transcript. Fresh state uses
right as chatAnchor, so first opens use left.

Actions: `openCard`, `selectTab`, `closeTab`, `togglePin`, `moveActive`,
`focusPane`, `backToSplit`, `showChat`, `restoreCards`, `restoreSnapshot`.
Each action carries explicit path/pane/time where required, plus viewport
(desktop/mobile) for open, select, showChat, and restoreCards decisions. Output includes the
next state and a focus effect describing the control/panel to focus after paint.
No clock reads, navigation, React state, or storage writes inside the reducer.
moveActive reveals the destination as cards and activates the moved tab. Its
source retains a neighbor selection, or becomes chat if empty. Pane order stays
pinned-first, preserving relative order within pinned/unpinned groups. Mobile
combines left then right, with pinned-first stable ordering across that sequence.

**Invariants:** one registry entry per canonical path; exactly one owning pane
per entry; activePath belongs to that pane; no empty cards display; focus targets
a nonempty cards pane. Restore and close normalize these invariants. Invalid
internal actions fail in development tests; stale UI events for already-closed
paths are harmless typed no-ops.

**Open destination table (load-bearing):**

| Situation when a fresh open intent arrives | Destination and presentation |
|---|---|
| Desktop split, chat in left | Right, regardless of link origin or existing tab side. |
| Desktop split, chat in right | Left, regardless of link origin or existing tab side. |
| Desktop full transcript | Opposite chatAnchor; reveal split with chat staying at its anchor. |
| Desktop two card panes, no chat visible | Existing target stays in its owning pane; a new target uses the originating card pane, otherwise lastCardPane. |
| Desktop focused card, chat ambient | Existing target activates in its owner (focus follows it); a new target uses focused pane. |
| Mobile transcript visible | Assign/move into the pane opposite chatAnchor, then foreground that card. Only one visible pane. |
| Mobile card visible, chat ambient | Existing target activates in its owning pane; new target uses the visible card's pane. |

If the target exists hidden behind the visible chat, `openCard` atomically moves
that same tab to the destination. Preserve its pin flag, visited mount, scroll,
and authored-view state. Update its ViewTarget only when the request explicitly
changes viewer/params/viewState. No remove-then-add intermediate state and no
second copy. Plain tab selection is not a fresh open: it activates the tab in
its existing pane. Show cards is restoration, also not a fresh open, and therefore
does not invoke opposite-pane routing.

**Vocabulary lock-ins:** pane is a viewing area; card tab is an open target;
focus allocates space; aside preserves tabs; close removes a tab, not its file.
The conversation is singleton content projected into available space, not a tab.

**First implementation chunk:** pure reducer/projection and deterministic
transition tests only, including the hidden-tab move and both-chat collapse.

### B. Persistence, routes, and ownership adapters

**What / why:** Existing route overlays and single-card URL effects otherwise
fight the new layout or reopen a moved tab after every URL projection.

**Direction:** Keep state owned by the existing shell/runtime lifecycle and
scoped per browser tab, development-worktree/box storage scope, and logical
conversation. Explicit conversation selection restores that conversation's
workspace; ordinary card navigation never selects a conversation. This preserves
the current scope until the separate landmark-baseline design is agreed.

The sibling chat-everywhere checkout has
`components/chat/conversation/storage-scope.ts:2`: `export function conversationStorageScope(apiBase: string): string`.
It was not found in current main during final review. Integrate the authoritative
helper after preflight coordination, or implement the same API-base scope locally
if that change remains unlanded; do not assume merging main supplies it. Proposed key:
`bbx:workspace-panes:v2:<conversationStorageScope>:<logicalConversationId>`.
Reuse `InteractiveChat.tsx:186` (`sessionId ?? conversationKey(target)`) and
existing selectSidecarSession/persistSidecarTransition adoption. Atomically adopt it
under the assigned session identity without clearing tabs or replacing a newer
snapshot. Do not retain the literal shared `new` as a durable identity. Assignment
flushes/cancels the provisional writer before installing the session writer;
a delayed write from the old identity cannot replace the new snapshot.

Parse v2 at the storage boundary. A validated legacy flat strip imports to left,
with its active selection/pins/order retained and right showing chat. For legacy import, prove the old key belongs to this box/worktree from the
actual router slug mapping; a suffixed worktree slug can already disambiguate it.
Import proven-local keys in development as well as production. If provenance
is ambiguous, leave the key untouched and ignore it; show a notice only if that
skips a populated strip. Prefer the trusted current in-memory strip. Corrupt v2 entries
produce a visible recoverable notice and preserve the bad payload for diagnosis;
blocked storage keeps the in-memory workspace usable with a persistence notice.
No on-disk box/card migration is needed.

Browser history owns a validated `bbxWorkspace` snapshot and originating action
revision. Durable sessionStorage owns the latest workspace snapshot. On reload,
valid history state wins; otherwise load the current conversation's storage.
A fresh share URL is an open intent. A restored history entry is an atomic
snapshot restore, not an open intent. Existing `?card=`/`?companion=` and `/views/`
links remain accepted; project only the active foreground target into the URL,
not two competing `card` values. Preserve full ViewTarget serialization. Focus and move replace the current history entry; following a new card link
pushes one entry. Mobile showChat pushes a snapshot with an explicit return
revision so device Back restores the card. restoreCards consumes that entry with
Back only when its matching return entry is still current; otherwise it replaces
the snapshot with the retained card projection. Desktop pane toggles replace.
Back restores the recorded arrangement and existing conversation binding.
Ignore stale effect completions using snapshot revisions. Old browser entries
with the retired conversation-overlay hint are translated once into workspace
show-chat state; new entries omit that field.

Current participating surfaces include chat, ordinary cards/files, and all eight
canonical interface instruments. A routed compatibility entrance becomes the
workspace's foreground target instead of rendering a duplicate route outlet.
Dashboard, Settings, Browse, Questions, Landmarks, History, Storage, and Admin
open or select their canonical cards; Browse keeps directory/detail navigation
in its card state. Settings and Admin no longer retain a separate page overlay.
These follow-on dispositions are owned by the
[interface-card consolidation plan](interface-cards-consolidation.md); the
earlier interim exclusions in this plan are historical.

**First implementation chunk:** storage parser/migration tests and one adapter
that restores a workspace without changing the singleton conversation binding.
Then consolidate link/route/mobile opens through the same `openCard` decision.
The shell workspace history adapter replaced the chat-page-only card URL owner.
Card opens from ambient callouts and in-card links now use the workspace open
operation. Consolidation removed the generic ViewOverlay and the excluded
Settings/Admin presentation while preserving task-specific dialogs.

**Vocabulary lock-ins:** bbxWorkspace is browser history presentation state;
storage v2 retains existing logical conversation ownership.

### C. Layout, controls, and retained content

**What / why:** The two-pane model must give content room without remounting it,
and must not reproduce the current cramped mobile vertical split.

**Direction:** Desktop has at most two horizontal content areas. In split mode,
the right-hand end of each card tab strip offers Move left/right, Focus, and
Show conversation. Focused mode replaces these with Back to split: no move and
no direct Show conversation shortcut. Show conversation in split changes only
that pane. If the other pane already shows chat/is empty, collapse to one
full-width transcript; retain both tab sets. Restoration reveals only the pane
whose Show cards control was invoked.

On the full transcript, one floating Show cards restores chatAnchor's retained
cards; if that set is empty, restore the other retained set. Recompute after every
move/close so the button never promises an empty set. Every half-width chat pane with retained cards always offers its own floating
Show cards, regardless of how it became chat. After restoring one side,
the remaining chat pane keeps this control. No button when neither side
has cards. A compact count/tooltip identifies retained cards; no picker.

Mobile uses one foreground projection over the same stored sides. Remove the mobile route-away opener and Open card shortcut, replace the
`!mobile` companion gate with this projection, and remove obsolete `h-[40vh]`
and vertical pane sizing. The gate currently makes that CSS unreachable in this
shell; deleting CSS alone is not the mobile behavior change. Never expose a
card and transcript simultaneously on mobile.
Present one combined tab strip for all retained cards, active according to the
visible card. Side assignments affect restoration at desktop width but not
mobile reachability. Show conversation/Show cards are the only layout toggles;
there is no mobile split or move. `mobileView` records the foreground separately from `layout`, which is the
remembered desktop split/focus arrangement. Entering narrow width seeds mobileView
from lastInteraction (card or chat), repaired to a visible selection if its
card was closed. Explicit tab/content activation and conversation interaction
update lastInteraction; passive updates do not. Subsequent mobile toggles alter
mobileView, not the desktop layout or either pane's display flag. Mobile card opens
may intentionally move/add tabs by A's rule and activate their owning selection;
they reveal that destination's cards for later desktop restoration. Closing the
mobile foreground selects its owning pane's neighbor, then another retained card,
then chat. returnPath is repaired after close/move; restoring never fabricates a
missing card. Returning to desktop uses the remembered layout, normalized only
if its focused pane was emptied by an explicit close/move. Resizing alone must
not relocate tabs, acknowledge replies, or select a recipient.

**Vocabulary lock-ins:** Move left/right, Focus, Back to split, Show conversation,
and Show cards name distinct actions; none closes card files.

Each visited card content root remains keyed under a common stable owner. Move
changes grid placement/visibility, not React parentage. Keep hidden roots inert
and excluded from accessibility; retain their local state and scroll. A single
transcript root similarly changes placement/width; its scroll anchor follows
existing chat-scroll rules. Do not mount a transcript per pane or a composer per
surface. Apply material geometry per visible pane so tab grain still joins the
correct sheet. Markdown documents use the themed document surface; other raw
files use the same pane routing without gaining paper styling.

Pane controls are native buttons outside tablists. Arrow/tab keyboard behavior
stays in the tabstrip primitive. After move focus follows the active tab; after
focus/back it lands on the corresponding pane control; after showChat it lands
on Show cards (or transcript if no cards); after restore it returns to selected
tab. Automatic transcript focus must not steal focus from an opposite-pane open.
Do not repurpose the old close/pop-out IDs. Keep open-in-new-browser-tab through
normal link semantics, not a newly promoted pane control.

**First implementation chunk:** two-pane desktop projection with preserved mounts
and revised controls, then the mobile one-pane projection using the same state.
Both are required before this track is complete.

### D. Transcript floating controls, callouts, and native attention

**What / why:** Show cards must coexist with message-scoped speech controls.
Callouts must look like foreground content even when prose is ambient.

**Direction:** The transcript scroller owns a floating-slot context. It publishes
whether Show cards is present and shared slot offsets; per-message speech bars
consume those offsets. This is the coordination mechanism, not independent
sticky positioning. Implement a shared floating-control positioning contract: Show
cards occupies the pane's upper trailing overlay slot, speech occupies the
adjacent slot when its message is active. Reserve the speech slot only where
needed; do not duplicate speech controls or change replay ownership. Use zero
layout-height overlays and pointer-events only on controls. Verify real long
messages, scrolling, selection, speech menus, and narrow widths; do not copy the
mockup's fixed transcript top padding as production layout. Adjust the exact
placement in the real interface until controls neither overlap each other nor
cover the text users need to select. Remove ThinkingCornerMark from the floating
bar; preserve thinking parser/debug/activity behavior.

Give shared CalloutBlock a chrome-theme surface role. Paper callouts use their
own readable paper surface, edge/shadow, and retained context label; plain uses
its existing treatment. Ambient and transcript render the same role. Preserve
callout identity/acknowledgment and link routing. No new callout schema or agent
markup. Ordinary assistant prose remains on the background.

Rebuild the workspace useConversationCard/card-context-store boundary: mounted
hidden roots release their focus claim, and visible tab activation claims focus.
The workspace projection is authoritative over mount order. When no card is
visible, focusedRef is null. In two-card mode use last activated visible card,
falling back to the remaining visible selection when its pane is put aside.
Publish attention from actual projection: transcript visible only when genuinely
shown (and no covering overlay); focusedRef is the card the user last activated
in a visible pane. Preserve the recipient and send-time capture. Native bridge
shape remains v1 unless a concrete implementation necessity is reviewed; two-pane
state itself is web presentation and is not added to the wire. Update the mobile
contract's behavioral description and run its fixtures plus iOS acceptance.

**Vocabulary lock-ins:** the callout chrome-theme role changes presentation,
not callout markup or acknowledgment identity.

**First implementation chunk:** floating restore/speech coexistence and removal
of the thinking decoration, with targeted real-browser checks. Then shared callout styling
and visibility/publication integration tests.

## Could this be simpler?

Renaming close to Show conversation while keeping one sidecar reducer is the
smallest alternative. It cannot compare two cards, move a hidden existing tab
opposite chat, or preserve two active selections. Those are explicit user jobs,
so §9 justifies a pure two-pane model. Two independent pane reducers are smaller
locally but make duplicate detection and hidden-tab moves non-atomic, against §8.
A general docking/layout framework adds arbitrary panes, drag/drop, and serialized
layouts that were not requested. Exactly two stored sides and one projection
function are sufficient. Conversation and landmark ownership are not redesigned.

## Subplans

None. Storage, routing, layout, and native attention are parts of one bounded
behavioral change and ship together. Deferred persistence semantics have issues,
not dependency subplans.

## Failure modes

No unresolved silent critical gap is accepted. Every new transition below has a
named planned assertion; existing handling is not mistaken for complete coverage.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Hidden tab remains behind chat or duplicates opposite it | Existing one-strip tests only; add `workspace-panes` cases | New atomic open/move action | Silent today; invariant/test required |
| Focus exits directly to full chat | New reducer test | Tiered projection/action set | Visible wrong layout; blocked by test |
| Toggle one side discards/hides the other | New reducer test | Per-pane display state | Silent loss; preserve sets in assertions |
| Restore points at a pane emptied by a move | New reducer test | Derived target and absent empty control | Visible misleading control; test both empty/one empty |
| Moving remounts a form or loses scroll | New DOM lifecycle test | Stable keyed roots required | Silent state loss; no accepted fallback |
| Both sides showing chat instantiate two streams | New DOM test | Singleton transcript projection | Duplicate subscriptions/acks; require one runtime |
| Route replay relocates the active tab repeatedly | Existing view-url tests; add history integration | Separate restore/open and revision guards | Silent oscillation; deterministic Back/reload case |
| New session assignment clears workspace | Existing storage tests; extend stable-start adoption | Atomic identity transition | Silent loss; test assignment during open |
| Same-origin worktrees read each other's tabs | New storage scope test | Scoped key; reject ambiguous legacy import | Visible one-time migration notice |
| Invalid storage disables navigation | Existing parser precedent; new v2 tests | Localized recovery/in-memory operation | Visible recovery notice |
| Pane open steals recipient or native draft destination | Existing conversation tests; extend attention fixture | One conversation owner/send-time snapshot | Silent misdelivery; acceptance blocker |
| Hidden transcript acknowledges ambient content | Existing ambient tests; extend projection inputs | Actual visibility feeds acknowledgment gate | Silent lost attention; test covered/hidden states |
| Floating restore overlaps speech or selectable text | New DOM/real-browser scenario | Shared overlay slots and tested sizing | Visible; desktop/phone acceptance blocker |
| Device Back skips the card after mobile showChat | New history transition and phone walkthrough | Push visibility entry; consume matching return revision | Visible wrong destination |
| Mobile retains vertical split through another entry path | New route/viewport DOM cases | Remove old mobile route-away/split owner | Visible; test chat link, direct card, Browse child |
| Removed thinking decoration deletes useful debug data | Existing parser/activity tests; focused regression | Remove presentation branch only | Silent debug loss; assert raw data retained |

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong tag/field:** no new agent-facing markup or configuration.
  Existing file links enter the unified open adapter (B); CalloutBlock stays shared (D).
- **ADDRESSED — stale ref:** retain a tab with the existing missing-file/error view,
  allowing close/retry. Missing targets do not silently replace the other pane.
- **ADDRESSED — concurrent agent edits:** realtime updates retain path identity and
  mounted views. A content update does not reopen, move, or focus a tab (A/C).
- **ADDRESSED — hand-edit drift:** v2 session state is validated; card/box schemas
  unchanged. Invalid saved pane references are diagnosed and recovered (B).
- **ADDRESSED — fabricated free-form value:** actions accept PaneId/ViewTarget,
  not arbitrary pane names; no agent command is introduced (A).
- **ADDRESSED — validation UX:** restore errors say what could not be restored,
  preserve usable entries, and do not expose unrelated storage content (B).
- **ADDRESSED — partial transition:** one versioned reader/writer and one visibility
  projection; no half-enabled split renderer. Release all tracks together (B/C).
- **ADDRESSED — unsent draft/streaming:** all actions preserve emission/controller
  ownership and send-time destination; verify while a turn is streaming (D).
- **ADDRESSED — pinning:** existing pin means eviction protection and ordering;
  moving preserves it. It does not bind to a landmark or prevent explicit close (A).
- **DEFERRED — review completion:** closing a tab does not mean reviewed; see the
  review-progress issue below.
- **DEFERRED — arbitrary Browse parent retention:** normal Browse Back remains;
  directory tabs are a separate follow-up, not gated on parent/review design.

## NOT in scope

- [Directory tabs](../../../issues/features/2026-07-28-directories-as-viewable-things.md) and [Dashboard tabs](../../../issues/closed/features/2026-09-08-dashboard-workspace-tab.md): the intended behavior is opening tabs instead of navigating away. Preserve an extension boundary now; implement these target types later.

- [Landmark-scoped pinned baseline](../../../issues/features/2026-09-08-landmark-scoped-pinned-card-baseline.md): save/reset/return semantics need a separate decision. Preserve current conversation scope now.
- [Review queue and hierarchical progress](../../../issues/features/2026-09-08-review-queue-hierarchical-progress.md): reviewed/done is not equivalent to closing a tab.
- [Saved sets and cross-landmark references](../../../issues/features/2026-09-08-saved-card-sets-cross-landmark.md): no collections/bookmark storage is introduced.
- [Explicit agent show-card action](../../../issues/features/2026-09-08-agent-show-card-action.md): tool/CLI presentation authority is separate from link activation.
- [Open/active link styling](../../../issues/features/2026-09-08-card-links-show-open-state.md): useful follow-up; this plan supplies identity but not the new link vocabulary.
- [Preview replacement policy](../../../issues/decisions/2026-09-08-sidecar-preview-replacement-policy.md): retain current accumulating tabs and cap; do not infer review queues from visits.
- Drag/drop, arbitrary open pickers, more than two panes, side-size persistence,
  multi-window synchronization, or duplicate views of one path.
- Redesigning chat recipient selection, speech pipelines, native composer, or
  landmark navigation; preserve their current contracts.
- Reworking the already-developed paper/card/bar materials beyond shared callout
  treatment and control placement necessary here.

## Open design questions

No unresolved state/routing choice blocks the first implementation chunk.
The exact floating Show cards hit area, icon, tooltip wording, and distance from
speech need real-interface iteration in D; acceptance requirements are fixed.
Prototype placement is evidence to try, not a shipping layout specification.
Landmark persistence, review progress, and preview policy remain open in their
issues and do not change this plan's transition contract.

## Knowledge audits

No new agent-facing schema, tag, command, or writing convention is introduced.
Existing links and callouts keep their syntax; skip new knowledge audits for
this UI-only work. If implementation proposes an agent show-card command, stop
and use its separate issue/plan rather than adding it under this exemption.

## What will hold this after it ships

Use pure doctests for decisions and real-browser probes for mounted behavior.
`docs/testing.md:710` assigns component-state checks to a “Dev harness route”;
`test/frontend/chat-openers.doctest.md:8` states tests run under “plain Node with no DOM”.
Do not introduce a DOM framework to make the lifecycle checks into doctests:

- `test/frontend/workspace-panes.doctest.md`: full transition matrix, opposite-pane
  existing/hidden target, global uniqueness, pins/cap, neighbor close, per-pane
  toggle, restore-empty cases, focus ladder, mobile/desktop projection round trip.
- `test/frontend/workspace-pane-storage.doctest.md`: v1/v2, corrupt entries,
  worktree isolation, history precedence, disabled storage, provisional assignment.
- `test/frontend/workspace-pane-navigation.doctest.md`: link versus restore versus
  target-state update, popstate/reload, direct `/views/`, legacy query URLs,
  Browse child, fresh and existing conversation identity preservation.
- A real-component dev harness, driven with `bin/browse`: mounted local form/scroll
  survives move/focus/aside, one transcript/composer, focus placement, floating
  controls, hidden/inert cards, streaming and native attention publication.
- Extend existing `test/frontend/chat/ambient-replies.doctest.md` and mobile
  contract fixtures for visible versus hidden transcript acknowledgments.
- A persistent tour repeats the accepted desktop and phone walkthroughs using
  real UI. It checks aesthetics/accessibility, not reducer correctness. Provide
  an exhibit covering split, focus, both-chat, restored cards, floating speech,
  and callouts. Do not expose private fixture content in tracked tests.

## Implementation order

1. Refresh main and resolve overlapping shell ownership with chat-everywhere.
   Reproduce accepted scenarios on current code; checkpoint existing theme edits
   separately if authorized. No opportunistic sibling worktree writes.
2. A: decision core and failing-then-passing transition tests.
3. B: versioned storage and URL/history adapters, with existing recipients intact.
4. C: desktop two-pane projection, controls, retained roots, then mobile single
   pane. Delete the displaced mobile vertical split and competing visibility logic.
5. D: floating restore/speech placement, thinking decoration removal, shared
   callout material, native/ambient visibility integration.
6. Replay walkthroughs, cross-model review the final implementation, resolve
   findings, run appropriate changed tests/typechecks/lint/doc checks, then
   request landing only when the user wants it. All tracks ship together.

## Rollout shape

Implementation was authorized after the plan review. State decision tests
preceded UI integration; new paths are named above. Ship the
versioned browser-state migration with its reader and writer atomically in the
same bundle. There is no card-file migration or backend API version change.

Done means the named behavioral tests, existing affected tests, frontend/backend
and native contract checks, and real desktop/mobile walkthroughs pass. Run a real
iOS WebView acceptance for card → transcript → card with keyboard/voice and an
in-flight send; desktop Chromium is not evidence for that device boundary.
Required walkthroughs:

1. Chat right → open card left → focus card → Back to split → show chat left →
   full transcript → restore left. No lost tabs, draft, transcript anchor, or target.
2. Two cards → show chat left → open a left-hidden card → it moves right with no
   duplicate, while chat stays left. Repeat mirrored and with a pinned tab.
3. Two cards → show chat on both → restore only one side → restore the other;
   moving/closing can empty a retained set without leaving a false restore button.
4. Parent card and child card → follow child links when chat is visible and when
   both sides are cards; routing follows A's table, not the old mockup shortcut.
5. Mobile chat → linked card → another tab from either stored side → chat → device
   Back to card → chat → restore;
   no vertical split at any step. Return to desktop and recover the arrangement.
6. Active streaming speech + floating Show cards + long callout, in transcript and
   ambient, with keyboard focus and text selection at narrow width.
7. Reload/Back, fresh-start assignment, direct card entry, missing card, explicit
   session selection, and native send-time binding during pane transitions.

The interactive control mockup predates the final opposite-pane rule for hidden
tabs. The transition table and walkthrough 2 above supersede that prototype's
open behavior. Do not treat a passing prototype as implementation verification.


## Implementation notes

The workspace provider now lives above the singleton conversation runtime.
Card roots share a grid parent; each visible root carries its pane's tab strip.
The transcript remains one mounted root. The legacy companion renderer, mobile
route-away opener, and chat-only card URL effects were removed.

Workspace URL projection never writes the selected session. Route restoration
waits for the conversation route's confirmed history binding, preventing an
incoming new-conversation URL from being replaced with the previous session.
Focus inside card content updates attention without navigation, so pointer focus
cannot cancel the link click that follows it. Mobile transcript toggles carry
paired return revision/index metadata; device Back consumes that entry.

Storage keeps per-conversation in-memory snapshots even when browser storage is
blocked. Runtime adoption preserves the workspace on session assignment. Legacy
imports require proven local scope; invalid stored data produces a notice.

The persistent `workspace-panes` tour uses the existing theme-tour content.
Run it with `bin/tour workspace-panes`; it covers desktop and mobile. State,
storage, and navigation doctests cover the decision boundaries separately.
The follow-on interface-card work added the canonical Dashboard and Browse
targets, then added Questions, Landmarks, History, Storage, and Admin and removed
the alternate production page presentation. The pane reducer and retained-root
model remain the implementation owned by this plan.

Automated checks and the browser tour do not complete the required physical
iOS WebView acceptance. Card → transcript → card with the native keyboard,
voice composer, device Back, and an in-flight send remains outstanding before
the implementation meets this plan's full done criteria.

System-theme selection is documented in the
[implemented system-theme subplan](../implemented-plans/system-theme-selection.subplan.md).
