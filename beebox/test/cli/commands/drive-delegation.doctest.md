# `bbx drive` from a shell with no credential

The 2026-09-14 incident in one sentence: a box agent wrote a correct mount card
and then could not verify or activate it, because every `bbx drive` verb built
a Drive service in its own process and that process is deliberately not allowed
to hold the Google token.

What these tests pin is the fix, end to end over a real socket: under any spawn
profile but `tooling`, a credentialed Drive verb asks the box's own server —
with the agent bearer the auth wall already accepts — and gets back the same
typed result the settings page gets. The auth wall is ON here (`openAccess:
false`), so the bearer is doing real work.

```ts setup
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTestServer, TEST_SLUG } from "../../helpers/doctest-server.js";
import { getOrCreateAgentToken } from "../../../src/core/agent/token.js";
import { createFakeGoogleDrive, type DriveFile, type FakeSpreadsheet } from "../../../src/services/google-drive.js";
import { mountDriveFolder, type MountFolderResult } from "../../../src/connectors/drive-mounts.js";
import { inspectDriveItem, type DriveInspectResult } from "../../../src/connectors/drive-inspect.js";
import {
  dispatchDrive,
  localDriveService,
  reportRefusal,
  runDriveVerb,
  type DriveRefusal,
} from "../../../src/cli/commands/drive-dispatch.js";
// Registers the sheets/docs handlers, the same way the CLI entry point does.
import "../../../src/connectors/drive-handler-sheets.js";
import "../../../src/connectors/drive-handler-docs.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function driveFile(opts: { id: string; name: string; mimeType: string; parent?: string }): DriveFile {
  return {
    id: opts.id,
    name: opts.name,
    mimeType: opts.mimeType,
    modifiedTime: "2026-09-14T10:00:00Z",
    trashed: false,
    owners: [{ emailAddress: "test@example.com" }],
    ...(opts.parent === undefined ? {} : { parents: [opts.parent] }),
    webViewLink: `https://drive.google.com/file/d/${opts.id}/view`,
  };
}

function spreadsheetFor(opts: { id: string; name: string }): FakeSpreadsheet {
  return {
    metadata: {
      spreadsheetId: opts.id,
      properties: { title: opts.name },
      sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }],
    },
    sheets: new Map([["Sheet1", [["Name"], ["Alice"]]]]),
  };
}

/** One folder holding one Sheet — enough for a mount and an inspect. */
function recipesDrive() {
  return createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Budget 2026", mimeType: SHEET_MIME, parent: "folder-1" }),
    ],
    spreadsheets: [["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Budget 2026" })]],
  });
}

const SHELL_VARS = ["BBX_SPAWN_PROFILE", "BBX_SERVER_URL", "BBX_BOX_NAME", "BBX_AGENT_TOKEN"];
const savedShell = Object.fromEntries(SHELL_VARS.map((name) => [name, process.env[name]]));

/** Set (or, with `undefined`, unset) the env vars a box spawn hands a child. */
function setEnv(vars: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function restoreEnv(): void {
  setEnv(savedShell);
}

/** Exactly what `bbx drive mount`'s action does, minus the printing. */
function mountVerb(boxRoot: string, mount: { url: string; dir: string }) {
  return dispatchDrive<MountFolderResult>({
    local: async () =>
      mountDriveFolder({
        boxRoot,
        service: await localDriveService(boxRoot),
        input: mount.url,
        dir: mount.dir,
      }),
    remote: (client) => client.drive.mount.mutate(mount),
  });
}

/** Exactly what `bbx drive inspect`'s action does. */
function inspectVerb(boxRoot: string, url: string) {
  return dispatchDrive<DriveInspectResult>({
    local: async () =>
      inspectDriveItem({ boxRoot, service: await localDriveService(boxRoot), input: url }),
    remote: (client) => client.drive.inspect.query({ url }),
  });
}

/** "KIND | fix | message" — the three things a relayed refusal has to carry. */
function refusalLine(result: { ok: boolean; error?: DriveRefusal }): string {
  if (result.ok || result.error === undefined) return "no refusal";
  return `${result.error.kind} | ${result.error.fix} | ${result.error.message}`;
}

async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args) => { lines.push(args.map(String).join(" ")); };
  console.error = (...args) => { lines.push(args.map(String).join(" ")); };
  try {
    await fn();
  } finally {
    console.log = log;
    console.error = error;
  }
  return lines.join("\n");
}
```

## An agent's shell mounts a folder through its own box's server

No token file is involved anywhere in this block: the CLI half holds only the
three env vars a box spawn hands it, and the credentialed work happens in the
server process (here, against an injected fake Drive).

```ts
const ctx = await makeTestServer({ openAccess: false, services: { drive: recipesDrive() } });
const serverUrl = await ctx.server.listen({ port: 0, host: "127.0.0.1" });
setEnv({
  BBX_SPAWN_PROFILE: "agent",
  BBX_SERVER_URL: serverUrl,
  BBX_BOX_NAME: TEST_SLUG,
  BBX_AGENT_TOKEN: getOrCreateAgentToken(ctx.boxRoot),
});

const mounted = await mountVerb(ctx.boxRoot, {
  url: "https://drive.google.com/drive/folders/folder-1",
  dir: "_content/drive/recipes",
});
JSON.stringify(mounted.ok ? { cardPath: mounted.value.cardPath, name: mounted.value.name } : mounted.error)
=> {"cardPath":"_content/drive/recipes/Recipes.gfolder.card","name":"Recipes"}
```

The card is a real card in the box, written by the server, indistinguishable
from one the settings page made.

```ts continue
(await ctx.read("_content/drive/recipes/Recipes.gfolder.card")).includes("drive-id: folder-1")
=> true
```

`inspect` is the verification step the incident lacked — the agent can now
resolve an id to a name, and see that a card already claims it.

```ts continue
const seen = await inspectVerb(ctx.boxRoot, "https://drive.google.com/file/d/sheet-1/view");
JSON.stringify(seen.ok ? { name: seen.value.name, cardType: seen.value.cardType, claimedBy: seen.value.claimedBy } : seen.error)
=> {"name":"Budget 2026","cardType":"gsheet","claimedBy":["_content/drive/recipes/Budget_2026.gsheet.card"]}
```

`--json` prints exactly one object — the procedure's own return value — so the
agent never parses prose.

```ts continue
const json = await captureLogs(() => runDriveVerb({
  json: true,
  run: () => inspectVerb(ctx.boxRoot, "https://drive.google.com/drive/folders/folder-1"),
  print: () => { throw new Error("--json must not print the human form"); },
}));
JSON.parse(json).name
=> Recipes
```

A refusal the server raised comes back with its own code and the party who can
act on it. A bad URL is the caller's.

```ts continue
refusalLine(await mountVerb(ctx.boxRoot, { url: "https://example.com/nope", dir: "_content/drive/x" }))
=> BAD_REQUEST | caller | Could not read a Drive ID from: https://example.com/nope — paste a Drive URL or the bare ID
```

Under `--json` that refusal is one object too, carrying `fix` as a field rather
than as a sentence.

```ts continue
const refused = await mountVerb(ctx.boxRoot, { url: "https://example.com/nope", dir: "_content/drive/x" });
const printed = await captureLogs(async () => { if (!refused.ok) reportRefusal(refused.error, true); });
JSON.stringify({ kind: JSON.parse(printed).kind, fix: JSON.parse(printed).fix })
=> {"kind":"BAD_REQUEST","fix":"caller"}
```

For a person the same refusal says who can fix it in words.

```ts continue
const forHumans = await captureLogs(async () => { if (!refused.ok) reportRefusal(refused.error, false); });
forHumans.split("\n")[1]
=> Who can fix it: the caller — fix the input and run it again.
```

## A missing env var refuses by name, and never falls back to a local credential

The refusal points at the spawn site, not at Drive. Guessing a URL would reach
whichever box happened to answer there, so there is no fallback.

```ts continue
setEnv({ BBX_AGENT_TOKEN: undefined });
refusalLine(await inspectVerb(ctx.boxRoot, "https://drive.google.com/drive/folders/folder-1")).split(".")[0]
=> BOX_UNREACHABLE | machine | Cannot reach this box's server: BBX_AGENT_TOKEN is not set
```

```ts continue
setEnv({ BBX_AGENT_TOKEN: getOrCreateAgentToken(ctx.boxRoot), BBX_SERVER_URL: undefined });
refusalLine(await inspectVerb(ctx.boxRoot, "https://drive.google.com/drive/folders/folder-1")).split(".")[0]
=> BOX_UNREACHABLE | machine | Cannot reach this box's server: BBX_SERVER_URL is not set
```

## The `tooling` profile takes the in-process path

The marker decides, not what the process can read. Under `tooling` the same
verb builds its own Drive service and therefore meets the box's own gates — the
injected service the server holds is not in play at all. This box has Drive
switched off, and the refusal now tells the agent it may turn it on, because the
boxholder said so (2026-09-14).

```ts continue
setEnv({ BBX_SPAWN_PROFILE: "tooling", BBX_SERVER_URL: serverUrl });
refusalLine(await inspectVerb(ctx.boxRoot, "https://drive.google.com/drive/folders/folder-1"))
=> FORBIDDEN | boxholder | Drive is not enabled for this box. Set `googleServices.drive: true` in `_config/box.json` (you may do this when the boxholder asks for Drive), or enable it in box settings.
```

With Drive switched on and no token file this process can read, it is the auth
gap — a different sentence, still the boxholder's, and the one that would have
been true for the agent all along had the agent been on this path.

```ts continue
await mkdir(join(ctx.boxRoot, "_config"), { recursive: true });
await writeFile(join(ctx.boxRoot, "_config/box.json"), JSON.stringify({ googleServices: { drive: true } }));
const gap = await inspectVerb(ctx.boxRoot, "https://drive.google.com/drive/folders/folder-1");
JSON.stringify(gap.ok ? "unexpectedly succeeded" : { kind: gap.error.kind, fix: gap.error.fix })
=> {"kind":"PRECONDITION_FAILED","fix":"boxholder"}
```

An unset or misspelled marker is NOT the tooling profile: it delegates, which is
what makes a spawn site that forgets the marker fail closed rather than reach
for a credential.

```ts continue
setEnv({ BBX_SPAWN_PROFILE: undefined });
const unset = await inspectVerb(ctx.boxRoot, "https://drive.google.com/drive/folders/folder-1");
JSON.stringify(unset.ok ? { name: unset.value.name } : unset.error)
=> {"name":"Recipes"}
```

```ts cleanup
restoreEnv();
await ctx.cleanup();
```
