// # Google Drive Connector: mirrored folders, subfolders and removal states
//
// Continues [google-drive.folder.test.ts](google-drive.folder.test.ts). This part covers end-to-end mirrored-folder syncs: subdirectories, followed shortcuts, trashed, moved-out and unreadable children, safe-name collisions, restore from the Drive trash, `bbx rm` tombstones, and the mount's own folder in the Drive trash.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { initBox } from "../../src/core/box/structure/core.js";
import { createFakeGoogleDrive, type DriveFile, type FakeSpreadsheet } from "../../src/services/google-drive/core.js";
import { createGoogleDriveConnector } from "../../src/connectors/google-drive/connector.js";
import { moveCardsToTrash } from "../../src/core/commands/trash/command.js";
import { createGfolderTemplate } from "../../src/schemas/gfolder.js";

// Importing the connector registers the docs/sheets handlers, which is what
// makes a Doc or Sheet child "syncable" rather than pointer-only.

const FOLDER_MIME = "application/vnd.google-apps.folder";

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

function driveFile(opts: {
  id: string;
  name: string;
  mimeType: string;
  parent?: string;
  trashed?: boolean;
  targetId?: string;
}): DriveFile {
  return {
    id: opts.id,
    name: opts.name,
    mimeType: opts.mimeType,
    modifiedTime: "2026-08-26T10:00:00Z",
    trashed: opts.trashed ?? false,
    owners: [{ emailAddress: "test@example.com" }],
    ...(opts.parent === undefined ? {} : { parents: [opts.parent] }),
    ...(opts.targetId === undefined
      ? {}
      : { shortcutDetails: { targetId: opts.targetId, targetMimeType: SHEET_MIME } }),
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

/** Notes the mirror emits — a child that left, a recursion cap — are warnings. */
async function captureWarnings(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args) => { lines.push(args.map(String).join(" ")); };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

function trashedIn(listing: string): string[] {
  return listing.split("\n").filter((p) => p.startsWith("_bookkeeping/trash/") && p.endsWith(".card"));
}

function cardsIn(listing: string, dir: string): string[] {
  return listing.split("\n").filter((p) => p.startsWith(dir) && p.endsWith(".card"));
}

// ## End to end — subfolders become subdirectories, mirrored on the same pass
void test("End to end — subfolders become subdirectories, mirrored on the same pass", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME, parent: "folder-1" }),
      driveFile({ id: "sheet-2", name: "Cookies", mimeType: SHEET_MIME, parent: "folder-2" }),
    ],
    spreadsheets: new Map([["sheet-2", spreadsheetFor({ id: "sheet-2", name: "Cookies" })]]),
  });

  const connector = createGoogleDriveConnector(box.root, drive);
  const result = await connector.sync();
  t.check(result, {
    success: true,
    created: [
      "_content/drive/recipes/Desserts/Desserts.gfolder.card",
      "_content/drive/recipes/Desserts/Cookies.attach/Sheet1.json",
      "_content/drive/recipes/Desserts/Cookies.gsheet.card",
    ],
    updated: ["_content/drive/recipes/Recipes.gfolder.card"],
  });

  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Desserts/Cookies.gsheet.card",
    "_content/drive/recipes/Desserts/Desserts.gfolder.card",
    "_content/drive/recipes/Recipes.gfolder.card",
  ]);

  // The subfolder's own card is a mount in its own right — it can be moved,
  // unmounted, or given a status of its own.

  t.checkText(await box.read("_content/drive/recipes/Desserts/Desserts.gfolder.card"), `---
drive:
  id: folder-2
  link: https://drive.google.com/file/d/folder-2/view
title: Desserts
---`);
});

// ## End to end — a shortcut is followed to its target
//
// The listing returns the shortcut, never the target, so the card's `drive.id`
// is the target's while its name is the one shown in the folder.
void test("The listing returns the shortcut, never the target, so the card's drive.id is...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({
        id: "shortcut-1",
        name: "Shared Bake Times",
        mimeType: SHORTCUT_MIME,
        parent: "folder-1",
        targetId: "sheet-1",
      }),
      driveFile({ id: "sheet-1", name: "Bake Times", mimeType: SHEET_MIME }),
    ],
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Bake Times" })]]),
  });

  const connector = createGoogleDriveConnector(box.root, drive);
  const result = await connector.sync();
  const card = await box.read("_content/drive/recipes/Shared_Bake_Times.gsheet.card");
  t.check(result, {
    success: true,
    created: [
      "_content/drive/recipes/Shared_Bake_Times.attach/Sheet1.json",
      "_content/drive/recipes/Shared_Bake_Times.gsheet.card",
    ],
    updated: ["_content/drive/recipes/Recipes.gfolder.card"],
  });
  t.checkText(card, `---
drive:
  id: sheet-1
  link: https://drive.google.com/file/d/sheet-1/view
  owner: test@example.com
  modified: «date»
title: Bake Times
sheets:
  - ref: attach/Sheet1.json
    title: Sheet1
    gid: "0"
---`);

  // A shortcut pointing back at the folder it lives in is a cycle: reported, and
  // not descended into a second time. It is not a failure.

  drive.files.push(driveFile({
    id: "shortcut-2",
    name: "Back To Recipes",
    mimeType: SHORTCUT_MIME,
    parent: "folder-1",
    targetId: "folder-1",
  }));
  const cycles: Array<Awaited<ReturnType<typeof connector.sync>>> = [];
  const warnings = await captureWarnings(async () => {
    cycles.push(await connector.sync());
  });
  t.check(cycles, [{ success: true, created: [], updated: [] }]);
  t.check(warnings, [
    "[google-drive] _content/drive/recipes/Recipes.gfolder.card: Folder folder-1 (\"Back To Recipes\") already mirrored on this pass (via shortcut shortcut-2) — cycle, not descended",
  ]);
  t.checkText(await box.read("_content/drive/recipes/Recipes.gfolder.card"), `---
drive:
  id: folder-1
  link: https://drive.google.com/file/d/folder-1/view
title: Recipes
---`);
});

// ## End to end — trashed, moved out, and unreadable are three different things
//
// Only a `getFile` that says `trashed` justifies trashing the box card.
void test("Only a getFile that says trashed justifies trashing the box card.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Doomed", mimeType: SHEET_MIME, parent: "folder-1" }),
      driveFile({ id: "sheet-2", name: "Wanderer", mimeType: SHEET_MIME, parent: "folder-1" }),
    ],
    spreadsheets: new Map([
      ["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Doomed" })],
      ["sheet-2", spreadsheetFor({ id: "sheet-2", name: "Wanderer" })],
    ]),
  });

  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Doomed.gsheet.card",
    "_content/drive/recipes/Recipes.gfolder.card",
    "_content/drive/recipes/Wanderer.gsheet.card",
  ]);

  // Now trash one on Drive and move the other into a different folder. Both drop
  // out of the listing; only the trashed one loses its card.

  const doomed = drive.files.find((f) => f.id === "sheet-1");
  if (doomed) doomed.trashed = true;
  const wanderer = drive.files.find((f) => f.id === "sheet-2");
  if (wanderer) wanderer.parents = ["folder-other"];

  const warnings = await captureWarnings(async () => {
    await connector.sync();
  });
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Recipes.gfolder.card",
    "_content/drive/recipes/Wanderer.gsheet.card",
  ]);
  t.check(trashedIn(await box.list()), ["_bookkeeping/trash/Doomed.gsheet.card"]);
  t.check(warnings, [
    "[google-drive] _content/drive/recipes/Recipes.gfolder.card: trashed: _content/drive/recipes/Doomed.gsheet.card — Drive sheet-1 is in the Drive trash; moved to _bookkeeping/trash/",
    "[google-drive] _content/drive/recipes/Recipes.gfolder.card: not-in-folder: _content/drive/recipes/Wanderer.gsheet.card — Drive sheet-2 is no longer in this folder; left in place and still syncing",
  ]);

  // The mount card carries the count, so a child the mirror no longer accounts for
  // is visible on the mount itself rather than only in a console warning. `trashed`
  // needs no count — that card is gone.

  const stamped = await box.read("_content/drive/recipes/Recipes.gfolder.card");
  t.checkText(stamped, `---
drive:
  id: folder-1
  link: https://drive.google.com/file/d/folder-1/view
title: Recipes
not-in-folder: 1
---`);

  // A child whose `getFile` fails is left exactly where it is — an error is not
  // evidence that anything was removed.

  drive.files = drive.files.filter((f) => f.id !== "sheet-2");
  const failing = await captureWarnings(async () => {
    await connector.sync();
  });
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Recipes.gfolder.card",
    "_content/drive/recipes/Wanderer.gsheet.card",
  ]);
  t.check(trashedIn(await box.list()), ["_bookkeeping/trash/Doomed.gsheet.card"]);
  t.check(failing, [
    "[google-drive] _content/drive/recipes/Recipes.gfolder.card: unknown: _content/drive/recipes/Wanderer.gsheet.card — Drive sheet-2 could not be read (File not found: sheet-2); left in place",
  ]);

  // The stamp follows the pass: the child is now `unknown` rather than
  // `not-in-folder`, and the count that no longer applies is removed outright — a
  // stale number is worse than none.

  const restamped = await box.read("_content/drive/recipes/Recipes.gfolder.card");
  t.checkText(restamped, `---
drive:
  id: folder-1
  link: https://drive.google.com/file/d/folder-1/view
title: Recipes
unknown: 1
---`);
});

// ## End to end — a safe-name collision is still refused, pointers included
//
// Two Drive children can derive one local card name. The occupant is compared by
// Drive ID; a different ID is a real collision and the sync says so rather than
// silently overwriting or silently skipping.
void test("Two Drive children can derive one local card name.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "pdf-1", name: "Report.pdf", mimeType: "application/pdf", parent: "folder-1" }),
      driveFile({ id: "pdf-2", name: "Report.pdf", mimeType: "application/pdf", parent: "folder-1" }),
    ],
  });

  const connector = createGoogleDriveConnector(box.root, drive);
  const result = await connector.sync();
  t.check(result, {
    success: false,
    created: ["_content/drive/recipes/Reportpdf.glink.card"],
    updated: ["_content/drive/recipes/Recipes.gfolder.card"],
    error: "Drive file pdf-2 (\"Report.pdf\") maps to _content/drive/recipes/Reportpdf.glink.card, already claimed by drive.id pdf-1",
  });
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Recipes.gfolder.card",
    "_content/drive/recipes/Reportpdf.glink.card",
  ]);

  // The folder card still has no `error`: the *mount* is healthy — it listed fine and
  // mirrored everything it could. The collision is a sync-report failure about one
  // child, not a broken mount, and `success: false` is what carries it.

  t.checkText(await box.read("_content/drive/recipes/Recipes.gfolder.card"), `---
drive:
  id: folder-1
  link: https://drive.google.com/file/d/folder-1/view
title: Recipes
---`);
});

// ## End to end — trashed on Drive, restored on Drive, and the card comes back
//
// The tombstone the connector leaves behind is a mirror of Drive's trash, not a
// decision by the boxholder. So when the file comes back on Drive, so does the
// card.
void test("The tombstone the connector leaves behind is a mirror of Drive's trash, not a...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Bake Times", mimeType: SHEET_MIME, parent: "folder-1" }),
    ],
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Bake Times" })]]),
  });

  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();
  const trashOnDrive = (id: string, trashed: boolean) => {
    const file = drive.files.find((f) => f.id === id);
    if (file) file.trashed = trashed;
  };

  trashOnDrive("sheet-1", true);
  await captureWarnings(async () => { await connector.sync(); });
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), ["_content/drive/recipes/Recipes.gfolder.card"]);
  t.check(trashedIn(await box.list()), ["_bookkeeping/trash/Bake_Times.gsheet.card"]);

  // Restored on Drive, the next sync lists it again and re-creates the card — the
  // tombstone alone no longer suppresses it.

  trashOnDrive("sheet-1", false);
  const back = await connector.sync();
  t.check(back, {
    success: true,
    created: ["_content/drive/recipes/Bake_Times.attach/Sheet1.json", "_content/drive/recipes/Bake_Times.gsheet.card"],
    updated: [],
  });
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Bake_Times.gsheet.card",
    "_content/drive/recipes/Recipes.gfolder.card",
  ]);
});

// ## End to end — a `bbx rm` tombstone stays durable
//
// The same tombstone made by a person means the opposite thing: they removed the
// card from the box while the file is alive and well on Drive. Every later sync
// lists that child, and the card stays gone.
void test("The same tombstone made by a person means the opposite thing:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Bake Times", mimeType: SHEET_MIME, parent: "folder-1" }),
    ],
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Bake Times" })]]),
  });

  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();

  const receipt = await moveCardsToTrash(
    { boxRoot: box.root, write: () => {}, writeLine: () => {} },
    ["_content/drive/recipes/Bake_Times.gsheet.card"],
  );
  box.commitAll("bbx rm the synced child");
  t.check(receipt.moves, [
    {
      sourcePath: "_content/drive/recipes/Bake_Times.gsheet.card",
      destPath: "_bookkeeping/trash/Bake_Times.gsheet.card",
      relatedFiles: ["Bake_Times.attach"],
      fileMoves: [
        { sourcePath: "_content/drive/recipes/Bake_Times.gsheet.card", destPath: "_bookkeeping/trash/Bake_Times.gsheet.card" },
        { sourcePath: "_content/drive/recipes/Bake_Times.attach", destPath: "_bookkeeping/trash/Bake_Times.attach" },
      ],
    },
  ]);
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), ["_content/drive/recipes/Recipes.gfolder.card"]);

  const after = await connector.sync();
  t.check(after, { success: true, created: [], updated: [] });
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), ["_content/drive/recipes/Recipes.gfolder.card"]);
});

// ## End to end — the mount's own folder in the Drive trash
//
// A trashed folder lists as empty, and empty read as membership would trash every
// child. So the pass stops at the card: it says what happened, and the children
// are left alone.
void test("A trashed folder lists as empty, and empty read as membership would trash eve...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Bake Times", mimeType: SHEET_MIME, parent: "folder-1" }),
    ],
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Bake Times" })]]),
  });

  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();

  const folder = drive.files.find((f) => f.id === "folder-1");
  if (folder) folder.trashed = true;
  const warnings = await captureWarnings(async () => { await connector.sync(); });
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Bake_Times.gsheet.card",
    "_content/drive/recipes/Recipes.gfolder.card",
  ]);
  t.check(warnings, [
    "[google-drive] _content/drive/recipes/Recipes.gfolder.card: _content/drive/recipes/Recipes.gfolder.card: folder is in Drive trash",
  ]);

  // The card itself carries the reason, so the mount reads as broken rather than as
  // an empty folder that mirrored fine.

  const card = await box.read("_content/drive/recipes/Recipes.gfolder.card");
  t.checkText(card, `---
drive:
  id: folder-1
  link: https://drive.google.com/file/d/folder-1/view
title: Recipes
error: folder is in Drive trash
---`);

  // Untrashed on Drive, the very next pass is ordinary again.

  if (folder) folder.trashed = false;
  await connector.sync();
  t.checkText(await box.read("_content/drive/recipes/Recipes.gfolder.card"), `---
drive:
  id: folder-1
  link: https://drive.google.com/file/d/folder-1/view
title: Recipes
---`);
});
