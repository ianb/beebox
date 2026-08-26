# cb drive mount / link / unmount

The three commands that write and remove Drive mount cards, plus the one-time
conversion that turns a pre-card `folders` config entry into a `.gfolder.card`.

Every refusal here is a message someone has to read and act on, so the tests
assert the message, not just that it threw.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { initBox } from "../../../src/core/box/index.js";
import {
  createFakeGoogleDrive,
  type DriveFile,
  type FakeSpreadsheet,
} from "../../../src/services/google-drive.js";
// Importing the connector registers the docs/sheets handlers, which is what
// makes a Doc or Sheet child syncable rather than pointer-only.
import { createGoogleDriveConnector } from "../../../src/connectors/google-drive.js";
import {
  linkDriveItem,
  mountDriveFolder,
  unmountDriveFolder,
} from "../../../src/connectors/drive-mounts.js";
import { loadDriveConfig, saveDriveConfig } from "../../../src/connectors/drive-config.js";
import { createGfolderTemplate } from "../../../src/schemas/gfolder.js";
import { runDriveStatus } from "../../../src/cli/commands/drive.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const FOLDER_URL = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const FILE_URL = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function driveFile(opts: {
  id: string;
  name: string;
  mimeType: string;
  parent?: string;
}): DriveFile {
  return {
    id: opts.id,
    name: opts.name,
    mimeType: opts.mimeType,
    modifiedTime: "2026-08-26T10:00:00Z",
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

/** A box with one Drive folder holding one Sheet and one PDF. */
function recipesDrive() {
  return createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Budget 2026", mimeType: SHEET_MIME, parent: "folder-1" }),
      driveFile({ id: "pdf-1", name: "Scan.pdf", mimeType: "application/pdf", parent: "folder-1" }),
    ],
    spreadsheets: [["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Budget 2026" })]],
  });
}

function cardsIn(listing: string, dir: string): string[] {
  return listing.split("\n").filter((p) => p.startsWith(dir) && p.endsWith(".card"));
}

async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const log = console.log;
  const warn = console.warn;
  const error = console.error;
  console.log = (...args) => { lines.push(args.map(String).join(" ")); };
  console.warn = (...args) => { lines.push(args.map(String).join(" ")); };
  console.error = (...args) => { lines.push(args.map(String).join(" ")); };
  try {
    await fn();
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
  }
  return lines.join("\n");
}
```

## mount writes the card and mirrors the folder in the same breath

A mount is not a promise for later: `mount` writes the `.gfolder.card` and runs
one mirror pass, so the directory holds the folder's children before the
command returns. The Sheet is synced; the PDF becomes a pointer.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const drive = recipesDrive();

const result = await mountDriveFolder({
  boxRoot: box.root,
  service: drive,
  input: "https://drive.google.com/drive/folders/folder-1",
  dir: "store/drive/recipes",
});
JSON.stringify({ cardPath: result.cardPath, name: result.name, failures: result.failures })
=> {"cardPath":"store/drive/recipes/Recipes.gfolder.card","name":"Recipes","failures":[]}

JSON.stringify(cardsIn(await box.list(), "store/drive/recipes/"))
=> ["store/drive/recipes/Budget_2026.gsheet.card","store/drive/recipes/Recipes.gfolder.card","store/drive/recipes/Scanpdf.glink.card"]
```

The mount card records the outcome, and the pointer says where it came from.

```ts continue
const card = await box.read("store/drive/recipes/Recipes.gfolder.card");
JSON.stringify({
  driveId: /drive-id: (\S+)/.exec(card)?.[1],
  status: /status: (\S+)/.exec(card)?.[1],
  hasLastSync: card.includes("last-sync:"),
})
=> {"driveId":"folder-1","status":"ok","hasLastSync":true}

/origin: (\S+)/.exec(await box.read("store/drive/recipes/Scanpdf.glink.card"))?.[1]
=> mirror
```

A second mount of the same folder is refused — two cards for one Drive ID are
two working copies, and the connector syncs neither.

```ts continue
await mountDriveFolder({
  boxRoot: box.root,
  service: drive,
  input: FOLDER_URL("folder-1"),
  dir: "store/drive/elsewhere",
})
=> throws DriveIdClaimedError: Drive item folder-1 is already claimed by: store/drive/recipes/Recipes.gfolder.card — trash or move that card to put it somewhere else
```

So is mounting a second folder into a directory that already has a mount: one
directory is one mount, or two mirrors fight over the same children.

```ts continue
drive.files.push(driveFile({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME }));
await mountDriveFolder({
  boxRoot: box.root,
  service: drive,
  input: FOLDER_URL("folder-2"),
  dir: "store/drive/recipes",
})
=> throws DirectoryAlreadyMountedError
```

```ts cleanup
await box.cleanup();
```

## mount refuses anything that is not a folder

`mount` is for membership; a Sheet has content, and content is `cb drive add`.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const drive = recipesDrive();

await mountDriveFolder({
  boxRoot: box.root,
  service: drive,
  input: FILE_URL("sheet-1"),
  dir: "store/drive/budget",
})
=> throws NotADriveFolderError: Budget 2026 is a application/vnd.google-apps.spreadsheet, not a Drive folder — use `cb drive add` to sync a Doc or Sheet, or `cb drive link` to point at it
```

Nothing is left behind by the refusal — no directory, no card.

```ts continue
(await box.list()).includes("store/drive/budget")
=> false
```

An input with no readable Drive ID never reaches Drive at all.

```ts continue
await mountDriveFolder({ boxRoot: box.root, service: drive, input: "", dir: "store/drive/x" })
=> throws UnreadableDriveInputError
```

```ts cleanup
await box.cleanup();
```

## link points at anything, and fills in the card extension

A pointer copies nothing, so it works for a PDF, and for a folder someone
wants remembered rather than mirrored. A bare path gets `.glink.card`.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const drive = recipesDrive();

const linked = await linkDriveItem({
  boxRoot: box.root,
  service: drive,
  input: "https://drive.google.com/file/d/pdf-1/view",
  target: "store/drive/Lease",
});
JSON.stringify(linked)
=> {"cardPath":"store/drive/Lease.glink.card","name":"Scan.pdf","mimeType":"application/pdf"}
```

`origin: manual` is what separates a pointer someone asked for from one a
mirror emitted, and the body starts empty because the notes are not ours.

```ts continue
const card = await box.read("store/drive/Lease.glink.card");
JSON.stringify({
  origin: /origin: (\S+)/.exec(card)?.[1],
  driveId: /drive-id: (\S+)/.exec(card)?.[1],
  body: card.split("---\n")[2],
})
=> {"origin":"manual","driveId":"pdf-1","body":""}
```

A full path is taken as given, and a folder is a legitimate pointer target.

```ts continue
const folderLink = await linkDriveItem({
  boxRoot: box.root,
  service: drive,
  input: FOLDER_URL("folder-1"),
  target: "store/drive/Recipes_folder.glink.card",
});
JSON.stringify({ cardPath: folderLink.cardPath, mimeType: folderLink.mimeType })
=> {"cardPath":"store/drive/Recipes_folder.glink.card","mimeType":"application/vnd.google-apps.folder"}
```

The same Drive item is not pointed at twice.

```ts continue
await linkDriveItem({ boxRoot: box.root, service: drive, input: FILE_URL("pdf-1"), target: "store/drive/Again" })
=> throws DriveIdClaimedError
```

```ts cleanup
await box.cleanup();
```

## unmount takes a directory or the card, and keeps every child

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const drive = recipesDrive();
await mountDriveFolder({
  boxRoot: box.root,
  service: drive,
  input: FOLDER_URL("folder-1"),
  dir: "store/drive/recipes",
});

const unmounted = await unmountDriveFolder({ boxRoot: box.root, target: "store/drive/recipes" });
JSON.stringify(unmounted)
=> {"cardPath":"store/drive/recipes/Recipes.gfolder.card","trashedTo":"store/trash/Recipes.gfolder.card"}
```

The children stay exactly where they are — the synced Sheet keeps syncing on
its own card, the pointer keeps pointing. Nothing was deleted.

```ts continue
JSON.stringify(cardsIn(await box.list(), "store/drive/recipes/"))
=> ["store/drive/recipes/Budget_2026.gsheet.card","store/drive/recipes/Scanpdf.glink.card"]
```

And the trashed card is the tombstone that stops the next sync re-creating the
mount.

```ts continue
const drive2 = recipesDrive();
const connector = createGoogleDriveConnector(box.root, drive2);
await connector.sync();
JSON.stringify(cardsIn(await box.list(), "store/drive/recipes/"))
=> ["store/drive/recipes/Budget_2026.gsheet.card","store/drive/recipes/Scanpdf.glink.card"]
```

Naming the card directly works the same way.

```ts continue
drive.files.push(driveFile({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME }));
await mountDriveFolder({
  boxRoot: box.root,
  service: drive,
  input: FOLDER_URL("folder-2"),
  dir: "store/drive/desserts",
});
(await unmountDriveFolder({
  boxRoot: box.root,
  target: "store/drive/desserts/Desserts.gfolder.card",
})).trashedTo
=> store/trash/Desserts.gfolder.card
```

```ts cleanup
await box.cleanup();
```

## unmount will not guess between two mounts, or invent one

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("store/drive/two/A.gfolder.card", createGfolderTemplate({ driveId: "folder-1" }));
await box.seed("store/drive/two/B.gfolder.card", createGfolderTemplate({ driveId: "folder-2" }));
box.commitAll("two mounts in one directory");

await unmountDriveFolder({ boxRoot: box.root, target: "store/drive/two" })
=> throws AmbiguousFolderMountError: store/drive/two holds 2 folder mounts (A.gfolder.card, B.gfolder.card) — name the one to unmount

await unmountDriveFolder({ boxRoot: box.root, target: "store/notes" })
=> throws NoFolderMountHereError: store/notes is not a Drive folder mount — it holds no .gfolder.card
```

```ts cleanup
await box.cleanup();
```

## status names the kind of every Drive card

A folder mount is not a file, and a pointer is not synced. Status says which,
and shows a folder's own status and last sync.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const drive = recipesDrive();
await mountDriveFolder({
  boxRoot: box.root,
  service: drive,
  input: FOLDER_URL("folder-1"),
  dir: "store/drive/recipes",
});

const output = await captureLogs(() => runDriveStatus(box.root));
JSON.stringify({
  count: output.includes("3 Drive card(s)"),
  folder: output.includes("Kind: folder (mirrored)"),
  file: output.includes("Kind: file (synced two-way)"),
  link: output.includes("Kind: link (pointer, nothing copied)"),
  folderName: output.includes("Title: Recipes"),
  folderStatus: output.includes("Status: ok"),
  folderSynced: /Last synced: 20\d\d-/.test(output),
})
=> {"count":true,"folder":true,"file":true,"link":true,"folderName":true,"folderStatus":true,"folderSynced":true}
```

```ts cleanup
await box.cleanup();
```

## a legacy `folders` config converts itself into mount cards

A box set up before folder mounts were cards still carries the array. The
first sync writes a `.gfolder.card` into each configured directory, mirrors it
on the same pass, and rewrites the config without the entry.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await saveDriveConfig(box.root, {
  folders: [{ driveFolderId: "folder-1", localPath: "store/drive/recipes" }],
});
box.commitAll("a pre-card folder mount");

const connector = createGoogleDriveConnector(box.root, recipesDrive());
const log = await captureLogs(async () => { await connector.sync(); });
JSON.stringify({
  converted: log.includes("Converted 1 legacy folder mount(s)"),
  cards: cardsIn(await box.list(), "store/drive/recipes/"),
})
=> {"converted":true,"cards":["store/drive/recipes/Budget_2026.gsheet.card","store/drive/recipes/Scanpdf.glink.card","store/drive/recipes/recipes.gfolder.card"]}
```

The config no longer carries the entry, and the mount card that replaced it is
already stamped by the mirror pass that ran after the conversion.

```ts continue
const config = await loadDriveConfig(box.root);
JSON.stringify(config)
=> {"ok":true,"value":{}}

const card = await box.read("store/drive/recipes/recipes.gfolder.card");
JSON.stringify({
  driveId: /drive-id: (\S+)/.exec(card)?.[1],
  name: /name: (.*)/.exec(card)?.[1],
  status: /status: (\S+)/.exec(card)?.[1],
})
=> {"driveId":"folder-1","name":"Recipes","status":"ok"}
```

A second sync converts nothing, writes no second card, and says nothing about
conversion — there is no `folders` key left to act on.

```ts continue
const again = await captureLogs(async () => { await connector.sync(); });
JSON.stringify({
  quiet: again.includes("Converted"),
  cards: cardsIn(await box.list(), "store/drive/recipes/").length,
})
=> {"quiet":false,"cards":3}
```

```ts cleanup
await box.cleanup();
```

## conversion refuses a directory that already mounts a different folder

Converting would put two mirrors in one directory. The entry stays in the
config until the boxholder decides which one wins — dropping it would look
like the conversion succeeded.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Other.gfolder.card",
  createGfolderTemplate({ driveId: "folder-9" }),
);
await saveDriveConfig(box.root, {
  folders: [{ driveFolderId: "folder-1", localPath: "store/drive/recipes" }],
});
box.commitAll("a config entry pointing at an occupied directory");

const drive = recipesDrive();
drive.files.push(driveFile({ id: "folder-9", name: "Other", mimeType: FOLDER_MIME }));
const connector = createGoogleDriveConnector(box.root, drive);
const log = await captureLogs(async () => { await connector.sync(); });
log.includes("NOT converted")
=> true

JSON.stringify(await loadDriveConfig(box.root))
=> {"ok":true,"value":{"folders":[{"driveFolderId":"folder-1","localPath":"store/drive/recipes"}]}}
```

An idempotent second run does exactly the same thing — no card, no rewrite.

```ts continue
await captureLogs(async () => { await connector.sync(); });
JSON.stringify(cardsIn(await box.list(), "store/drive/recipes/").filter((p) => p.endsWith(".gfolder.card")))
=> ["store/drive/recipes/Other.gfolder.card"]
```

```ts cleanup
await box.cleanup();
```

## a config that exists but does not parse is a failure, never "no mounts"

Reading a corrupt file as an empty config would silently drop the mounts it
still owes a conversion, and the box would look correctly empty while it
wasn't. So the sync fails loudly and converts nothing.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.write("config/connectors/google-drive.json", '{"folders": [{"localPath": 7}]\n');
box.commitAll("a malformed connector config");

const parsed = await loadDriveConfig(box.root);
JSON.stringify({ ok: parsed.ok, mentions: parsed.ok ? "" : parsed.error.includes("google-drive.json") })
=> {"ok":false,"mentions":true}

const connector = createGoogleDriveConnector(box.root, recipesDrive());
let outcome = { success: true, error: "" };
const log = await captureLogs(async () => {
  const result = await connector.sync();
  outcome = { success: result.success, error: result.error ?? "" };
});
JSON.stringify({
  success: outcome.success,
  loud: log.includes("google-drive.json"),
  reported: outcome.error.includes("google-drive.json"),
})
=> {"success":false,"loud":true,"reported":true}
```

```ts cleanup
await box.cleanup();
```
