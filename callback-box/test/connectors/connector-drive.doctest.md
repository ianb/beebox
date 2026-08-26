# Google Drive Connector

Tests for the Google Drive connector using fake services.

```ts setup
import { join } from "node:path";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { createFakeGoogleDrive } from "../../src/services/google-drive.js";
import { createFakeGoogleAuth } from "../../src/services/google-auth.js";
import { createGoogleDriveConnector } from "../../src/connectors/google-drive.js";
import { moveCardsToTrash } from "../../src/core/commands/trash.js";
import { createCliContext } from "../../src/core/commands/index.js";
import { createGsheetTemplate } from "../../src/schemas/gsheet.js";
import { createGdocTemplate } from "../../src/schemas/gdoc.js";
import { runDriveStatus } from "../../src/cli/commands/drive.js";
import { findDriveCardTracking } from "../../src/connectors/google-drive-tracking.js";
import type { FakeSpreadsheet } from "../../src/services/google-drive.js";

function sheetFixture(opts: { id: string; name: string; parent?: string }): {
  file: {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    trashed: boolean;
    owners: Array<{ emailAddress: string }>;
    parents?: string[];
    webViewLink: string;
  };
  spreadsheet: FakeSpreadsheet;
  card: string;
} {
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
      sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }],
    },
    sheets: new Map([["Sheet1", [["Name"], ["Alice"]]]]),
  };
  const card = createGsheetTemplate({
    driveId: opts.id,
    title: opts.name,
    modified: file.modifiedTime,
    link: file.webViewLink,
    owner: "test@example.com",
    sheets: [{ ref: "attach/Sheet1.json", title: "Sheet1", gid: "0" }],
  });
  return { file, spreadsheet, card };
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

## Pull — creates card and JSON files from a spreadsheet

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const sheets = new Map([["Sheet1", [["Name", "Age"], ["Alice", "30"]]]]);
const spreadsheet = {
  metadata: {
    spreadsheetId: "sheet-abc123",
    properties: { title: "Test Budget" },
    sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }],
  },
  sheets,
};

const drive = createFakeGoogleDrive({
  files: [{
    id: "sheet-abc123",
    name: "Test Budget",
    mimeType: "application/vnd.google-apps.spreadsheet",
    modifiedTime: "2026-03-29T10:00:00Z",
    trashed: false,
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/spreadsheets/d/sheet-abc123/edit",
  }],
  spreadsheets: new Map([["sheet-abc123", spreadsheet]]),
});

// Create the card manually first (simulating cb drive add)
const { createGsheetTemplate } = await import("../../src/schemas/gsheet.js");
const cardContent = createGsheetTemplate({
  driveId: "sheet-abc123",
  title: "Test Budget",
  modified: "2026-03-29T10:00:00Z",
  link: "https://docs.google.com/spreadsheets/d/sheet-abc123/edit",
  owner: "test@example.com",
  sheets: [{ ref: "Budget/Sheet1.json", title: "Sheet1", gid: "0" }],
});
await box.seed("store/drive/Budget.gsheet.card", cardContent);
await box.seed("store/drive/Budget/Sheet1.json", '[\n["Name","Age"],\n["Alice","30"]\n]\n');
box.commitAll("add drive sheet");

const connector = createGoogleDriveConnector(box.root, drive);
const result = await connector.sync();
result.success
=> true
```

The card file contains the spreadsheet metadata:

```ts continue
const card = await box.read("store/drive/Budget.gsheet.card");
card.includes("drive-id: sheet-abc123")
=> true

card.includes("title: Test Budget")
=> true
```

## Push — detects local JSON edit, pushes to Drive

When a user edits a JSON file locally, the connector pushes changes back:

```ts
const box3 = await makeTmpBox({ git: true });
await initBox(box3.root);
box3.commitAll("init box");

const sheets3 = new Map([["Sheet1", [["Item", "Cost"], ["Coffee", "5"]]]]);
const ss3 = {
  metadata: {
    spreadsheetId: "sheet-push1",
    properties: { title: "Expenses" },
    sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }],
  },
  sheets: sheets3,
};

const drive3 = createFakeGoogleDrive({
  files: [{
    id: "sheet-push1",
    name: "Expenses",
    mimeType: "application/vnd.google-apps.spreadsheet",
    modifiedTime: "2026-03-29T10:00:00Z",
    trashed: false,
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/spreadsheets/d/sheet-push1/edit",
  }],
  spreadsheets: new Map([["sheet-push1", ss3]]),
});

const { createGsheetTemplate: tpl3 } = await import("../../src/schemas/gsheet.js");
await box3.seed("store/drive/Expenses.gsheet.card", tpl3({
  driveId: "sheet-push1",
  title: "Expenses",
  modified: "2026-03-29T10:00:00Z",
  link: "https://docs.google.com/spreadsheets/d/sheet-push1/edit",
  owner: "test@example.com",
  sheets: [{ ref: "Sheet1.json", title: "Sheet1", gid: "0" }],
}));
await box3.seed("store/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","5"]\n]\n');
box3.commitAll("add expenses");

const conn3 = createGoogleDriveConnector(box3.root, drive3);
await conn3.sync();

// Edit the JSON locally — change Coffee price and add Tea
await box3.seed("store/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","6"],\n["Tea","3"]\n]\n');
box3.commitAll("edit expenses");

const result3 = await conn3.sync();
result3.success
=> true

// Verify push happened
drive3.updateLog.length
=> 1

drive3.updateLog[0]?.sheetTitle
=> Sheet1

// Verify the pushed values
drive3.updateLog[0]?.values[1]?.[1]
=> 6
```

## Multiple tabs

Spreadsheets with multiple sheet tabs get separate JSON files:

```ts
const box4 = await makeTmpBox({ git: true });
await initBox(box4.root);
box4.commitAll("init box");

const sheets4 = new Map([
  ["Summary", [["Total", "=SUM(Expenses!B:B)"]]],
  ["Expenses", [["Item", "Cost"], ["Coffee", "5"]]],
]);
const ss4 = {
  metadata: {
    spreadsheetId: "sheet-multi",
    properties: { title: "Multi" },
    sheets: [
      { properties: { sheetId: 0, title: "Summary" } },
      { properties: { sheetId: 1, title: "Expenses" } },
    ],
  },
  sheets: sheets4,
};

const drive4 = createFakeGoogleDrive({
  files: [{
    id: "sheet-multi",
    name: "Multi",
    mimeType: "application/vnd.google-apps.spreadsheet",
    modifiedTime: "2026-03-29T10:00:00Z",
    trashed: false,
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/spreadsheets/d/sheet-multi/edit",
  }],
  spreadsheets: new Map([["sheet-multi", ss4]]),
});

const { createGsheetTemplate: tpl4 } = await import("../../src/schemas/gsheet.js");
await box4.seed("store/drive/Multi.gsheet.card", tpl4({
  driveId: "sheet-multi",
  title: "Multi",
  modified: "2026-03-29T10:00:00Z",
  link: "https://docs.google.com/spreadsheets/d/sheet-multi/edit",
  owner: "test@example.com",
  sheets: [
    { ref: "Multi/Summary.json", title: "Summary", gid: "0" },
    { ref: "Multi/Expenses.json", title: "Expenses", gid: "1" },
  ],
}));
await box4.seed("store/drive/Multi/Summary.json", '[\n["Total","=SUM(Expenses!B:B)"]\n]\n');
await box4.seed("store/drive/Multi/Expenses.json", '[\n["Item","Cost"],\n["Coffee","5"]\n]\n');
box4.commitAll("add multi");

const conn4 = createGoogleDriveConnector(box4.root, drive4);
const result4 = await conn4.sync();
result4.success
=> true

const files = await readdir(join(box4.root, "store/drive/Multi"));
files.sort();
files
=> [
  "Expenses.json",
  "Summary.json"
]
```

## Comments — captured as a sidecar in the attach scope

A spreadsheet with comments gets a `{basename}.comments.json` sidecar
(written into the card's `.attach/` scope) and a `comments.ref:` field on
the card. The fake serves comments off a registered document keyed by the
same file id.

```ts
const box5 = await makeTmpBox({ git: true });
await initBox(box5.root);
box5.commitAll("init box");

const sheets5 = new Map([["Sheet1", [["Name"], ["Alice"]]]]);
const ss5 = {
  metadata: {
    spreadsheetId: "sheet-comm",
    properties: { title: "Reviewed" },
    sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }],
  },
  sheets: sheets5,
};

const drive5 = createFakeGoogleDrive({
  files: [{
    id: "sheet-comm",
    name: "Reviewed",
    mimeType: "application/vnd.google-apps.spreadsheet",
    modifiedTime: "2026-03-29T10:00:00Z",
    trashed: false,
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/spreadsheets/d/sheet-comm/edit",
  }],
  spreadsheets: new Map([["sheet-comm", ss5]]),
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

const { createGsheetTemplate: tpl5 } = await import("../../src/schemas/gsheet.js");
await box5.seed("store/drive/Reviewed.gsheet.card", tpl5({
  driveId: "sheet-comm",
  title: "Reviewed",
  modified: "2026-03-29T10:00:00Z",
  link: "https://docs.google.com/spreadsheets/d/sheet-comm/edit",
  owner: "test@example.com",
  sheets: [{ ref: "attach/Sheet1.json", title: "Sheet1", gid: "0" }],
}));
box5.commitAll("add reviewed sheet");

const result5 = await createGoogleDriveConnector(box5.root, drive5).sync();
result5.success
=> true

const card5 = await box5.read("store/drive/Reviewed.gsheet.card");
card5.includes("ref: attach/Reviewed.comments.json")
=> true

const sidecar5 = JSON.parse(await box5.read("store/drive/Reviewed.attach/Reviewed.comments.json"));
sidecar5[0]?.content
=> Should this be Bob?

sidecar5[0]?.author?.displayName
=> Reviewer
```

## Trashing a card stops sync, and restoring it resumes

`cb rm` moves both the card and its attachment scope into `store/trash`. The
trash copy remains the durable record of the Drive ID, but it is not part of
the active sync working set.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const fixture = sheetFixture({ id: "sheet-trash", name: "Trash Me" });
await box.seed("store/drive/Trash-Me.gsheet.card", fixture.card);
await box.seed("store/drive/Trash-Me.attach/Sheet1.json", '[["Name"],["Alice"]]\n');
box.commitAll("add drive card");

const inner = createFakeGoogleDrive({
  files: [fixture.file],
  spreadsheets: new Map([[fixture.file.id, fixture.spreadsheet]]),
});
let getFileCalls = 0;
const drive = {
  ...inner,
  async getFile(fileId: string) {
    getFileCalls += 1;
    return inner.getFile(fileId);
  },
};
const connector = createGoogleDriveConnector(box.root, drive);
await connector.sync();
getFileCalls
=> 1
```

After the real trash move, another sync makes no request for that Drive file.

```ts continue
const receipt = await moveCardsToTrash(
  createCliContext(box.root),
  ["store/drive/Trash-Me.gsheet.card"],
);
getFileCalls = 0;
const trashed = await connector.sync();
JSON.stringify({
  getFileCalls,
  changed: trashed.created.length + trashed.updated.length + (trashed.pushed?.length ?? 0),
  trashPath: receipt.moves[0]?.destPath,
})
=> {"getFileCalls":0,"changed":0,"trashPath":"store/trash/Trash-Me.gsheet.card"}
```

Restoring the exact card and attachment paths makes it live again.

```ts continue
for (const move of receipt.moves[0]?.fileMoves ?? []) {
  await rename(join(box.root, move.destPath), join(box.root, move.sourcePath));
}
getFileCalls = 0;
await connector.sync();
getFileCalls
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
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/google-drive.json", JSON.stringify({
  folders: [{ driveFolderId: "folder-1", localPath: "store/drive/folder" }],
}, null, 2));
const fixture = sheetFixture({
  id: "sheet-folder-trash",
  name: "Folder Child",
  parent: "folder-1",
});
box.commitAll("mount folder");

const inner = createFakeGoogleDrive({
  files: [fixture.file],
  spreadsheets: new Map([[fixture.file.id, fixture.spreadsheet]]),
});
let getFileCalls = 0;
const drive = {
  ...inner,
  async getFile(fileId: string) {
    getFileCalls += 1;
    return inner.getFile(fileId);
  },
};
const connector = createGoogleDriveConnector(box.root, drive);
const initial = await connector.sync();
const liveCard = "store/drive/folder/Folder_Child.gsheet.card";
const liveSheet = "store/drive/folder/Folder_Child.attach/Sheet1.json";
JSON.stringify({
  created: initial.created.includes(liveCard),
  attachment: (await box.list()).includes(liveSheet),
})
=> {"created":true,"attachment":true}
```

Trash the previously synced card, so the connector retains both real transient
hashes and a durable tombstone. It must neither sync nor rediscover the child.

```ts continue
const receipt = await moveCardsToTrash(
  createCliContext(box.root),
  [liveCard],
);
getFileCalls = 0;
const trashed = await connector.sync();
const retainedState = JSON.parse(
  await box.read("config/connectors/google-drive.state.json"),
) as { files?: Record<string, { contentHashes?: Record<string, string> }> };
JSON.stringify({
  getFileCalls,
  created: trashed.created.length,
  liveCardExists: (await box.list()).includes(liveCard),
  retainedHash: retainedState.files?.[fixture.file.id]?.contentHashes?.["Sheet1.json"] !== undefined,
})
=> {"getFileCalls":0,"created":0,"liveCardExists":false,"retainedHash":true}
```

Hard-deleting the complete tombstone allows the still-mounted folder to
recreate both the card and its attachment data, despite retained transient
hashes from the original mount.

```ts continue
for (const move of receipt.moves[0]?.fileMoves ?? []) {
  await rm(join(box.root, move.destPath), { recursive: true, force: true });
}
getFileCalls = 0;
const rediscovered = await connector.sync();
JSON.stringify({
  getFileCalls,
  createdCard: rediscovered.created.includes(liveCard),
  createdAttachment: rediscovered.created.includes(liveSheet),
  attachmentExists: (await box.list()).includes(liveSheet),
})
=> {"getFileCalls":1,"createdCard":true,"createdAttachment":true,"attachmentExists":true}
```

```ts cleanup
await box.cleanup();
```

## Drive status shares the live-card scan and YAML ID parser

Status reports live YAML and legacy cards, but it does not report a tombstone
as a mounted file.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const yamlFixture = sheetFixture({ id: "yaml-id", name: "YAML Card" });
await box.seed("store/drive/Yaml.gsheet.card", yamlFixture.card);
await box.seed("store/drive/Legacy.gsheet.card", '<gsheet drive-id="legacy-id"><title>Legacy</title><modified>2026-03-01T00:00:00Z</modified><sheet-tab title="Old Tab" gid="0"/></gsheet>\n');
await box.seed("store/trash/Hidden.gsheet.card", createGsheetTemplate({
  driveId: "trash-id",
  title: "Hidden",
  modified: "2026-03-29T10:00:00Z",
  link: "https://example.test/hidden",
  owner: "test@example.com",
  sheets: [],
}));

const output = await captureLogs(() => runDriveStatus(box.root));
JSON.stringify({
  count: output.includes("2 mounted file(s)"),
  yamlId: output.includes("Drive ID: yaml-id"),
  legacyId: output.includes("Drive ID: legacy-id"),
  trash: output.includes("trash-id") || output.includes("store/trash"),
})
=> {"count":true,"yamlId":true,"legacyId":true,"trash":false}
```

The health fields come from the current YAML form, not just the legacy XML
form: title, last-synced time, a non-`synced` status, sheet tabs, and the
lossy summary all print.

```ts continue
const conflicted = createGdocTemplate({
  driveId: "doc-id",
  title: "Contended Doc",
  modified: "2026-04-26T12:00:00Z",
  link: "https://docs.google.com/document/d/doc-id/edit",
  owner: "test@example.com",
  contentFile: "Contended.md",
  status: "conflict",
  lossy: [{ type: "images", count: 2 }, { type: "footnotes", count: 1 }],
});
await box.seed("store/drive/Contended.gdoc.card", conflicted);

const health = await captureLogs(() => runDriveStatus(box.root));
JSON.stringify({
  yamlTitle: health.includes("Title: YAML Card"),
  yamlSynced: health.includes("Last synced: 2026-03-29T10:00:00Z"),
  yamlTabs: health.includes("Tabs: Sheet1"),
  yamlStatusHidden: !health.includes("Status: synced"),
  docTitle: health.includes("Title: Contended Doc"),
  docStatus: health.includes("Status: conflict"),
  docLossy: health.includes("Lossy: images=2, footnotes=1"),
  legacyTabs: health.includes("Tabs: Old Tab"),
})
=> {"yamlTitle":true,"yamlSynced":true,"yamlTabs":true,"yamlStatusHidden":true,"docTitle":true,"docStatus":true,"docLossy":true,"legacyTabs":true}
```

Cards with an ambiguous identity are listed too — they are not synced, so a
silent omission would read as "not mounted".

```ts continue
await box.seed("store/drive/Yaml-Copy.gsheet.card", yamlFixture.card);
await box.seed("store/drive/Broken.gsheet.card", "---\ntitle: No identity\n---\n");

const ambiguous = await captureLogs(() => runDriveStatus(box.root));
JSON.stringify({
  duplicate: ambiguous.includes("Duplicate drive-id yaml-id"),
  bothPaths: ambiguous.includes("store/drive/Yaml.gsheet.card")
    && ambiguous.includes("store/drive/Yaml-Copy.gsheet.card"),
  unreadable: ambiguous.includes("No readable drive-id: store/drive/Broken.gsheet.card"),
  mounted: ambiguous.includes("2 mounted file(s)"),
})
=> {"duplicate":true,"bothPaths":true,"unreadable":true,"mounted":true}
```

```ts cleanup
await box.cleanup();
```

## Drive IDs come from parsed YAML, not a line match

A quoted or commented `drive-id` is ordinary YAML. Reading it with a regex
yields a *wrong* ID — worse than none, because a wrong tombstone ID lets folder
discovery recreate a deleted card. Unparseable frontmatter reads as no ID.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("store/drive/Quoted.gsheet.card", "---\ndrive-id: 'sheet-quoted'\nstatus: synced\ntitle: Quoted\n---\n");
await box.seed("store/drive/Commented.gsheet.card", "---\ndrive-id: sheet-commented # mounted by hand\ntitle: Commented\n---\n");
await box.seed("store/drive/Broken.gsheet.card", "---\ndrive-id: [unclosed\n---\n");
await box.seed("store/drive/Legacy.gsheet.card", '<gsheet drive-id="legacy-id"><title>Legacy</title></gsheet>\n');

const tracking = await findDriveCardTracking(box.root);
JSON.stringify({
  ids: tracking.liveCards.map((card) => card.driveId),
  unreadable: tracking.unreadable,
})
=> {"ids":["sheet-commented","legacy-id","sheet-quoted"],"unreadable":["store/drive/Broken.gsheet.card"]}
```

```ts cleanup
await box.cleanup();
```

## Duplicate drive-id — neither working copy is pushed

Two live cards for one Drive file share a single transient-hash entry while
their attachments are per-card. Syncing either one would push its own copy over
the other's, so the connector syncs neither and reports the ambiguity.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const fixture = sheetFixture({ id: "sheet-dup", name: "Shared" });
await box.seed("store/drive/Alpha.gsheet.card", fixture.card);
box.commitAll("mount alpha");

const drive = createFakeGoogleDrive({
  files: [fixture.file],
  spreadsheets: new Map([[fixture.file.id, fixture.spreadsheet]]),
});
const connector = createGoogleDriveConnector(box.root, drive);
const first = await connector.sync();
JSON.stringify({
  success: first.success,
  attach: (await box.list()).includes("store/drive/Alpha.attach/Sheet1.json"),
})
=> {"success":true,"attach":true}
```

A second card claiming the same `drive-id` appears (a copy, a restore, a
rename gone wrong). Alpha's attachment is edited locally — the exact case that
used to push Beta's stale copy back over it.

```ts continue
await box.seed("store/drive/Beta.gsheet.card", fixture.card);
// Beta's own attach copy is the stale data that used to get pushed back over
// Alpha's edit, because both share one transient-hash entry.
await box.seed("store/drive/Beta.attach/Sheet1.json", '[\n["Name"],\n["Alice stale"]\n]\n');
await box.seed("store/drive/Alpha.attach/Sheet1.json", '[\n["Name"],\n["Alice edited"]\n]\n');

const ambiguous = await connector.sync();
JSON.stringify({
  success: ambiguous.success,
  error: ambiguous.error,
  pushed: ambiguous.pushed ?? [],
  updates: drive.updateLog.length,
})
=> {"success":false,"error":"Duplicate drive-id sheet-dup claimed by store/drive/Alpha.gsheet.card, store/drive/Beta.gsheet.card — both skipped","pushed":[],"updates":0}
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
await rm(join(box.root, "store/drive/Beta.gsheet.card"));
await rm(join(box.root, "store/drive/Beta.attach"), { recursive: true });
const resolved = await connector.sync();
JSON.stringify({
  success: resolved.success,
  pushed: resolved.pushed ?? [],
  remote: drive.spreadsheets.get("sheet-dup")?.sheets.get("Sheet1"),
})
=> {"success":true,"pushed":["store/drive/Alpha.attach/Sheet1.json"],"remote":[["Name"],["Alice edited"]]}
```

```ts cleanup
await box.cleanup();
```

## Folder discovery — a safe-name collision is reported, not skipped

Two remote children can derive the same local card name. The occupant is
compared by Drive ID: a different ID is a real collision, and the run fails
rather than leaving the remote child untracked forever.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/google-drive.json", JSON.stringify({
  folders: [{ driveFolderId: "folder-1", localPath: "store/drive/folder" }],
}, null, 2));

const occupant = sheetFixture({ id: "sheet-occupant", name: "Shared Name" });
const newcomer = sheetFixture({
  id: "sheet-newcomer",
  name: "Shared Name",
  parent: "folder-1",
});
await box.seed("store/drive/folder/Shared_Name.gsheet.card", occupant.card);
box.commitAll("mount folder");

const drive = createFakeGoogleDrive({
  files: [occupant.file, newcomer.file],
  spreadsheets: new Map([
    [occupant.file.id, occupant.spreadsheet],
    [newcomer.file.id, newcomer.spreadsheet],
  ]),
});
const connector = createGoogleDriveConnector(box.root, drive);
const result = await connector.sync();
const cards = (await box.list()).split("\n").filter((p) => p.endsWith(".gsheet.card"));
JSON.stringify({ success: result.success, error: result.error, cards })
=> {"success":false,"error":"Drive file sheet-newcomer (\"Shared Name\") maps to store/drive/folder/Shared_Name.gsheet.card, already claimed by drive-id sheet-occupant","cards":["store/drive/folder/Shared_Name.gsheet.card"]}
```

The same Drive ID at that path is a benign re-mount, not a collision. That is
what a concurrent `cb drive add` looks like: the card appears after discovery
took its snapshot, so the path is occupied by the very file being discovered.

```ts continue
const raced = sheetFixture({ id: "sheet-raced", name: "Raced Child", parent: "folder-1" });
drive.files.push(raced.file);
drive.spreadsheets.set(raced.file.id, raced.spreadsheet);
const racing = {
  ...drive,
  async listFiles(folderId: string) {
    // Stand in for `cb drive add` landing between the card scan and this
    // folder pass: the card exists on disk but was not in the snapshot.
    await box.seed("store/drive/folder/Raced_Child.gsheet.card", raced.card);
    return drive.listFiles(folderId);
  },
};
const racedConnector = createGoogleDriveConnector(box.root, racing);
const third = await racedConnector.sync();
JSON.stringify({
  error: third.error,
  cards: (await box.list()).split("\n").filter((p) => p.endsWith(".gsheet.card")),
})
=> {"error":"Drive file sheet-newcomer (\"Shared Name\") maps to store/drive/folder/Shared_Name.gsheet.card, already claimed by drive-id sheet-occupant","cards":["store/drive/folder/Raced_Child.gsheet.card","store/drive/folder/Shared_Name.gsheet.card"]}
```

```ts cleanup
await box.cleanup();
```

## Folder discovery — an unreadable card blocks rediscovery

A trash tombstone whose `drive-id` cannot be read is exactly the card that
suppresses a folder child. Discovery cannot tell it apart from an unrelated
broken card, so the folder pass does not run at all while one exists — no
Drive request, no recreated card, and the failure names the path.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed("config/connectors/google-drive.json", JSON.stringify({
  folders: [{ driveFolderId: "folder-1", localPath: "store/drive/folder" }],
}, null, 2));
const fixture = sheetFixture({
  id: "sheet-folder-unreadable",
  name: "Folder Child",
  parent: "folder-1",
});
box.commitAll("mount folder");

const inner = createFakeGoogleDrive({
  files: [fixture.file],
  spreadsheets: new Map([[fixture.file.id, fixture.spreadsheet]]),
});
let getFileCalls = 0;
const drive = {
  ...inner,
  async getFile(fileId: string) {
    getFileCalls += 1;
    return inner.getFile(fileId);
  },
};
const connector = createGoogleDriveConnector(box.root, drive);
const initial = await connector.sync();
const liveCard = "store/drive/folder/Folder_Child.gsheet.card";
JSON.stringify({ success: initial.success, created: initial.created.includes(liveCard) })
=> {"success":true,"created":true}
```

Trash the card, then corrupt the tombstone so its retained Drive ID is
unreadable.

```ts continue
await moveCardsToTrash(createCliContext(box.root), [liveCard]);
await box.seed("store/trash/Folder_Child.gsheet.card", "---\ntitle: Folder Child\n---\n");
getFileCalls = 0;
const blocked = await connector.sync();
JSON.stringify({
  success: blocked.success,
  error: blocked.error,
  getFileCalls,
  created: blocked.created.length,
  liveCardExists: (await box.list()).includes(liveCard),
})
=> {"success":false,"error":"Unreadable Drive card(s), folder discovery skipped: store/trash/Folder_Child.gsheet.card","getFileCalls":0,"created":0,"liveCardExists":false}
```

```ts cleanup
await box.cleanup();
```
