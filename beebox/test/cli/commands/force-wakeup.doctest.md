# `bbx force-wakeup` — a real wakeup, now, from a shell with no credential

`bbx wakeup` in an agent's shell runs a cycle in which every Google connector
finds no service, syncs nothing, and reports success. Forcing disagreed with
letting it happen, and the difference was invisible to the caller — the
2026-09-14 incident one layer down.

What these tests pin is the replacement, end to end over a real socket: the CLI
verb asks the box's own server (auth wall ON, agent bearer doing real work), the
server runs the same supervised `bbx wakeup` child the Sync button and the
scheduler run, and the agent reads back a typed account of what each connector
did. The child itself is substituted here — spawning a real CLI is the one part
of this path with nothing to verify.

```ts setup
import { makeTestServer, TEST_SLUG } from "../../helpers/doctest-server.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { forceWakeup, forceWakeupLines } from "../../../src/cli/commands/force-wakeup.js";
import type { WakeupRunner, WakeupRunResult } from "../../../src/core/commands/wakeup-runner.js";
import type { WakeupOutcomeReport } from "../../../src/cli/commands/wakeup-outcome.js";

/** What the connector step of a clean scoped run looks like. */
const DRIVE_SYNCED = {
  name: "google-drive",
  success: true,
  created: 3,
  updated: 1,
  pushed: 0,
  jobs: 2,
};

const GMAIL_SKIPPED = {
  name: "gmail",
  success: true,
  created: 0,
  updated: 0,
  pushed: 0,
  jobs: 0,
  skipped: { reason: "not-configured", detail: "Google is not authorized for this box" },
};

function report(overrides: Partial<WakeupOutcomeReport>): WakeupOutcomeReport {
  return {
    connectorErrors: 0,
    connectors: [],
    reactorOk: true,
    reactorSkipped: false,
    jobsProcessed: 0,
    jobsRemaining: 0,
    ...overrides,
  };
}

/** Records what the procedure asked the child to do, and answers with `result`. */
function stubRunner(result: WakeupRunResult): { runner: WakeupRunner; calls: unknown[] } {
  const calls: unknown[] = [];
  const runner: WakeupRunner = async (opts) => {
    calls.push({ triggeredBy: opts.triggeredBy, connector: opts.connector ?? null });
    return result;
  };
  return { runner, calls };
}

const SHELL_VARS = ["BBX_SPAWN_PROFILE", "BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN"];
const savedShell = Object.fromEntries(SHELL_VARS.map((name) => [name, process.env[name]]));

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/**
 * The refusal each spawn profile gets once the agent token is gone. A loop in
 * setup rather than in the example: the example stays one readable assertion.
 */
async function refusalPerProfile(): Promise<string[]> {
  const lines: string[] = [];
  for (const profile of ["agent", "tooling", undefined]) {
    setEnv({ BBX_SPAWN_PROFILE: profile, BBX_AGENT_TOKEN: undefined });
    const refused = await forceWakeup({});
    if (refused.ok) throw new Error(`${String(profile)} did not refuse`);
    const first = refused.error.message.split(".")[0];
    lines.push(`${String(profile)}: ${refused.error.kind} | ${refused.error.fix} | ${String(first)}`);
  }
  return lines;
}

/** A box server with the auth wall up and a substituted wakeup child. */
async function boxWith(result: WakeupRunResult) {
  const stub = stubRunner(result);
  const ctx = await makeTestServer({
    openAccess: false,
    services: { wakeupRunner: stub.runner },
  });
  const serverUrl = await ctx.server.listen({ port: 0, host: "127.0.0.1" });
  setEnv({
    BBX_SPAWN_PROFILE: "agent",
    BBX_SERVER_URL: serverUrl,
    BBX_BOX_NAME: TEST_SLUG,
    BBX_AGENT_TOKEN: getOrCreateAgentToken(ctx.boxRoot),
  });
  return { ctx, calls: stub.calls };
}
```

## A scoped force reaches the child as `--connector`, and comes back per connector

`triggeredBy` distinguishes this run in the box's history from a scheduled one;
the connector name is passed through untranslated, because `bbx wakeup` matches
`Connector.name` exactly (`drive` would match nothing).

```ts
const box = await boxWith({
  ok: true,
  detail: "",
  output: "[Running connectors]\nSyncing google-drive...",
  outcome: report({ connectors: [DRIVE_SYNCED], jobsProcessed: 2 }),
});
const forced = await forceWakeup({ connector: "google-drive" });
JSON.stringify({ calls: box.calls, ok: forced.ok && forced.value.ok })
=> {"calls":[{"triggeredBy":"force-wakeup","connector":"google-drive"}],"ok":true}
```

The entries survive the wire, so the agent learns what Drive did without
reading a line of the child's output:

```ts continue
JSON.stringify(forced.value.outcome.connectors[0])
=> {"name":"google-drive","success":true,"created":3,"updated":1,"pushed":0,"jobs":2}
```

For a person that is one line per connector, then the reactor — the step a
caller waiting on a job actually depends on:

```ts continue
JSON.stringify(forceWakeupLines(forced.value))
=> ["  google-drive: 3 created, 1 updated, 2 jobs","reactor: ok, 2 jobs processed, 0 remaining"]
```

The child's output is NOT in the result. An agent that had to parse prose to
learn whether Drive synced is the situation this verb exists to end.

```ts continue
"output" in forced.value
=> false
```

```ts cleanup
await box.ctx.cleanup();
```

## A connector that deliberately did nothing says so, with the reason

This is the failure the incident was made of: a service the box never contacted
reporting as "up to date". `success` is true — nothing failed — so the skip is
the only thing that distinguishes it from a real sync.

```ts
const box = await boxWith({
  ok: true,
  detail: "",
  output: "",
  outcome: report({ connectors: [DRIVE_SYNCED, GMAIL_SKIPPED], jobsProcessed: 2 }),
});
const forced = await forceWakeup({});
JSON.stringify(forceWakeupLines(forced.value))
=> ["  google-drive: 3 created, 1 updated, 2 jobs","  gmail: skipped (not-configured): Google is not authorized for this box","reactor: ok, 2 jobs processed, 0 remaining"]
```

With no `--connector` the child runs the whole cycle, which is what the
schedule runs — the same code, not a forced variant of it:

```ts continue
JSON.stringify(box.calls[0])
=> {"triggeredBy":"force-wakeup","connector":null}
```

```ts cleanup
await box.ctx.cleanup();
```

## A cycle that skipped on the box's lock is a successful call

Two overlapping wakeups are ordinary. The call succeeded and nothing ran, so
the skip has to be visible — reported as an error it would look like a broken
box, and reported as a clean run it would claim work that never started.

```ts
const box = await boxWith({
  ok: true,
  detail: "",
  output: "Wakeup already running for this box; skipping.",
  outcome: report({ skipped: "wakeup-running" }),
});
const forced = await forceWakeup({});
const summary = { ok: forced.value.ok, skipped: forced.value.outcome.skipped, lines: forceWakeupLines(forced.value), detail: forced.value.detail.split(",")[0] };
JSON.stringify(summary)
=> {"ok":true,"skipped":"wakeup-running","lines":["wakeup skipped: already running"],"detail":"Another wakeup cycle was already running on this box"}
```

```ts cleanup
await box.ctx.cleanup();
```

## A child that produced no outcome is "unknown", not "fine"

An older binary or a crash before the end of the cycle leaves nothing to read.
Saying so is the whole point: a caller must not take silence for success.

```ts
const box = await boxWith({ ok: true, detail: "", output: "", outcome: null });
const forced = await forceWakeup({});
forceWakeupLines(forced.value)[0].split("—")[0].trim()
=> The wakeup finished, but produced no outcome line
```

```ts cleanup
await box.ctx.cleanup();
```

## A failed child keeps its per-connector detail, and the verb exits non-zero

```ts
const box = await boxWith({
  ok: false,
  detail: "bbx wakeup exited with code 1",
  output: "",
  outcome: report({
    connectorErrors: 1,
    connectors: [{ name: "nope", success: false, created: 0, updated: 0, pushed: 0, jobs: 0, error: "Connector not found: nope" }],
  }),
});
const forced = await forceWakeup({ connector: "nope" });
const failed = { ok: forced.value.ok, lines: forceWakeupLines(forced.value) };
JSON.stringify(failed)
=> {"ok":false,"lines":["  nope: error: Connector not found: nope","reactor: ok, 0 jobs processed, 0 remaining","bbx wakeup exited with code 1"]}
```

`--json` prints exactly this object, so an agent reads fields rather than the
lines above.

```ts continue
Object.keys(JSON.parse(JSON.stringify(forced.value))).sort().join(",")
=> detail,ok,outcome
```

```ts cleanup
await box.ctx.cleanup();
```

## Without the box environment it refuses by name — in every profile

The refusal points at the spawn site, not at the box. `tooling` is included
deliberately: unlike a credentialed `bbx drive` verb, this one has no
in-process path to fall back to, so the marker changes nothing.

```ts
const box = await boxWith({ ok: true, detail: "", output: "", outcome: report({}) });
const refusals = await refusalPerProfile();
JSON.stringify(refusals)
=> ["agent: BOX_UNREACHABLE | machine | Cannot reach this box's server: BBX_AGENT_TOKEN is not set","tooling: BOX_UNREACHABLE | machine | Cannot reach this box's server: BBX_AGENT_TOKEN is not set","undefined: BOX_UNREACHABLE | machine | Cannot reach this box's server: BBX_AGENT_TOKEN is not set"]
```

The child was never asked to run:

```ts continue
box.calls.length
=> 0
```

```ts cleanup
setEnv(savedShell);
await box.ctx.cleanup();
```
