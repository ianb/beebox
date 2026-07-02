# Google Drive Connector

Tests for the Google Drive connector using fake services.

```ts setup
import { join } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box.js";
import { createFakeGoogleDrive } from "../../src/services/google-drive.js";
import { createFakeGoogleAuth } from "../../src/services/google-auth.js";
import { createGoogleDriveConnector } from "../../src/connectors/google-drive.js";
import type { FakeSpreadsheet } from "../../src/services/google-drive.js";
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
