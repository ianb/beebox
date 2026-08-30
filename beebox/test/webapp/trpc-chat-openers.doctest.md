# `chat.openers`: the suggestions an empty chat offers

A chat is bound to a landmark directory, and the openers it shows on its empty
state are the `openers:` listed in *that* directory's `briefing.briefing.card`
(the root briefing for a root-bound chat). Openers are briefing content the box
agent maintains, so "no openers" is the ordinary answer: a box in regular use
has had them removed, and the chat falls back to its plain empty-state line.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}

const STOCK = "---\ntype: briefing\nopeners:\n  - Let me tell you what this box is for.\n  - What can you do?\n---\n{% purpose %}\nWhat this box is for.\n{% /purpose %}\n";
```

## A fresh box's root briefing offers the two stock openers

```ts
const box = await makeTmpBox();
await box.write("briefing.briefing.card", STOCK);

JSON.stringify(await caller(box.root).chat.openers({}))
=> {"openers":["Let me tell you what this box is for.","What can you do?"]}
```

## Lookup is per directory: a landmark chat gets that directory's briefing

An opener list is scoped to the briefing beside the chat, not inherited from the
root — a recipes chat suggests recipe things or nothing at all.

```ts
const box = await makeTmpBox();
await box.write("briefing.briefing.card", STOCK);
await box.write(
  "recipes/briefing.briefing.card",
  "---\ntype: briefing\nopeners:\n  - What can I cook tonight?\n---\n",
);

JSON.stringify(await caller(box.root).chat.openers({ contextDir: "recipes" }))
=> {"openers":["What can I cook tonight?"]}
```

## A directory with no briefing of its own inherits the root's openers

Most landmark directories never grow a briefing; a chat bound to one falls back
to the root briefing, the same way it inherits the root briefing's context.

```ts
const box = await makeTmpBox();
await box.write("briefing.briefing.card", STOCK);

JSON.stringify(await caller(box.root).chat.openers({ contextDir: "recipes" }))
=> {"openers":["Let me tell you what this box is for.","What can you do?"]}
```

## A directory briefing that lists no openers offers none — no fallback

A briefing that exists and says nothing about openers is an answer, not a gap:
this is how a directory turns its openers off without the root's leaking in.

```ts
const box = await makeTmpBox();
await box.write("briefing.briefing.card", STOCK);
await box.write("recipes/briefing.briefing.card", "---\ntype: briefing\n---\n");

JSON.stringify(await caller(box.root).chat.openers({ contextDir: "recipes" }))
=> {"openers":[]}
```

## An established box — briefing with no `openers:` — offers none

This is the normal end state, not a failure: the agent removes the openers once
the box is in regular use.

```ts
const box = await makeTmpBox();
await box.write("briefing.briefing.card", "---\ntype: briefing\n---\n{% purpose %}\nRun the household.\n{% /purpose %}\n");

JSON.stringify(await caller(box.root).chat.openers({}))
=> {"openers":[]}
```

## A box with no briefing anywhere offers none

Nothing to fall back to — the chat keeps its plain empty-state line.

```ts
const box = await makeTmpBox();

JSON.stringify(await caller(box.root).chat.openers({ contextDir: "recipes" }))
=> {"openers":[]}
```

## Each opener is trimmed before it reaches the button

```ts
const box = await makeTmpBox();
await box.write(
  "briefing.briefing.card",
  "---\ntype: briefing\nopeners:\n  - '  What can you do?  '\n---\n",
);

JSON.stringify(await caller(box.root).chat.openers({}))
=> {"openers":["What can you do?"]}
```

## A briefing that fails validation offers none, and doesn't fall back

A blank opener is a card validation error (see
`test/schemas/briefing-compile.doctest.md`). A broken card shouldn't blank the
chat — but it shouldn't quietly promote the root's openers into that directory
either, which would hide the breakage behind plausible-looking buttons.

```ts
const box = await makeTmpBox();
await box.write("briefing.briefing.card", STOCK);
await box.write(
  "recipes/briefing.briefing.card",
  "---\ntype: briefing\nopeners:\n  - ''\n---\n",
);

JSON.stringify(await caller(box.root).chat.openers({ contextDir: "recipes" }))
=> {"openers":[]}
```

## A `contextDir` that escapes the box is rejected

The directory comes from the client and is joined onto the box root, so `..`
never gets to resolve.

```ts
const box = await makeTmpBox();
const outcome = await caller(box.root).chat.openers({ contextDir: "../../etc" }).then(
  () => "accepted",
  (e) => (String(e.message).includes("box-relative") ? "rejected" : e.message),
);
outcome
=> rejected
```
