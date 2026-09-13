---
title: "Chat everywhere: one input, explicit conversational focus"
status: partial
workstream: chat-everywhere
issues:
  - ../../../issues/features/2026-08-30-chat-input-everywhere.md
---
# Chat everywhere: one input, explicit conversational focus

When reading a card, checking the dashboard, or moving between places, the
boxholder can keep typing or speaking to the box without first visiting chat.
Selecting a landmark deliberately changes the conversation; following a card
link changes what the conversation can see. Replies remain available when the
transcript is out of sight.

**Issues addressed:** [Chat input everywhere](../../../issues/features/2026-08-30-chat-input-everywhere.md).
The issue queue was searched with `bin/issues similar --all --docs` and for `everywhere`, `ambient`, `callout`,
`landmark`, `draft`, `back-to-chat`, and screen-focus language. Related work:

- [Mobile modal rather than split](../../../issues/features/2026-07-23-mobile-modal-not-split-pane.md): this plan supplies the minimum document/transcript switch and ambient input contract. Broader mobile navigation, gestures, and voice reliability work remain with that issue; do not automatically close it.
- [iOS input parity](../../../issues/features/2026-07-19-ios-input-plane-parity.md): reuse its draft and delivery system; its outstanding physical-device acceptance is not satisfied by this work.
- [Screen unfocused](../../../issues/features/2026-08-13-tell-the-agent-the-screen-is-unfocused.md): no live attention tracking or new background-audio promise here.
- [Back to chat](../../../issues/bugs/2026-08-23-no-consistent-way-back-to-chat.md): preserve the shipped return path; its existing device-check gate is separate.
- [Listening/note mode](../../../issues/features/2026-08-29-listening-note-mode.md): diarized ambient listening is a different input policy; do not enable it implicitly.
- [Chat feedback](../../../issues/features/2026-08-06-capture-feedback-from-chat.md) and [draft ahead](../../../issues/features/2026-07-08-draft-ahead-surface-native-pattern.md): preserve addressable results; do not implement either workflow.
- [Sidecar shell](../implemented-plans/sidecar-shell.md), [card prominence](../implemented-plans/card-prominence.md), [interface as cards](interface-as-cards.md), and [interface-card consolidation](interface-cards-consolidation.md): foundations and follow-on ownership, not additional completion obligations.

The boxholder authorized planning on 2026-09-07, after reviewing seven
storyboards. Implementation was authorized later in the same conversation. The
implementation is complete in this branch and locally verified; physical-device
acceptance and the product reconfirmations recorded below remain open. This
document is not evidence of deployed behavior.

## Stated preferences this plan trades against

Direct human decisions outrank the issue's tentative suggestions:

- “Dedicated and split happen pretty naturally on desktop, but not so naturally on mobile. Just not enough room.” Also: “when the split happens, it doesn't necessarily feel that different than dedicated.” Keep one transcript presentation with optional adjacent cards; do not add a three-mode selector.
- “Selecting a landmark is like explicitly saying ‘I'm switching focus to something else’. But moving about isn't necessarily that.” Navigation intent, not the current card's directory, changes the recipient.
- The human requested concrete desktop/mobile movement and multitasking walkthroughs, mocked up before building and reconfirmed afterward. Section **Rollout shape** preserves those cases as acceptance work.
- On the mockups: “that's not very close to the current interface, but I think it's roughly okay.” This accepts the behavioral exercise, not a new visual design. Preserve the actual app bar, composer, transcript, menus, card viewers, and sidecar tabs. Review screenshots of those surfaces before claiming UI completion.
- Prior input direction, `interface-as-cards.md:382-384`: “It *attaches* to a chat when you send, but it lives between chats (switch conversations and the draft stays).” Keep one box-scoped draft. No per-conversation draft fork or cross-device synchronization is implied.
- Principles [1, 3, 4, 8, 9, 10, 13](../engineering-principles.md): typed navigation intent; validation at the native/network/storage boundaries; visible failures; reuse one send path; explicit async ownership; pure routing/projection decisions; show resolved destinations and real recording/delivery states.
- `src/frontend/src/components/chat/sidecar-tabs-storage.ts:4-8`: “sessionStorage, per browser tab, per box, per conversation.” Preserve the shipped tab scope rather than introducing a general arrangement service.
- [The closed sidecar landmark issue](../../../issues/closed/bugs/2026-08-30-chat-card-panel-missing-landmark-context.md): “Do not rebuild this without a new ask.” A compact composer destination identifies the recipient; it is not a landmark strip for the viewed card.

## What already exists

Paths in this table are relative to `beebox/`. Line numbers are discovery
anchors from this checkout; quoted code is the stronger reference.

| Existing seam and evidence | Reuse / change |
|---|---|
| `src/frontend/src/router.tsx:75-77`: `path: "/$boxSlug"`, `component: AppLayout`; `app-shell.tsx:100`: `<Outlet />` | Put the persistent owner inside the validated box layout, above child routes. Login/setup have no box recipient. |
| `src/frontend/src/app-shell.tsx:132-139`: `previous.current = boxSlug;` and `queryClient.clear();` | Keep box isolation. Existing request URLs depend on location, so an old-box send cannot run through a new-box client. |
| `src/frontend/src/pages/ChatPage.tsx:235-237`: “a real session switch” and “the same logical session” for new-to-assigned | Move bootstrap, coining, assignment latch, and one-time preload together. Preserve the distinction between assignment and selection. |
| `src/frontend/src/components/chat/InteractiveChat.tsx:157`: `useMachine(chatMachine,`; `:175`: “Persist the whole in-progress emission” | Extract controller ownership from presentation; reuse machine, emission store, uploads, and voice services. Do not mount a hidden second InteractiveChat. |
| `src/frontend/src/hooks/useDictationDraft.ts:74-76`: “The key is a per-box singleton now” | Keep current persisted drafts readable; moving pages must not remount recording or draft services. |
| `src/frontend/src/components/chat/InteractiveChat-ws.ts:319`: `to: href(` followed by the chat route | Replace unconditional assignment navigation with owner update and conditional chat-URL projection. Ambient first send must stay on its page. |
| `src/frontend/src/hooks/useOpenLandmarkChat.ts:32`: `utils.chat.lastSessionForDirectory.fetch({ contextDir: dir })` | Reuse directory resolution; route explicit landmark selection through one intent handler. |
| `src/frontend/src/pages/card/components/OpenChatControl.tsx:2-14`: “Chat — opens the most-recent session bound to that directory”; “New — always starts a fresh session.” | Keep these explicit actions distinct from ordinary card links. |
| `src/frontend/src/components/BackToChatChip.tsx:15-18`: “It returns to *that session*” | Reuse the return affordance, now backed by selected shell conversation rather than an unrelated inferred card context. |
| `src/frontend/src/components/chat/InteractiveChat-layout.tsx:214-251`: regions supplied “as a pre-built node” | Reuse ChatView and its region components; change layout ownership without restyling them. |
| `src/frontend/src/components/chat/InteractiveChat-controls.tsx:175`: `h-[40vh] md:h-full md:w-1/2` | Replace the mobile competing transcript/card regions with one foreground region; retain desktop split and mounted card tabs. |
| `src/frontend/src/input/targets/receipts.ts:9`: “Receipts are ACCEPTANCE-level, not completion-level” | Accepted, queued, running, and replied remain different UI states. |
| `src/frontend/src/components/chat/InteractiveChat-dispatch.ts:76`: `acceptEmission(emission, { witness: getWitness(), cardFields, send })` | Keep target assembly and receipts. Freeze destination and attention before any upload/HQ wait. |
| `src/frontend/src/components/chat/InteractiveChat-card-hooks.ts:85-88`: `openCard?`, `cardActivity?`, `cardState?`; `:132`: `activeView.target.path` | Generalize the current single focused-card source to primary routes and overlays. Preserve selections as independently captured evidence. |
| `src/frontend/src/components/chat/native-emission.ts:13-24`: `NativeEmissionV2` contains `id`, `origin`, `text`, `images`, `files`, `selections` | It has no recipient. Native pending sends need captured destination metadata, not merely a longer-lived web listener. |
| `../ios-app/BeeBox/Storage/PendingEmissionStore.swift:158-175`: `enqueue` accepts `boxID` and content, and constructs `PendingEmission` | Extend durable pending and voice-preparation records with destination/context; keep native draft ownership and receipt handling. |
| `src/webapp/routes/chat-send-target.ts:99-105`: “reservation has to be admitted here too”; `getReservation(sessionId)` precedes resumability check | Reuse backend exact-session validation for reserved and committed IDs; add its missing web-client propagation in B. Missing/expired reservations fail explicitly rather than retargeting. |
| `src/core/event-bus-schemas.ts:171-175`: `chat-complete` carries session identity and time | Completion invalidates history; it is not the answer text. Unknown/null session IDs never become the selected session. |
| `src/frontend/src/components/chat/ChatMessages.tsx:116,186` and `CalloutBlock.tsx:24-42`: callouts parsed from messages and rendered with Markdown | Reuse parsing/rendering outside the transcript. The current renderer has no unread/pending queue. |
| `src/frontend/src/hooks/useBusSubscription.ts:1-12`: reconnect/replay requires full resync beyond retention | Use transcript-backed catchup, not event receipt as durable reply storage. |
| `src/core/chat/session/prompts.ts:181`: narration means the user is “speaking at length and does not expect answers” | Ambient mode must not enable narration or reinterpret it as read-aloud. Keep current voice/prose/HQ semantics. |

A targeted search found no existing callout read/dismissal store. The place
menu's freshness counts are not unread counts. Current chat husk code exists
in `src/core/chat/husk.ts` and `husk-read.ts`; this plan needs no husk migration.
A read-only browser check of the current `/chat` showed the existing
`bbx-nav-place`, `bbx-nav-session`, `bbx-nav-voice`, and `bbx-composer-*`
controls. Keep those stable IDs and their familiar roles.

## Prior art (external)

- React ties state to position in the render tree. Merely copying the composer into each page cannot preserve recording and in-flight work. [Preserving and resetting state](https://react.dev/learn/preserving-and-resetting-state).
- TanStack Router supports explicit search-parameter navigation and location state. Keep route intent in that navigation layer; do not infer landmark selection from arbitrary filesystem paths. [Navigation](https://tanstack.com/router/latest/docs/guide/navigation).
- VS Code separates implicit activity context and explicitly attached context. Borrow the distinction, not its editor layout. [Context](https://code.visualstudio.com/docs/agents/concepts/context).
- Apple audio-session configuration is separate from visual presence. This plan does not infer hearing from a hidden webview or promise new background execution. [AVAudioSession](https://developer.apple.com/documentation/avfaudio/avaudiosession).

These sources inform ownership and context boundaries. No new UI framework,
notification library, or window manager is needed.

## Tracks / scope

### A. Box shell and explicit conversation selection

**What / why:** A single box-scoped conversation owner survives child-route
navigation. It owns selected conversation identity and one input service;
the current ChatPage is a projection of that state. This prevents route
changes from stopping dictation or detaching delivery handling (principles 8, 9).

**Direction:** Add `components/chat/BoxConversationProvider.tsx` and a pure
`conversation-intent.ts` decision module. Provider placement is under the
existing box/AppBarChrome/ViewOverlay boundary, above the stable route Outlet.
Keep narrow subscriptions: token/recording updates do not rerender every card.

Use a discriminated selection state:

```ts
type ConversationTarget =
  | { kind: "session"; sessionId: string; contextDir: string }
  | { kind: "start"; clientConversationId: string; contextDir: string;
      engine: ChatAgentEngine; model?: string; seedFeatures?: Record<string, string> };

type ConversationSelection =
  | { kind: "resolving"; requestId: string; contextDir: string }
  | { kind: "ready"; target: ConversationTarget; label: string }
  | { kind: "unavailable"; contextDir: string; reason: string };
```

Ready either names a concrete reserved/existing ID or an immutable new-chat
intent on an engine that cannot reserve IDs. Codex is the existing latter case:
`src/frontend/src/pages/ChatPage.tsx:32-35` says only Claude can coin, and `:285-288` preserves
the `new` path for Codex. Reservation returning unsupported is not a failed
selection. Reuse engine/model/default resolution and existing bootstrap;
never switch engine merely to obtain a reserved ID. `new` alone is not enough
identity: the start variant has a clientConversationId and frozen directory,
engine, model, and feature seed.

No send while resolving or unavailable; typing and attaching remain available.
A ready start target can send its first message, displaying New conversation
and the chosen place. Capture/bulk operations that already require a concrete
ID retain their explicit start-a-conversation-first state until assignment.
If sessionStorage is unavailable, retain live selection without promising
reload persistence; do not block ordinary chat. A failed lookup shows Retry and retains the draft. Rapid selections
have a request generation; an older lookup cannot take over a newer choice.

| Action | Recipient rule | Visible navigation |
|---|---|---|
| Select landmark in PlacePill or Landmarks action | Resolve that directory's current conversation with the existing committed-first policy; reserve if supported, otherwise prepare a start target | Preserve the action's current chat-opening behavior. |
| Select a named chat or direct `/chat?session=X` | Select exactly X | Show its transcript. |
| Card's existing Chat / New action | Explicitly resolve/start that card's landmark conversation | Preserve attaching the card and opening chat. |
| Open card, follow reference, browse a directory, visit dashboard/landmarks list | Preserve selected conversation | Change inspected content only. Merely visiting the landmark list is not selecting a landmark. |
| Bare Chat / back-to-chat action with an active owner | Show current selected conversation | Desktop shows transcript; mobile foregrounds it. |
| Explicit root landmark selection | Resolve directory `""` | Same as any landmark. Dashboard navigation alone is not this action. |
| No selection on cold bare `/chat` or box-root redirect | Preserve current `chat.bootstrap` most-active selection, or its existing empty-box new-chat behavior | Show chat; do not replace this landing behavior with root-directory selection. |
| No selection on fresh direct card entry | Resolve from the card once | Stay on the card; show the resolved recipient before enabling Send. |
| No selection on fresh dashboard/list/tool entry | Resolve root `""` once | Stay on that surface. |
| Reopen the same browser tab | Restore validated per-tab selected ID before cold-entry inference | Unavailable restored targets require explicit recovery, not silent fallback. |
| Inspect a background result card | Preserve selected conversation | Open it through the workspace card path. |
| Explicit Open conversation on background notice | Select the notice's session | Show that transcript. |

Persist only selected ID/directory and return-presentation metadata per tab and
box in sessionStorage. This is not a new globally shared “most recent chat” preference. The current
server most-active bootstrap remains the cold bare-chat default only. An
explicit URL session wins over persisted state. Invalid stored data is ignored
with an observable diagnostic; missing referenced sessions produce unavailable
state. Root is the empty string, not null or a guessed content folder.

Record selection identity in app-created history entries. Back/forward restores
that entry's explicit selection; ordinary in-app card movement inherits it.
Entries without shell metadata use explicit chat URL intent, otherwise retain
the live selection; cold entry uses the table above. Do not put drafts in URLs
or fork them into a per-tab record during navigation. Existing per-box local
draft persistence remains the baseline; two live tabs may still have separate
in-memory editors. This work does not add cross-tab editing synchronization.

**Vocabulary lock-ins:** conversation = recipient/session; attention = inspected
subject; input = draft material. `selectLandmark`, `selectConversation`,
`showConversation`, and `inspectCard` are distinct internal intents. Route
assignment is not another user selection.

**First implementation chunk:** Extract and test intent/selection decisions and
move existing bootstrap/coining logic under the box owner while keeping the
current ChatPage appearance. No ambient layout or new prompt fields yet.

### B. One input and a send binding that cannot drift

**What / why:** Keep the emission target-free until the person commits a send.
Then preserve recipient and attention through uploads, HQ work, queuing, retries,
and selection changes. This is required by S2, S3, and S5 (principles 1, 4, 13).

**Direction:** Lift EmissionStore, persistence, recording, attachment acquisition,
and selection collection above selected-session remounts. Extract the existing
InteractiveChat controller from its view; do not duplicate its hooks in an
ambient implementation. Selected transcript state may change by session; input
services must not. Mount native emission/selection handlers once per box.

At the send gesture/voice keyword, create an immutable `SendBinding` alongside
the emission ID: `{ boxSlug, target: ConversationTarget, attention }`. Capture it
before the first await. Existing draft materialization may still wait for
uploads according to its current content policy, but it cannot re-read the
recipient or ambient attention afterward. New-to-assigned preserves the same
reserved ID. For an unreservable start target, the first send uses the existing
`session: "new"` path with frozen engine/model/directory/seed and without exactSession.
Only the owning controller handles its first turn and assignment. Later sends
for that same clientConversationId wait locally for committed assignment, then
use the assigned exact ID; they never each launch an independent `new` chat.

Use a captured controller handle, not a lookup of the selected controller after
an await. The shell's begin-send operation pins the target controller and returns
`{ binding, dispatch, release }`. Extend the target adapter's SEND payload,
`machines/chatMachine.ts` context/actor input, both `streamActor` and
`queueMessageToBackend` POST sites, and `api-chat.ts` `startChatTurn` with the
explicit bound target and exactSession flag. Those fields do not exist end to
end today; this is a transport change, not free reuse. Use exactSession only
for the session arm, and the existing validated new-send path for the start arm.
The handle prevents controller disposal; the event data makes the actual HTTP
destination independently testable. The two enforce the same binding. An expired reservation or
archived target rejects clearly; it never creates a replacement conversation.
Retain the existing deduplication by message ID. A retry keeps both ID and
binding (or the matching start-to-session alias, which is the same target). Explicit Restore returns content to the singleton draft and makes its
current destination visible; it is not an automatic retry into that destination.

Keep the selected controller plus only controllers with local unsettled sends
(upload/HQ/acceptance/queue handoff). Release a previous selected controller once
its local work is settled AND any start target has received its own assignment;
receipt acceptance can precede assignment. Learn the alias from the owning
turn stream, but do not release follow-ups at its init frame: the server awaits
`recordSessionStart` and registry promotion before emitting session-assigned
(`registry.ts:351-378`). Release only after a chat-session-assigned event whose
ID matches that already correlated alias. Remember matching readiness events
that arrive before the stream frame; never let two start controllers adopt an
unqualified broadcast. Publish native assignment only at that ready boundary.
For a lost bus event, allow a bounded retry of the same first held exact send
while in known-startup state (250 ms, 1 s, 3 s, using awake-time delays). A
not-ready 404 in this state stays Waiting for conversation with Retry after
the bounded attempts; it is not mislabeled archived or auto-restored as a new
send. This special wait does not apply to an ordinary previously ready target.

The exact-session server gate must admit a non-deleting live assigned registry
entry as well as its existing reserved/persisted-session cases. A fresh Codex
thread may not yet be enumerable from engine history after registry promotion.
Check deletion gates first, following `availability.ts:74-78`. Then use
`registry.ts:174-175` `isKnownSession`: `this.entries.has(sessionId) ||
this.reservations.has(sessionId)`. This excludes pending startup entries;
`registry-deletion.ts:22-24` `hasAssignedSession` also searches pending entries
and is therefore too early for this particular readiness gate. Retain strict refusal
of unknown, archived/deleted, and `new` targets. Do not broaden the non-exact
fresh-session fallback. Route tests hold recordSessionStart pending, then
promote the entry before engine history is enumerable, to exercise both edges. Persist
clientConversationId-to-sessionId aliases in this tab's state and publish them
to native on assignment. A pending start binding resolves only through its own
alias, never through whichever chat is now selected. If a reload loses the
unassigned controller before an alias is known, hold its remaining messages in
recoverable target-review state rather than replaying them as fresh chats or
choosing the most-active chat. The original first emission keeps its dedup ID;
acceptance without recovered assignment does not authorize another new send.
Keep this bounded failure explicit instead of adding a server-wide alias service.
After settled assignment, server-side running turns continue independently.
Background response observation (D) does not require mounting an entire chat
runtime for every prior session. Input/voice playback have one owner even when
an old controller is retained for receipts. Queued messages must reach the
backend or remain in retained local ownership before controller disposal.
For a locally held completed web-origin emission, persist its content and binding before
clearing the shared draft, reusing `input/emission-persist.ts` serialization in
a separate per-tab/box pending-send record. This is necessary for follow-ups
waiting on Codex assignment and for explicit failed-send recovery. A storage
write failure keeps the draft and shows the failure; it is not local acceptance.
After reload, known exact bindings can resume through their original targets;
unresolved start bindings require target review. Native-origin emissions are never copied into this web content record; their
unreceipted native queue is the sole durable owner. The web may retain only
routing/receipt metadata for them and withholds the native receipt until backend
acceptance, not local enqueue. Persist per-tab startup routing records alongside
aliases: `{ clientConversationId, firstEmissionId, target, state }`, with state
`prepared | attempted | accepted | assigned`. Write attempted before dispatch,
and accepted before releasing the success receipt; an uncertain attempted
record after reload is not permission to start a new conversation. Native
records the same firstEmissionId/start state in its own existing repository,
before emission delivery and on receipt, so loss of web sessionStorage does not
turn a redelivered follow-up into a first send. Only the designated first ID can
use the fresh-start path; remaining IDs wait for its alias or target review.
If accepted-state persistence fails after backend acceptance, retain the attempted
marker and report acceptance with recovery-needed status; do not misreport a
backend-accepted send as rejected. An already accepted first
message is never presented as unsent or automatically resent with a new ID;
if its assignment is unrecoverable, link to Chats to locate that conversation.
Only still-unsent follow-ups need a recovered target or explicit Restore.

On rejected sends, preserve the original emission and destination in a visible
failed-send entry; do not silently append old content to a newer draft aimed at
another conversation. Reuse existing restore planning for the explicit Restore
action. Native already owns its rejected emissions; never restore them a second
time in the web store.

A box change flushes draft persistence and suspends unfinished preparation for
that box. Cancel old-box subscriptions and route-dependent requests before
activating the new box client. Already accepted server turns continue. Never
send old work through a client whose base URL now addresses a different box;
resuming old work requires returning to that box, retaining its binding.

**Vocabulary lock-ins:** `SendBinding` is transport intent, not a field added to
`Emission` or a card schema. Accepted/queued is not replied. “To: …” names the
ready recipient; a new unassigned recipient is labeled New conversation in its place; resolving/unavailable state is visible.

**First implementation chunk:** Add captured handles plus the bound-target and exactSession
fields through both POST paths, then test delayed upload, explicit session
change, late receipt, Codex pre-promotion init, committed assignment and second send, startup metadata recovery, and rejection
restoration before enabling sends outside chat.

### C. Attention on every box page

**What / why:** The companion pane currently supplies the inspected card. A
primary card page, dashboard, and an overlay must describe their own attention
without retargeting the conversation (principles 1, 3, 8).

**Direction:** A small shell attention store accepts registration from routed
surfaces and existing FileView activity callbacks. Define:

```ts
type AttentionSnapshot = {
  surface: "card" | "browse" | "dashboard" | "landmarks" | "chat" | "other";
  focusedRef?: string;
  transcript: "visible" | "hidden";
};
```

`focusedRef` uses existing ViewTarget/ref serialization, including a named view
when present. Do not send raw browser URLs, auth search parameters, form values,
DOM text, or all mounted tabs. Auth/admin settings values are not implicit
context. `other` deliberately carries no guessed subject. A directory browse
may identify its directory through the existing ref form.

Focus means the last active content surface, not the focused textarea: moving
into the composer does not erase the card you were discussing. Opening an
overlay activates it; closing restores the underlying subject. In a desktop
split, interacting with the card makes it focused; inspecting the transcript
makes chat focused. Selections retain their explicit source independent of this
ambient snapshot, including after crossing landmarks.

Carry optional validated `viewContext` through client SEND, backend queue,
and turn composition. Serialize read-only `<chat-app surface="…"
transcript="hidden|visible" …>` attributes. Reuse `open-card` for the focused
card's path; reuse existing view-reference encoding for view parameters instead
of inventing another ref grammar. Derive the assembler's existing `zoomed-view`
from that same focused ref; do not retain a stale companion value alongside a
new primary `open-card`. Keep activity details tied to their registered
source and captured binding; changing focused subjects clears the live subject's
activity accumulator. A failed send restores only its own activity/source,
not an old card's activity under the newly focused card.

Older clients omit the optional fields; absence means unknown, not hidden.
The agent cannot set these read-only attributes via feature deltas. System and
slash-command behavior retains its existing bypass semantics.

Prompt guidance: the focused card is context, not an instruction to change the
session directory; explicit selections are the quoted evidence. When transcript
is hidden, make important visual output self-contained in existing callouts,
and use existing speech rules. The shell still exposes a reply if the model
omits callouts. Do not turn ambient visibility into narration, prose, or HQ
feature toggles. This snapshot is send-time context, not live surveillance.

**Vocabulary lock-ins:** `surface` and `transcript` describe presentation;
`open-card` keeps its existing spelling. Attention never sets `contextDir`.
No new callout tag or “ambient session” kind.

**First implementation chunk:** Add the optional boundary schema and pure
snapshot/projection tests, then wire the primary card route and existing
companion through the same registration path.

### D. Ambient replies and background work

**What / why:** Sending while staying on a card must produce feedback outside
the transcript. Another conversation finishing must not impersonate the selected
conversation or steal its input (principles 4, 8, 13).

**Direction:** Keep transcript messages as the durable content source. A shell
observer tracks the selected session plus sessions this tab sent to or left
while running. Subscribe once to the box bus; a matching completion/history
event invalidates that session's existing bounded tail query. Ignore unattributed
events for per-session notices. Never invent answer text from `chat-complete`.
An unassigned start target remains under B's owning controller until its ID is known.

Project the latest completed reply using existing grouping, parsing, and
CalloutStack. A reply with no callout still gets Reply ready and Open conversation.
Acks use the existing action rendering with the same session attribution.
Reply ready requires an actual completed assistant response. A turn failure uses
the existing error/status data; an unattributable/empty outcome says Activity
available with a conversation link, not that an answer succeeded. A
partial stream shows running status; it does not count as a completed response.
Use the source session and first persisted assistant UUID of the complete reply
group, plus callout ordinal, for dismissal identity. A tail beginning in the
middle of an assistant group is not a complete group: keep a generic Reply ready
entry with Open conversation rather than parsing a misleading suffix. Legacy
entries without UUIDs get the same fallback. Never use a streaming/render index
as durable identity. This avoids introducing a second transcript parser.

For the selected conversation, put a bounded expandable reply region immediately
above the existing composer. Show its latest callouts/acks or reply-ready state.
Earlier replies remain reachable through Open conversation; do not show an exact
unread count that the tail query cannot establish. A result from another tracked
session is a separately labeled compact notice: Kitchen renovation · Reply ready.
Its status cannot replace Garden's busy state, and completion never navigates.

A callout's card link only inspects the card; explicit Open conversation selects
the source session. Do not automatically play background-conversation speech
over the selected conversation. Keep selected-session speech behavior and its
existing stop/skip controls. Stopping playback on an explicit switch does not
cancel the server turn.

Persist a small per-tab/box record for each tracked session: known last completed
reply identity, attention-needed flag, and explicit dismissal identity. No
transcript copies or history cursor service. A completion sets attention-needed;
only explicit dismissal or opening that conversation clears it. A later reply
updates the preview but does not silently clear that flag. Merely seeing a
stream event or playing audio does not acknowledge visual content. Dismissing
this presentation never answers a question card or changes its business status.

On reload, reconnect, or visibility return, refetch tracked sessions' tail and
current status. A changed completed reply identity sets attention-needed. Keep
an existing flag until explicit acknowledgment even when the latest preview
changes. On first attachment, baseline old completed history; if the session is
already running, keep that turn pending so its answer is surfaced on completion.
If the tail is truncated, entries lack stable identity, or earlier material may
be omitted, present Earlier responses in conversation instead of an exact unread
claim. Missing history shows an unavailable notice; fetch failure retains the
old notice with Retry. Neither condition silently marks a reply read.

This guarantees S3/S6's session-labeled result and return path, not full offline
unread reconstruction. Arbitrarily old visual material is durable in the
conversation; the ambient preview is bounded. Real pending question cards retain
their existing queue/status workflow. No new notification center or paged history
catchup is required. The server does support offset pages
(`src/webapp/trpc/routers/chat-session-procedures.ts:37-55`); deliberately do not
add a second paging consumer for this feature.

**Vocabulary lock-ins:** reply attention is separate from send receipt.
A notice is session-labeled; inspect and open-conversation are separate actions.

**Device feedback correction (2026-09-08):** Ambient reply panels are unnecessary
when the transcript is already visible, including panels from other conversations.
Hide the whole ambient region in dedicated/split chat and when the transcript is
foregrounded over a page. Keep observation mounted so returning to browsing does
not reset reply tracking. Panels remain available while away from the transcript.

**First implementation chunk:** Implement/test recent-history projection,
background attribution, ordinary-prose fallback, incomplete-group fallback,
and persistent attention flag; then attach the box observer. No new agent
execution engine or unread-history accounting.

### E. Current desktop UI and constrained mobile presentation

**What / why:** Make the input available throughout the box while retaining the
interface the boxholder uses. Mobile must leave useful space for the card.

**Direction:** Keep AppNav/PlacePill and existing session/voice controls. The
shell supplies the same composer exactly once at a stable location beneath the
content region. Page content reserves its height; do not cover page buttons or
use a second independently stateful composer. Preserve attachment/HQ controls
and recording states. Add a compact destination label adjacent to the composer
using the existing session menu; it identifies the conversation even when the
page's place differs. Keep the existing back-to-chat chip contextual for a real
return journey. On a cold card entry, the new composer destination/menu provides
Open conversation without pretending the person came from a chat. Publish the
shell's current selection into the existing last-chat reader when appropriate;
do not maintain two competing recipient authorities. Do not add a card-panel landmark strip.

On desktop `/chat`, keep ChatView's transcript and optional companion layout.
Other routes initially show their normal page with composer and ambient reply
region. Showing the conversation opens the same transcript beside the page if
space permits. Dedicated and split are arrangements, not new conversation modes.
Keep existing tab labels, pin/eviction, stale-data display, and per-conversation
sidecar restoration. Do not automatically promote every visited page into a
sidecar tab or duplicate a primary card in the companion.

At the existing mobile breakpoint, one main region is foreground: card/page or
transcript. A companion card opened from chat takes that region; transcript
moves out of view, leaving composer and compact feedback. Showing conversation
covers the current page using a shell-owned layer and restores it on close;
keep the underlying card component mounted so scroll, form state, and selection
are preserved. The layer participates in browser back/history state and
restores focus on close. An explicit chat selection is a real recipient change,
not just this presentation toggle. There is only one rendered transcript and
one composer; hidden regions are inert and not in the accessibility tree.

Keep the mic reachable in the collapsed input. Typing expands the existing
input and the OS keyboard naturally reduces card space; cap input growth using
existing composer limits. Expose accumulated attachments/selections with the
existing removable chips/detail controls. Do not replace them with a new mockup
visual language. A long callout expands on request; do not let a stack consume
the mobile reading area. Loading, empty, error/retry, queue, and interrupt controls
remain reachable outside the transcript.

All authenticated box child routes get the input: card, browse, view, dashboard,
landmarks, history, questions, storage, settings, and admin. Login/setup,
box-not-found, standalone published pages, and cross-origin external tabs have
no box input. Existing capture mode takes over the single input using its
current lifecycle; never stack a second chat composer over capture. Embedded
chat renderers consume the shell controller when interactive in this app and
must not mount another native bridge/composer; non-app read-only embeds stay
read-only.

**Vocabulary lock-ins:** transcript shown/hidden is presentation state only.
Use existing UI primitives, palette, control IDs, and viewport-height support.

**First implementation chunk:** Expose the existing web composer and target
strip on primary card and dashboard routes, maintaining current `/chat` layout.
Then wire the remaining routes and mobile foreground switching, using actual
before/after screenshots rather than the v1 storyboard styling.

### F. Native delivery and iOS parity

**What / why:** RootView already keeps a native composer outside its webview,
but queued messages lack destination. Bind at native send commitment, not at
whichever web route eventually receives an emission (principles 1, 3, 4).

**Direction:** Extend the shared mobile contract with a versioned
`ComposerBinding` publication from the web shell to native:
`{ version: 1, kind: "selection", revision, boxSlug, selection, attention }`.
Selection is the ready/resolving/unavailable union from A. The same channel has
an assignment-only arm: `{ version: 1, kind: "assigned", boxSlug,
clientConversationId, sessionId, contextDir }`. It updates the alias map and
waiting sends, never the current selection. Thus a background Codex startup
can become assigned without publishing itself as the foreground conversation. Native renders the resolved recipient
beside the existing input; unresolved states retain typing but disable send
and explain why. Publish attention changes as the same small snapshot as C.

Add `NativeEmissionV3`, retaining V2's content fields and adding an immutable
`binding: SendBinding` plus its published revision. Native copies the current
binding at the send gesture or voice keyword, before HQ preparation/upload.
Persist it in PendingEmission and VoicePreparation so relaunch and retry cannot
retarget. The JS bridge validates box, session/start target identity, and captured
context against the paired box and server-resolved session directory; the
client does not get to rewrite the existing session directory. A revision older
than the current UI is valid for an already committed
send, not a reason to retarget or drop it. For start bindings, native persists the clientConversationId and accepts the
matching later alias publication even while another conversation is selected.
Native persists first-start attempt/acceptance metadata as specified in B; web
never persists a duplicate native content queue.
Unresolved start records after restart follow B's recoverable target-review
rule, not a fresh `new` send per queued message. Native stays the durable content
owner; web owns chat transport, queue/busy state, and receipts.

Negotiate support before native emits V3: the binding publication advertises
support, and updated native acknowledges the contract version. Updated native
against an older web host retains the draft and shows that sending requires an
updated host; do not send V3 to an old parser. A new web host accepts legacy V2
only under the existing visible-chat behavior, with first-receipt binding and
its documented limitation. Outside visible chat, unsupported native clients get
an explicit update-required rejection with guidance to return to chat and
Restore the rejected content before sending, rather than silently sending to a
guessed recipient. Do not promise that retrying the same rejected V2 delivery
will change its cached outcome merely because the route changed. Full everywhere behavior requires the
updated native client. Do not advertise legacy clients as passing native parity.

Existing persisted native sends with no binding cannot be safely assigned
retroactively. Load them into a recoverable review state: retain all content,
show “Choose a conversation to resend,” and require that explicit target before
retry. Retain the original message ID for deduplication. If the server reports
it was already accepted, report that acceptance without claiming the newly
chosen target was the original recipient; link to Chats for inspection. The same applies to an old voice-preparation record. Never quarantine or
discard a valid old draft merely because transport metadata is missing. Use
backward-compatible decoding and atomic repository writes; no box-card migration.

Move the existing combined detection (`ChatPage.tsx:206`:
`String(search.nativeComposer) === "1" || isNativeShell()`) into the shell.
It already survives loss of the search flag; its owner is the boundary to change. Internal
navigation must not re-enable the web composer or lose native selection commands.

ComposerBinding supersedes URL-derived `visibleChatSessionID` for updated native
clients. Today `ChatWebView.swift:916-922` reads `?session=` and
`RootView.swift:245-255` resets narration/HQ/playback/response on that change.
Use the selected logical target (including clientConversationId before assignment)
as the reset key, not route changes or the provisional-to-assigned transition.
`RootView` builds composerBox from the binding's concrete ID when available.
Migrate photo-batch/capture targeting (`NativeComposerView.swift:1154`), retained
voice audio's session association (`:817,838`), and the session flags published
by web. Retained audio captured before assignment follows the matching alias.
URL session messages remain compatibility input only until a versioned binding
is established; thereafter they cannot clear or override it. A card route with
no session query must leave the recipient, voice flags, and media association intact.

Keep web target status/queue controls visible above the native safe-area inset;
do not duplicate their logic in Swift. Update bridge fixtures, Swift, TS,
`mobile-contract.md`, and parity docs together. Audit other wrapper consumers
of these shared channel names; preserve their legacy behavior explicitly rather
than assuming that an iOS-only Swift change updates every wrapper.

**Vocabulary lock-ins:** NativeEmissionV3 is a delivery envelope with target
metadata; the shared input Emission remains target-free. Receipt IDs and retry
IDs retain their current meaning.

**First implementation chunk:** Add binding/V3 parsers, native persistence
upgrade handling, and shared JSON/XCTest fixtures before wiring new native UI.
Test delayed delivery across a landmark switch with no network/LLM dependency.

## Could this be simpler?

The smallest visual change is adding a composer to each page and navigating to
chat on Send. It fails the requested send-and-stay/voice workflow and remounts
input state when moving between cards. A hidden copy of InteractiveChat keeps
some hooks alive but creates competing bridges, subscriptions, and ownership.

A global composer that resolves the viewed card's landmark on every send is
smaller than explicit intent handling, but directly contradicts the human's
cross-landmark movement rule. A bridge lifted unchanged is smaller than F, but
cannot know the recipient of a native message delayed before first JS delivery.
These are observable wrong-recipient failures, not hypothetical framework neatness.

Conversely, a full tableau store, arbitrary tiled window manager, cross-device
draft service, or notification center buys nothing necessary for S1-S7. Keep
existing per-conversation sidecar tabs and local shell state. This is the
principles 8/10 boundary: reuse transport and isolate decisions for tests.

## Subplans

None. Shell lifetime, send binding, and native persistence are one coupled
contract and ship together. The broader mobile and screen-unfocused issues
remain separate work, not hidden subplans required to complete this one.

## Failure modes

No critical gap is accepted silently. The following tests are implementation
requirements; existing tests named below are anchors, not proof of new behavior.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Card link into another landmark changes recipient | New `conversation-intent` doctest | A preserves selection for inspect | Destination remains visible |
| Older landmark lookup wins a rapid second selection | New intent race test | A request generation | Pending label, then latest result only |
| Session assignment navigates an ambient first send to chat | Existing assignment tests; new shell integration | A conditional route projection | Page stays in place |
| Upload/HQ completes after a recipient switch | New binding doctest + XCTest | B/F frozen binding | Old target named on pending send |
| Receipt arrives after old controller disappears | Existing receipt tests; extend lifecycle | B retains unsettled local ownership | Accepted/rejected settles once |
| Locally held follow-up is lost on reload or storage quota failure | New pending-send persistence test | B writes content/binding before clearing; unavailable storage keeps draft | Recoverable target review or visible storage failure |
| Old-box preparation uses newly selected box URL | Existing native box tests; extend web binding | B suspend/dispose before client change | Requires returning to original box |
| Native redelivery reaches a different selected session | Existing redelivery fixtures; extend V3 | F persisted binding | Exact target or explicit rejection |
| Reservation expires or target is archived | Existing exact-send handling; extend frontend | B exactSession, no fallback | Retry/restore/select explicitly |
| Rejection overwrites another conversation's new draft | Existing restore tests; add destination switch | B failed-send entry | Explicit Restore only |
| Old card activity is attributed to newly focused card | New attention source test | C source-scoped capture/restore | Snapshot contains the actual source |
| No callout in an otherwise valid reply | Existing parser tests; new projection test | D reply-ready fallback | Transcript always reachable |
| Background reply appears to answer current conversation | New ambient attribution test | D separate session-labeled notice | No auto-navigation or speech |
| Disconnect misses completion or duplicates callout | Existing reconnect tests; extend tail comparison | D bounded history refresh and persistent attention flag | Retry/earlier-responses notice; no exact unread claim |
| Mobile transcript toggle resets reading or live dictation | Browser scenario plus controller lifecycle test | E stable input and retained card | Position restored; actual recording state shown |
| Older native pending record lacks destination | New shared/XCTest upgrade fixtures | F recoverable review, no guessed target | Choose conversation to resend |
| Codex new chat cannot reserve an ID or assigns after switching away | Existing new path; add bound-start tests | A/B preserve engine, correlate owning turn, and wait for committed readiness | New-place label or recoverable unassigned state |
| Init names a thread before registry promotion/history visibility | New staged-assignment route test | B matched readiness event or bounded exact retry; live registry admission after deletion gates | Waiting for conversation, not false archived error |
| Reload forgets that a new-chat first send was attempted/accepted | New web/native startup record fixtures | B/F persist first ID and state; native owns native content exactly once | Follow-ups wait or request target review, never become new first sends |
| Card URL drops native session and resets HQ/media target | Existing URL-session fixtures; extend binding tests | F versioned selection replaces URL as authority | Destination and settings remain stable |
| Native navigation renders a second web composer | Existing native bridge tests; extend shell harness | F shell-owned detection | Exactly one composer |

## Agent-flow / user-flow edge cases

- **ADDRESSED — wrong field:** C keeps `contextDir` separate from read-only presentation fields. Validate surface/transcript enums; agents cannot mutate them through feature deltas.
- **ADDRESSED — stale ref/session:** B rejects exact unavailable sessions; card viewers retain their existing unavailable state. Never infer a replacement card or recipient from a broken link.
- **ADDRESSED — two agents change a card:** this work adds no card mutation path. Existing card loaders/reconciliation remain responsible for changed data; explicit selected text stays the captured quote rather than silently changing under the draft.
- **ADDRESSED — hand-edited stored state:** validate shell sessionStorage and native records at load. Preserve valid legacy drafts; distinguish malformed metadata from recoverable missing binding.
- **ADDRESSED — fabricated free-form values:** D does not synthesize a reply from a completion event. Unknown attention is absent/other, not a fabricated card or hearing claim.
- **ADDRESSED — validation error UX:** wrong binding/version/expired target produces a named failed-send reason and recovery actions. Diagnostic logs include IDs and operation, not the full private draft.
- **ADDRESSED — partial rollout:** F defines new/new, new-native/old-web, old-native/new-web, and legacy stored-send behavior. Require updated clients for the new guarantee.
- **ADDRESSED — slash/system send:** retain current command assembly bypasses; do not reinterpret internal commands as user attention events.
- **DEFERRED — screen changes after send:** snapshot can be stale during a long turn. The screen-unfocused issue owns richer focus signals; narration is not audibility.
- **DEFERRED — simultaneous devices/tabs editing:** no new shared draft or unread coordination. Reuse current box-scoped local persistence without claiming collaborative composition.

## NOT in scope

- A general tiled window manager, tableau server persistence, drag/drop layouts, or rearrangement of every app page.
- A new design system or wholesale composer/nav restyle based on the exploratory storyboards.
- Cross-device synchronized drafts, selections, or unread markers.
- Automatic context switching on arbitrary directory or card navigation.
- Full DOM/screenshot capture, background-tab content injection, or implicit sensitive form capture.
- New narration semantics, automatic prose/HQ toggles, or guaranteed background microphone/audio execution.
- Replacing callout Markdown with mandatory card-backed callouts; question cards keep their existing status workflow.
- A box-wide notification center, scheduling changes, feedback-on-chat, or proactive draft production.
- A new card schema or husk migration. Card prominence continues to govern discoverability, not recipient identity.
- Broad mobile gesture/navigation redesign beyond the foreground card/transcript behavior needed here.

## Open design questions

None block the implementation. A-F now implement the reviewed defaults: cold
card entry uses that card's landmark once; dashboard entry uses root only when
no conversation is already selected; inspecting a result card preserves the
recipient; Open conversation switches it; drafts follow explicit selection
without a blocking confirmation. The actual-interface review still needs to
reconfirm generic labels for multiple untitled conversations and the broader
notice scope described in the engineering review.

Exact truncation and expansion sizes for mobile reply/input regions should be
settled against the existing UI during E's visual pass. No new layout aesthetic
is pre-approved. Richer attention/audio behavior belongs to the separately filed
screen-unfocused issue, not an unresolved first-chunk dependency.

## Knowledge audits

C changes agent-facing context and response guidance. Add `knows_directly`
entries to `src/dev/knowledge-audits.yaml` for:

1. A focused card in another landmark does not change the receiving session's directory.
2. Explicit selected text keeps its source after the focused card changes.
3. Hidden transcript calls for self-contained visual output, but does not enable narration or establish that speech can be heard.

The filtered audits run against the isolated test box passed for focused-card
versus conversation context and for hidden-transcript visual output. Their dated
records live in `src/dev/context-history.yaml`. Keep prompt/docs and audits in
the same implementation track when this context changes again.

## What will hold this after it ships

The implementation uses the existing doctest tiers. Its focused coverage lives in:

- `test/frontend/chat/conversation-intent.doctest.md` for route intent, cold entry, restoration, and unavailable targets.
- `test/frontend/chat/send-binding.doctest.md`, `pending-sends.doctest.md`, and `conversation-controller-pool.doctest.md` for frozen recipients, startup assignment, persistence, rejection, and overlapping delivery.
- `test/frontend/chat/card-conversation-context.doctest.md` and `card-activity-store.doctest.md` for focused content, selection sources, and source-scoped activity.
- `test/frontend/chat/ambient-replies.doctest.md` for transcript projection, background attribution, dismissal, reconnect, and incomplete history.
- `test/mobile-contract/fixtures.doctest.md` plus shared composer-binding/native-emission fixtures for version, target, assignment, and recovery boundaries.
- `test/webapp/chat-exact-committed.doctest.md` and `chat-send-routes-validation.doctest.md` for exact-session admission and context validation.
- `ComposerDraftTests.swift` and `SpeechKeywordsTests.swift` for native binding persistence, record upgrade, receipts, keyword send, and box isolation. The recorded native run used a simulator.

Extract decisions into pure functions; route tests exercise actual backend
queues/history rather than reproducing the implementation in a fake UI. A small
real-shell fixture mounts the owner through route/presentation changes to check
mount identity and listener count. Browser walks check actual layout and focus;
they complement, rather than replace, deterministic behavior tests. No new test
framework is needed.

## Implementation order

1. Record baseline screenshots of current desktop/mobile chat and card routes; add A's decision tests and owner extraction with existing appearance.
2. Implement B's frozen send binding and input lifetime; prove no lost receipt or cross-target send before enabling ambient input.
3. Implement C's optional context contract and source registration, then agent guidance/audits.
4. Implement D's transcript-backed ambient projection and bounded refresh.
5. Implement F's shared contract and deterministic native upgrade/delivery tests before exposing new native behavior.
6. Implement E's route coverage and constrained mobile presentation; complete F's native recipient/status wiring. Reuse all current controls.
7. Replay S1-S7, run selected tests/type/lint/docs and knowledge audits, get a cross-model implementation review, and address material findings.
8. Present actual-interface evidence to the boxholder and complete physical-device acceptance. Commit coherent chunks in this worktree; merge/deploy only when requested. These are commit boundaries, not partial shipping boundaries.

## Rollout shape

Design tests first for each new decision boundary listed above. Run the affected
doctests and `pnpm --dir beebox test:changed`, frontend/backend typechecks,
changed-file lint, and doc-check before implementation completion. Use the iOS
project's simulator build/XCTest commands and shared fixtures. Existing unrelated
manual-testing issues do not become closed because these checks pass.

The v1 exhibit is in the durable workstream store at
`chat-everywhere/chat-everywhere-walkthroughs-v1` (resolve with `bin/exhibits url`;
never commit its access token). Its scenarios are illustrative rather than a
visual spec. The following acceptance table is the durable tracked version.
Use the same case IDs for the actual-interface exhibit, annotate deviations,
and reconfirm with the boxholder before calling this work complete.

| Case | Actual-app replay | Required observation |
|---|---|---|
| S1 · Desktop evidence across landmarks | From Kitchen renovation, open House's energy report, select text, send | Recipient remains Kitchen renovation; focused card and quoted source are correct; page stays put; reply is accessible. |
| S2 · Explicit landmark mid-draft | Type and attach in Kitchen renovation; select Garden; return | Selection visibly changes, draft/selections survive, existing conversation histories stay separate. No accidental send or draft fork. |
| S3 · Work continues elsewhere | Send in Kitchen renovation; select Garden and type; let Kitchen finish | Garden keeps focus/draft. Notice names Kitchen. Inspecting result card keeps Garden; explicit Open conversation selects Kitchen. Test this while the original POST is still settling too. |
| S4 · Mobile card/voice/keyboard/history | Read Exercise 3; select, dictate, correct with keyboard, send, open transcript, return | One useful foreground region, one composer; keyboard does not cover controls; reading position and focus restore; callout is reachable. |
| S5 · Mobile gather while dictating | Speak beside recipe, select ingredients, open pantry, select more, review/send | Recording/input service survives navigation; appended draft and both source references remain; accepted transcript contains one emission. Repeat with upload/HQ delay and target change. |
| S6 · Screen away and return | Ask for diagrams, leave screen, allow completion, return | Visual result remains discoverable even if events were missed. No assertion that audio was heard; speech only follows existing policy/platform capability. No new background-audio guarantee. |
| S7 · Cold arrival / dashboard | Fresh direct card link; send; dashboard follow-up; separately fresh dashboard | Initial recipient is legible; subsequent browsing preserves it; fresh dashboard resolves root; cold bare `/chat` retains most-active bootstrap; repeat empty/new cases on Claude and Codex; explicit root selection and mere dashboard navigation remain distinct. |

Repeat the navigation/delivery portions on mobile web and updated iOS. Real
phone checks are required for dictation across navigation, keyboard/safe-area
behavior, interruptions, and screen-away recovery. Simulator-only evidence must
be labeled as such. If physical-device checks remain, report that boundary and
leave the plan incomplete; do not equate a mocked voice stream with a phone pass.

There is no box-card data migration. Shell persistence is additive and validated;
native pending-record upgrades retain content as described in F. Backend optional
context fields allow older web clients to continue. New native everywhere
semantics require coordinated client rollout; legacy sends are not silently
upgraded to a guarantee their payload cannot express.

Plan validation record: documentation checks passed; the [engineering review](chat-everywhere.review.md) records cross-model findings and their disposition. The focused cross-model re-review completed; its two startup/recovery findings are addressed in B/F and recorded in the review. These are source-reviewed requirements, not evidence of implemented behavior.

## Implementation verification — 2026-09-07

A–F are implemented in the `chat-everywhere` worktree. The box shell owns one
composer and chooses independent session controllers; sends capture target and
attention before asynchronous preparation. Web recovery retains full emissions;
native V3 owns its own pending content and mirrors startup identity. Ambient
replies use existing callout rendering. Mobile foregrounds cards or transcript
without remounting the input service.

Local browser replay used the isolated test box's recipe and Acids & Bases
landmark in place of the illustrative Kitchen/Garden content. A real send from
the recipe stayed on the page and the reply correctly identified the focused
card and surface. Switching landmarks left that reply under its original
conversation. Explicitly opening it preserved the composer DOM element.
Ordinary page navigation also preserved that element. An expired exact target
was refused without fallback and retained a separate recovery entry. Mobile
browser replay checked direct card links, transcript foregrounding and return.
A companion restored from desktop stays behind an Open card action on mobile;
opening it and returning to chat does not create a redirect loop.

Final affected-test verification passed: 226 files and 2,737 assertions. All
four TypeScript checks, changed-file lint and documentation checks passed.
Deterministic tests cover the remaining timing boundaries: captured recipient
across waits, overlapping startup, definitive versus uncertain refusal, reload
recovery, accepted-message storage cleanup, source-scoped card activity, native
protocol/upgrade behavior and box isolation. Two context knowledge audits passed
against the isolated box. Native simulator build passed and 45 focused XCTest
cases passed. The implementation review and adjudications are recorded in the
[engineering review](chat-everywhere.review.md).

Physical phone acceptance remains for S4–S6: live dictation through navigation,
keyboard/safe-area behavior, interruptions and screen-away recovery. Browser
viewport checks and deterministic voice tests do not close these gates. The
actual-interface exhibit requests the boxholder's reconfirmation. Generic
Conversation labels for untitled sessions can still be ambiguous, and retained
visited-session metadata allows later scheduled completions to raise notices
beyond the original sent-to/left-running set; active history subscriptions are
still pruned. This plan remains partial until those product calls and the phone
checks are accepted. Landing this branch does not itself verify deployment or a
physical device.

### 2026-09-08: isolate remembered conversations across development worktrees

A card page in a second development worktree restored the first worktree's
`test1` selection and displayed `missing-local-transcript`. Directory discovery
already skips missing transcripts; the tab's box-slug-only storage key was the
cause. Conversation selection, startup records, pending-send recovery, and
ambient metadata now use the box API path as their storage scope, including
the worktree prefix. Production keys retain their existing shape. Ambiguous
legacy development records remain untouched and are not automatically imported
into a clone. Explicit missing session requests remain unavailable.

Browser replay retained a foreign legacy selection, reloaded this worktree,
and confirmed its own conversation restored without the unavailable banner.
The separate development checkout needs this change incorporated before its
page benefits. This does not close the remaining physical-device checks above.

For this correction, all 58 affected assertions, four TypeScript checks, and
changed-file lint passed. Cross-model review found no defect in the scoped
conversation stores. It identified the separate, pre-existing
[draft storage collision](../../../issues/closed/bugs/2026-09-08-draft-storage-crosses-development-worktrees.md),
which remains outside this correction.

### 2026-09-08: recover a fresh Claude reservation after server restart

A separate follow-up reproduced the same unavailable banner for an ID that
this box itself had reserved before its first message. A development reload
then discarded the server's in-memory reservation. Namespace isolation cannot
repair that lifecycle: the session in the URL is correct, but not yet backed
by a transcript.

Keep Claude reservations because full camera capture and bulk upload can need
an addressable target before the first message. A tab records the context,
engine, and model of each successful reservation under its box-instance storage
scope. A matching receipt permits restoring that exact reservation before
bootstrap or reconnect history refresh. This must precede history lookup: after
a restart, raw history refresh for an empty Claude chat on a Codex-default
box otherwise queries the wrong engine, bypassing bootstrap's unavailable answer.
The server still refuses IDs already present in committed history/transcripts.
Explicitly requested unknown IDs, foreign-scope receipts, and still-unavailable
results do not become new chats automatically. An implicitly selected old chat
with a missing local transcript starts fresh, as established by the main-branch
resolver correction. Receipts are metadata, not user-message storage; they
last for the tab and are removed before a send or deletion attempt, when a
user-message event is observed, or when bootstrap observes a real transcript.

Already-lost IDs from before this change have no receipt. The unavailable
notice offers an explicit Start new conversation action that retains the card
query and unsent draft. Enter respects the same disabled-recipient condition
as the send button, before capturing any emission; it no longer produces the
misleading Message kept for recovery toast for that blocked gesture.

This recovery is same-tab only. A copied old empty-session URL without its
receipt still requires an explicit new conversation. Re-reservation preserves
the stored context/engine/model; feature defaults are recomputed by the existing
reservation endpoint, so feature edits that existed only in the lost server
reservation are not recovered by this correction.

Verification: the exact reported unavailable/Enter-toast combination reproduced
in the development browser. With the correction, Enter left the draft intact
without a toast, and Start new conversation retained both draft and card query.
A real stop/restart of this isolated worktree followed by reload re-reserved the
same empty Claude ID and restored the same directory/card. The 64 affected
assertions and 30 reservation/bootstrap backend assertions passed, as did the
frontend typecheck and changed-file lint. No physical-device check is claimed.

Review and browser replay required fresh bootstrap and directory lookups after
re-reservation (the cache could otherwise return unavailable or the wrong root
directory), recovery
from malformed metadata, and receipt retirement when a chat is used or deleted.
Those corrections are in place. The cache regression uses a real QueryClient with stale bootstrap and root-directory entries;
the final affected run passed 71 assertions. In the browser, the delete action
removed the test reservation receipt, and a subsequent server restart left that
ID unavailable instead of recreating it. A fresh receipt still recovered its
exact ID through a separate restart. These checks do not establish cross-tab
recovery or durable deletion knowledge across other clients.

Mounted-page correction (2026-09-08): transcript reconnect and ambient refresh
now await the same receipt-backed reservation recovery before reading history.
Concurrent consumers share the in-flight recovery; retired or absent receipts
never authorize it. Ambient Retry follows the same path. A real server
stop/wake with the browser left mounted restored the same empty Claude ID and
directory without a page reload. The wrong-engine case is also covered by a
backend regression with a Claude reservation on a Codex-default box.

The follow-up review moved ambient recovery into the history query function,
covering initial load, focus refetch, invalidation, and Retry with one ordering
guarantee. Observed nonempty history retires its receipt. A receipt-backed
selection that cannot recover stays unavailable even during passive browsing;
it cannot silently fall back to the box's default engine.

### 2026-09-10: interface-card presentation ownership moved to the workspace

The follow-on [interface-card consolidation plan](interface-cards-consolidation.md)
now owns ordinary card and interface-instrument presentation. Dashboard,
Settings, Browse, Questions, Landmarks, History, Storage, and Admin are canonical
workspace card targets. Its implementation retired the production page-content
fork and generic card preview/conversation overlay described earlier in this
plan. Those passages remain the historical design baseline, not current route
or presentation dispositions.

Chat-everywhere continues to own the singleton conversation runtime, recipient
selection, drafts and send binding, ambient replies and callouts, native
publication, and the rule that passive attention never changes the recipient.
The workspace's Show conversation and Show cards controls provide the retained
mobile presentation. Task-specific source, image, and capture dialogs remain.
The small read adapter for old `bbxConversationOverlay` browser-history entries
belongs to consolidation compatibility; new history entries do not write that
field. None of this closes the physical-phone and product-reconfirmation gates
above or establishes production deployment.
