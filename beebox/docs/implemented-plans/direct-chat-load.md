---
title: "Direct chat load"
status: implemented
workstream: direct-chat-load
issues:
  - ../../../issues/closed/bugs/2026-11-13-choosing-conversation-notice-flashes-on-every-reload.md
---
# Direct chat load

Loading or reloading a chat page goes straight to a conversation: the one the URL names, the one that fits, or a new chat. The "Choosing conversation…" notice and the dead-end "no saved transcript" notice with **Retry** / **Start new conversation** go away.

**Issues addressed:** `issues/bugs/2026-11-13-choosing-conversation-notice-flashes-on-every-reload.md`. Searched the queue for "Choosing conversation", "no saved transcript", "missing-local-transcript", "receipt": the other hits (`2026-10-29-unsent-chat-reservation-fails-after-engine-switch.md`, feature items) are about reservation semantics, not this notice.

## Design

The developer's rule, stated in the handoff: *"It should be direct, no selector, just go to whatever chat is appropriate or a new chat, and if it's wrong then I'll select the other chat from the menu."*

- When I reload a chat page, I want to see that conversation without an intermediate step, so I can keep working.
- When the URL names a conversation this box does not have (never created, expired, ran elsewhere, being deleted), I want a usable new chat, so the page is never a dead end. The conversation menu is how I pick another one.
- When the box cannot be reached, I want the page to keep trying on its own and, if it gives up, say so in one quiet line with Retry, so I know why sending is held.

What the person sees:

| Situation | Before | After |
|---|---|---|
| Normal reload, fast resolution | "Choosing conversation…" flashes | Nothing; the transcript appears |
| Slow resolution (over 1 s) | "Choosing conversation…" | Muted "Loading conversation…" until ready |
| Named id missing in this box | Red reason + Retry + Start new | New chat, silently (console warning) |
| Box unreachable | "Choosing conversation…" while the transport retries (~211 s), then red error + Retry + Start new | "Loading conversation…" while the transport retries, then muted "Couldn't load the conversation." + Retry |

The composer stays typeable throughout; only sending waits (existing behaviour, `sendDisabledReasonFor`, `InteractiveChat/shell.tsx:57-59`). Its tooltip text changes from "Choosing conversation…" to "Loading conversation…".

Silent fallback is the developer's choice. The cost: a person who follows a link to a husked or expired chat lands in a new chat with no explanation. The husk page (`components/chat-husk/ChatHuskView.tsx`) still exists for direct visits.

## Smallest fix and budget

Smallest fix: in `resolveConversation`, every `unavailable` outcome becomes `fresh(...)`; the notice renders nothing while resolving. That is about 20 lines and fixes both reported symptoms. It leaves a thrown request (transport error) on the `unavailable` notice with buttons.

Chosen: the smallest fix plus one extra recovery attempt for a receipted chat, a delayed loading line, a quiet failure line with Retry, and the Codex-`start` URL correction. Actual: ~120 source lines changed, ~140 test lines, ~20 doc lines (chat-everywhere plan paragraphs, performance.md mark note).

Revised after review: the first draft added a background retry loop in the hook. The tRPC link already retries a query whose box did not answer, for about 211 s, and states *"Past that the person sees the message and nothing retries on a timer — nothing retries forever."* (`src/frontend/src/lib/trpc/transient.ts:121-126`). The loop was a second retry layer that contradicted that rule, and it was removed.

## Stated preferences this plan trades against

- Earlier decision, `beebox/docs/plans/chat-everywhere.md:845-847`: *"Explicitly requested unknown IDs, foreign-scope receipts, and still-unavailable results do not become new chats automatically."* The developer reverses this in the handoff quote above. The plan updates that paragraph.
- Test header "A proven implicit selection never silently changes identity" (`test/components/chat/everywhere/resolve-conversation.test.ts`, ~line 235): same decision; the test is rewritten to the new rule. The receipt's identity role is unchanged where it still matters: recovery re-reserves the exact id before bootstrap (`reservation-recovery.ts`), so a refused first send keeps its conversation (commit `286529c5b`). Only when that recovery cannot produce a usable conversation does the page fall back.
- Memory/feedback: bias toward strict, fail-closed. A silent identity change is fail-open. Accepted because the developer asked for it, and a refused message that was saved stays reachable: pending sends are stored per box and tab, not per conversation (`use-bound-emission/hook.tsx:88`, `createPendingSendsStore(sessionStorage, { boxSlug, storageScope })`), and `FailedConversationSends` offers **Retry original conversation** / **Restore to draft** on whatever chat is shown. A send the store could not persist (storage quota, `pending-sends.ts:201`) is in memory only and does not survive a reload; that is existing behaviour.

## What already exists

- `fresh()` (`resolve-conversation.ts:57-79`) creates a reserved Claude chat or a Codex `start` target; reused as the fallback.
- Resolution gate (`conversation-intent.ts`, `createResolutionGate`) invalidates superseded requests; unchanged.
- tRPC transport retry (`src/frontend/src/lib/trpc/transient.ts`, `client.ts:174-181`): queries to an unreachable box retry for ~211 s. Reused as the only retry layer.
- Draft composition is per box (`input-store.ts:81`, `useEmissionStoreInstance(boxSlug)`), so the draft survives a fallback.
- Card panel opens without a ready conversation (commit `5e9b4a257`); becomes moot for the missing-id case since a conversation is now always ready.

## Prior art (external)

No design decision depends on an external premise. Skipped.

## Ontology

No new nouns. `ConversationSelection` kinds (`shared/chat-composer-binding.ts:16-20`: `resolving`, `ready`, `unavailable`) are unchanged, so the `beeboxComposerBinding` publication shape and `ios-app/BeeBox/Models/NativeComposerContract.swift:577-578` need no change. The values change: native receives a `ready` new chat where it used to receive the "no saved transcript" `unavailable` reason, and `unavailable` with "Couldn't load the conversation." when resolution throws.

## Tracks / scope

### 1. Resolver falls back to a new chat

- What: `resolveConversation` returns `fresh(...)` wherever it returned `unavailable` today: `resolveEmptyBootstrap` with a proven receipt (`:83-88`), the `missing-local-transcript` named/proven branch (`:134`), and `deletion-in-progress` (`:135`).
- Why: these are the dead-end notices the developer reported.
- Direction: delete the `named`/`receiptProven` conditions for the fallback; `console.warn` the session id and reason. `fresh` keeps a *known* context directory: the request's `contextDir` or the receipt's (receipt wins). A bare `?session=<id>` with neither opens the new chat at the box root; an `unavailable` bootstrap carries no directory to recover.
- Recovery retry (from plan review): when reservation recovery threw and bootstrap then cannot open the chat, the resolver runs recovery once more (bootstrap answering shows the box is up). Success re-bootstraps the same id. A second transport failure throws to the hook. `ReservationRecoveryUnsupportedError` (engine no longer reserves ids) means the reservation is gone, so the resolver falls back. `ConversationRequest.named` loses its only reader; remove the field and its writers (`conversation-intent.ts:39`, `BoxConversationShell/view.tsx:55`).
- First chunk: resolver change + rewritten tests in `resolve-conversation.test.ts`.

### 2. Selection hook reports a thrown resolution quietly

- What: on a throw, `useConversationSelection.select` sets `unavailable` with the fixed reason "Couldn't load the conversation." and logs the error. The existing `retry` re-runs the last request.
- Why: the old reason was the raw error message, and the notice offered **Start new conversation**, a selector the developer ruled out.

### 3. Notice and composer text

- What: `ConversationNotice` renders nothing for the first second of `resolving`, then muted "Loading conversation…". `unavailable` renders its reason, muted, with one **Retry** button. **Start new conversation** is removed; the conversation menu already offers it. `sendDisabledReasonFor` says "Loading conversation…".
- `BoxPresentationProvider.tsx:39` keeps gating `placeReady` on `resolving`; unchanged.

### 4. Codex `start` fallback rewrites the URL to `?session=new`

- What: `routeSelectionUpdate` (`conversation-intent.ts`) writes `session: "new"` when a chat page shows a `start` target but the URL names some other concrete id.
- Why: without it, a Codex box that falls back keeps `?session=<missing>` in the URL and repeats the fallback on every reload. Claude boxes already get the new reserved id written (`session` branch of the same function).

## Could this be simpler?

The simplest version is track 1 + "render nothing while resolving". It leaves a thrown error on the red notice with Start new, which the handoff rules out (*"A blocking selector is not [acceptable]"*). Track 2 is a message change, not machinery. The recovery retry in track 1 is a few lines and keeps the deploy case on its own chat. Track 4 is two lines and stops a repeated fallback loop on Codex boxes. The delayed loading line costs one timer and covers a slow `chat.bootstrap` on a long transcript, where an empty pane with a held send button would otherwise be unexplained.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Named id missing → new chat, person expected the old one | `resolve-conversation.test.ts` "An id named in the URL…" | conversation menu | silent by design (console.warn) |
| Recovery throws during a restart, bootstrap then finds nothing | "Passive navigation…" (recovered / down) | one more recovery; a second throw reaches the hook | clear ("Couldn't load the conversation." + Retry) |
| Engine no longer reserves ids (box default changed) | "Passive navigation…" (gone) | falls back to a new chat in the receipt's place | silent (console.warn) |
| `fresh()` itself throws (status/reserve fails) | hook path, browser-verified with a stubbed 500 | `unavailable` + Retry | clear |
| Codex fallback leaves stale `?session=` | `conversation-intent.test.ts` | track 4 | n/a |
| Accepted first message, then a restart before the transcript: bootstrap `pending` holds it, the page opens a new chat | — | none (also unseen before this change) | silent; filed as `issues/bugs/2026-11-13-accepted-first-message-invisible-after-restart.md` |
| Box unreachable: send waits for the transport's ~211 s retries | — | composer stays typeable; failure line + Retry at the end | clear; queued sends while unreachable would be new machinery |
| Switching A→B: A stays visible for up to 1 s with no indicator | — | "Loading conversation…" after 1 s | accepted; resolution is usually well under a second |

No critical gap.

## Agent-flow / user-flow edge cases

- Wrong tag / wrong field, two agents, hand-edit drift, fabricated value, validation UX, migration: no agent-facing surface or stored shape changes.
- Stale ref: a URL id deleted between visits → ADDRESSED by track 1 (new chat).
- Refused first send then reload (handoff case): with the receipt, recovery re-reserves the same id (unchanged); without it, track 1 gives a new chat and the failed-send row keeps the message. ADDRESSED; verified in the browser.

## NOT in scope

- Rendering a named session before bootstrap returns (optimistic mount). Not now: recovery must precede history fetch (`chat-everywhere.md:840-843`), so the history controller cannot mount early without reordering that.
- iOS "Finding the conversation..." text (`NativeComposerView.swift:453`). Web only per handoff.
- A visible "that conversation isn't here" note on fallback. Developer asked for silent.
- Removing the `unavailable` selection kind from the shared schema. It is part of the native contract.

## Open design questions

none

## Knowledge audits

Purely UI behaviour; no agent-facing concept. Skip.

## What will hold this after it ships

`resolve-conversation.test.ts` covers every fallback branch (pure function with fakes). `conversation-intent.test.ts` covers track 4. The delayed notice and the failure line are UI timing, verified in the browser with stubbed `chat.bootstrap` and `/chat/send` responses.

## Implementation order

1. Track 1 + tests. 2. Tracks 2-3. 3. Track 4 + test. 4. Doc updates (`chat-everywhere.md` paragraph, `development/performance.md:43`). 5. Browser verification on the worktree test box: normal reload, reload with a never-created `?session=` id, refused-send-then-reload if reproducible.

## Rollout shape

Done when the rewritten resolver tests, the intent test, frontend typecheck and lint pass, and the browser walk shows no notice on reload and a new chat for a missing id. No migration.
