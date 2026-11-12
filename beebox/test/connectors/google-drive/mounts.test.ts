// # bbx drive mount / link / unmount
//
// The three commands that write and remove Drive mount cards, plus the one-time
// conversion that turns a pre-card `folders` config entry into a `.gfolder.card`.
//
// Every refusal here is a message someone has to read and act on, so the tests
// assert the message, not just that it threw.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { initBox } from "../../../src/core/box/structure/core.js";
import {
  createFakeGoogleDrive,
  type DriveFile,
  type FakeSpreadsheet,
} from "../../../src/services/google-drive/core.js";
import { createGoogleDriveConnector } from "../../../src/connectors/google-drive/connector.js";
import {
  linkDriveItem,
  mountDriveFolder,
  unmountDriveFolder,
} from "../../../src/connectors/google-drive/mounts/core.js";
import { loadDriveConfig, saveDriveConfig } from "../../../src/connectors/google-drive/config.js";
import { syncFolderMount } from "../../../src/connectors/google-drive/mount-sync.js";
import { createGfolderTemplate } from "../../../src/schemas/gfolder.js";
import { runDriveStatus } from "../../../src/cli/commands/drive/status-cli.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// Importing the connector registers the docs/sheets handlers, which is what
// makes a Doc or Sheet child syncable rather than pointer-only.

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
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Budget 2026" })]]),
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

const mountedRecipes = {
  cardPath: "_content/drive/recipes/Recipes.gfolder.card",
  name: "Recipes",
  created: [
    "_content/drive/recipes/Budget_2026.attach/Sheet1.json",
    "_content/drive/recipes/Budget_2026.gsheet.card",
    "_content/drive/recipes/Scanpdf.glink.card",
  ],
  // The mount wrote the card with Drive's name and link already, so the
  // first pass finds nothing on it to change.
  updated: [],
  pushed: [],
  failures: [],
  notes: [],
  scheduleHint: null,
};

/** The `bbx drive status` report for the mounted recipes folder, with an optional extra line on the folder. */
function statusReport(extra: string): string {
  return `3 Drive card(s):

  _content/drive/recipes/Budget_2026.gsheet.card
    Kind: file (synced two-way)
    Title: Budget 2026
    Drive ID: sheet-1
    Modified on Drive: «date»
    Tabs: Sheet1

  _content/drive/recipes/Recipes.gfolder.card
    Kind: folder (mirrored)
    Title: Recipes
    Drive ID: folder-1
    Last synced: «date»${extra}

  _content/drive/recipes/Scanpdf.glink.card
    Kind: link (pointer, nothing copied)
    Title: Scan.pdf
    Drive ID: pdf-1`;
}

const recipesMountCard = `---
drive:
  id: folder-1
  link: https://drive.google.com/file/d/folder-1/view
title: Recipes
---`;

async function refusal(op: Promise<unknown>): Promise<string> {
  try {
    await op;
    return "no refusal";
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
}

// ## mount writes the card and mirrors the folder in the same breath
//
// A mount is not a promise for later: `mount` writes the `.gfolder.card` and runs
// one mirror pass, so the directory holds the folder's children before the
// command returns. The Sheet is synced; the PDF becomes a pointer.
void test("A mount is not a promise for later:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const drive = recipesDrive();

  const result = await mountDriveFolder({
    boxRoot: box.root,
    service: drive,
    input: "https://drive.google.com/drive/folders/folder-1",
    dir: "_content/drive/recipes",
  });
  t.check(result, mountedRecipes);

  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Budget_2026.gsheet.card",
    "_content/drive/recipes/Recipes.gfolder.card",
    "_content/drive/recipes/Scanpdf.glink.card",
  ]);

  // The mount card records the outcome, and the pointer says where it came from.

  const card = await box.read("_content/drive/recipes/Recipes.gfolder.card");
  t.checkText(card, recipesMountCard);

  t.checkText(
    await box.read("_content/drive/recipes/Scanpdf.glink.card"),
    `---
drive:
  id: pdf-1
  link: https://drive.google.com/file/d/pdf-1/view
  mime: application/pdf
title: Scan.pdf
origin: mirror
---`,
  );

  // A second mount of the same folder is refused — two cards for one Drive ID are
  // two working copies, and the connector syncs neither.

  await t.checkThrows(
    async () => (await mountDriveFolder({
      boxRoot: box.root,
      service: drive,
      input: FOLDER_URL("folder-1"),
      dir: "_content/drive/elsewhere",
    })),
    "DriveIdClaimedError: Drive item folder-1 is already claimed by: _content/drive/recipes/Recipes.gfolder.card — trash or move that card to put it somewhere else",
  );

  // So is mounting a second folder into a directory that already has a mount: one
  // directory is one mount, or two mirrors fight over the same children.

  drive.files.push(driveFile({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME }));
  await t.checkThrows(
    async () => (await mountDriveFolder({
      boxRoot: box.root,
      service: drive,
      input: FOLDER_URL("folder-2"),
      dir: "_content/drive/recipes",
    })),
    "DirectoryAlreadyMountedError",
  );
});

// ## mount refuses anything that is not a folder
//
// `mount` is for membership; a Sheet has content, and content is `bbx drive add`.
void test("mount is for membership; a Sheet has content, and content is bbx drive add.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const drive = recipesDrive();

  await t.checkThrows(
    async () => (await mountDriveFolder({
      boxRoot: box.root,
      service: drive,
      input: FILE_URL("sheet-1"),
      dir: "_content/drive/budget",
    })),
    "NotADriveFolderError: Budget 2026 is a application/vnd.google-apps.spreadsheet, not a Drive folder — use `bbx drive add` to sync a Doc or Sheet, or `bbx drive link` to point at it",
  );

  // Nothing is left behind by the refusal — no directory, no card.

  t.check((await box.list()).split("\n").filter((p) => p.startsWith("_content/drive/budget")), []);

  // An input with no readable Drive ID never reaches Drive at all.

  await t.checkThrows(async () => (await mountDriveFolder({ boxRoot: box.root, service: drive, input: "", dir: "_content/drive/x" })), "UnreadableDriveInputError");
});

// ## link points at anything, and fills in the card extension
//
// A pointer copies nothing, so it works for a PDF, and for a folder someone
// wants remembered rather than mirrored. A bare path gets `.glink.card`.
void test("A pointer copies nothing, so it works for a PDF, and for a folder someone wan...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const drive = recipesDrive();

  const linked = await linkDriveItem({
    boxRoot: box.root,
    service: drive,
    input: "https://drive.google.com/file/d/pdf-1/view",
    target: "_content/drive/Lease",
  });
  t.check(linked, {
    cardPath: "_content/drive/Lease.glink.card",
    name: "Scan.pdf",
    mimeType: "application/pdf",
  });

  // `origin: manual` is what separates a pointer someone asked for from one a
  // mirror emitted, and the body starts empty because the notes are not ours.

  const card = await box.read("_content/drive/Lease.glink.card");
  t.checkText(
    card,
    `---
drive:
  id: pdf-1
  link: https://drive.google.com/file/d/pdf-1/view
  mime: application/pdf
title: Scan.pdf
origin: manual
---`,
  );

  // A full path is taken as given, and a folder is a legitimate pointer target.

  const folderLink = await linkDriveItem({
    boxRoot: box.root,
    service: drive,
    input: FOLDER_URL("folder-1"),
    target: "_content/drive/Recipes_folder.glink.card",
  });
  t.check(folderLink, {
    cardPath: "_content/drive/Recipes_folder.glink.card",
    name: "Recipes",
    mimeType: "application/vnd.google-apps.folder",
  });

  // The same Drive item is not pointed at twice.

  await t.checkThrows(async () => (await linkDriveItem({ boxRoot: box.root, service: drive, input: FILE_URL("pdf-1"), target: "_content/drive/Again" })), "DriveIdClaimedError");
});

// ## unmount takes a directory or the card, and keeps every child
void test("unmount takes a directory or the card, and keeps every child", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const drive = recipesDrive();
  await mountDriveFolder({
    boxRoot: box.root,
    service: drive,
    input: FOLDER_URL("folder-1"),
    dir: "_content/drive/recipes",
  });

  const unmounted = await unmountDriveFolder({ boxRoot: box.root, target: "_content/drive/recipes" });
  t.check(unmounted, {
    cardPath: "_content/drive/recipes/Recipes.gfolder.card",
    trashedTo: "_bookkeeping/trash/Recipes.gfolder.card",
  });

  // The children stay exactly where they are — the synced Sheet keeps syncing on
  // its own card, the pointer keeps pointing. Nothing was deleted.

  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Budget_2026.gsheet.card",
    "_content/drive/recipes/Scanpdf.glink.card",
  ]);

  // And the trashed card is the tombstone that stops the next sync re-creating the
  // mount.

  const drive2 = recipesDrive();
  const connector = createGoogleDriveConnector(box.root, drive2);
  await connector.sync();
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Budget_2026.gsheet.card",
    "_content/drive/recipes/Scanpdf.glink.card",
  ]);

  // Naming the card directly works the same way.

  drive.files.push(driveFile({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME }));
  await mountDriveFolder({
    boxRoot: box.root,
    service: drive,
    input: FOLDER_URL("folder-2"),
    dir: "_content/drive/desserts",
  });
  t.check(
    await unmountDriveFolder({
      boxRoot: box.root,
      target: "_content/drive/desserts/Desserts.gfolder.card",
    }),
    { cardPath: "_content/drive/desserts/Desserts.gfolder.card", trashedTo: "_bookkeeping/trash/Desserts.gfolder.card" },
  );
});

// ## unmount will not guess between two mounts, or invent one
void test("unmount will not guess between two mounts, or invent one", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_content/drive/two/A.gfolder.card", createGfolderTemplate({ driveId: "folder-1" }));
  await box.seed("_content/drive/two/B.gfolder.card", createGfolderTemplate({ driveId: "folder-2" }));
  box.commitAll("two mounts in one directory");

  await t.checkThrows(async () => (await unmountDriveFolder({ boxRoot: box.root, target: "_content/drive/two" })), "AmbiguousFolderMountError: _content/drive/two holds 2 folder mounts (A.gfolder.card, B.gfolder.card) — name the one to unmount");

  await t.checkThrows(async () => (await unmountDriveFolder({ boxRoot: box.root, target: "_content/notes" })), "NoFolderMountHereError: _content/notes is not a Drive folder mount — it holds no .gfolder.card");
});

// ## status names the kind of every Drive card
//
// A folder mount is not a file, and a pointer is not synced. Status says which,
// and shows a folder's last sync, and its error only when that sync failed.
void test("A folder mount is not a file, and a pointer is not synced.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const drive = recipesDrive();
  await mountDriveFolder({
    boxRoot: box.root,
    service: drive,
    input: FOLDER_URL("folder-1"),
    dir: "_content/drive/recipes",
  });

  const output = await captureLogs(() => runDriveStatus(box.root));
  t.checkText(output, statusReport(""));

  // A healthy mount says nothing about children it could not account for. Move the
  // Sheet out of the Drive folder and the next pass stamps the count, which status
  // then shows — the mirror is no longer the whole folder, and that is a fact about
  // the mount, not a line in a log.

  const quiet = await captureLogs(() => runDriveStatus(box.root));
  t.checkText(quiet, statusReport(""));

  const sheet = drive.files.find((f) => f.id === "sheet-1");
  if (sheet) sheet.parents = ["folder-other"];
  await captureLogs(async () => {
    await syncFolderMount({
      boxRoot: box.root,
      service: drive,
      target: "_content/drive/recipes/Recipes.gfolder.card",
    });
  });
  const noted = await captureLogs(() => runDriveStatus(box.root));
  t.checkText(noted, statusReport("\n    Not in folder: 1 (still syncing on their own)"));
});

// ## a legacy `folders` config converts itself into mount cards
//
// A box set up before folder mounts were cards still carries the array. The
// first sync writes a `.gfolder.card` into each configured directory, mirrors it
// on the same pass, and rewrites the config without the entry.
void test("A box set up before folder mounts were cards still carries the array.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await saveDriveConfig(box.root, {
    folders: [{ driveFolderId: "folder-1", localPath: "_content/drive/recipes" }],
  });
  box.commitAll("a pre-card folder mount");

  const connector = createGoogleDriveConnector(box.root, recipesDrive());
  const log = await captureLogs(async () => { await connector.sync(); });
  t.checkText(
    log,
    "[google-drive] Converted 1 legacy folder mount(s) to .gfolder.card: _content/drive/recipes — a folder mount is now the card in the directory it mirrors.",
  );
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Budget_2026.gsheet.card",
    "_content/drive/recipes/Scanpdf.glink.card",
    "_content/drive/recipes/recipes.gfolder.card",
  ]);

  // The config no longer carries the entry, and the mount card that replaced it is
  // already stamped by the mirror pass that ran after the conversion.

  const config = await loadDriveConfig(box.root);
  t.check(config, {
    ok: true,
    value: {},
  });

  const card = await box.read("_content/drive/recipes/recipes.gfolder.card");
  t.checkText(card, recipesMountCard);

  // A second sync converts nothing, writes no second card, and says nothing about
  // conversion — there is no `folders` key left to act on.

  const again = await captureLogs(async () => { await connector.sync(); });
  t.checkText(again, "");
  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Budget_2026.gsheet.card",
    "_content/drive/recipes/Scanpdf.glink.card",
    "_content/drive/recipes/recipes.gfolder.card",
  ]);
});

// ## conversion refuses a directory that already mounts a different folder
//
// Converting would put two mirrors in one directory. The entry stays in the
// config until the boxholder decides which one wins — dropping it would look
// like the conversion succeeded.
void test("Converting would put two mirrors in one directory.", async (t) => {
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
    "_content/drive/recipes/Other.gfolder.card",
    createGfolderTemplate({ driveId: "folder-9" }),
  );
  await saveDriveConfig(box.root, {
    folders: [{ driveFolderId: "folder-1", localPath: "_content/drive/recipes" }],
  });
  box.commitAll("a config entry pointing at an occupied directory");

  const drive = recipesDrive();
  drive.files.push(driveFile({ id: "folder-9", name: "Other", mimeType: FOLDER_MIME }));
  const connector = createGoogleDriveConnector(box.root, drive);
  const log = await captureLogs(async () => { await connector.sync(); });
  t.checkText(
    log,
    "[google-drive] _content/drive/recipes already holds a folder mount for a different Drive folder (folder-9) — legacy config entry for folder-1 NOT converted, and left in _config/connectors/google-drive.json. Trash the card there, or point the config entry at another directory.",
  );

  t.check(await loadDriveConfig(box.root), {
    ok: true,
    value: {
      folders: [
        {
          driveFolderId: "folder-1",
          localPath: "_content/drive/recipes",
        },
      ],
    },
  });

  // An idempotent second run does exactly the same thing — no card, no rewrite.

  await captureLogs(async () => { await connector.sync(); });
  t.check(cardsIn(await box.list(), "_content/drive/recipes/").filter((p) => p.endsWith(".gfolder.card")), [
    "_content/drive/recipes/Other.gfolder.card",
  ]);
});

// ## a config that exists but does not parse is a failure, never "no mounts"
//
// Reading a corrupt file as an empty config would silently drop the mounts it
// still owes a conversion, and the box would look correctly empty while it
// wasn't. So the sync fails loudly and converts nothing.
void test("Reading a corrupt file as an empty config would silently drop the mounts it s...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.write("_config/connectors/google-drive.json", '{"folders": [{"localPath": 7}]\n');
  box.commitAll("a malformed connector config");

  const parsed = await loadDriveConfig(box.root);
  t.check(parsed, { ok: false, error: str`_config/connectors/google-drive.json is not valid JSON: ${any(String)}` });

  const connector = createGoogleDriveConnector(box.root, recipesDrive());
  let outcome: Awaited<ReturnType<typeof connector.sync>> | undefined;
  const log = await captureLogs(async () => {
    outcome = await connector.sync();
  });
  t.checkText(log, "[google-drive] _config/connectors/google-drive.json is not valid JSON: «*»");
  t.check(outcome, {
    success: false,
    created: [],
    updated: [],
    error: str`_config/connectors/google-drive.json is not valid JSON: ${any(String)}`,
  });
});

// ## conversion refuses a directory holding two mounts, and a target outside the box
//
// Two `.gfolder.card`s in one directory are already an unresolved question about
// which mirror owns it. Converting would add a third answer, so the entry stays
// in the config.
void test("Two .gfolder.cards in one directory are already an unresolved question about...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  await box.seed("_content/drive/recipes/One.gfolder.card", createGfolderTemplate({ driveId: "folder-8" }));
  await box.seed("_content/drive/recipes/Two.gfolder.card", createGfolderTemplate({ driveId: "folder-9" }));
  await saveDriveConfig(box.root, {
    folders: [{ driveFolderId: "folder-1", localPath: "_content/drive/recipes" }],
  });
  box.commitAll("a config entry pointing at a doubly-mounted directory");

  const drive = recipesDrive();
  drive.files.push(driveFile({ id: "folder-8", name: "One", mimeType: FOLDER_MIME }));
  drive.files.push(driveFile({ id: "folder-9", name: "Two", mimeType: FOLDER_MIME }));
  const connector = createGoogleDriveConnector(box.root, drive);
  const log = await captureLogs(async () => { await connector.sync(); });
  t.checkText(
    log,
    `[google-drive] _content/drive/recipes already holds 2 folder mounts (One.gfolder.card, Two.gfolder.card) — legacy config entry for folder-1 NOT converted, and left in _config/connectors/google-drive.json. Trash all but one of those cards first.
[google-drive] _content/drive/recipes/One.gfolder.card: not-in-folder: _content/drive/recipes/Two.gfolder.card — Drive folder-9 is no longer in this folder; left in place and still syncing
[google-drive] _content/drive/recipes/Two.gfolder.card: not-in-folder: _content/drive/recipes/One.gfolder.card — Drive folder-8 is no longer in this folder; left in place and still syncing`,
  );

  t.check(await loadDriveConfig(box.root), {
    ok: true,
    value: {
      folders: [
        {
          driveFolderId: "folder-1",
          localPath: "_content/drive/recipes",
        },
      ],
    },
  });

  // A legacy config could name any filesystem path. One that climbs out of the box
  // is refused the same way — the entry is kept, and nothing is written outside.

  await saveDriveConfig(box.root, {
    folders: [{ driveFolderId: "folder-1", localPath: "../escaped" }],
  });
  const escape = await captureLogs(async () => { await connector.sync(); });
  t.checkText(
    escape,
    `[google-drive] The mount directory must be a path inside the box: ../escaped — legacy config entry NOT converted.
[google-drive] _content/drive/recipes/One.gfolder.card: not-in-folder: _content/drive/recipes/Two.gfolder.card — Drive folder-9 is no longer in this folder; left in place and still syncing
[google-drive] _content/drive/recipes/Two.gfolder.card: not-in-folder: _content/drive/recipes/One.gfolder.card — Drive folder-8 is no longer in this folder; left in place and still syncing`,
  );

  t.check(await loadDriveConfig(box.root), {
    ok: true,
    value: {
      folders: [
        {
          driveFolderId: "folder-1",
          localPath: "../escaped",
        },
      ],
    },
  });
});

// ## every mount target is resolved inside the box, or refused
//
// `mount`, `link`, and `unmount` all resolve their target through
// `shared/ref-path.ts`, which fails closed: a `..` that climbs out and a
// filesystem-absolute path are both refused before anything is written. A leading
// `/` is box-root-absolute rather than filesystem-absolute, so `/etc` names a
// directory *in the box*; the box root itself is not a target at all.
void test("mount, link, and unmount all resolve their target through shared/ref-path.ts,...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const drive = recipesDrive();

  t.check(
    await refusal(mountDriveFolder({
      boxRoot: box.root, service: drive, input: FOLDER_URL("folder-1"), dir: "../outside",
    })),
    "PathOutsideBoxError: The target directory must be a path inside the box: ../outside",
  );

  t.check(
    await refusal(mountDriveFolder({
      boxRoot: box.root, service: drive, input: FOLDER_URL("folder-1"), dir: "_content/../..",
    })),
    "PathOutsideBoxError: The target directory must be a path inside the box: _content/../..",
  );

  t.check(
    await refusal(mountDriveFolder({
      boxRoot: box.root, service: drive, input: FOLDER_URL("folder-1"), dir: ".",
    })),
    "PathOutsideBoxError: The target directory must be a path inside the box: .",
  );

  t.check(
    await refusal(linkDriveItem({
      boxRoot: box.root, service: drive, input: FILE_URL("pdf-1"), target: "../outside/Scan",
    })),
    "PathOutsideBoxError: The pointer path must be a path inside the box: ../outside/Scan",
  );

  t.check(await refusal(unmountDriveFolder({ boxRoot: box.root, target: "../../etc" })), "PathOutsideBoxError: The mount card must be a path inside the box: ../../etc");

  // Nothing was created outside the box, and the box itself is untouched.

  t.check(cardsIn(await box.list(), "_content/"), []);

  // A box-root-absolute target still mounts, at the path it names inside the box.

  const mounted = await mountDriveFolder({
    boxRoot: box.root, service: drive, input: FOLDER_URL("folder-1"), dir: "/_content/drive/recipes",
  });
  t.check(mounted, mountedRecipes);
});

// ## Round-7 hardening finding 3: a symlinked-away directory refuses the write, not just the lexical check
//
// `shared/ref-path.ts`'s check above is lexical only. `_content/code` here is a
// TRACKED symlink to `../src` — a package-internal directory outside the box
// namespace entirely. The lexical check passes (`_content/code/New` reads as a
// normal in-namespace path), so without an on-disk re-check `linkDriveItem`
// would write `New.glink.card` straight into `src/`. It's now refused, on the
// FINAL filename (after the `.glink.card` suffix is appended), before anything
// is written:
void test("shared/ref-path.ts's check above is lexical only.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const drive = recipesDrive();

  await fs.symlink(path.join("..", "src"), path.join(box.root, "_content", "code"));

  t.check(
    await refusal(linkDriveItem({
      boxRoot: box.root, service: drive, input: FILE_URL("pdf-1"), target: "/_content/code/New",
    })),
    "SymlinkedMountTargetError: The pointer path resolves through a symlink to somewhere outside the box: _content/code/New.glink.card — refusing to write through it. Reconcile by hand (replace the symlink with a real directory), then retry.",
  );

  // Nothing landed in `src/`:

  t.check((await fs.readdir(path.join(box.root, "src"))).filter((n) => n.endsWith(".card")), []);

  // The same disk re-check refuses `mount` and `unmount` through the same
  // symlinked directory:

  t.check(
    await refusal(mountDriveFolder({
      boxRoot: box.root, service: drive, input: FOLDER_URL("folder-1"), dir: "/_content/code",
    })),
    "SymlinkedMountTargetError: The target directory resolves through a symlink to somewhere outside the box: _content/code — refusing to write through it. Reconcile by hand (replace the symlink with a real directory), then retry.",
  );

  t.check(await refusal(unmountDriveFolder({ boxRoot: box.root, target: "/_content/code" })), "SymlinkedMountTargetError: The mount card resolves through a symlink to somewhere outside the box: _content/code — refusing to write through it. Reconcile by hand (replace the symlink with a real directory), then retry.");
});
