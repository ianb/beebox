# Chat run lifecycle

`chat-session-lifecycle.ts` models the shared chat-run phases as a discriminated
union and centralises the legal transitions. The pure predicates are the seam:
they need no SDK run, so the phase graph is fully exercised here. Both
`ChatSession` and `ChatThreadSession` assert against `isLegalChatPhaseTransition`
at their write sites.

```ts setup
import {
  isLegalChatPhaseTransition,
  lifecycleBusy,
  lifecycleRun,
  IDLE,
} from "../../src/core/chat-session-lifecycle.js";
```

## Legal transitions — the run's happy path and teardown

```ts
isLegalChatPhaseTransition("idle", "starting")
=> true

isLegalChatPhaseTransition("starting", "ready")
=> true

isLegalChatPhaseTransition("ready", "streaming")
=> true

isLegalChatPhaseTransition("streaming", "ready")
=> true

isLegalChatPhaseTransition("streaming", "stopping")
=> true

isLegalChatPhaseTransition("stopping", "idle")
=> true

isLegalChatPhaseTransition("streaming", "idle")
=> true
```

## Illegal transitions are rejected

You can't stream without starting, resurrect a stopped run, or skip phases.

```ts
isLegalChatPhaseTransition("idle", "streaming")
=> false

isLegalChatPhaseTransition("stopping", "streaming")
=> false

isLegalChatPhaseTransition("ready", "starting")
=> false

isLegalChatPhaseTransition("idle", "idle")
=> false
```

## `busy` and `run` readings match the phase

`idle`, `starting`, and `ready` are not busy; only `streaming` (or a `stopping`
that interrupted a turn) is. Only the run-carrying phases expose a handle.

```ts
lifecycleBusy(IDLE)
=> false

lifecycleBusy({ phase: "starting" })
=> false

lifecycleBusy({ phase: "streaming", run: {} as never })
=> true

lifecycleBusy({ phase: "stopping", run: {} as never, wasBusy: true })
=> true

lifecycleBusy({ phase: "stopping", run: {} as never, wasBusy: false })
=> false

lifecycleRun(IDLE) === null
=> true

lifecycleRun({ phase: "starting" }) === null
=> true
```
