# Connector config mutations: calendar / drive / gmail

Three config-write mutations that persist a connector's JSON config and commit
it: `calendar.updateConfig`, `drive.updateConfig`, and `admin.updateGmailConfig`.
Each writes the file, commits exactly that path via `stageAndCommitPaths`, and
returns the saved shape. Gmail is an `ownerProcedure`; the others are public.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getLog } from "../../src/lib/git.js";
import { simpleGit } from "simple-git";

function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}

async function readJson(box, rel) {
  return JSON.parse(await box.read(rel));
}

async function code(p) {
  return p.then(() => "none", (e) => e.code);
}
```

## calendar.updateConfig writes the sync config and commits it

Only the provided keys are persisted (an omitted field stays absent), and the
commit is scoped to the calendar config file — an unrelated dirty file is left
uncommitted, proving the `stageAndCommitPaths` scoping the other config
mutations share.

```ts
const box = await makeTmpBox({ git: true });
// A decoy the mutation must NOT sweep into its commit.
await box.write("store/decoy.md", "unrelated\n");
const res = await caller(box.root).calendar.updateConfig({
  calendars: ["primary", "work@example.com"],
  syncDaysBack: 7,
});
JSON.stringify(res)
=> {"success":true}
```

```ts continue
const cfg = await readJson(box, "config/connectors/google-calendar.json");
JSON.stringify(cfg)
=> {"calendars":["primary","work@example.com"],"syncDaysBack":7}
```

```ts continue
(await getLog(box.root, 1))[0].subject
=> Update calendar sync config
```

```ts continue
// Commit scoped to just the config file; the decoy stayed uncommitted.
const files = (await simpleGit(box.root).raw(["show", "--name-only", "--relative", "--format=", "HEAD"])).trim();
files
=> config/connectors/google-calendar.json

// `status` porcelain paths are always repo-root-relative (repo root = package
// root), so the content-dir decoy shows as `content/store/decoy.md`.
JSON.stringify((await simpleGit(box.root).status()).not_added)
=> ["content/store/decoy.md"]
```

```ts cleanup
await box.cleanup();
```

## drive.updateConfig persists folder mounts, and empty input clears them

Passing `folders` stores them; passing nothing writes an empty config (no folder
mounts). A folder mount missing `localPath` is rejected by Zod.

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

const res = await c.drive.updateConfig({ folders: [{ driveFolderId: "abc", localPath: "sheets/x" }] });
JSON.stringify(res)
=> {"success":true}

JSON.stringify(await readJson(box, "config/connectors/google-drive.json"))
=> {"folders":[{"driveFolderId":"abc","localPath":"sheets/x"}]}

(await getLog(box.root, 1))[0].subject
=> Update Drive sync config
```

```ts continue
// No folders → empty config object.
await c.drive.updateConfig({});
JSON.stringify(await readJson(box, "config/connectors/google-drive.json"))
=> {}
```

```ts continue
// A malformed folder mount (missing localPath) is refused at input validation.
await code(c.drive.updateConfig({ folders: [{ driveFolderId: "x" }] }))
=> BAD_REQUEST
```

```ts cleanup
await box.cleanup();
```

## admin.updateGmailConfig trims and drops empties, committing the result

The query is trimmed and blank labels are filtered out. The action is persisted
alongside them — the form cannot save a filter without saying what happens to a
match, so the connector never infers `track`.

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

const res = await c.admin.updateGmailConfig({
  query: "  is:unread  ",
  labels: ["INBOX", "  ", "Work"],
  action: { type: "track" },
});
JSON.stringify(res)
=> {"query":"is:unread","labels":["INBOX","Work"],"action":{"type":"track"}}

JSON.stringify(await readJson(box, "config/connectors/gmail.json"))
=> {"query":"is:unread","labels":["INBOX","Work"],"action":{"type":"track"}}

(await getLog(box.root, 1))[0].subject
=> Update Gmail filter config
```

A procedure action routes matches without creating any card.

```ts continue
const routed = await c.admin.updateGmailConfig({
  query: "is:unread",
  labels: [],
  action: { type: "procedure", ref: "config/procedures/review.procedure.card" },
});
JSON.stringify(routed.action)
=> {"type":"procedure","ref":"config/procedures/review.procedure.card"}
```

When nothing is left to match, the action is dropped too: an action with no
query or labels beside it is a config error the connector would reject.

```ts continue
// All-blank input collapses to an empty config.
const empty = await c.admin.updateGmailConfig({
  query: "   ",
  labels: ["  "],
  action: { type: "track" },
});
JSON.stringify(empty)
=> {"query":"","labels":[],"action":null}

JSON.stringify(await readJson(box, "config/connectors/gmail.json"))
=> {}
```

```ts continue
// Re-saving the identical empty config commits nothing new.
const before = (await getLog(box.root, 1))[0].hash;
await c.admin.updateGmailConfig({ query: "", labels: [], action: { type: "track" } });
const after = (await getLog(box.root, 1))[0].hash;
before === after
=> true
```

```ts cleanup
await box.cleanup();
```
