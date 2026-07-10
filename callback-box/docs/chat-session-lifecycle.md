# Chat session lifecycle

The backend chat runs are long-lived SDK conversations wrapped by two classes:

- **`ChatSession`** (`src/core/chat/session/index.ts`) — whole-box interactive chat.
  Queues messages that arrive mid-turn and drains them into the next turn.
- **`ChatThreadSession`** (`src/core/chat/session/thread.ts`) — one per chat
  thread, orchestrated by `ChatSessionPool`. No queue; the pool parks/activates
  one session at a time.

Both drive their SDK run through the same lifecycle, modelled as a discriminated
union in `src/core/chat/session/lifecycle.ts`, and adapt raw SDK messages through
the same shared adapter (`adaptSdkMessage` in `src/core/chat/session/messages.ts`).
This doc is the backend
counterpart to the frontend's state-machine docs — the park/drain/evict/queue
contract the backend previously left implicit.

## Phases

```
                 send()                    backend.start()
      idle ───────────────▶ starting ─────────────────────▶ ready
       ▲                                                    │   ▲
       │ run ended (close handler)                   send() │   │ result
       │                                                    ▼   │
       ├──────────────◀──────────── stopping ◀── stop() ── streaming
       │                                │
       └────────◀───────────────────────┘  run ended
```

| Phase | Meaning | `isRunning()` | `isBusy()` |
|-------|---------|:---:|:---:|
| `idle` | no SDK run; start state and where every run ends | no | no |
| `starting` | `startRun()` in flight (docs refresh, lock, spawn); no run handle yet | no | yes |
| `ready` | run open and idle, waiting for the next turn | yes | no |
| `streaming` | a turn is in flight | yes | yes |
| `stopping` | a graceful `stop()` closed the run; close handler will not drain | yes | `wasBusy` |

`stopping` is **ChatSession-only** — a thread session has no queue to protect, so
its `stop()`/`park()` close straight through `ready`/`streaming` → `idle`.

The legal edges live in one table (`isLegalChatPhaseTransition`); every write
site goes through `nextLifecycle`, which throws an `InvariantError` on an illegal
move (a caller bug over internal state — not a degradable condition).

## The contract

- **Queue / drain (ChatSession).** A `send()` while `streaming` — or while a run
  is `starting` — is not accepted (`isBusy()` → `true`); callers `enqueue()`
  instead. When the turn's `result` lands (`streaming → ready`) the queue drains
  into the next turn. Queuing during `starting` matters for concurrency: a second
  request arriving mid-`startRun` has no open run to send onto, so it enqueues
  and rides the starting run's first turn rather than racing a second run.
  If the run dies unexpectedly with a non-empty queue, the close handler starts
  a fresh run and drains into it — so a wedged run doesn't lose queued messages.
- **Stop vs restart.** `stop()` moves to `stopping` and clears the queue; the
  close handler reads that phase as the intentional-stop signal and does **not**
  drain. `restart()` leaves the phase as-is and just closes the run, so the same
  close handler **does** drain the queue into a fresh run — the wedged-session
  recovery path. `resetSession()` is `stop()` plus clearing the saved session id.
- **Park / evict (ChatThreadSession + pool).** The pool holds one active session.
  A message for a different thread `park()`s the active one (close the run, keep
  the session id for resume) after waiting for any in-flight turn to finish
  (`waitForIdle` watches `done`/`close`). Registry eviction calls `stop()`.
- **The busy-flip ordering.** On `result`, the phase advances to `ready`
  (`isBusy()` → `false`) **before** `<chat-app>` feature deltas are applied, so a
  `features-changed` listener can call `setFeature()` without hitting the
  in-flight guard. `afterTurnResult` encodes this.
- **Close-window race.** `run.closed` flips and the consume loop's `finally`
  both fire when the message iterator ends. `startRun()` only starts from `idle`;
  during the brief window where the handle is closed but the phase hasn't reached
  `idle`, a `send()` returns `false`/rejects rather than racing a second run onto
  the session.

## Shared code

The two classes share the SDK message-pump skeleton (`pumpChatRun` in
`session/consume.ts`), the lifecycle union/transitions (`session/lifecycle.ts`),
and the SDK-message adapter (`adaptSdkMessage` in `session/messages.ts`).

**The adapter is one shared function** (Track 6 convergence, 2026-07). Both
sessions call the same `adaptSdkMessage`, so every SDK message type surfaces to
both paths identically — there is no longer a thread-local fork that silently
dropped types. The thread path's narrowing (it delivers only complete
`<chat-response>` blocks over external chat) now lives as **explicit flow
control** in `ChatThreadSession.handleMessage`: a `switch` over the message type
where `stream_event` (partial deltas) and `task` (background-task lifecycle) are
deliberate, commented, logged skips, and `assertNever` guards the union so a new
SDK message type is a compile error rather than a silent drop.

The two classes are **not** yet collapsed into one base class — see
`../../issues/2026-07-06-chat-session-shared-core.md` for why (the per-turn bodies
genuinely diverge: durability + queue draining vs `<chat-response>` extraction).
