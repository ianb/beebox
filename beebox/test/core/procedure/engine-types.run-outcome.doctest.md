# Procedure run outcomes

A run card's `outcome` is written once, when the run finishes, and removed only
when a resume re-opens the run. `finishRunCard` and `reopenRunCard`
(`src/core/procedure/engine/run-card.ts`) assert this at the write boundary so
a caller bug can't persist a corrupt lifecycle. The pure predicates behind
those assertions live in `engine-types.ts`.

```ts setup
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canReopenRun, isRunOutcome } from "../../../src/core/procedure/engine-types.js";
import { finishRunCard, reopenRunCard } from "../../../src/core/procedure/engine/run-card.js";

async function attempt(fn: () => Promise<void>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return e instanceof Error ? e.message.replace(/: \/.*$/, "") : String(e);
  }
}
```

## `isRunOutcome` — is this a known outcome?

```ts
isRunOutcome("completed")
=> true

isRunOutcome("inconclusive")
=> true

isRunOutcome("running")
=> false
```

## Which runs a resume may re-open

A run with no outcome was interrupted mid-execution; re-opening it is
idempotent. A failed run re-opens. A completed run never does (resume returns
early), and neither does an inconclusive one: its work is done and resume does
not re-judge.

```ts
canReopenRun(undefined)
=> true

canReopenRun("failed")
=> true

canReopenRun("completed")
=> false

canReopenRun("inconclusive")
=> false
```

## The write boundary

A run finishes once. Finishing it again without re-opening it is refused, and
so is re-opening a completed run. Re-opening a failed run removes its
outcome, so it can finish again.

```ts
const dir = await mkdtemp(join(tmpdir(), "run-outcome-"));
const card = join(dir, "run.procedure-run.card");
await writeFile(card, "---\nprocedure: p.procedure.card\nstarted-at: 2026-09-01T00:00:00.000Z\nsteps: []\n---\n");

await attempt(() => finishRunCard({ runCardPath: card, outcome: "failed", completedAt: "2026-09-01T00:05:00.000Z", expires: "never" }))
=> ok

(await readFile(card, "utf-8")).split("\n").slice(0, 3).join(" | ")
=> --- | procedure: p.procedure.card | outcome: failed

await attempt(() => finishRunCard({ runCardPath: card, outcome: "completed", completedAt: "2026-09-01T00:06:00.000Z", expires: "never" }))
=> Run already finished (failed), cannot record completed

await attempt(() => reopenRunCard(card))
=> ok

(await readFile(card, "utf-8")).includes("outcome:")
=> false

await attempt(() => finishRunCard({ runCardPath: card, outcome: "completed", completedAt: "2026-09-01T00:07:00.000Z", expires: "never" }))
=> ok

await attempt(() => reopenRunCard(card))
=> A completed run cannot be re-opened
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
