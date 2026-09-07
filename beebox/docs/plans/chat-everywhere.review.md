# Plan Engineering Review — Chat everywhere

Review of [Chat everywhere](chat-everywhere.md), 2026-09-07. The independent
reviewer was Claude Fable, invoked read-only from Codex. The originating
[issue](../../../issues/features/2026-08-30-chat-input-everywhere.md) and direct
human decisions were review authority; only planning was authorized.

## What already exists

The reviewer verified the box-layout seam, ChatPage's assignment/remount
boundary, box-scoped drafts, landmark action, card Chat/New controls, contextual
back-to-chat chip, receipt semantics, native V2 shape, backend exact-session
validation, bus completion events, callout renderer, and narration guidance.
The corrected plan distinguishes existing backend support from missing
frontend propagation.

## Prior art (external) — verified

The planner repeated the primary-source checks while reviewing the document:

- [React state preservation](https://react.dev/learn/preserving-and-resetting-state): component state follows position in the render tree. Supports a persistent input owner, not duplicated page composers.
- [TanStack navigation](https://tanstack.com/router/latest/docs/guide/navigation): navigation/search/location state are explicit inputs. Supports intent-driven selection; does not specify this product's recipient policy.
- [VS Code context](https://code.visualstudio.com/docs/agents/concepts/context): implicit current activity and explicit attached evidence are distinct. Supports the context distinction, not adopting VS Code's layout.
- [Apple audio sessions](https://developer.apple.com/documentation/avfaudio/avaudiosession): audio configuration is separate from presentation. No source establishes that backgrounding means the user can hear a reply.

The independent CLI reviewer did not have web tools and did not independently
verify these links. No framework change or new external dependency is proposed.

## Stated preferences this plan trades against

The human requires explicit landmark selection to change conversational focus,
while ordinary card movement need not. Desktop split is the same conversational
experience with more room; mobile needs a useful foreground surface and voice.
The mockups were accepted as rough behavioral sketches, not a visual redesign.
The plan must preserve actual controls and replay the seven scenarios after
implementation. The recorded singleton-input direction remains in force.

## Could this be simpler? (verified)

A per-page composer would lose route-bound recording/delivery ownership. A
persistent composer with card-directory inference would violate explicit
navigation intent. A native listener lifted unchanged cannot recover a target
that the native message never recorded.

The initial plan did over-specify ambient history catchup. The revised D uses
the existing bounded history tail, a session-labeled attention flag, and a
conversation return path. It makes no exact unread-history promise and adds no
cursor/paging consumer. Existing server paging is real, but unnecessary here.

## Failure modes

The most consequential failures were missing Codex's unreservable startup,
retargeting after an asynchronous send wait, and native session state clearing
on a card URL. Tracks A/B/F now describe separate start/existing targets,
captured controller ownership, explicit HTTP target propagation, assignment
correlation, and native binding as the authoritative selection source.

The bounded recovery tradeoff is explicit: if an unassigned startup loses its
local owner before the session alias is known, retain unsent follow-ups for
target review. Do not choose the most-active chat or create several new ones.
Accepted first messages retain their original acceptance/dedup identity.

## Agent-flow / user-flow edge cases

- Explicit result inspection versus Open conversation is distinguished.
- A queued send keeps its original target through UI selection changes.
- The same provisional chat becoming assigned is not another user selection.
- Cold bare chat retains existing most-active bootstrap; cold dashboard uses root.
- Native URL compatibility events cannot override an established new binding.
- Hidden transcript does not enable narration or prove audible playback.
- Missing transcript IDs/incomplete tail groups use a reply-ready fallback.
- Physical device and mixed-version behavior remain implementation acceptance work.

## Findings

### 1. Preserve new-chat startup on engines that cannot reserve an ID

**Location in plan:** A, B, F.
**Citation:** original A: “Ready always has a concrete reserved or existing ID.”
`src/frontend/src/pages/ChatPage.tsx:32-35`: only Claude can coin IDs;
`:285-288` retains the `new` path for Codex.
**Issue:** the proposed ready state could never admit a fresh Codex conversation.
**Why it matters:** selecting a landmark without history would disable sending.
**Suggested action:** represent an immutable start target separately from an existing/reserved ID.
**Traces to preference:** principles 1 and 4; preserve supported product behavior.
**Disposition:** accepted. A/B/F now preserve both engines, freeze new-chat
choices, pin the owning controller until assignment, and hold follow-ups until
that exact logical target has an assigned ID. No Claude-only scope reduction.

### 2. Specify the full web dispatch path, not just a binding object

**Location in plan:** B and its first implementation chunk.
**Citation:** original B: “Route through the existing chat target, assembler,
machine receipt, and POST paths.” `api-chat.ts` `startChatTurn` had no
`exactSession` argument; SEND derived session from machine context.
**Issue:** a lifted input could still dispatch through the newly selected controller after an upload wait.
**Why it matters:** freezing a data object alone does not change the actual HTTP recipient.
**Suggested action:** capture a controller handle at the gesture and carry bound target/exactSession through SEND, both actor POST sites, and startChatTurn.
**Traces to preference:** principles 1, 9, 10; S5's navigation during preparation.
**Disposition:** accepted. B names the handle, propagation sites, retention rule,
local pending persistence, and awaited-upload tests. Backend exact-session
validation is reuse; its web-client propagation is new work.

### 3. Replace native URL-derived session authority and migrate its consumers

**Location in plan:** F.
**Citation:** `../ios-app/BeeBox/Views/ChatWebView.swift:916-922` derives visible
session from `?session=`; `RootView.swift:245-255` resets voice/response state
when it changes.
**Issue:** opening a card would clear native target/flags despite the new shell binding.
**Why it matters:** photo batching and retained audio also depend on that ID.
**Suggested action:** make ComposerBinding authoritative for composerBox, feature reset boundaries, batch/capture destination, and retained audio.
**Traces to preference:** principles 8 and 13; iOS parity through ordinary page movement.
**Disposition:** accepted. F names those consumers and prevents legacy URL
signals from overriding an established binding. Assignment and presentation
changes do not count as explicit conversation switches.

### 4. State the cold bare-chat policy explicitly

**Location in plan:** A intent table and S7.
**Citation:** `src/frontend/src/pages/ChatPage.tsx:281-283`: omitted session asks
bootstrap for the box's most-active session.
**Issue:** the original table specified cold card/dashboard entry but omitted the normal box landing route.
**Why it matters:** interpreting all cold entry as root would silently change current landing behavior.
**Suggested action:** retain most-active bootstrap for cold bare `/chat`; distinguish it from dashboard-first root selection.
**Traces to preference:** preserve current interface behavior; explicit navigation contracts.
**Disposition:** accepted. A and S7 cover bare chat and empty-box entry, including both engines.

### 5. Bound ambient recovery to the actual walkthrough requirement

**Location in plan:** D.
**Citation:** original D proposed persisted cursors and paging until a saved marker.
The reviewer claimed history was tail-only, citing a frontend caller.
**Issue:** full unread reconstruction exceeded S3/S6's required result notice and return path. The tail-only API claim was inaccurate.
**Why it matters:** a second paginated-history consumer creates complexity without an approved unread-history feature.
**Suggested action:** use recent history and a persistent session-level attention notice; make older content reachable in the conversation.
**Traces to preference:** principles 6 and 8; no notification-center expansion.
**Disposition:** accepted scope correction; rejected factual claim.
`src/webapp/trpc/routers/chat-session-procedures.ts:37-55` has both tail and page
arms. D deliberately does not add a paging consumer. A changed preview cannot
clear attention, and a truncated group does not get a fabricated stable ID.

### 6. Correct source evidence and describe the real native-detection seam

**Location in plan:** existing-code table and F.
**Citation:** `app-shell.tsx:138` uses `previous.current`, not the originally
quoted `lastBoxSlugRef.current`; `ChatPage.tsx:206` already combines the query
hint with `isNativeShell()`.
**Issue:** the plan incorrectly implied native mode depended only on a query parameter.
**Why it matters:** an implementer could recreate a fix already present instead of moving its owner.
**Suggested action:** correct the quote and retain the existing combined detection in the new shell.
**Traces to preference:** read before writing; cite actual source.
**Disposition:** accepted. Quotes/line anchors corrected; F changes ownership rather than inventing another native detector.

### 7. Wait for committed startup before releasing follow-ups

**Location in plan:** B and its failure-mode tests.
**Citation:** `src/core/chat/session/registry.ts:351-378` awaits
`recordSessionStart` before `this.entries.set(sessionId, candidate)` and the
`session-assigned` event. The turn stream can expose the ID earlier.
**Issue:** treating the init frame as readiness can produce an exact-target 404
for a conversation that is still starting.
**Why it matters:** an ordinary follow-up would appear rejected, or retained
controllers could adopt the wrong unqualified assignment event.
**Suggested action:** correlate the alias through the owning stream, wait for
matching committed assignment, and bound same-target retries if that event is lost.
**Traces to preference:** send destination remains stable through multitasking.
**Disposition:** accepted. B specifies correlation, readiness, bounded retries,
and staged startup tests. The planner additionally checked the registry APIs:
`registry.ts:174-175` `isKnownSession` checks entries/reservations, whereas
`registry-deletion.ts:22-24` also finds pending entries. B requires deletion
checks first and the former gate for committed readiness; it does not rely on
engine-history enumeration becoming visible immediately. This gate change is
planned and still requires implementation tests.

### 8. Persist first-start ownership and keep native content in one queue

**Location in plan:** B/F recovery and persistence.
**Citation:** the earlier plan said “acceptance without recovered assignment
does not authorize another new send” but did not name a persistent first-send
record; `use-native-bridge.ts:150-153` keeps current bridge dedup in page memory.
**Issue:** after reload, a follow-up can look like a new first send. Writing it
into both web and native content queues would also duplicate recovery entries.
**Why it matters:** recovery could create another conversation or present the
same unsent material twice.
**Suggested action:** persist startup identity/acceptance alongside aliases,
and make native the sole durable owner of native-origin content.
**Traces to preference:** one input, explicit destination, no silent resend.
**Disposition:** accepted. B/F require a designated first emission ID plus
prepared/attempted/accepted/assigned state in routing metadata, mirrored by native
before delivery and on receipt. Uncertain attempts require recovery, not another
fresh start. Native-origin content never enters the web pending-content record;
its receipt waits for backend acceptance. Persistence failure after acceptance
must not relabel an accepted message as rejected. Recovery tests remain required.

## NOT in scope (verified)

No generic window manager, tableau service, new design system, cross-device
input/unread sync, new agent engine, screen-awareness service, or background
audio guarantee is required. Related manual-testing and mobile-polish issues
are not automatically closed. No implementation or deployment is authorized by
this review.

## Things I checked and found clean

The first independent review verified the core source seams listed above, the
seven existing test anchors it checked, related issue/doc links, existing
control IDs, and the knowledge-audit convention. Documentation checking and
required plan-section checks passed during drafting. Product behavior tests,
knowledge audits, simulator runs, and physical-device checks have not run for
this proposed change; the plan names them as later acceptance work.

A focused cross-model re-review of corrected A/B/D/F completed. Its two
remaining findings are recorded above and incorporated into the plan. The
reviewer rechecked the engine startup, both POST paths, native consumers, and
cold-chat behavior. The planner source-checked the registry readiness distinction
afterward. The final corrections have not received a third independent pass.
Reservation expiry timing and non-iOS wrapper behavior were not independently
verified in the focused review; implementation must exercise the stated
failure and compatibility boundaries before claiming completion.
