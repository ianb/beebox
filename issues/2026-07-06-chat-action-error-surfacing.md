---
needs: [design]
area: frontend
filed-by: agent
discovered-in: worktree-architectural-review — Track F/N (P1-f), fixing
  InteractiveChat-actions.ts's silent restart-process catch
---

# No generic user-visible error surfacing for chat action handlers

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
