---
title: "Notification target: a new chat in a place"
status: draft
workstream: notification-place-target
issues:
  - ../../../issues/bugs/2026-11-10-notification-target-cannot-name-a-place.md
  - ../../../issues/bugs/2026-11-10-notification-chat-gets-a-pending-question-offered.md
---
# Notification target: a new chat in a place

A notification can open a new chat, but only at the box root. This plan adds a target `chat:new:<place directory>` that opens a new chat in that place, and stops a chat opened from a notification from offering an unrelated pending question.

**Issues addressed:** [notification target cannot name a place](../../../issues/bugs/2026-11-10-notification-target-cannot-name-a-place.md); [notification chat gets a pending question offered](../../../issues/bugs/2026-11-10-notification-chat-gets-a-pending-question-offered.md). Searched `issues/` for "notification", "chat:new", "target": [notifications have no recipient](../../../issues/features/2026-10-30-notifications-have-no-recipient.md) and the notifications design issue are unrelated to tap targets. No duplicate.

## Design

### Situations

- When Priya's box nudges her at 9pm that she has not written today's journal entry, I want the tap to open a chat in the journal place, so I can start writing with the journal's context and cards beside me.
- When Idris gets a "the club's events page lists May" nudge, I want the tap to land in the club website place, so the agent there already knows which files are in scope.
- When Tomas taps a nudge whose place he has since deleted, I want to still read the message and talk about it, so the tap is not a dead end.
- When Noor taps a notification and has an old pending question about paint colors, I do not want that question opened beside the chat, so the chat is about what the notification said.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Journal nudge | Show | New chat bound to the place; the place's arrival card opens beside it on desktop, as any arrival does; the notification banner above the composer | The notification already interrupted; the chat waits for her |
| Place removed | Show | New chat at the box root with the banner | Same |
| Pending question exists | Quiet | The question is not opened; the empty-state line reads "Start a conversation." | None |

### Spirit

- **Serves:** *It should feel like a place* — a nudge to do X takes the person to X's place.
- **Risks:** none new. The notification and its loudness are unchanged; only where the tap lands changes.

### Trust

Shows only, takes no action. The box agent chooses the target when it writes the notification or schedule; the person corrects a wrong place by saying so in chat, and the agent edits the schedule card.

### When it goes wrong or does nothing

- **Place does not exist at send time:** `bbx notify` exits 2 with `no place at "<dir>": the directory has no landmark card`. A `notify:` schedule's tick fails with the same message, which the schedule's run status shows. Nothing is sent.
- **Place removed after send:** the tap opens a new root chat with the banner (the pre-change behavior). The console logs a warning.
- **Older iOS app:** it does not know the new form; the target has a `/`, which its `chat:<sessionId>` rule refuses. The tap brings the app forward where it was and logs an unreadable target (`ios-app/BeeBox/Views/RootView.swift:373-379`). Accepted: the fix is to update the app, which ships with this change.
- **Place lookup fails at tap time** (server unreachable): the chat opens at the root with the banner, as for a removed place. A failed lookup while loading the chat page means the page itself is failing; a retry surface is not worth its cost here.

### Walkthrough

The journal schedule card has `notify: {target: "chat:new:_content/journal"}`. At 9pm the tick parses the target, checks `_content/journal/*.landmark.card` exists, and sends. The URL is `/<box>/chat?new=1&contextDir=_content%2Fjournal&notification=<id>`; APNs carries the target string and the iOS app renders the same path. The chat route's `beforeLoad` confirms the landmark (`landmarks.identity`), redirects to `?session=new&contextDir=_content/journal&notification=<id>`, and the conversation resolver starts a fresh chat with that context directory. The banner shows the notification. Arrival opens the journal's arrival card on desktop and no question. Her first message carries the notification as context, as today.

## Smallest fix and budget

Smallest fix: parse `chat:new:<dir>` and append `&contextDir=` to the URL. Chosen design adds: the send-time existence check, the tap-time fallback, the Swift mirror, docs, and the arrival-question suppression. Estimate: ~150 source lines (TS ~90, Swift ~25, docs strings ~15), ~90 test lines (TS + Swift). Docs: mobile-contract §5.10 a few lines.

## Stated preferences this plan trades against

- `AGENTS.md` (root): *"Bias toward strict"* (boxholder memory) — fail closed at send for a missing place, rather than send and fall back.
- `beebox/src/core/notification/target.ts:1-8`: *"parsed once into a discriminated union and rendered to a root-relative deep link per box. It is never a raw URL."* The new form keeps that.
- `ios-app/BeeBox/Models/NotificationTarget.swift:9-11`: *"`NotificationTargetTests` runs the TypeScript test's cases ... a change to the rules there changes them here."* — the Swift mirror changes in the same commit.

## What already exists

- `?session=new&contextDir=<dir>` already starts a fresh chat in a directory: `conversation-intent.ts` `explicitChatRequest` passes `contextDir: search.contextDir` with `kind: "new"`; `resolve-conversation.ts` `fresh(...contextDir)`. Reuse; the route schema already has `contextDir` (`chat-route-search.ts:10`).
- The chat route already rewrites `?new=1` to `session=new` and keeps the other params (`router.tsx:133-134`). Reuse; add the place check there.
- `landmarks.identity` (`webapp/trpc/routers/landmarks/router.ts`, after `forDir`) answers "is there a landmark in this dir" cheaply and fences the namespace. Reuse for the tap check.
- `resolveRefPath` normalizes and fences a box path (`_content/journal/` → `_content/journal`; `journal` → null). Reuse for parse.
- `landmarkScanRelDir` / `normalizeLandmarkDir` (`core/landmark/root-dir.ts`) map the root place to `_content`. `_content` as a place normalizes to plain `chat:new`.
- `usePlaceArrival` (`WorkspaceProvider/provider.tsx:94-106`) enables the arrival question only for `contextDir === "" && unstarted`. Add one condition.

## Prior art (external)

No decision depends on an external premise.

## Ontology

- **Place**: a box directory with a `*.landmark.card` (`core/landmark/nearest.ts:9-13`: *"keyed on the `*.landmark.card` filename alone"*). Named in a target by its box-relative directory, e.g. `_content/journal`. Not the landmark card path; not a geographic `place` card.
- **`chat-new` target**: gains an optional `place` field. No new union member: `chat:new` and `chat:new:<dir>` are one kind with and without a place.

## Tracks / scope

### A. Target grammar and URL (TS + Swift)

- **What:** `parseTarget("chat:new:<dir>")` → `{ kind: "chat-new", place: "<dir>" }`; `formatTarget` round-trips; `targetUrl` adds `&contextDir=<enc>` before `&notification=`. A dir naming `_content` (the root place) normalizes to `{ kind: "chat-new" }`. A path ending `.landmark.card` is refused with "name the place's directory, not its landmark card". Swift `NotificationTarget` mirrors it as `.chatNew(place: String?)`.
- **Why:** the issue's journal case.
- **Vocabulary lock-in:** `chat:new:<place directory>`; `Target` `{ kind: "chat-new"; place?: string }`.
- **First chunk:** target.ts + target.test.ts + Swift + PushNotificationTests + mobile-contract §5.10.

### B. Send-time check

- **What:** `targetProblem(boxRoot, target): Promise<string | null>` in `core/notification/target-check.ts`: for a `chat-new` with a place, null when the directory is inside the box namespace on disk (`resolveBoxNamespacePathOnDisk`) and its first `*.landmark.card` by name parses (`readLandmarkCard`), else the message. This is the predicate `landmarks.identity` applies at tap time, so a place that passes at send passes at tap unless it changes in between. A `notify:` schedule records the refusal as a final failure (no retry). `bbx notify` checks every target before any send or dry run (exit 2). `notifyBoxholder` throws on a problem, which covers the schedule tick and the server's `notifications.send`.
- **Why:** fail closed at the writer, where the agent can fix it.

### C. Tap-time fallback

- **What:** the chat route's `beforeLoad`, for `?new=1` with `contextDir`, awaits `trpcClient.landmarks.identity.query({ dir })`; on null or error it drops `contextDir` and logs a warning. The decision is a pure function `notificationChatSearch(rest, identityFound)` for testing.

### D. No arrival question for a notification chat

- **What:** `usePlaceArrival` takes `fromNotification` (the route search has `notification`) and leaves the question query disabled when true. This covers `chat:new` at the root.

### E. Docs the box agent reads

- `bbx notify --help` target list, `SCHEMES` in target.ts, `bbx-commands-scheduling.ts`, `schemas/scheduled-script/instructions.ts` (the `notify:` target line). One line: "A nudge to go do something in a place targets that place: `chat:new:<place directory>`."

## Could this be simpler?

Simplest: Track A's TS half alone. It fails on (1) a typo'd or nonexistent place, which would open a chat whose working directory does not exist; the agent would not learn of it until the person taps — strictness preference; (2) the iOS app, which parses targets itself and would open the root chat for every place target. Track D is one condition. No new abstraction: the check is one function with one place case.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent names a place dir that has no landmark | New CLI test | Exit 2 with message | Clear |
| Agent names the landmark card path | New target test | Parse error with hint | Clear |
| Agent names `journal` without `_content/` | New target test | Parse error (outside underscore areas) | Clear |
| Schedule tick after place deleted | New notify-boxholder test | Throws; schedule run records failure | Clear in schedule status |
| Tap after place deleted | New pure-function test | Root chat with banner | Console warning |
| `landmarks.identity` errors (offline) | Same pure function | Root chat | Console warning |
| Old iOS app gets `chat:new:<dir>` | Swift test on current app only | Its parser refuses `/`; app opens where it was | Logged on the phone; accepted |
| Place dir is a symlink out of the box, or its landmark does not parse | notify-boxholder test | Refused at send, same predicate as tap | Clear |

## Agent-flow / user-flow edge cases

- Wrong field: landmark card path vs dir — ADDRESSED (Track A hint).
- Stale ref — ADDRESSED (B at send, C at tap).
- Hand-edit drift: trailing slash or leading `/` — ADDRESSED (`resolveRefPath` normalizes).
- Validation error UX — message names the dir and says what is missing.
- Partial rollout: an older box server never emits the form; an older iOS app degrades as above.
- Two agents / fabricated value — not applicable: a target is a path checked against the disk.

## NOT in scope

- Checking that `card:`/`question:` targets exist at send: same idea, but not asked for, and those already show "not found" on tap.
- `chat:<sessionId>` in a place: a session already has its directory.
- Editing the boxholder's prod journal schedule: reported, not done.
- Showing a visible "place was removed" note in the chat: the banner already carries the message; revisit if it confuses.

## Open design questions

none

## Plan review (codex gpt-6-sol)

Adopted: one predicate at send and tap (namespace on disk plus a parsing landmark card), and the corrected older-iOS behavior. Already true: `bbx notify` checks every target in process before any send or dry run, so a missing place exits 2 on both the local and the server route; only a place removed between that check and the server's is exit 1, which is acceptable. Declined: a retry surface for a failed tap-time lookup (see When it goes wrong).

## Knowledge audits

Agent-facing: "a nudge to go do X targets X's place". Add one `knows_directly` entry if the audit file has a notifications section; run it against test1.

## What will hold this after it ships

`target.test.ts` cases (grammar, URL), Swift `PushNotificationTests` mirroring them, a `bbx notify` command test for the missing place, a `notifyBoxholder` test for the throw, a pure-function test for the route fallback, and an `arrival` test for D if the decision is pure; otherwise the condition is a single boolean in the hook.

## Implementation order

1. Track A (TS + Swift + contract doc).
2. Track B.
3. Tracks C and D.
4. Track E and the knowledge audit.

## Rollout shape

Done when the tests above pass, `pnpm typecheck`/lint pass, the iOS unit tests pass on a simulator, and a browser walk on the worktree's test1 clone shows `chat:new:_content/projects/porch-rebuild` opening a chat in that place with the banner and no question. No data migration.
