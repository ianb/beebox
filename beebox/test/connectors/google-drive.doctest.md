# Google Drive Connector

Tests for the Google Drive connector using fake services.

```ts setup
import { join } from "node:path";
import { readdir, rename, rm } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/structure/core.js";
import { createFakeGoogleDrive } from "../../src/services/google-drive/core.js";
import type { FakeGoogleDriveOptions } from "../../src/services/google-drive/core.js";
import { createGoogleDriveConnector } from "../../src/connectors/google-drive/connector.js";
import { moveCardsToTrash } from "../../src/core/commands/trash/command.js";
import { createCliContext } from "../../src/core/command-runner.js";
import { createGsheetTemplate } from "../../src/schemas/gsheet.js";
import { createGdocTemplate } from "../../src/schemas/gdoc.js";
import { createGfolderTemplate } from "../../src/schemas/gfolder.js";
import { runDriveStatus } from "../../src/cli/commands/drive/status-cli.js";
import { findDriveCardTracking } from "../../src/connectors/google-drive/tracking.js";
import type { FakeSpreadsheet } from "../../src/services/google-drive/core.js";

type Tabs = Array<[string, string[][]]>;

/**
 * A spreadsheet's remote side (Drive file + tab data) and its local
 * `.gsheet.card`. Tab refs in the card are `<refPrefix><title>.json`.
 */
function sheetFixture(opts: { id: string; name: string; parent?: string; tabs?: Tabs; refPrefix?: string }) {
  const tabs: Tabs = opts.tabs ?? [["Sheet1", [["Name"], ["Alice"]]]];
  const refPrefix = opts.refPrefix ?? "attach/";
  const file = {
    id: opts.id,
    name: opts.name,
    mimeType: "application/vnd.google-apps.spreadsheet",
    modifiedTime: "2026-03-29T10:00:00Z",
    trashed: false,
    owners: [{ emailAddress: "test@example.com" }],
    ...(opts.parent ? { parents: [opts.parent] } : {}),
    webViewLink: `https://docs.google.com/spreadsheets/d/${opts.id}/edit`,
  };
  const spreadsheet: FakeSpreadsheet = {
    metadata: {
      spreadsheetId: opts.id,
      properties: { title: opts.name },
      sheets: tabs.map(([title], i) => ({ properties: { sheetId: i, title } })),
    },
    sheets: new Map(tabs),
  };
  const card = createGsheetTemplate({
    driveId: opts.id,
    title: opts.name,
    modified: file.modifiedTime,
    link: file.webViewLink,
    owner: "test@example.com",
    sheets: tabs.map(([title], i) => ({ ref: `${refPrefix}${title}.json`, title, gid: String(i) })),
  });
  return { file, spreadsheet, card };
}

/** A Drive folder entry for the fake — the remote side of a `.gfolder.card`. */
function folderFixture(opts: { id: string; name: string }) {
  return {
    id: opts.id,
    name: opts.name,
    mimeType: "application/vnd.google-apps.folder",
    modifiedTime: "2026-03-29T10:00:00Z",
    trashed: false,
    webViewLink: `https://drive.google.com/drive/folders/${opts.id}`,
  };
}

/** A fake Drive holding the fixtures' files and spreadsheets, plus any extra entries. */
function fakeDrive(
  fixtures: Array<ReturnType<typeof sheetFixture>>,
  extra?: { folders?: Array<ReturnType<typeof folderFixture>>; documents?: FakeGoogleDriveOptions["documents"] },
) {
  return createFakeGoogleDrive({
    files: [...(extra?.folders ?? []), ...fixtures.map((f) => f.file)],
    spreadsheets: new Map(fixtures.map((f) => [f.file.id, f.spreadsheet])),
    ...(extra?.documents ? { documents: extra.documents } : {}),
  });
}

/** Wraps a fake Drive so the test can count `getFile` requests. */
function countGetFile(inner: ReturnType<typeof createFakeGoogleDrive>) {
  const calls = { getFile: 0 };
  const drive = {
    ...inner,
    async getFile(fileId: string) {
      calls.getFile += 1;
      return inner.getFile(fileId);
    },
  };
  return { drive, calls };
}

async function newBox() {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  return box;
}

/**
 * A box mounting `folder-1`, with one synced child sheet whose card and
 * attachment already exist locally.
 */
async function syncedFolderChild(childId: string) {
  const box = await newBox();
  await box.seed(
    "_content/drive/folder/Folder.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  const fixture = sheetFixture({ id: childId, name: "Folder Child", parent: "folder-1" });
  box.commitAll("mount folder");
  const { drive, calls } = countGetFile(
    fakeDrive([fixture], { folders: [folderFixture({ id: "folder-1", name: "Folder" })] }),
  );
  const connector = createGoogleDriveConnector(box.root, drive);
  const initial = await connector.sync();
  return {
    box, fixture, calls, connector, initial,
    liveCard: "_content/drive/folder/Folder_Child.gsheet.card",
    liveSheet: "_content/drive/folder/Folder_Child.attach/Sheet1.json",
  };
}

async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}
```

## Pull, push, tabs and comments

A synced spreadsheet card gets its Drive metadata in the card and one JSON file
per tab. The local card starts stale (old title, older modified time) and has
no tab file yet; a sync pulls the remote state.

```ts
const box = await newBox();
box.commitAll("init box");
const fx = sheetFixture({
  id: "sheet-abc123",
  name: "Test Budget",
  tabs: [["Sheet1", [["Name", "Age"], ["Alice", "30"]]]],
  refPrefix: "Budget/",
});
const stale = sheetFixture({ id: "sheet-abc123", name: "Old Budget", refPrefix: "Budget/" });
// The card is created first, simulating `bbx drive add`.
await box.seed("_content/drive/Budget.gsheet.card", stale.card.replace("2026-03-29T10:00:00Z", "2026-01-01T00:00:00Z"));
box.commitAll("add drive sheet");

const result = await createGoogleDriveConnector(box.root, fakeDrive([fx])).sync();
result.success
=> true
```

The card now carries the remote spreadsheet metadata:

```ts continue
const card = await box.read("_content/drive/Budget.gsheet.card");
[card.includes("drive:\n  id: sheet-abc123"), card.includes("title: Test Budget"), card.includes("Old Budget")]
=> [true, true, false]
```

The tab file is created from the remote cell values:

```ts continue
await box.read("_content/drive/Budget.attach/Sheet1.json")
=> [
["Name","Age"],
["Alice",30]
]
```

```ts cleanup
await box.cleanup();
```

When a user edits a JSON file locally, the next sync pushes the changed values
back, to the right tab:

```ts
const box = await newBox();
box.commitAll("init box");
const fx = sheetFixture({
  id: "sheet-push1",
  name: "Expenses",
  tabs: [["Sheet1", [["Item", "Cost"], ["Coffee", "5"]]]],
  refPrefix: "",
});
const drive = fakeDrive([fx]);
await box.seed("_content/drive/Expenses.gsheet.card", fx.card);
await box.seed("_content/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","5"]\n]\n');
box.commitAll("add expenses");

const connector = createGoogleDriveConnector(box.root, drive);
await connector.sync();

// Edit the JSON locally — change Coffee price and add Tea
await box.seed("_content/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","6"],\n["Tea","3"]\n]\n');
box.commitAll("edit expenses");

const result = await connector.sync();
result.success
=> true

drive.updateLog.length
=> 1

drive.updateLog[0]?.sheetTitle
=> Sheet1

drive.updateLog[0]?.values[1]?.[1]
=> 6
```

```ts cleanup
await box.cleanup();
```

Spreadsheets with multiple sheet tabs get separate JSON files:

```ts
const box = await newBox();
box.commitAll("init box");
const fx = sheetFixture({
  id: "sheet-multi",
  name: "Multi",
  tabs: [
    ["Summary", [["Total", "=SUM(Expenses!B:B)"]]],
    ["Expenses", [["Item", "Cost"], ["Coffee", "5"]]],
  ],
  refPrefix: "Multi/",
});
await box.seed("_content/drive/Multi.gsheet.card", fx.card);
await box.seed("_content/drive/Multi/Summary.json", '[\n["Total","=SUM(Expenses!B:B)"]\n]\n');
await box.seed("_content/drive/Multi/Expenses.json", '[\n["Item","Cost"],\n["Coffee","5"]\n]\n');
box.commitAll("add multi");

const result = await createGoogleDriveConnector(box.root, fakeDrive([fx])).sync();
result.success
=> true

const files = await readdir(join(box.root, "_content/drive/Multi"));
files.sort();
files
=> [
  "Expenses.json",
  "Summary.json"
]
```

```ts cleanup
await box.cleanup();
```

### Comments — captured as a sidecar in the attach scope

A spreadsheet with comments gets a `{basename}.comments.json` sidecar
(written into the card's `.attach/` scope) and a `comments.ref:` field on
the card. The fake serves comments off a registered document keyed by the
same file id.

```ts
const box = await newBox();
box.commitAll("init box");
const fx = sheetFixture({ id: "sheet-comm", name: "Reviewed" });
const drive = fakeDrive([fx], {
  documents: new Map([["sheet-comm", {
    structure: { documentId: "sheet-comm", title: "Reviewed", revisionId: "rev-1", body: { content: [] } },
    exports: new Map(),
    comments: [
      {
        id: "c-1",
        content: "Should this be Bob?",
        author: { displayName: "Reviewer" },
        resolved: false,
        createdTime: "2026-03-28T08:00:00Z",
      },
    ],
  }]]),
});
await box.seed("_content/drive/Reviewed.gsheet.card", fx.card);
box.commitAll("add reviewed sheet");

const result = await createGoogleDriveConnector(box.root, drive).sync();
result.success
=> true

const card = await box.read("_content/drive/Reviewed.gsheet.card");
card.includes("ref: attach/Reviewed.comments.json")
=> true

const sidecar = JSON.parse(await box.read("_content/drive/Reviewed.attach/Reviewed.comments.json"));
sidecar[0]?.content
=> Should this be Bob?

sidecar[0]?.author?.displayName
=> Reviewer
```

```ts cleanup
await box.cleanup();
```

## Trashing a card stops sync, and restoring it resumes

`bbx rm` moves both the card and its attachment scope into `_bookkeeping/trash`. The
trash copy remains the durable record of the Drive ID, but it is not part of
the active sync working set.

```ts
const box = await newBox();
const fixture = sheetFixture({ id: "sheet-trash", name: "Trash Me" });
await box.seed("_content/drive/Trash-Me.gsheet.card", fixture.card);
await box.seed("_content/drive/Trash-Me.attach/Sheet1.json", '[["Name"],["Alice"]]\n');
box.commitAll("add drive card");

const { drive, calls } = countGetFile(
  fakeDrive([fixture], { folders: [folderFixture({ id: "folder-1", name: "Folder" })] }),
);
const connector = createGoogleDriveConnector(box.root, drive);
await connector.sync();
calls.getFile
=> 1
```

After the real trash move, another sync makes no request for that Drive file.

```ts continue
const receipt = await moveCardsToTrash(
  createCliContext(box.root),
  ["_content/drive/Trash-Me.gsheet.card"],
);
calls.getFile = 0;
const trashed = await connector.sync();
JSON.stringify({
  getFileCalls: calls.getFile,
  changed: trashed.created.length + trashed.updated.length + (trashed.pushed?.length ?? 0),
  trashPath: receipt.moves[0]?.destPath,
})
=> {"getFileCalls":0,"changed":0,"trashPath":"_bookkeeping/trash/Trash-Me.gsheet.card"}
```

Restoring the exact card and attachment paths makes it live again.

```ts continue
for (const move of receipt.moves[0]?.fileMoves ?? []) {
  await rename(join(box.root, move.destPath), join(box.root, move.sourcePath));
}
calls.getFile = 0;
await connector.sync();
calls.getFile
=> 1
```

```ts cleanup
await box.cleanup();
```

## A trashed folder child is not rediscovered

Folder mounts still list their remote children, but the Drive IDs retained in
trash suppress recreation. Raw hard deletion is different: once the tombstone
is removed, the configured folder mount is authoritative and creates the card
again.

```ts
const { box, initial, liveCard, liveSheet, calls, connector, fixture } = await syncedFolderChild("sheet-folder-trash");
JSON.stringify({
  created: initial.created.includes(liveCard),
  attachment: (await box.list()).includes(liveSheet),
})
=> {"created":true,"attachment":true}
```

Trash the previously synced card, so the connector retains both real transient
hashes and a durable tombstone. It must neither sync nor rediscover the child.
(The one `getFile` is the mount reading its own Drive folder, not the child.)

```ts continue
const receipt = await moveCardsToTrash(
  createCliContext(box.root),
  [liveCard],
);
calls.getFile = 0;
const trashed = await connector.sync();
const retainedState = JSON.parse(
  await box.read("_bookkeeping/connectors/google-drive.state.json"),
) as { files?: Record<string, { contentHashes?: Record<string, string> }> };
JSON.stringify({
  getFileCalls: calls.getFile,
  created: trashed.created.length,
  liveCardExists: (await box.list()).includes(liveCard),
  retainedHash: retainedState.files?.[fixture.file.id]?.contentHashes?.["Sheet1.json"] !== undefined,
})
=> {"getFileCalls":1,"created":0,"liveCardExists":false,"retainedHash":true}
```

Hard-deleting the complete tombstone allows the still-mounted folder to
recreate both the card and its attachment data, despite retained transient
hashes from the original mount.

```ts continue
for (const move of receipt.moves[0]?.fileMoves ?? []) {
  await rm(join(box.root, move.destPath), { recursive: true, force: true });
}
calls.getFile = 0;
const rediscovered = await connector.sync();
JSON.stringify({
  getFileCalls: calls.getFile,
  createdCard: rediscovered.created.includes(liveCard),
  createdAttachment: rediscovered.created.includes(liveSheet),
  attachmentExists: (await box.list()).includes(liveSheet),
})
=> {"getFileCalls":2,"createdCard":true,"createdAttachment":true,"attachmentExists":true}
```

```ts cleanup
await box.cleanup();
```

## Drive status shares the live-card scan and YAML ID parser

Status reports live YAML and legacy cards, but it does not report a tombstone
as a mounted file.

```ts
const box = await newBox();
const yamlFixture = sheetFixture({ id: "yaml-id", name: "YAML Card" });
await box.seed("_content/drive/Yaml.gsheet.card", yamlFixture.card);
await box.seed("_content/drive/Legacy.gsheet.card", '<gsheet drive-id="legacy-id"><title>Legacy</title><modified>2026-03-01T00:00:00Z</modified><sheet-tab title="Old Tab" gid="0"/></gsheet>\n');
await box.seed("_bookkeeping/trash/Hidden.gsheet.card", createGsheetTemplate({
  driveId: "trash-id",
  title: "Hidden",
  modified: "2026-03-29T10:00:00Z",
  link: "https://example.test/hidden",
  owner: "test@example.com",
  sheets: [],
}));

const output = await captureLogs(() => runDriveStatus(box.root));
JSON.stringify({
  count: output.includes("2 Drive card(s)"),
  yamlId: output.includes("Drive ID: yaml-id"),
  legacyId: output.includes("Drive ID: legacy-id"),
  trash: output.includes("trash-id") || output.includes("_bookkeeping/trash"),
})
=> {"count":true,"yamlId":true,"legacyId":true,"trash":false}
```

The health fields come from the current YAML form, not just the legacy XML
form: title, Drive's last-modified time, a conflict, sheet tabs, and the lossy
summary all print. A synced file's `drive.modified` is when it last changed on
Drive, not when the box synced it.

```ts continue
const conflicted = createGdocTemplate({
  driveId: "doc-id",
  title: "Contended Doc",
  modified: "2026-04-26T12:00:00Z",
  link: "https://docs.google.com/document/d/doc-id/edit",
  owner: "test@example.com",
  contentFile: "Contended.md",
  conflict: true,
  lossy: [{ type: "images", count: 2 }, { type: "footnotes", count: 1 }],
});
await box.seed("_content/drive/Contended.gdoc.card", conflicted);

const health = await captureLogs(() => runDriveStatus(box.root));
JSON.stringify({
  yamlTitle: health.includes("Title: YAML Card"),
  yamlModified: health.includes("Modified on Drive: 2026-03-29T10:00:00Z"),
  notLastSynced: !health.includes("Last synced: 2026-03-29T10:00:00Z"),
  yamlTabs: health.includes("Tabs: Sheet1"),
  yamlConflictHidden: (health.match(/Conflict:/g) ?? []).length === 1,
  docTitle: health.includes("Title: Contended Doc"),
  docConflict: health.includes("Conflict: merge the .remote.md beside the local copy, then delete it"),
  docLossy: health.includes("Lossy: images=2, footnotes=1"),
  legacyTabs: health.includes("Tabs: Old Tab"),
})
=> {"yamlTitle":true,"yamlModified":true,"notLastSynced":true,"yamlTabs":true,"yamlConflictHidden":true,"docTitle":true,"docConflict":true,"docLossy":true,"legacyTabs":true}
```

Cards with an ambiguous identity are listed too — they are not synced, so a
silent omission would read as "not mounted".

```ts continue
await box.seed("_content/drive/Yaml-Copy.gsheet.card", yamlFixture.card);
await box.seed("_content/drive/Broken.gsheet.card", "---\ntitle: No identity\n---\n");

const ambiguous = await captureLogs(() => runDriveStatus(box.root));
JSON.stringify({
  duplicate: ambiguous.includes("Duplicate drive.id yaml-id"),
  bothPaths: ambiguous.includes("_content/drive/Yaml.gsheet.card")
    && ambiguous.includes("_content/drive/Yaml-Copy.gsheet.card"),
  unreadable: ambiguous.includes("No readable drive.id: _content/drive/Broken.gsheet.card"),
  mounted: ambiguous.includes("2 Drive card(s)"),
})
=> {"duplicate":true,"bothPaths":true,"unreadable":true,"mounted":true}
```

```ts cleanup
await box.cleanup();
```

## Drive IDs come from parsed YAML, not a line match

A quoted or commented `drive.id` is ordinary YAML. Reading it with a regex
yields a *wrong* ID — worse than none, because a wrong tombstone ID lets folder
discovery recreate a deleted card. Unparseable frontmatter reads as no ID.

```ts
const box = await newBox();
await box.seed("_content/drive/Quoted.gsheet.card", "---\ndrive:\n  id: 'sheet-quoted'\ntitle: Quoted\n---\n");
await box.seed("_content/drive/Commented.gsheet.card", "---\ndrive:\n  id: sheet-commented # mounted by hand\ntitle: Commented\n---\n");
await box.seed("_content/drive/Broken.gsheet.card", "---\ndrive:\n  id: [unclosed\n---\n");
await box.seed("_content/drive/Legacy.gsheet.card", '<gsheet drive-id="legacy-id"><title>Legacy</title></gsheet>\n');

const tracking = await findDriveCardTracking(box.root);
JSON.stringify({
  ids: tracking.liveCards.map((card) => card.driveId),
  unreadable: tracking.unreadable,
})
=> {"ids":["sheet-commented","legacy-id","sheet-quoted"],"unreadable":["_content/drive/Broken.gsheet.card"]}
```

```ts cleanup
await box.cleanup();
```

## Duplicate drive.id — neither working copy is pushed

Two live cards for one Drive file share a single transient-hash entry while
their attachments are per-card. Syncing either one would push its own copy over
the other's, so the connector syncs neither and reports the ambiguity.

```ts
const box = await newBox();
const fixture = sheetFixture({ id: "sheet-dup", name: "Shared" });
await box.seed("_content/drive/Alpha.gsheet.card", fixture.card);
box.commitAll("mount alpha");

const drive = fakeDrive([fixture]);
const connector = createGoogleDriveConnector(box.root, drive);
const first = await connector.sync();
JSON.stringify({
  success: first.success,
  attach: (await box.list()).includes("_content/drive/Alpha.attach/Sheet1.json"),
})
=> {"success":true,"attach":true}
```

A second card claiming the same `drive.id` appears (a copy, a restore, a
rename gone wrong). Alpha's attachment is edited locally — the exact case that
used to push Beta's stale copy back over it.

```ts continue
await box.seed("_content/drive/Beta.gsheet.card", fixture.card);
// Beta's own attach copy is the stale data that used to get pushed back over
// Alpha's edit, because both share one transient-hash entry.
await box.seed("_content/drive/Beta.attach/Sheet1.json", '[\n["Name"],\n["Alice stale"]\n]\n');
await box.seed("_content/drive/Alpha.attach/Sheet1.json", '[\n["Name"],\n["Alice edited"]\n]\n');

const ambiguous = await connector.sync();
JSON.stringify({
  success: ambiguous.success,
  error: ambiguous.error,
  pushed: ambiguous.pushed ?? [],
  updates: drive.updateLog.length,
})
=> {"success":false,"error":"Duplicate drive.id sheet-dup claimed by _content/drive/Alpha.gsheet.card, _content/drive/Beta.gsheet.card — both skipped","pushed":[],"updates":0}
```

Nothing reached Google — the remote spreadsheet still holds its original rows.

```ts continue
print(drive.describe());
=> files:
  sheet-dup "Shared" application/vnd.google-apps.spreadsheet modified=2026-03-29T10:00:00Z
spreadsheets:
  sheet-dup "Shared"
    Sheet1: [["Name"],["Alice"]]
documents:
updateLog (0):
contentUpdateLog (0):
```

Removing the duplicate makes the surviving card syncable again, and the local
edit then pushes.

```ts continue
await rm(join(box.root, "_content/drive/Beta.gsheet.card"));
await rm(join(box.root, "_content/drive/Beta.attach"), { recursive: true });
const resolved = await connector.sync();
JSON.stringify({
  success: resolved.success,
  pushed: resolved.pushed ?? [],
  remote: drive.spreadsheets.get("sheet-dup")?.sheets.get("Sheet1"),
})
=> {"success":true,"pushed":["_content/drive/Alpha.attach/Sheet1.json"],"remote":[["Name"],["Alice edited"]]}
```

```ts cleanup
await box.cleanup();
```

## Folder discovery — a safe-name collision is reported, not skipped

Two remote children can derive the same local card name. The occupant is
compared by Drive ID: a different ID is a real collision, and the run fails
rather than leaving the remote child untracked forever.

```ts
const box = await newBox();
await box.seed(
  "_content/drive/folder/Folder.gfolder.card",
  createGfolderTemplate({ driveId: "folder-1" }),
);

const occupant = sheetFixture({ id: "sheet-occupant", name: "Shared Name" });
const newcomer = sheetFixture({
  id: "sheet-newcomer",
  name: "Shared Name",
  parent: "folder-1",
});
await box.seed("_content/drive/folder/Shared_Name.gsheet.card", occupant.card);
box.commitAll("mount folder");

const drive = fakeDrive([occupant, newcomer], { folders: [folderFixture({ id: "folder-1", name: "Folder" })] });
const connector = createGoogleDriveConnector(box.root, drive);
const result = await connector.sync();
const cards = (await box.list()).split("\n").filter((p) => p.endsWith(".gsheet.card"));
JSON.stringify({ success: result.success, error: result.error, cards })
=> {"success":false,"error":"Drive file sheet-newcomer (\"Shared Name\") maps to _content/drive/folder/Shared_Name.gsheet.card, already claimed by drive.id sheet-occupant","cards":["_content/drive/folder/Shared_Name.gsheet.card"]}
```

The same Drive ID at that path is a benign re-mount, not a collision. That is
what a concurrent `bbx drive add` looks like: the card appears after discovery
took its snapshot, so the path is occupied by the very file being discovered.

```ts continue
const raced = sheetFixture({ id: "sheet-raced", name: "Raced Child", parent: "folder-1" });
drive.files.push(raced.file);
drive.spreadsheets.set(raced.file.id, raced.spreadsheet);
const racing = {
  ...drive,
  async listFiles(folderId: string) {
    // Stand in for `bbx drive add` landing between the card scan and this
    // folder pass: the card exists on disk but was not in the snapshot.
    await box.seed("_content/drive/folder/Raced_Child.gsheet.card", raced.card);
    return drive.listFiles(folderId);
  },
};
const racedConnector = createGoogleDriveConnector(box.root, racing);
const third = await racedConnector.sync();
JSON.stringify({
  error: third.error,
  cards: (await box.list()).split("\n").filter((p) => p.endsWith(".gsheet.card")),
})
=> {"error":"Drive file sheet-newcomer (\"Shared Name\") maps to _content/drive/folder/Shared_Name.gsheet.card, already claimed by drive.id sheet-occupant","cards":["_content/drive/folder/Raced_Child.gsheet.card","_content/drive/folder/Shared_Name.gsheet.card"]}
```

```ts cleanup
await box.cleanup();
```

## Folder discovery — an unreadable card blocks rediscovery

A trash tombstone whose `drive.id` cannot be read is exactly the card that
suppresses a folder child. Discovery cannot tell it apart from an unrelated
broken card, so the folder pass does not run at all while one exists — no
Drive request, no recreated card, and the failure names the path.

```ts
const { box, initial, liveCard, calls, connector } = await syncedFolderChild("sheet-folder-unreadable");
JSON.stringify({ success: initial.success, created: initial.created.includes(liveCard) })
=> {"success":true,"created":true}
```

Trash the card, then corrupt the tombstone so its retained Drive ID is
unreadable.

```ts continue
await moveCardsToTrash(createCliContext(box.root), [liveCard]);
await box.seed("_bookkeeping/trash/Folder_Child.gsheet.card", "---\ntitle: Folder Child\n---\n");
calls.getFile = 0;
const blocked = await connector.sync();
JSON.stringify({
  success: blocked.success,
  error: blocked.error,
  getFileCalls: calls.getFile,
  created: blocked.created.length,
  liveCardExists: (await box.list()).includes(liveCard),
})
=> {"success":false,"error":"Unreadable Drive card(s), folder discovery skipped: _bookkeeping/trash/Folder_Child.gsheet.card","getFileCalls":0,"created":0,"liveCardExists":false}
```

```ts cleanup
await box.cleanup();
```
