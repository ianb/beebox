# `todos.setStatus` — tick one todo from the web UI

The checkbox on a rendered todo calls `todos.setStatus`
(`docs/plans/todos-ui.md`, Track 3). It addresses the todo by card path and
locator, and also sends the text and status the reader saw. Under the card
lock the server re-extracts the card and writes only if the todo at that
locator still reads the same and still has that status; otherwise it refuses
with `CONFLICT` and writes nothing. The write changes only the `status`
attribute, commits with webapp trailers, and announces a `file-change`.

```ts setup
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const events = [];

function caller(boxRoot, options) {
  return appRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus: {
      emit: () => 0,
      emitTransient: (name, data) => { events.push(`${name} ${data.path}`); },
      readSince: () => [],
      subscribe: () => ({ unsubscribe: () => {} }),
      prune: () => 0,
      close: () => {},
    },
    services: {},
    user: null,
    authed: true,
    isOwner: options?.isOwner !== false,
  });
}

function lastCommit(root) {
  return execFileSync("git", ["log", "-1", "--format=%s%n%(trailers:only,unfold)"], { cwd: root, encoding: "utf8" }).trim();
}

function commitCount(root) {
  return execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

/** The error code a refused call rejects with, or "accepted". */
function outcome(promise) {
  return promise.then(() => "accepted", (error) => `${error.code}: ${error.message}`);
}

const cardPath = "_content/Porch.memo.card";
const original = [
  "---",
  "status: new",
  "created: 2026-07-01T10:00:00Z",
  "title: Porch",
  "todos:",
  "  - text: Call the inspector",
  "    due: 2026-10-01",
  "---",
  "Intro line.",
  "",
  "{% todo due=\"2026-09-15\" %}Order lumber{% /todo %} and {% todo %}book the [roofer](https://example.com){% /todo %}",
  "",
  "{% todo status=\"parked\" %}Paint the rail{% /todo %}",
  "",
].join("\n");

const box = await makeTmpBox({ git: true });
await box.write(cardPath, original);
box.commitAll("seed");
```

## Tick, then untick

Ticking the first todo on line 11 sets `status="done"` on exactly that tag,
keeps its other attributes, and commits. Nothing else in the file moves.

```ts
events.length = 0;
const done = await caller(box.root).todos.setStatus({
  path: cardPath,
  locator: { kind: "body", line: 11 },
  text: "Order lumber",
  expectedStatus: "open",
  status: "done",
});
JSON.stringify([done.status, typeof done.commit, done.commitWarning])
=> ["done","string",null]

(await box.read(cardPath)).split("\n")[10]
=> {% todo status="done" due="2026-09-15" %}Order lumber{% /todo %} and {% todo %}book the [roofer](https://example.com){% /todo %}

lastCommit(box.root)
=> Mark todo done: Order lumber
Source: webapp
Endpoint: todos.setStatus

JSON.stringify(events)
=> ["file-change _content/Porch.memo.card"]
```

Reopening removes the attribute (absence means open), and the file is back
to what it was.

```ts continue
const reopened = await caller(box.root).todos.setStatus({
  path: cardPath,
  locator: { kind: "body", line: 11 },
  text: "Order lumber",
  expectedStatus: "done",
  status: "open",
});
JSON.stringify([reopened.status, (await box.read(cardPath)) === original, lastCommit(box.root).split("\n")[0]])
=> ["open",true,"Reopen todo: Order lumber"]
```

## The second todo on a line

The locator's `nth` picks the second tag on line 11. Its text is what the
collector flattens: the link's label, not its target.

```ts continue
await caller(box.root).todos.setStatus({
  path: cardPath,
  locator: { kind: "body", line: 11, nth: 2 },
  text: "book the roofer",
  expectedStatus: "open",
  status: "done",
});
(await box.read(cardPath)).split("\n")[10]
=> {% todo due="2026-09-15" %}Order lumber{% /todo %} and {% todo status="done" %}book the [roofer](https://example.com){% /todo %}
```

## A frontmatter todo

Frontmatter todos go through format-preserving YAML: only the entry's
`status` changes.

```ts continue
await caller(box.root).todos.setStatus({
  path: cardPath,
  locator: { kind: "frontmatter", index: 0 },
  text: "Call the inspector",
  expectedStatus: "open",
  status: "done",
});
(await box.read(cardPath)).split("\n").slice(4, 8).join("\n")
=> todos:
  - text: Call the inspector
    due: 2026-10-01
    status: done
```

That added a line to the frontmatter, so every body todo is now one line
further down: "Order lumber" is at line 12. A reader still looking at the
old render would send line 11, which the checks below refuse.

## Refusals write nothing

Each refusal below leaves the file and the history as they were.

```ts continue
const before = await box.read(cardPath);
const commitsBefore = commitCount(box.root);
events.length = 0;
```

The text the reader saw is not the text at that line (a line was inserted
above it, or it was reworded):

```ts continue
await outcome(caller(box.root).todos.setStatus({
  path: cardPath, locator: { kind: "body", line: 12 }, text: "Order timber", expectedStatus: "open", status: "done",
}))
=> CONFLICT: This card changed since it was shown — it has been reloaded
```

The text matches, but its status is no longer the one the reader saw:

```ts continue
await outcome(caller(box.root).todos.setStatus({
  path: cardPath, locator: { kind: "body", line: 12, nth: 2 }, text: "book the roofer", expectedStatus: "open", status: "done",
}))
=> CONFLICT: This card changed since it was shown — it has been reloaded
```

A parked todo is always refused: the checkbox cannot express `parked`.

```ts continue
await outcome(caller(box.root).todos.setStatus({
  path: cardPath, locator: { kind: "body", line: 14 }, text: "Paint the rail", expectedStatus: "open", status: "done",
}))
=> CONFLICT: This card changed since it was shown — it has been reloaded
```

No todo at that address any more — the stale line from before the
frontmatter grew:

```ts continue
await outcome(caller(box.root).todos.setStatus({
  path: cardPath, locator: { kind: "body", line: 11 }, text: "Order lumber", expectedStatus: "open", status: "done",
}))
=> CONFLICT: This card changed since it was shown — it has been reloaded
```

A card whose frontmatter no longer parses has no todos to address:

```ts continue
const brokenPath = "_content/Broken.memo.card";
await box.write(brokenPath, "---\nstatus: [not, a, status]\ntodos:\n  - text: Fix it\n---\n{% todo %}Fix it{% /todo %}\n");
box.commitAll("broken");
const brokenBefore = await box.read(brokenPath);
await outcome(caller(box.root).todos.setStatus({
  path: brokenPath, locator: { kind: "body", line: 6 }, text: "Fix it", expectedStatus: "open", status: "done",
}))
=> CONFLICT: This card changed since it was shown — it has been reloaded

(await box.read(brokenPath)) === brokenBefore
=> true
```

Only the box owner may write:

```ts continue
await outcome(caller(box.root, { isOwner: false }).todos.setStatus({
  path: cardPath, locator: { kind: "body", line: 12 }, text: "Order lumber", expectedStatus: "open", status: "done",
}))
=> FORBIDDEN: Owner access required
```

A path outside the box is refused before anything is read:

```ts continue
(await outcome(caller(box.root).todos.setStatus({
  path: "_content/../package.json", locator: { kind: "body", line: 1 }, text: "x", expectedStatus: "open", status: "done",
}))).split(":")[0]
=> BAD_REQUEST
```

After all of that, nothing changed and nothing was announced (the broken
card's seed commit is the only new one):

```ts continue
JSON.stringify([(await box.read(cardPath)) === before, Number(commitCount(box.root)) - Number(commitsBefore), events])
=> [true,1,[]]
```

## A failed commit is a warning, not a lost write

The file is written first; if the commit then fails, the write stands and
the result says the commit did not happen.

```ts continue
const hook = path.join(box.root, ".git", "hooks", "pre-commit");
await fs.writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const originalError = console.error;
console.error = () => {};
const warned = await caller(box.root).todos.setStatus({
  path: cardPath, locator: { kind: "body", line: 12 }, text: "Order lumber", expectedStatus: "open", status: "done",
});
console.error = originalError;
await fs.rm(hook);
JSON.stringify([warned.commit, warned.commitWarning, (await box.read(cardPath)).split("\n")[11].startsWith('{% todo status="done"')])
=> [null,"Saved, but the Git commit failed.",true]
```

```ts cleanup
await box.cleanup();
```
