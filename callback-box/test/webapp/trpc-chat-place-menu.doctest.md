# `chat.placeMenu`: the app bar's switcher, and only what it draws

The place pill's switch menu draws one row per landmark — symbol, label, and a
count of fresh chats — plus a warning when a landmark card doesn't parse. It
used to get that from `chat.byLandmark`, which builds the full picker payload:
every chat in the box, bucketed and **named**. Naming a chat can mean reading
its transcript, so the one query a page warms on every load was the most
expensive in the app, for data the menu threw away.

`chat.placeMenu` computes only what is drawn. The tests below pin the two things
that can silently rot once the two procedures are separate: the **row order**
(the menu's contract, duplicated from `byLandmark`) and the **synthetic root
row's count**. Both are invisible in a type check.

```ts setup
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../src/core/chat/session/transcript-paths.js";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Freshness is the transcript's mtime, so a fixture has to set it.
async function seedSession(box, args) {
  const { sessionId, contextDir, daysAgo } = args;
  const cwd = contextDir === "" ? box.root : box.path(contextDir);
  const logPath = getSessionLogPath(cwd, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  const entry = {
    type: "user",
    uuid: `u-${sessionId}`,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: `first message of ${sessionId}` }] },
  };
  await writeFile(logPath, JSON.stringify(entry) + "\n");
  const when = new Date(Date.now() - daysAgo * DAY_MS);
  await utimes(logPath, when, when);
  const binding = contextDir === "" ? "" : `context-dir: ${contextDir}\n`;
  await box.write(
    `store/chat/web/2026-07-28_${sessionId}.chat.card`,
    `---\nsession: ${sessionId}\n${binding}---\n\n`,
  );
}
```

## Rows carry a symbol, a label, and a fresh count — no sessions

A landmark's `freshCount` is every chat bound to it inside the 7-day window, not
a capped or visible subset: the menu renders the number, so it has to be the
true one.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("store/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n  symbol: \"🍳\"\n---\n\n");

await seedSession(box, { sessionId: "recipe01", contextDir: "store/recipes", daysAgo: 1 });
await seedSession(box, { sessionId: "recipe02", contextDir: "store/recipes", daysAgo: 2 });
await seedSession(box, { sessionId: "recipe03", contextDir: "store/recipes", daysAgo: 30 });

const menu = await caller(box.root).chat.placeMenu();
JSON.stringify(menu.landmarks)
=> [{"path":"store/recipes/Recipes.landmark.card","dir":"store/recipes","label":"Recipes","symbol":"🍳","symbolSrc":null,"freshCount":2}]
```

Nothing session-shaped rides along — that's the whole point of the split.

```ts continue
JSON.stringify(Object.keys(menu).toSorted())
=> ["landmarks","problems","rootFreshCount"]
```

```ts cleanup
await box.cleanup();
```

## `rootFreshCount` feeds the synthetic root row, and only when it's needed

The box root is always switchable, landmark card or not. With no root card the
client synthesizes a "Box root" row, and this is the count it shows.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("store/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n\n");
await seedSession(box, { sessionId: "rootone1", contextDir: "", daysAgo: 1 });
await seedSession(box, { sessionId: "roottwo2", contextDir: "", daysAgo: 2 });
await seedSession(box, { sessionId: "rootold3", contextDir: "", daysAgo: 30 });

(await caller(box.root).chat.placeMenu()).rootFreshCount
=> 2
```

Once a real root landmark exists it owns those chats, and the count drops to
zero — otherwise the client would render them twice.

```ts continue
await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n\n");

const withRoot = await caller(box.root).chat.placeMenu();
`${withRoot.rootFreshCount} / ${withRoot.landmarks.find((l) => l.dir === "").freshCount}`
=> 0 / 2
```

```ts cleanup
await box.cleanup();
```

## Ordering matches `chat.byLandmark`'s, including the stale-but-used case

The menu's row order is a duplicated contract now, so it gets its own test. A
landmark whose chats all fell out of the fresh window shows a zero count but is
NOT unused — it sorts by when it was last touched, ahead of landmarks nobody
has ever opened. Those sink to the bottom, root first so it stays reachable,
then alphabetical.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n\n");
await box.write("store/fresh/Fresh.landmark.card", "---\nnavigation:\n  label: Fresh\n---\n\n");
await box.write("store/stale/Stale.landmark.card", "---\nnavigation:\n  label: Stale\n---\n\n");
await box.write("store/never/Never.landmark.card", "---\nnavigation:\n  label: Never\n---\n\n");
await box.write("store/absent/Absent.landmark.card", "---\nnavigation:\n  label: Absent\n---\n\n");

await seedSession(box, { sessionId: "freshone", contextDir: "store/fresh", daysAgo: 1 });
await seedSession(box, { sessionId: "staleone", contextDir: "store/stale", daysAgo: 30 });

const menu = await caller(box.root).chat.placeMenu();
menu.landmarks.map((l) => `${l.label}:${l.freshCount}`).join(" > ")
=> Fresh:1 > Stale:0 > Home:0 > Absent:0 > Never:0
```

The same box through `chat.byLandmark` orders its rows identically — the
duplication is the risk, so the two are compared directly rather than trusted.

```ts continue
const full = await caller(box.root).chat.byLandmark();
full.landmarks.map((l) => l.label).join(" > ") === menu.landmarks.map((l) => l.label).join(" > ")
=> true
```

```ts cleanup
await box.cleanup();
```

## A landmark card that doesn't parse still reaches the menu

The menu shows a warning row from `problems`; without it a hand-edit that breaks
a card's frontmatter would silently remove the only route to whatever lives
there.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("store/recipes/Recipes.landmark.card", "---\nnavigation:\n  label: Recipes\n---\n\n");
await box.write("store/trips/Trips.landmark.card", "no frontmatter here at all\n");

const broken = await caller(box.root).chat.placeMenu();
`${broken.landmarks.map((l) => l.label).join(",")} | ${broken.problems.map((p) => p.path).join(",")}`
=> Recipes | store/trips/Trips.landmark.card
```

```ts cleanup
await box.cleanup();
```
