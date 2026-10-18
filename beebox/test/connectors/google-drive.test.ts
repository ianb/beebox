// # Google Drive Connector
//
// Tests for the Google Drive connector using fake services.

import { test } from "tap";
import "agent-doctest/tap";
import { join } from "node:path";
import { readdir, rename, rm } from "node:fs/promises";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { initBox } from "../../src/core/box/structure/core.js";
import { createFakeGoogleDrive } from "../../src/services/google-drive/core.js";
import type { FakeGoogleDriveOptions } from "../../src/services/google-drive/core.js";
import { createGoogleDriveConnector } from "../../src/connectors/google-drive/connector.js";
import { moveCardsToTrash } from "../../src/core/commands/trash/command.js";
import { createCliContext } from "../../src/core/command-runner.js";
import { createGsheetTemplate } from "../../src/schemas/gsheet.js";
import { createGfolderTemplate } from "../../src/schemas/gfolder.js";
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

// ## Pull, push, tabs and comments
//
// A synced spreadsheet card gets its Drive metadata in the card and one JSON file
// per tab. The local card starts stale (old title, older modified time) and has
// no tab file yet; a sync pulls the remote state.
void test("A synced spreadsheet card gets its Drive metadata in the card and one JSON fi...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L132
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

  // doctest:L145
  const result = await createGoogleDriveConnector(box.root, fakeDrive([fx])).sync();
  t.check(result.success, true);

  // The card now carries the remote spreadsheet metadata:

  // doctest:L153
  const card = await box.read("_content/drive/Budget.gsheet.card");
  t.check([card.includes("drive:\n  id: sheet-abc123"), card.includes("title: Test Budget"), card.includes("Old Budget")], [
    true,
    true,
    false,
  ]);

  // The tab file is created from the remote cell values:

  // doctest:L161
  await t.checkText(await box.read("_content/drive/Budget.attach/Sheet1.json"), `[
["Name","Age"],
["Alice",30]
]`);
});

// When a user edits a JSON file locally, the next sync pushes the changed values
// back, to the right tab:
void test("When a user edits a JSON file locally, the next sync pushes the changed value...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L176
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

  // doctest:L189
  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();

  // doctest:L192
  // Edit the JSON locally — change Coffee price and add Tea
  await box.seed("_content/drive/Expenses.attach/Sheet1.json", '[\n["Item","Cost"],\n["Coffee","6"],\n["Tea","3"]\n]\n');
  box.commitAll("edit expenses");

  // doctest:L196
  const result = await connector.sync();
  t.check(result.success, true);

  // doctest:L200
  await t.checkText(drive.updateLog.length, "1");

  // doctest:L203
  t.check(drive.updateLog[0]?.sheetTitle, "Sheet1");

  // doctest:L206
  await t.checkText(drive.updateLog[0]?.values[1]?.[1], "6");
});

// Spreadsheets with multiple sheet tabs get separate JSON files:
void test("Spreadsheets with multiple sheet tabs get separate JSON files:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L217
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

  // doctest:L233
  const result = await createGoogleDriveConnector(box.root, fakeDrive([fx])).sync();
  t.check(result.success, true);

  // doctest:L237
  const files = await readdir(join(box.root, "_content/drive/Multi"));
  files.sort();
  t.check(files, [
    "Expenses.json",
    "Summary.json",
  ]);
});

// ### Comments — captured as a sidecar in the attach scope
//
// A spreadsheet with comments gets a `{basename}.comments.json` sidecar
// (written into the card's `.attach/` scope) and a `comments.ref:` field on
// the card. The fake serves comments off a registered document keyed by the
// same file id.
void test("A spreadsheet with comments gets a {basename}.comments.json sidecar (written...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L258
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

  // doctest:L279
  const result = await createGoogleDriveConnector(box.root, drive).sync();
  t.check(result.success, true);

  // doctest:L283
  const card = await box.read("_content/drive/Reviewed.gsheet.card");
  await t.checkText(card.includes("ref: attach/Reviewed.comments.json"), "true");

  // doctest:L287
  const sidecar = JSON.parse(await box.read("_content/drive/Reviewed.attach/Reviewed.comments.json"));
  t.check(sidecar[0]?.content, "Should this be Bob?");

  // doctest:L291
  t.check(sidecar[0]?.author?.displayName, "Reviewer");
});

// ## Trashing a card stops sync, and restoring it resumes
//
// `bbx rm` moves both the card and its attachment scope into `_bookkeeping/trash`. The
// trash copy remains the durable record of the Drive ID, but it is not part of
// the active sync working set.
void test("bbx rm moves both the card and its attachment scope into bookkeeping/trash.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L306
  const box = await newBox();
  const fixture = sheetFixture({ id: "sheet-trash", name: "Trash Me" });
  await box.seed("_content/drive/Trash-Me.gsheet.card", fixture.card);
  await box.seed("_content/drive/Trash-Me.attach/Sheet1.json", '[["Name"],["Alice"]]\n');
  box.commitAll("add drive card");

  // doctest:L312
  const { drive, calls } = countGetFile(
    fakeDrive([fixture], { folders: [folderFixture({ id: "folder-1", name: "Folder" })] }),
  );
  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();
  t.check(calls.getFile, 1);

  // After the real trash move, another sync makes no request for that Drive file.

  // doctest:L324
  const receipt = await moveCardsToTrash(
    createCliContext(box.root),
    ["_content/drive/Trash-Me.gsheet.card"],
  );
  calls.getFile = 0;
  const trashed = await connector.sync();
  t.check(
    {
      getFileCalls: calls.getFile,
      changed: trashed.created.length + trashed.updated.length + (trashed.pushed?.length ?? 0),
      trashPath: receipt.moves[0]?.destPath,
    },
    {
    getFileCalls: 0,
    changed: 0,
    trashPath: "_bookkeeping/trash/Trash-Me.gsheet.card",
  },
  );

  // Restoring the exact card and attachment paths makes it live again.

  // doctest:L341
  for (const move of receipt.moves[0]?.fileMoves ?? []) {
    await rename(join(box.root, move.destPath), join(box.root, move.sourcePath));
  }
  calls.getFile = 0;
  await connector.sync();
  t.check(calls.getFile, 1);
});

// ## A trashed folder child is not rediscovered
//
// Folder mounts still list their remote children, but the Drive IDs retained in
// trash suppress recreation. Raw hard deletion is different: once the tombstone
// is removed, the configured folder mount is authoritative and creates the card
// again.
void test("Folder mounts still list their remote children, but the Drive IDs retained in...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L362
  const { box, initial, liveCard, liveSheet, calls, connector, fixture } = await syncedFolderChild("sheet-folder-trash");
  t.check(
    {
      created: initial.created.includes(liveCard),
      attachment: (await box.list()).includes(liveSheet),
    },
    {
    created: true,
    attachment: true,
  },
  );

  // Trash the previously synced card, so the connector retains both real transient
  // hashes and a durable tombstone. It must neither sync nor rediscover the child.
  // (The one `getFile` is the mount reading its own Drive folder, not the child.)

  // doctest:L375
  const receipt = await moveCardsToTrash(
    createCliContext(box.root),
    [liveCard],
  );
  calls.getFile = 0;
  const trashed = await connector.sync();
  const retainedState: { files?: Record<string, { contentHashes?: Record<string, string> }> } = JSON.parse(
    await box.read("_bookkeeping/connectors/google-drive.state.json"),
  );
  t.check(
    {
      getFileCalls: calls.getFile,
      created: trashed.created.length,
      liveCardExists: (await box.list()).includes(liveCard),
      retainedHash: retainedState.files?.[fixture.file.id]?.contentHashes?.["Sheet1.json"] !== undefined,
    },
    {
    getFileCalls: 1,
    created: 0,
    liveCardExists: false,
    retainedHash: true,
  },
  );

  // Hard-deleting the complete tombstone allows the still-mounted folder to
  // recreate both the card and its attachment data, despite retained transient
  // hashes from the original mount.

  // doctest:L398
  for (const move of receipt.moves[0]?.fileMoves ?? []) {
    await rm(join(box.root, move.destPath), { recursive: true, force: true });
  }
  calls.getFile = 0;
  const rediscovered = await connector.sync();
  t.check(
    {
      getFileCalls: calls.getFile,
      createdCard: rediscovered.created.includes(liveCard),
      createdAttachment: rediscovered.created.includes(liveSheet),
      attachmentExists: (await box.list()).includes(liveSheet),
    },
    {
    getFileCalls: 2,
    createdCard: true,
    createdAttachment: true,
    attachmentExists: true,
  },
  );
});
