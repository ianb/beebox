# `POST /api/chat/send` — a run that cannot start is refused, not accepted

A send is acknowledged once the session takes the turn; the run starts after
(see `send-run.start-failure.doctest.md`). A run that is certain to be refused —
no Claude login, or a third-party model with no provider setup — used to be
acknowledged too. The web composer then showed the error on the turn stream,
but a sender that never subscribes to that stream, such as quick chat, stored
the thought as sent while no run ever read it
(`issues/closed/bugs/2026-10-15-quick-chat-sent-when-run-never-starts.md`).

So the session runs the same readiness check `startRun` makes before it takes
the turn. A refusal answers 409 with its reason, records nothing, and keeps no
message-id claim: once the cause is fixed, a retry of the same id is sent.

These examples refuse with an added OpenRouter model as the box default and no
OpenRouter key, which needs no Claude CLI; a logged-out Claude takes the same
path.

```ts setup
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer } from "../../../helpers/doctest-server.js";
import { createFakeChatBackend, type FakeChatBackend } from "../../../../src/services/claude-chat/core.js";
import type { BusEvent } from "../../../../src/core/event-bus/core.js";

/** Await the fake's real start boundary; the file-level timeout catches hangs. */
async function awaitFakeRuns(backend: FakeChatBackend, count: number): Promise<void> {
  while (backend.runs.length < count) {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
}

/** Run with console.error captured: the refusal is logged by design. */
async function capturingErrors<T>(run: () => Promise<T>): Promise<{ result: T; logged: string[] }> {
  const logged: string[] = [];
  const { error } = console;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try { return { result: await run(), logged }; }
  finally { console.error = error; }
}
```

## A refused run answers 409 with the reason, and nothing is recorded

```ts
const backend = createFakeChatBackend();
const ctx = await makeTestServer({ chatBackend: backend });
await writeFile(join(ctx.boxRoot, "_config/box.json"), JSON.stringify({ agentModel: "qwen/qwen3-coder", openrouterModels: [{ id: "qwen/qwen3-coder", label: "Qwen3 Coder" }] }));

const recorded: string[] = [];
ctx.eventBus.subscribe({
  listener: (e: BusEvent) => { if (e.event === "chat-user-message") recorded.push(String(e.data.message)); },
});

const { result: res } = await capturingErrors(() => ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "did you water the plants", messageId: "m1" },
}));
({ status: res.statusCode, refused: typeof res.body.error, recorded: recorded.length, runs: backend.runs.length })
=> { status: 409, refused: "string", recorded: 0, runs: 0 }
```

The reason names the missing setup, not a busy chat.

```ts continue
res.body.error
=> This run uses the OpenRouter model qwen/qwen3-coder, but no usable OpenRouter key is available for this box (No secret named "openrouter" exists on this machine. It can be declared (bbx secrets declare openrouter), but only the boxholder can supply its value.). Add one in Admin → Secrets and grant it to this box.
```

## Once the cause is fixed, the same message id is sent

The refusal kept no claim, so the retry is not answered as a duplicate.

```ts continue
await writeFile(join(ctx.boxRoot, "_config/box.json"), JSON.stringify({}));
const retry = await ctx.request({
  method: "POST",
  url: "/api/chat/send",
  payload: { session: "new", message: "did you water the plants", messageId: "m1" },
});
await awaitFakeRuns(backend, 1);
({ status: retry.statusCode, turn: typeof retry.body.turnId, deduplicated: retry.body.deduplicated ?? false, recorded: recorded.length })
=> { status: 200, turn: "string", deduplicated: false, recorded: 1 }
```

```ts cleanup
await ctx.cleanup();
```
