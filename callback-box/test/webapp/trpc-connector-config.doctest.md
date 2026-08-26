# Connector config mutations: calendar / gmail, and Drive's absent one

Two config-write mutations that persist a connector's JSON config and commit it:
`calendar.updateConfig` and `admin.updateGmailConfig`. Each writes the file,
commits exactly that path via `stageAndCommitPaths`, and returns the saved
shape. Gmail is an `ownerProcedure`; calendar is public.

Drive has no such mutation, on purpose — a Drive mount is a card, so there is no
config for a settings page to write. The Drive section here pins that.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { getLog } from "../../src/lib/git.js";
import { errorMessage } from "../../src/lib/error-guards.js";
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

## drive has a config reader and no config writer

A Drive mount is a `.gdoc.card` / `.gsheet.card` / `.gfolder.card` /
`.glink.card` — the card's existence is the configuration. `drive.config` still
reads the connector file, because a box set up before folder mounts were cards
carries a legacy `folders` array there until its next sync converts it; but
there is nothing to write, so `drive.updateConfig` does not exist.

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

await box.write(
  "config/connectors/google-drive.json",
  JSON.stringify({ folders: [{ driveFolderId: "abc", localPath: "sheets/x" }] }),
);
JSON.stringify(await c.drive.config())
=> {"folders":[{"driveFolderId":"abc","localPath":"sheets/x"}]}
```

A config file that exists but does not parse is an error, never an empty
config — reading it as "no folder mounts" would silently drop the mounts still
owed a conversion.

```ts continue
await box.write("config/connectors/google-drive.json", "{oops");
await code(c.drive.config())
=> INTERNAL_SERVER_ERROR
```

There is no mount-writing procedure on this router.

```ts continue
JSON.stringify(Object.keys(appRouter._def.procedures).filter((name) => name.startsWith("drive.")))
=> ["drive.config"]
```

```ts cleanup
await box.cleanup();
```

## admin.updateGmailConfig trims and drops empties, committing the result

The query is trimmed and blank labels are filtered out. The action is persisted
alongside them — the form cannot save a filter without saying what happens to a
match, so the connector never infers `track`.

`query` and `labels` are two spellings of one shorthand, so a non-empty query
wins and the labels are dropped rather than written into a file where they would
look effective while matching nothing.

```ts
const box = await makeTmpBox({ git: true });
const c = caller(box.root);

const res = await c.admin.updateGmailConfig({
  query: "  is:unread  ",
  labels: ["INBOX", "  ", "Work"],
  action: { type: "track" },
});
JSON.stringify(res)
=> {"query":"is:unread","labels":[],"action":{"type":"track"}}

JSON.stringify(await readJson(box, "config/connectors/gmail.json"))
=> {"query":"is:unread","action":{"type":"track"}}

(await getLog(box.root, 1))[0].subject
=> Update Gmail filter config
```

Labels alone are written as labels.

```ts continue
const byLabel = await c.admin.updateGmailConfig({
  query: "",
  labels: ["INBOX", "  ", "Work"],
  action: { type: "track" },
});
JSON.stringify(byLabel.labels)
=> ["INBOX","Work"]

JSON.stringify(await readJson(box, "config/connectors/gmail.json"))
=> {"labels":["INBOX","Work"],"action":{"type":"track"}}
```

A filter with something to match but no action is refused, so the form cannot
save a config the connector would then reject.

```ts continue
let refused = "";
try {
  await c.admin.updateGmailConfig({ query: "is:unread", labels: [] });
} catch (error) {
  refused = errorMessage(error);
};
refused.includes("needs an action")
=> true
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
const empty = await c.admin.updateGmailConfig({ query: "   ", labels: ["  "] });
JSON.stringify(empty)
=> {"query":"","labels":[],"action":null}

JSON.stringify(await readJson(box, "config/connectors/gmail.json"))
=> {}
```

```ts continue
// Re-saving the identical empty config commits nothing new.
const before = (await getLog(box.root, 1))[0].hash;
await c.admin.updateGmailConfig({ query: "", labels: [] });
const after = (await getLog(box.root, 1))[0].hash;
before === after
=> true
```

```ts cleanup
await box.cleanup();
```
