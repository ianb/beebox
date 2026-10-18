// # Google Drive Connector: mirrored folders, subfolders and removal states
//
// Continues [google-drive.folder.doctest.md](google-drive.folder.doctest.md). This part covers end-to-end mirrored-folder syncs: subdirectories, followed shortcuts, trashed, moved-out and unreadable children, safe-name collisions, restore from the Drive trash, `bbx rm` tombstones, and the mount's own folder in the Drive trash.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
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
  // doctest:L86
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  // doctest:L94
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME, parent: "folder-1" }),
      driveFile({ id: "sheet-2", name: "Cookies", mimeType: SHEET_MIME, parent: "folder-2" }),
    ],
    spreadsheets: new Map([["sheet-2", spreadsheetFor({ id: "sheet-2", name: "Cookies" })]]),
  });

  // doctest:L103
  const connector = createGoogleDriveConnector(box.root, drive);
  const result = await connector.sync();
  t.check({ success: result.success, error: result.error ?? null }, {
    success: true,
    error: null,
  });

  // doctest:L108
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Desserts/Cookies.gsheet.card",
    "_content/drive/recipes/Desserts/Desserts.gfolder.card",
    "_content/drive/recipes/Recipes.gfolder.card",
  ]);

  // The subfolder's own card is a mount in its own right — it can be moved,
  // unmounted, or given a status of its own.

  // doctest:L116
  await t.checkText((await box.read("_content/drive/recipes/Desserts/Desserts.gfolder.card")).startsWith("---\ndrive:\n  id: folder-2\n"), "true");
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
  // doctest:L130
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  // doctest:L138
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

  // doctest:L153
  const connector = createGoogleDriveConnector(box.root, drive);
  const result = await connector.sync();
  const card = await box.read("_content/drive/recipes/Shared_Bake_Times.gsheet.card");
  t.check(
    {
      success: result.success,
      driveId: /\n {2}id: (\S+)/.exec(card)?.[1],
    },
    {
    success: true,
    driveId: "sheet-1",
  },
  );

  // A shortcut pointing back at the folder it lives in is a cycle: reported, and
  // not descended into a second time. It is not a failure.

  // doctest:L167
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
  t.check(
    {
      success: cycles[0]?.success,
      cycleNoted: warnings.some((line) => line.includes("cycle, not descended")),
      failed: /^error:/m.test(await box.read("_content/drive/recipes/Recipes.gfolder.card")),
    },
    {
    success: true,
    cycleNoted: true,
    failed: false,
  },
  );
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
  // doctest:L195
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  // doctest:L203
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

  // doctest:L215
  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Doomed.gsheet.card",
    "_content/drive/recipes/Recipes.gfolder.card",
    "_content/drive/recipes/Wanderer.gsheet.card",
  ]);

  // Now trash one on Drive and move the other into a different folder. Both drop
  // out of the listing; only the trashed one loses its card.

  // doctest:L225
  const doomed = drive.files.find((f) => f.id === "sheet-1");
  if (doomed) doomed.trashed = true;
  const wanderer = drive.files.find((f) => f.id === "sheet-2");
  if (wanderer) wanderer.parents = ["folder-other"];

  // doctest:L230
  const warnings = await captureWarnings(async () => {
    await connector.sync();
  });
  t.check(
    {
      cards: cardsIn(await box.list(), "_content/drive/recipes/"),
      trashed: (await box.list()).includes("_bookkeeping/trash/Doomed.gsheet.card"),
      trashNote: warnings.some((l) => l.includes("trashed: _content/drive/recipes/Doomed.gsheet.card")),
      movedNote: warnings.some((l) => l.includes("not-in-folder: _content/drive/recipes/Wanderer.gsheet.card")),
    },
    {
    cards: [
      "_content/drive/recipes/Recipes.gfolder.card",
      "_content/drive/recipes/Wanderer.gsheet.card",
    ],
    trashed: true,
    trashNote: true,
    movedNote: true,
  },
  );

  // The mount card carries the count, so a child the mirror no longer accounts for
  // is visible on the mount itself rather than only in a console warning. `trashed`
  // needs no count — that card is gone.

  // doctest:L247
  const stamped = await box.read("_content/drive/recipes/Recipes.gfolder.card");
  await t.checkText(
    JSON.stringify({
      notInFolder: /not-in-folder: (\d+)/.exec(stamped)?.[1],
      unknown: /^unknown: (\d+)/m.exec(stamped)?.[1],
      failed: /^error:/m.test(stamped),
    }),
    "{\"notInFolder\":\"1\",\"failed\":false}",
  );

  // A child whose `getFile` fails is left exactly where it is — an error is not
  // evidence that anything was removed.

  // doctest:L260
  drive.files = drive.files.filter((f) => f.id !== "sheet-2");
  const failing = await captureWarnings(async () => {
    await connector.sync();
  });
  t.check(
    {
      stillThere: (await box.list()).includes("_content/drive/recipes/Wanderer.gsheet.card"),
      inTrash: (await box.list()).includes("_bookkeeping/trash/Wanderer.gsheet.card"),
      unknownNote: failing.some((l) => l.includes("unknown: _content/drive/recipes/Wanderer.gsheet.card")),
    },
    {
    stillThere: true,
    inTrash: false,
    unknownNote: true,
  },
  );

  // The stamp follows the pass: the child is now `unknown` rather than
  // `not-in-folder`, and the count that no longer applies is removed outright — a
  // stale number is worse than none.

  // doctest:L277
  const restamped = await box.read("_content/drive/recipes/Recipes.gfolder.card");
  await t.checkText(
    JSON.stringify({
      notInFolder: /not-in-folder: (\d+)/.exec(restamped)?.[1],
      unknown: /^unknown: (\d+)/m.exec(restamped)?.[1],
    }),
    "{\"unknown\":\"1\"}",
  );
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
  // doctest:L296
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  // doctest:L304
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "pdf-1", name: "Report.pdf", mimeType: "application/pdf", parent: "folder-1" }),
      driveFile({ id: "pdf-2", name: "Report.pdf", mimeType: "application/pdf", parent: "folder-1" }),
    ],
  });

  // doctest:L312
  const connector = createGoogleDriveConnector(box.root, drive);
  const result = await connector.sync();
  t.check(
    {
      success: result.success,
      error: result.error,
      cards: cardsIn(await box.list(), "_content/drive/recipes/"),
    },
    {
    success: false,
    error: "Drive file pdf-2 (\"Report.pdf\") maps to _content/drive/recipes/Reportpdf.glink.card, already claimed by drive.id pdf-1",
    cards: [
      "_content/drive/recipes/Recipes.gfolder.card",
      "_content/drive/recipes/Reportpdf.glink.card",
    ],
  },
  );

  // The folder card still has no `error`: the *mount* is healthy — it listed fine and
  // mirrored everything it could. The collision is a sync-report failure about one
  // child, not a broken mount, and `success: false` is what carries it.

  // doctest:L327
  t.check(/^error:/m.test(await box.read("_content/drive/recipes/Recipes.gfolder.card")), false);
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
  // doctest:L342
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  // doctest:L350
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Bake Times", mimeType: SHEET_MIME, parent: "folder-1" }),
    ],
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Bake Times" })]]),
  });

  // doctest:L358
  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();
  const trashOnDrive = (id: string, trashed: boolean) => {
    const file = drive.files.find((f) => f.id === id);
    if (file) file.trashed = trashed;
  };

  // doctest:L365
  trashOnDrive("sheet-1", true);
  await captureWarnings(async () => { await connector.sync(); });
  t.check(
    {
      gone: cardsIn(await box.list(), "_content/drive/recipes/"),
      tombstone: (await box.list()).includes("_bookkeeping/trash/Bake_Times.gsheet.card"),
    },
    {
    gone: [
      "_content/drive/recipes/Recipes.gfolder.card",
    ],
    tombstone: true,
  },
  );

  // Restored on Drive, the next sync lists it again and re-creates the card — the
  // tombstone alone no longer suppresses it.

  // doctest:L378
  trashOnDrive("sheet-1", false);
  const back = await connector.sync();
  t.check(
    {
      success: back.success,
      cards: cardsIn(await box.list(), "_content/drive/recipes/"),
    },
    {
    success: true,
    cards: [
      "_content/drive/recipes/Bake_Times.gsheet.card",
      "_content/drive/recipes/Recipes.gfolder.card",
    ],
  },
  );
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
  // doctest:L398
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  // doctest:L406
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Bake Times", mimeType: SHEET_MIME, parent: "folder-1" }),
    ],
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Bake Times" })]]),
  });

  // doctest:L414
  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();

  // doctest:L417
  const receipt = await moveCardsToTrash(
    { boxRoot: box.root, write: () => {}, writeLine: () => {} },
    ["_content/drive/recipes/Bake_Times.gsheet.card"],
  );
  box.commitAll("bbx rm the synced child");
  t.check({ moved: receipt.moves.length, cards: cardsIn(await box.list(), "_content/drive/recipes/") }, {
    moved: 1,
    cards: [
      "_content/drive/recipes/Recipes.gfolder.card",
    ],
  });

  // doctest:L425
  const after = await connector.sync();
  t.check({ success: after.success, cards: cardsIn(await box.list(), "_content/drive/recipes/") }, {
    success: true,
    cards: [
      "_content/drive/recipes/Recipes.gfolder.card",
    ],
  });
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
  // doctest:L441
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed(
    "_content/drive/recipes/Recipes.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );
  box.commitAll("mount the Recipes folder");

  // doctest:L449
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Bake Times", mimeType: SHEET_MIME, parent: "folder-1" }),
    ],
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Bake Times" })]]),
  });

  // doctest:L457
  const connector = createGoogleDriveConnector(box.root, drive);
  await connector.sync();

  // doctest:L460
  const folder = drive.files.find((f) => f.id === "folder-1");
  if (folder) folder.trashed = true;
  const warnings = await captureWarnings(async () => { await connector.sync(); });
  t.check(
    {
      cards: cardsIn(await box.list(), "_content/drive/recipes/"),
      noted: warnings.some((l) => l.includes("folder is in Drive trash")),
    },
    {
    cards: [
      "_content/drive/recipes/Bake_Times.gsheet.card",
      "_content/drive/recipes/Recipes.gfolder.card",
    ],
    noted: true,
  },
  );

  // The card itself carries the reason, so the mount reads as broken rather than as
  // an empty folder that mirrored fine.

  // doctest:L474
  const card = await box.read("_content/drive/recipes/Recipes.gfolder.card");
  t.check(
    {
      error: /error: (.*)/.exec(card)?.[1],
    },
    {
    error: "folder is in Drive trash",
  },
  );

  // Untrashed on Drive, the very next pass is ordinary again.

  // doctest:L484
  if (folder) folder.trashed = false;
  await connector.sync();
  t.check(/^error:/m.test(await box.read("_content/drive/recipes/Recipes.gfolder.card")), false);
});
