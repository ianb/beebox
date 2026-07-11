---
title: "chat action error surfacing"
needs: [design]
area: frontend
filed-by: agent
discovered-in: worktree-architectural-review — Track F/N (P1-f), fixing
  InteractiveChat-actions.ts's silent restart-process catch
resolution: implemented
---

**Closed (implemented) by c5c1fe73** (architectural-review follow-ups, Track 5).
Built a generic frontend toast primitive: a module-level, framework-free store
(`src/frontend/src/components/ui/toast-store.ts`, singleton `toastError`) bound
via `useSyncExternalStore` in one `<ToastViewport>` at the app root
(`main.tsx`). Errors only; dedupe counter, ~10s auto-expiry, dismissible,
`role="alert"`. Wired all four silent sites — `handleRestartProcess`,
`handleLoadOlder`, `handleCancelSchedule`, and the machine's swallowed
`interruptChat(...).catch(() => {})` (now `sendInterrupt`, toast + console.error).

`InteractiveChat`'s chat machine has exactly one user-visible error channel:
`context.error`, set by `STREAM_ERROR`/`STREAM_FAILED` and rendered as a
banner, dismissed via `DISMISS_ERROR`. It's wired into the `on:` block of the
"streaming" state only (`chatMachine.ts`) — dispatching it from outside a live
turn silently no-ops.

That left `handleRestartProcess` (`InteractiveChat-actions.ts`) with nothing
to surface a failed restart to the user beyond `console.error` — a "restart
process" click that fails still looks, from the user's side, identical to one
that succeeded. Same gap applies to any other non-stream user-initiated
action in this component (e.g. `handleCompactSession`, `handleNewSession` if
they ever gain fallible work).

Worth a small design pass: either widen the machine's error context to a
generic (non-stream-gated) action-error slot, or add a lightweight toast
mechanism for action handlers that isn't tied to the streaming state at all.
Not done as part of this task — console.error is the interim signal.
