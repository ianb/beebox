# `run()`'s wall-clock ceiling

agent-browser 0.27.0's `wait --fn` polls forever unless
`AGENT_BROWSER_DEFAULT_TIMEOUT` is set, and an unbounded child hung
`screenshot`, `snapshot`, and `open`. `timeoutMs` is the backstop under the
settle wait: whatever the upstream binary does about timeouts, the wrapper
cannot hang forever.

```ts setup
import { run } from "../src/runner.js";

async function refused(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "(no error)";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
```

## A child that ignores its own timeout is still killed

```ts
const killed = await refused(async () => run(["--version"], { timeoutMs: 1 }));
killed.includes("killed after 1ms")
=> true
```
