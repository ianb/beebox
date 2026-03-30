# Google Drive Connector

Tests for the Google Drive connector using fake services.

```ts setup
import { join } from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { initBox } from "../src/core/box.js";
import { createFakeGoogleDrive } from "../src/services/google-drive.js";
import { createFakeGoogleAuth } from "../src/services/google-auth.js";
import { createGoogleDriveConnector } from "../src/connectors/google-drive.js";
import type { FakeSpreadsheet } from "../src/services/google-drive.js";
```

## Pull — creates card and CSV files from a spreadsheet

```
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
const { createDriveSheetTemplate } = await import("../src/schemas/drive-sheet.js");
const cardContent = createDriveSheetTemplate({
  driveId: "sheet-abc123",
  title: "Test Budget",
  modified: "2026-03-29T10:00:00Z",
  link: "https://docs.google.com/spreadsheets/d/sheet-abc123/edit",
  owner: "test@example.com",
  sheets: [{ file: "Budget/Sheet1.csv", title: "Sheet1", gid: "0" }],
});
await box.seed("store/drive/Budget.drive-sheet.card", cardContent);
await box.seed("store/drive/Budget/Sheet1.csv", "Name,Age\nAlice,30\n");
box.commitAll("add drive sheet");

const connector = createGoogleDriveConnector(box.root, drive);
const result = await connector.sync();
result.success
=> true
```

The card file contains the spreadsheet metadata:

``` continue
const card = await box.read("store/drive/Budget.drive-sheet.card");
card.includes('drive-id="sheet-abc123"')
=> true

card.includes("<title>Test Budget</title>")
=> true
```

## Pull with remote change — updates CSV

When the remote spreadsheet changes, the CSV is updated:

```
const box2 = await makeTmpBox({ git: true });
await initBox(box2.root);
box2.commitAll("init box");

const sheets2 = new Map([["Sheet1", [["Name", "Age"], ["Alice", "30"]]]]);
const ss2 = {
  metadata: {
    spreadsheetId: "sheet-def456",
    properties: { title: "Contacts" },
    sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }],
  },
  sheets: sheets2,
};

const drive2 = createFakeGoogleDrive({
  files: [{
    id: "sheet-def456",
    name: "Contacts",
    mimeType: "application/vnd.google-apps.spreadsheet",
    modifiedTime: "2026-03-29T10:00:00Z",
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/spreadsheets/d/sheet-def456/edit",
  }],
  spreadsheets: new Map([["sheet-def456", ss2]]),
});

// Initial sync
const { createDriveSheetTemplate: tpl2 } = await import("../src/schemas/drive-sheet.js");
await box2.seed("store/drive/Contacts.drive-sheet.card", tpl2({
  driveId: "sheet-def456",
  title: "Contacts",
  modified: "2026-03-29T10:00:00Z",
  link: "https://docs.google.com/spreadsheets/d/sheet-def456/edit",
  owner: "test@example.com",
  sheets: [{ file: "Contacts/Sheet1.csv", title: "Sheet1", gid: "0" }],
}));
await box2.seed("store/drive/Contacts/Sheet1.csv", "Name,Age\nAlice,30\n");
box2.commitAll("add contacts");

const conn2 = createGoogleDriveConnector(box2.root, drive2);
await conn2.sync();

// Now change the remote data
sheets2.set("Sheet1", [["Name", "Age"], ["Alice", "31"], ["Bob", "25"]]);

const result2 = await conn2.sync();
result2.success
=> true

const csv = await box2.read("store/drive/Contacts/Sheet1.csv");
csv.includes("Alice,31")
=> true

csv.includes("Bob,25")
=> true
```

## Push — detects local CSV edit, pushes to Drive

When a user edits a CSV locally, the connector pushes changes back:

```
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

const { createDriveSheetTemplate: tpl3 } = await import("../src/schemas/drive-sheet.js");
await box3.seed("store/drive/Expenses.drive-sheet.card", tpl3({
  driveId: "sheet-push1",
  title: "Expenses",
  modified: "2026-03-29T10:00:00Z",
  link: "https://docs.google.com/spreadsheets/d/sheet-push1/edit",
  owner: "test@example.com",
  sheets: [{ file: "Expenses/Sheet1.csv", title: "Sheet1", gid: "0" }],
}));
await box3.seed("store/drive/Expenses/Sheet1.csv", "Item,Cost\nCoffee,5\n");
box3.commitAll("add expenses");

const conn3 = createGoogleDriveConnector(box3.root, drive3);
await conn3.sync();

// Edit the CSV locally
await box3.seed("store/drive/Expenses/Sheet1.csv", "Item,Cost\nCoffee,6\nTea,3\n");
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

Spreadsheets with multiple sheet tabs get separate CSV files:

```
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

const { createDriveSheetTemplate: tpl4 } = await import("../src/schemas/drive-sheet.js");
await box4.seed("store/drive/Multi.drive-sheet.card", tpl4({
  driveId: "sheet-multi",
  title: "Multi",
  modified: "2026-03-29T10:00:00Z",
  link: "https://docs.google.com/spreadsheets/d/sheet-multi/edit",
  owner: "test@example.com",
  sheets: [
    { file: "Multi/Summary.csv", title: "Summary", gid: "0" },
    { file: "Multi/Expenses.csv", title: "Expenses", gid: "1" },
  ],
}));
await box4.seed("store/drive/Multi/Summary.csv", '"Total","=SUM(Expenses!B:B)"\n');
await box4.seed("store/drive/Multi/Expenses.csv", "Item,Cost\nCoffee,5\n");
box4.commitAll("add multi");

const conn4 = createGoogleDriveConnector(box4.root, drive4);
const result4 = await conn4.sync();
result4.success
=> true

const files = await readdir(join(box4.root, "store/drive/Multi"));
files.sort();
files
=> [
  "Expenses.csv",
  "Summary.csv"
]
```
