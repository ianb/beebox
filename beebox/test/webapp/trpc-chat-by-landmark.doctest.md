# `chat.byLandmark`: every chat lands somewhere, and broken landmarks say so

The picker groups chats by the landmark their session is bound to. Two things
used to fall off that grouping silently: a chat bound to a directory with no
landmark card (the box root before anyone made a root landmark, or a dir whose
landmark was deleted) was dropped entirely, because the response mapped over
landmark cards only; and a landmark card whose frontmatter didn't parse
disappeared along with everything grouped under it.

Now the landmark-less chats come back in a trailing `unassigned` bucket, and the
unparseable cards come back in `problems`.

Each bucket also carries `freshCount` and `latestActivity`. Those aren't
derivable from the rendered lists: a non-root landmark shows only its latest
fresh chat inline and folds the rest into `olderSessions`, so counting
`sessions` undercounts the bucket. The capping itself is unchanged — the picker
depends on it.

```ts setup
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../src/core/chat/session/transcript-paths.js";
import { localOrigin } from "../../src/core/chat/session/origin.js";

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

// Freshness is the transcript's mtime, so a fixture has to set it: `daysAgo`
// puts a session inside or outside the 7-day fresh window on purpose.
async function seedSession(box, args) {
  const { sessionId, contextDir, firstMessage, daysAgo } = args;
  const cwd = contextDir === "" ? box.root : box.path(contextDir);
  const logPath = getSessionLogPath(cwd, sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  const entry = {
    type: "user",
    uuid: `u-${sessionId}`,
    timestamp: "2026-07-28T03:00:00Z",
    message: { role: "user", content: [{ type: "text", text: firstMessage }] },
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

## Chats with no landmark land in `unassigned`, carrying where they live

The box has one landmark (`store/recipes`) and no root landmark, so both the
root chat and the chat bound to a landmark-less directory are unassigned. Each
unassigned row says which directory it belongs to — the bucket spans
directories, so the binding can't live on the bucket.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("store/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n  symbol: \"🍳\"\n---\n\n");

await seedSession(box, { sessionId: "inrecipe1", contextDir: "store/recipes", firstMessage: "what can I make with lentils", daysAgo: 1 });
await seedSession(box, { sessionId: "rootchat1", contextDir: "", firstMessage: "how's my week looking", daysAgo: 2 });
await seedSession(box, { sessionId: "orphaned1", contextDir: "store/orphan", firstMessage: "leftover thread", daysAgo: 3 });

const { landmarks, unassigned } = await caller(box.root).chat.byLandmark();
print(`landmarks: ${landmarks.map((l) => `${l.label}=${l.sessions.map((s) => s.sessionId).join(",")}`).join(" | ")}`);
print(`unassigned: ${unassigned.sessions.map((s) => `${s.sessionId} [${s.contextDir}]`).join(" | ")}`);
=>
landmarks: Recipes=inrecipe1
unassigned: rootchat1 [] | orphaned1 [store/orphan]
```

A root landmark card takes the root chats back — `unassigned` is what's left
over, not a second home for the root.

```ts continue
await box.write("Box.landmark.card", "---\nnavigation:\n  label: Home\n---\n\n");

const withRoot = await caller(box.root).chat.byLandmark();
print(`root tile: ${withRoot.landmarks.find((l) => l.dir === "").sessions.map((s) => s.sessionId).join(",")}`);
print(`unassigned: ${withRoot.unassigned.sessions.map((s) => `${s.sessionId} [${s.contextDir}]`).join(" | ")}`);
=>
root tile: rootchat1
unassigned: orphaned1 [store/orphan]
```

```ts cleanup
await box.cleanup();
```

## `freshCount` and `latestActivity` describe the bucket, not the visible rows

Three fresh chats under one non-root landmark still render as one inline row
plus two in `olderSessions` (unchanged), and a fourth chat outside the fresh
window joins them there. `freshCount` says three anyway, and `latestActivity` is
the newest session's mtime whether or not it's fresh.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("store/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n---\n\n");

await seedSession(box, { sessionId: "fresh001", contextDir: "store/recipes", firstMessage: "newest", daysAgo: 1 });
await seedSession(box, { sessionId: "fresh002", contextDir: "store/recipes", firstMessage: "middle", daysAgo: 2 });
await seedSession(box, { sessionId: "fresh003", contextDir: "store/recipes", firstMessage: "oldest fresh", daysAgo: 3 });
await seedSession(box, { sessionId: "stale001", contextDir: "store/recipes", firstMessage: "long ago", daysAgo: 30 });

const recipes = (await caller(box.root).chat.byLandmark()).landmarks.find((l) => l.dir === "store/recipes");
print(`visible: ${recipes.sessions.map((s) => s.sessionId).join(",")}`);
print(`older: ${recipes.olderSessions.map((s) => s.sessionId).join(",")}`);
print(`freshCount: ${recipes.freshCount}`);
print(`latest is the newest session: ${recipes.latestActivity === recipes.sessions[0].lastActivity}`);
=>
visible: fresh001
older: fresh002,fresh003,stale001
freshCount: 3
latest is the newest session: true
```

An empty bucket reports zero and null rather than inventing an activity time.

```ts continue
await box.write("store/trips/Trips.landmark.card",
  "---\nnavigation:\n  label: Trips\n---\n\n");

const trips = (await caller(box.root).chat.byLandmark()).landmarks.find((l) => l.dir === "store/trips");
`${trips.freshCount} / ${trips.latestActivity}`
=> 0 / null
```

```ts cleanup
await box.cleanup();
```

## Ordering follows `latestActivity`, not just the visible rows

A landmark whose only chats fell out of the fresh window renders no inline
rows, but it isn't a landmark nobody has used — it sorts by when it was last
used, ahead of landmarks with no chats at all. (Sorting on the visible rows
sank it among the never-used ones, which is what the Landmarks page shows.)

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("store/fresh/Fresh.landmark.card", "---\nnavigation:\n  label: Fresh\n---\n\n");
await box.write("store/stale/Stale.landmark.card", "---\nnavigation:\n  label: Stale\n---\n\n");
await box.write("store/never/Never.landmark.card", "---\nnavigation:\n  label: Never\n---\n\n");

await seedSession(box, { sessionId: "freshone", contextDir: "store/fresh", firstMessage: "today", daysAgo: 1 });
await seedSession(box, { sessionId: "staleone", contextDir: "store/stale", firstMessage: "a while back", daysAgo: 30 });

const ordered = await caller(box.root).chat.byLandmark();
ordered.landmarks.map((l) => l.label).join(" > ")
=> Fresh > Stale > Never
```

```ts cleanup
await box.cleanup();
```

## A landmark card that doesn't parse is reported, not swallowed

The good landmarks still load. The broken one rides along in `problems` so the
UI can show a warning row — once a landmark is the only way to reach its chats,
a hand-edit that breaks the frontmatter must not make them vanish silently.

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await box.write("store/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n---\n\n");
await box.write("store/trips/Trips.landmark.card", "no frontmatter here at all\n");

await seedSession(box, { sessionId: "intrips01", contextDir: "store/trips", firstMessage: "where to in august", daysAgo: 1 });

const broken = await caller(box.root).chat.byLandmark();
print(`landmarks: ${broken.landmarks.map((l) => l.label).join(",")}`);
print(`problems: ${broken.problems.map((p) => p.path).join(",")}`);
print(`its chats: ${broken.unassigned.sessions.map((s) => `${s.sessionId} [${s.contextDir}]`).join(" | ")}`);
=>
landmarks: Recipes
problems: store/trips/Trips.landmark.card
its chats: intrips01 [store/trips]
```

```ts cleanup
await box.cleanup();
```

## Dead chats ride in their own bucket, under the landmark they were bound to

A chat whose transcript is gone can't be resumed, so it can't be a `sessions`
row — every one of those links into `/chat?session=`. It comes back in `dead`
instead, carrying the husk path the UI links to and the state that names its
section ("Expired", "On prod", "Unavailable").

```ts
const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");
const here = await localOrigin();

await box.write("store/recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n---\n\n");
await seedSession(box, { sessionId: "livechat1", contextDir: "store/recipes", firstMessage: "what's for dinner", daysAgo: 1 });
await box.write("store/chat/web/2026-07-20_gone.chat.card",
  `---\nsession: goneaway1\ntitle: Sourdough attempt\ncontext-dir: store/recipes\norigin: ${here.id}\norigin-name: ${here.name}\n---\n\n`);
await box.write("store/chat/web/2026-07-19_prod.chat.card",
  "---\nsession: elsewhere1\ncontext-dir: store/recipes\norigin: prod-machine-id\norigin-name: prod\n---\n\n");

const picked = await caller(box.root).chat.byLandmark();
const recipes = picked.landmarks.find((l) => l.label === "Recipes");
print(`live: ${recipes.sessions.map((s) => s.sessionId).join(",")}`);
print(`dead: ${recipes.dead.map((d) => `${d.label} [${d.transcript.state}] -> ${d.huskPath}`).join(" | ")}`);
=>
live: livechat1
dead: Sourdough attempt [expired] -> store/chat/web/2026-07-20_gone.chat.card | elsewher [elsewhere] -> store/chat/web/2026-07-19_prod.chat.card
```

```ts cleanup
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```
