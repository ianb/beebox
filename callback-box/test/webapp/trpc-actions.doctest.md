# tRPC actions: answer / dismiss

`actions.answer` and `actions.dismiss` are the procedures the frontend uses to
resolve a question (the raw `/api/actions/answer` route was removed). Each
delegates to the shared command, then emits a bus event so live surfaces
refresh. A command failure surfaces as a `BAD_REQUEST` TRPCError.

```ts setup
import { actionsRouter } from "../../src/webapp/trpc/routers/actions.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// Minimal tRPC context — the actions procedures read only boxRoot + eventBus.
// The eventBus stub records what was emitted so we can assert on it.
function contextFor(box) {
  const events = [];
  const eventBus = {
    emit: (event, data) => { events.push({ event, data }); return 0; },
    emitTransient: () => {},
    readSince: () => [],
    subscribe: () => ({ unsubscribe: () => {} }),
    prune: () => 0,
    close: () => {},
  };
  const ctx = { boxRoot: box.root, boxSlug: "t", eventBus, services: {}, user: null, authed: true, isOwner: true };
  return { caller: actionsRouter.createCaller(ctx), events };
}

async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    return `THREW:${e.code}:${e.message}`;
  }
}

const SELECT = `---
status: pending
prompt: Pick one
input:
  type: select
  options:
    - {id: red, label: Red}
    - {id: blue, label: Blue}
directive: Use the picked color
---
`;
```

## answer resolves the card and emits `question-answered`

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Color.question.card", SELECT);
const { caller, events } = contextFor(box);

const res = await caller.answer({ questionPath: "box/questions/Color.question.card", answer: "Red" });
res.success
=> true

res.message
=> Question answered

(await box.read("box/questions/Color.question.card")).includes("selected: red")
=> true

events.map((e) => e.event).join(",")
=> question-answered
```

```ts cleanup
await box.cleanup();
```

## answer surfaces a command failure as BAD_REQUEST

Answering a card that doesn't exist fails in the command; the procedure turns it
into a `BAD_REQUEST`:

```ts
const box = await makeTmpBox({ git: true });
const { caller } = contextFor(box);

const out = await attempt(() => caller.answer({ questionPath: "box/questions/Nope.question.card", answer: "Red" }));
out.startsWith("THREW:BAD_REQUEST:")
=> true
```

```ts cleanup
await box.cleanup();
```

## dismiss flips the card and emits `question-dismissed`

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/questions/Color.question.card", SELECT);
const { caller, events } = contextFor(box);

const res = await caller.dismiss({ questionPath: "box/questions/Color.question.card" });
res.success
=> true

res.message
=> Question dismissed

(await box.read("box/questions/Color.question.card")).includes("status: dismissed")
=> true

events.map((e) => e.event).join(",")
=> question-dismissed
```

```ts cleanup
await box.cleanup();
```

## dismiss rejects a non-pending question as BAD_REQUEST

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "box/questions/Color.question.card",
  SELECT.replace("status: pending", "status: answered"),
);
const { caller } = contextFor(box);

const out = await attempt(() => caller.dismiss({ questionPath: "box/questions/Color.question.card" }));
out.startsWith("THREW:BAD_REQUEST:")
=> true
```

```ts cleanup
await box.cleanup();
```
