# Quick chat requests and retry receipts

These tRPC procedures use a synthetic box and injected Jev fake. They prepare
routing without contacting a provider or running an agent.

```ts setup
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { setChatRuntime, clearChatRuntime } from "../../src/webapp/chat-runtime.js";
import { quickChatRouter } from "../../src/webapp/trpc/routers/quick-chat.js";
import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { createFakeJev, JevError } from "../../src/services/jev.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../src/core/chat/session/transcript-paths.js";
function caller(boxRoot, jev, authed) {
  return quickChatRouter.createCaller({ boxRoot, boxSlug: "test", authed: authed ?? true, services: { jev },
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} } });
}
// Only the registry reserve boundary is scripted: no subprocess or send path.
function reservationRuntime(boxRoot, results) {
  const calls = [];
  setChatRuntime(boxRoot, { registry: { reserve: async (input) => {
    calls.push(input);
    const kind = results[calls.length - 1];
    if (!kind) throw new Error("Unexpected reservation call");
    return kind === "reserved" ? { kind, sessionId: input.sessionId } : { kind };
  } } });
  return calls;
}
async function failure(run) {
  try { await run(); return "unexpected success"; }
  catch (error) { return `${error.code}: ${error.message}`; }
}
```

Missing credentials produce an actionable failure before sending.

```ts
const empty = await makeTmpBox();
await failure(() => caller(empty.root).prepare({ id: randomUUID(), message: "Please route this" }))
=> PRECONDITION_FAILED: Quick chat needs an OpenRouter key granted to this box. Your message has not been sent.

await failure(() => caller(empty.root, undefined, false).prepare({ id: randomUUID(), message: "Unauthorized capture" }))
=> UNAUTHORIZED: Not authenticated

await failure(() => caller(empty.root, undefined, false).receipt({ id: randomUUID(), receipt: {} }))
=> UNAUTHORIZED: Not authenticated
```

```ts cleanup
await empty.cleanup();
```

A resumable chat is eligible alongside a new general chat. Concurrent retries
reuse one persisted judgment and immediately prepare the existing destination.

```ts
const box = await makeTmpBox();
const oldProjectsDir = process.env["BBX_CLAUDE_PROJECTS_DIR"];
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
const sessionId = randomUUID();
const log = getSessionLogPath(box.root, sessionId);
await mkdir(dirname(log), { recursive: true });
await writeFile(log, JSON.stringify({ type: "user", uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "Plan the garden" }] } }) + "\n");
await box.write(`_content/chat/web/2026-09-21_${sessionId}.chat.card`, `---\nsession: ${sessionId}\n---\n\n`);
const fake = createFakeJev({ result: { model: "synthetic-jev", probabilities: { c0: 0.6, c1: 0.4 }, confidence: 0.4 } });
const api = caller(box.root, fake);
const request = { id: randomUUID(), message: "Which one did we agree on?" };
const [first, retry] = await Promise.all([api.prepare(request), api.prepare(request)]);
JSON.stringify([first.selected.target.kind, first.delivery?.session === sessionId, first.delivery?.exactSession, first.receipt ?? null, first.id === retry.id, fake.calls.length])
=> ["existing-session",true,true,null,true,1]

(await failure(() => api.receipt({ id: first.id, receipt: { sessionId: randomUUID() } }))).split(":")[0]
=> BAD_REQUEST

await failure(() => api.prepare({ ...request, message: "Changed text" }))
=> CONFLICT: This send already has different text. Start another message.
```

An invalid rubric now makes fresh discovery fail. Correction still succeeds
because it reuses the original catalog and judgment, selecting its existing chat.

```ts continue
await box.write("_config/chat-routing.yaml", "destinations: [{target: /missing.chat.card, when: obsolete}]\n");
const correctionRequest = { id: randomUUID(), message: request.message, sourceId: first.id, candidateId: "c0" };
const correction = await api.prepare(correctionRequest);
JSON.stringify([correction.selected.target.kind, correction.delivery?.session === sessionId, correction.delivery?.exactSession, correction.sourceId === first.id, fake.calls.length])
=> ["existing-session",true,true,true,1]

(await failure(() => api.prepare({ ...correctionRequest, candidateId: "c1" }))).split(":")[0]
=> CONFLICT

JSON.stringify(correction.candidates) === JSON.stringify(first.candidates)
=> true

await failure(() => api.prepare({ id: randomUUID(), message: "Different text", sourceId: first.id, candidateId: "c0" }))
=> BAD_REQUEST: A correction must resend the original text

await failure(() => api.prepare({ id: randomUUID(), message: request.message, sourceId: first.id, candidateId: "missing" }))
=> BAD_REQUEST: Choose a destination from the original routing result
```

A receipt survives a new caller and incremental receipt updates. Unknown source
and receipt IDs are rejected; arbitrary path strings cannot become record IDs.

```ts continue
(await failure(() => api.receipt({ id: correction.id, receipt: { sessionId: randomUUID() } }))).split(":")[0]
=> BAD_REQUEST

await api.receipt({ id: correction.id, receipt: { sessionId, turnId: "turn-1", queued: true } });
await api.receipt({ id: correction.id, receipt: { queued: false } });
const restored = await caller(box.root, fake).prepare(correctionRequest);
JSON.stringify([restored.receipt?.sessionId === sessionId, restored.receipt?.turnId, restored.receipt?.queued, fake.calls.length])
=> [true,"turn-1",false,1]

await failure(() => api.prepare({ id: randomUUID(), message: request.message, sourceId: randomUUID(), candidateId: "c0" }))
=> NOT_FOUND: Original routing result is unavailable

await failure(() => api.receipt({ id: randomUUID(), receipt: { sessionId } }))
=> NOT_FOUND: Routing result is unavailable

await failure(() => api.prepare({ id: "../escape", message: request.message }))
=> BAD_REQUEST: «*»
```

```ts cleanup
if (oldProjectsDir === undefined) delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
else process.env["BBX_CLAUDE_PROJECTS_DIR"] = oldProjectsDir;
await box.cleanup();
```

## A reserved destination remains stable after its session starts

The registry first reserves the selected landmark chat. Once the session exists,
its ID is taken. Retrying the same capture keeps that original ID and does not
ask Jev again. A deleted landmark blocks another undelivered retry.

```ts
const landmarkBox = await makeTmpBox();
const landmarkPath = "_content/Garden/Garden.landmark.card";
await landmarkBox.write(landmarkPath, "---\nnavigation:\n  label: Garden\n---\n");
const reservations = reservationRuntime(landmarkBox.root, ["reserved", "taken"]);
const newFake = createFakeJev({ result: { model: "synthetic-jev", probabilities: { c0: 0.9, c1: 0.1 }, confidence: 0.9 } });
const newApi = caller(landmarkBox.root, newFake);
const newRequest = { id: randomUUID(), message: "Start planning the garden" };
const reserved = await newApi.prepare(newRequest);
const taken = await newApi.prepare(newRequest);
JSON.stringify([reserved.delivery?.session === taken.delivery?.session, reserved.delivery?.session !== "new", taken.delivery?.exactSession, taken.delivery?.contextDir, newFake.calls.length, reservations.length])
=> [true,true,true,"_content/Garden",1,2]

JSON.stringify([reservations[0]?.sessionId === reservations[1]?.sessionId, reservations[0]?.requestedEngine, reservations[0]?.contextDir])
=> [true,"claude","_content/Garden"]

await rm(landmarkBox.path(landmarkPath));
await failure(() => newApi.prepare(newRequest))
=> CONFLICT: The selected landmark is no longer available. Choose another destination.

JSON.stringify([newFake.calls.length, reservations.length])
=> [1,2]
```

```ts cleanup
clearChatRuntime(landmarkBox.root);
await landmarkBox.cleanup();
```

## Engines without reservation retain their new-session delivery on retry

Codex can require the ordinary new-session path. The first unsupported result
is persisted, so retries do not repeatedly reserve or ask Jev. A delivered
receipt records the actual engine-assigned session ID for later reopening.

```ts
const codexBox = await makeTmpBox();
await codexBox.write("_config/box.json", JSON.stringify({ agentEngine: "codex" }));
const unsupportedCalls = reservationRuntime(codexBox.root, ["unsupported"]);
const codexFake = createFakeJev({ result: { model: "synthetic-jev", probabilities: { c0: 1 }, confidence: 0.9 } });
const codexApi = caller(codexBox.root, codexFake);
const codexRequest = { id: randomUUID(), message: "Start a new topic" };
const unsupported = await codexApi.prepare(codexRequest);
const unsupportedRetry = await codexApi.prepare(codexRequest);
JSON.stringify([unsupported.delivery?.session, unsupportedRetry.delivery?.session, unsupportedRetry.delivery?.exactSession, unsupportedRetry.delivery?.engine, unsupportedCalls[0]?.requestedEngine, unsupportedCalls.length, codexFake.calls.length])
=> ["new","new",false,"codex","codex",1,1]

const assignedSession = randomUUID();
await codexApi.receipt({ id: codexRequest.id, receipt: { sessionId: assignedSession, turnId: "codex-turn" } });
const codexRestored = await codexApi.prepare(codexRequest);
JSON.stringify([codexRestored.receipt?.sessionId === assignedSession, unsupportedCalls.length, codexFake.calls.length])
=> [true,1,1]
```

```ts cleanup
clearChatRuntime(codexBox.root);
await codexBox.cleanup();
```

## Actionable routing failures survive the HTTP error formatter

The actual Fastify tRPC adapter serializes typed routing failures as expected
client errors, preserving recovery guidance rather than replacing it with the
internal-error message. The error body exposes no stack or absolute box path.

```ts
const httpBox = await makeTmpBox();
const httpFake = createFakeJev({ error: new JevError("HTTP 503", "request") });
const httpApp = Fastify();
await httpApp.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: quickChatRouter,
    createContext: () => ({ boxRoot: httpBox.root, boxSlug: "test", authed: true, services: { jev: httpFake },
      eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} } }),
  },
});
const providerFailure = await httpApp.inject({ method: "POST", url: "/trpc/prepare", payload: { id: randomUUID(), message: "Keep this message for retry" } });
const providerError = providerFailure.json().error;
JSON.stringify([providerFailure.statusCode, providerError.data.code, providerError.message])
=> [502,"BAD_GATEWAY","Jev request error: HTTP 503. Your message has not been sent. Retry, or copy the text into a chat."]

JSON.stringify([providerFailure.payload.includes(httpBox.root), providerFailure.payload.includes('"stack"'), httpFake.calls.length])
=> [false,false,1]

await httpBox.write("_config/chat-routing.yaml", "destinations: not-a-list\n");
const rubricFailure = await httpApp.inject({ method: "POST", url: "/trpc/prepare", payload: { id: randomUUID(), message: "Preserve this one too" } });
const rubricError = rubricFailure.json().error;
JSON.stringify([rubricFailure.statusCode, rubricError.data.code, rubricError.message, httpFake.calls.length])
=> [412,"PRECONDITION_FAILED","Chat routing rubric is invalid. Check _config/chat-routing.yaml.",1]

await httpBox.write("_config/chat-routing.yaml", "destinations: [\n");
const yamlFailure = await httpApp.inject({ method: "POST", url: "/trpc/prepare", payload: { id: randomUUID(), message: "No destination yet" } });
JSON.stringify([yamlFailure.statusCode, yamlFailure.json().error.data.code, httpFake.calls.length])
=> [412,"PRECONDITION_FAILED",1]
```

```ts cleanup
await httpApp.close();
await httpBox.cleanup();
```
