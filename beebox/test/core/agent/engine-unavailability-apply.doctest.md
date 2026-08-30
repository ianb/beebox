# Engine unavailability — classifying a failed AgentResult

`applyEngineUnavailability` post-processes an engine run's `AgentResult`:
a failure matching a recognized provider signal gains the typed
`unavailability` field and an informative rewritten `error`, and the machine
store is populated so the scheduler's skip gate and deferred-outcome logic
(which live across a process boundary) can see it. Everything else passes
through byte-identical.

```ts setup
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { applyEngineUnavailability } from "../../../src/core/agent/engine-unavailability-apply.js";
import { liveEngineUnavailability } from "../../../src/core/agent/engine-availability-store.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

// The verbatim CLI message from the live probe (2026-08-18). The reset date is
// far in the past relative to any test run, so the parsed date clamps to the
// bounded 1-hour fallback hold — which also exercises the clamp path.
const CODEX_QUOTA_MESSAGE =
  "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage " +
  "to purchase more credits or try again at Aug 19th, 2026 11:34 PM.";
```

## A recognized failure is classified, rewritten, and recorded

```ts
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "engine-apply-"));
const box = await makeTmpBox();
t.teardown(async () => {
  delete process.env.BBX_ENGINE_AVAILABILITY_FILE;
  await fs.rm(dir, { recursive: true, force: true });
  await box.cleanup();
});
process.env.BBX_ENGINE_AVAILABILITY_FILE = path.join(dir, "engine-availability.json");

const classified = await applyEngineUnavailability(
  { success: false, output: "", error: CODEX_QUOTA_MESSAGE, exitCode: -1, sessionId: "s1" },
  { provider: "codex", boxRoot: box.root },
);
classified.success === false && classified.unavailability?.reason
=> quota-exhausted

!classified.success && classified.error.startsWith("Codex is out of usage quota until ")
=> true

const live = await liveEngineUnavailability({ provider: "codex", now: new Date() });
live?.provider
=> codex

// The episode was announced (no channels are configured on a tmp box, so no
// cards were written) and latched — recorded as notified.
live?.notifiedAt !== null
=> true
```

## Unrecognized failures and successes pass through untouched

```ts continue
const ordinary = await applyEngineUnavailability(
  { success: false, output: "x", error: "exit code 1", exitCode: 1, sessionId: "s2" },
  { provider: "codex", boxRoot: box.root },
);
!ordinary.success && ordinary.error
=> exit code 1

"unavailability" in ordinary
=> false

const success = await applyEngineUnavailability(
  { success: true, output: "done", exitCode: 0, sessionId: "s3" },
  { provider: "codex", boxRoot: box.root },
);
success.success
=> true
```
