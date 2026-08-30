# Procedure run-status transitions

The run card's overall status follows a fixed lifecycle. `updateRunCardStatus`
(`src/core/procedure/engine-run-card.ts`) asserts the transition at the write
boundary so a caller bug can't persist a corrupt lifecycle. The pure predicates
that back that assertion live in `engine-types.ts` and are the test seam.

```ts setup
import { isRunStatus, isLegalRunStatusTransition } from "../../../src/core/procedure/engine-types.js";
```

## `isRunStatus` — is this a known status?

```ts
isRunStatus("running")
=> true

isRunStatus("completed")
=> true

isRunStatus("bogus")
=> false
```

## Legal transitions

The documented lifecycle is `pending → running → completed/failed`, plus the two
resume moves: an interrupted run re-stamps `running → running`, and a failed run
re-opens `failed → running`.

```ts
isLegalRunStatusTransition("pending", "running")
=> true

isLegalRunStatusTransition("running", "completed")
=> true

isLegalRunStatusTransition("running", "failed")
=> true

isLegalRunStatusTransition("running", "running")
=> true

isLegalRunStatusTransition("failed", "running")
=> true
```

## Illegal transitions

A terminal `completed` run is never re-opened (resume returns early before it
would write), so every move out of `completed` is rejected. Skipping `running`
or moving backwards out of a terminal state is likewise rejected.

```ts
isLegalRunStatusTransition("completed", "running")
=> false

isLegalRunStatusTransition("completed", "failed")
=> false

isLegalRunStatusTransition("pending", "completed")
=> false

isLegalRunStatusTransition("failed", "completed")
=> false
```
