# What a small pass does not load

The SDK loads a box's own agent context by default — `CLAUDE.md`, the generated
agent guide, `.claude/rules/`. For the reactor, procedure runs and chat that is
the design. For the small structured passes (chat review, retro observation,
triage, the procedure judge) it is pure cost: measured on the test box it is
**~9,700 always-loaded words on every invocation**, and a pass emitting a title
or a yes/no verdict cannot use any of it
(`issues/code-quality/2026-07-30-structured-output-passes-load-full-box-context.md`).

`loadBoxContext: false` is how a call site opts out. It reaches the SDK as an
empty `settingSources`, and it is omitted entirely otherwise so the SDK's own
default keeps applying — this is an opt-out, never a new default.

```ts setup
import { buildQueryOptions } from "../../src/core/agent/run.js";

const CONTEXT = { env: {}, maxTurns: 4, binaryPath: null, appendedSystem: "" };
const RUN = { boxRoot: "/box", systemPrompt: "", prompt: "hi" };

function optionsFor(extra: Record<string, unknown>): Record<string, unknown> {
  return buildQueryOptions({ ...RUN, ...extra }, CONTEXT);
}
```

Opting out sets an empty `settingSources`; anything else leaves the key off.

```ts
JSON.stringify(optionsFor({ loadBoxContext: false }).settingSources)
=> []

JSON.stringify(["settingSources" in optionsFor({}), "settingSources" in optionsFor({ loadBoxContext: true })])
=> [false,false]
```

Opting out changes nothing else about the run — the working directory is still
the box, so a pass that reads a file still can.

```ts
optionsFor({ loadBoxContext: false }).cwd
=> /box
```
