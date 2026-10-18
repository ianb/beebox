// # Google Drive Connector: status, duplicate IDs, and folder discovery
//
// Continues [google-drive.doctest.md](google-drive.doctest.md). This part covers Drive status sharing the live-card scan, Drive IDs parsed from YAML, duplicate `drive.id` handling, and folder discovery refusals.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { makeTmpBox } from "../helpers/test-helpers.js";
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

// ## Drive status shares the live-card scan and YAML ID parser
//
// Status reports live YAML and legacy cards, but it does not report a tombstone
// as a mounted file.
void test("Status reports live YAML and legacy cards, but it does not report a tombstone...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L146
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

  // doctest:L159
  const output = await captureLogs(() => runDriveStatus(box.root));
  t.check(
    {
      count: output.includes("2 Drive card(s)"),
      yamlId: output.includes("Drive ID: yaml-id"),
      legacyId: output.includes("Drive ID: legacy-id"),
      trash: output.includes("trash-id") || output.includes("_bookkeeping/trash"),
    },
    {
    count: true,
    yamlId: true,
    legacyId: true,
    trash: false,
  },
  );

  // The health fields come from the current YAML form, not just the legacy XML
  // form: title, Drive's last-modified time, a conflict, sheet tabs, and the lossy
  // summary all print. A synced file's `drive.modified` is when it last changed on
  // Drive, not when the box synced it.

  // doctest:L175
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

  // doctest:L187
  const health = await captureLogs(() => runDriveStatus(box.root));
  t.check(
    {
      yamlTitle: health.includes("Title: YAML Card"),
      yamlModified: health.includes("Modified on Drive: 2026-03-29T10:00:00Z"),
      notLastSynced: !health.includes("Last synced: 2026-03-29T10:00:00Z"),
      yamlTabs: health.includes("Tabs: Sheet1"),
      yamlConflictHidden: (health.match(/Conflict:/g) ?? []).length === 1,
      docTitle: health.includes("Title: Contended Doc"),
      docConflict: health.includes("Conflict: merge the .remote.md beside the local copy, then delete it"),
      docLossy: health.includes("Lossy: images=2, footnotes=1"),
      legacyTabs: health.includes("Tabs: Old Tab"),
    },
    {
    yamlTitle: true,
    yamlModified: true,
    notLastSynced: true,
    yamlTabs: true,
    yamlConflictHidden: true,
    docTitle: true,
    docConflict: true,
    docLossy: true,
    legacyTabs: true,
  },
  );

  // Cards with an ambiguous identity are listed too — they are not synced, so a
  // silent omission would read as "not mounted".

  // doctest:L206
  await box.seed("_content/drive/Yaml-Copy.gsheet.card", yamlFixture.card);
  await box.seed("_content/drive/Broken.gsheet.card", "---\ntitle: No identity\n---\n");

  // doctest:L209
  const ambiguous = await captureLogs(() => runDriveStatus(box.root));
  t.check(
    {
      duplicate: ambiguous.includes("Duplicate drive.id yaml-id"),
      bothPaths: ambiguous.includes("_content/drive/Yaml.gsheet.card")
        && ambiguous.includes("_content/drive/Yaml-Copy.gsheet.card"),
      unreadable: ambiguous.includes("No readable drive.id: _content/drive/Broken.gsheet.card"),
      mounted: ambiguous.includes("2 Drive card(s)"),
    },
    {
    duplicate: true,
    bothPaths: true,
    unreadable: true,
    mounted: true,
  },
  );
});

// ## Drive IDs come from parsed YAML, not a line match
//
// A quoted or commented `drive.id` is ordinary YAML. Reading it with a regex
// yields a *wrong* ID — worse than none, because a wrong tombstone ID lets folder
// discovery recreate a deleted card. Unparseable frontmatter reads as no ID.
void test("A quoted or commented drive.id is ordinary YAML.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L231
  const box = await newBox();
  await box.seed("_content/drive/Quoted.gsheet.card", "---\ndrive:\n  id: 'sheet-quoted'\ntitle: Quoted\n---\n");
  await box.seed("_content/drive/Commented.gsheet.card", "---\ndrive:\n  id: sheet-commented # mounted by hand\ntitle: Commented\n---\n");
  await box.seed("_content/drive/Broken.gsheet.card", "---\ndrive:\n  id: [unclosed\n---\n");
  await box.seed("_content/drive/Legacy.gsheet.card", '<gsheet drive-id="legacy-id"><title>Legacy</title></gsheet>\n');

  // doctest:L237
  const tracking = await findDriveCardTracking(box.root);
  t.check(
    {
      ids: tracking.liveCards.map((card) => card.driveId),
      unreadable: tracking.unreadable,
    },
    {
    ids: [
      "sheet-commented",
      "legacy-id",
      "sheet-quoted",
    ],
    unreadable: [
      "_content/drive/Broken.gsheet.card",
    ],
  },
  );
});

// ## Duplicate drive.id — neither working copy is pushed
//
// Two live cards for one Drive file share a single transient-hash entry while
// their attachments are per-card. Syncing either one would push its own copy over
// the other's, so the connector syncs neither and reports the ambiguity.
void test("Two live cards for one Drive file share a single transient-hash entry while t...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L256
  const box = await newBox();
  const fixture = sheetFixture({ id: "sheet-dup", name: "Shared" });
  await box.seed("_content/drive/Alpha.gsheet.card", fixture.card);
  box.commitAll("mount alpha");

  // doctest:L261
  const drive = fakeDrive([fixture]);
  const connector = createGoogleDriveConnector(box.root, drive);
  const first = await connector.sync();
  await t.checkText(
    out.with(JSON.stringify({
      success: first.success,
      attach: (await box.list()).includes("_content/drive/Alpha.attach/Sheet1.json"),
    })),
    "{\"success\":true,\"attach\":true}",
  );

  // A second card claiming the same `drive.id` appears (a copy, a restore, a
  // rename gone wrong). Alpha's attachment is edited locally — the exact case that
  // used to push Beta's stale copy back over it.

  // doctest:L276
  await box.seed("_content/drive/Beta.gsheet.card", fixture.card);
  // Beta's own attach copy is the stale data that used to get pushed back over
  // Alpha's edit, because both share one transient-hash entry.
  await box.seed("_content/drive/Beta.attach/Sheet1.json", '[\n["Name"],\n["Alice stale"]\n]\n');
  await box.seed("_content/drive/Alpha.attach/Sheet1.json", '[\n["Name"],\n["Alice edited"]\n]\n');

  // doctest:L282
  const ambiguous = await connector.sync();
  await t.checkText(
    out.with(JSON.stringify({
      success: ambiguous.success,
      error: ambiguous.error,
      pushed: ambiguous.pushed ?? [],
      updates: drive.updateLog.length,
    })),
    "{\"success\":false,\"error\":\"Duplicate drive.id sheet-dup claimed by _content/drive/Alpha.gsheet.card, _content/drive/Beta.gsheet.card — both skipped\",\"pushed\":[],\"updates\":0}",
  );

  // Nothing reached Google — the remote spreadsheet still holds its original rows.

  // doctest:L295
  await t.checkText(out.with(print(drive.describe())), `files:
  sheet-dup "Shared" application/vnd.google-apps.spreadsheet modified=2026-03-29T10:00:00Z
spreadsheets:
  sheet-dup "Shared"
    Sheet1: [["Name"],["Alice"]]
documents:
updateLog (0):
contentUpdateLog (0):`);

  // Removing the duplicate makes the surviving card syncable again, and the local
  // edit then pushes.

  // doctest:L310
  await rm(join(box.root, "_content/drive/Beta.gsheet.card"));
  await rm(join(box.root, "_content/drive/Beta.attach"), { recursive: true });
  const resolved = await connector.sync();
  await t.checkText(
    out.with(JSON.stringify({
      success: resolved.success,
      pushed: resolved.pushed ?? [],
      remote: drive.spreadsheets.get("sheet-dup")?.sheets.get("Sheet1"),
    })),
    "{\"success\":true,\"pushed\":[\"_content/drive/Alpha.attach/Sheet1.json\"],\"remote\":[[\"Name\"],[\"Alice edited\"]]}",
  );
});

// ## Folder discovery — a safe-name collision is reported, not skipped
//
// Two remote children can derive the same local card name. The occupant is
// compared by Drive ID: a different ID is a real collision, and the run fails
// rather than leaving the remote child untracked forever.
void test("Two remote children can derive the same local card name.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L332
  const box = await newBox();
  await box.seed(
    "_content/drive/folder/Folder.gfolder.card",
    createGfolderTemplate({ driveId: "folder-1" }),
  );

  // doctest:L338
  const occupant = sheetFixture({ id: "sheet-occupant", name: "Shared Name" });
  const newcomer = sheetFixture({
    id: "sheet-newcomer",
    name: "Shared Name",
    parent: "folder-1",
  });
  await box.seed("_content/drive/folder/Shared_Name.gsheet.card", occupant.card);
  box.commitAll("mount folder");

  // doctest:L347
  const drive = fakeDrive([occupant, newcomer], { folders: [folderFixture({ id: "folder-1", name: "Folder" })] });
  const connector = createGoogleDriveConnector(box.root, drive);
  const result = await connector.sync();
  const cards = (await box.list()).split("\n").filter((p) => p.endsWith(".gsheet.card"));
  t.check({ success: result.success, error: result.error, cards }, {
    success: false,
    error: "Drive file sheet-newcomer (\"Shared Name\") maps to _content/drive/folder/Shared_Name.gsheet.card, already claimed by drive.id sheet-occupant",
    cards: [
      "_content/drive/folder/Shared_Name.gsheet.card",
    ],
  });

  // The same Drive ID at that path is a benign re-mount, not a collision. That is
  // what a concurrent `bbx drive add` looks like: the card appears after discovery
  // took its snapshot, so the path is occupied by the very file being discovered.

  // doctest:L360
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
  t.check(
    {
      error: third.error,
      cards: (await box.list()).split("\n").filter((p) => p.endsWith(".gsheet.card")),
    },
    {
    error: "Drive file sheet-newcomer (\"Shared Name\") maps to _content/drive/folder/Shared_Name.gsheet.card, already claimed by drive.id sheet-occupant",
    cards: [
      "_content/drive/folder/Raced_Child.gsheet.card",
      "_content/drive/folder/Shared_Name.gsheet.card",
    ],
  },
  );
});

// ## Folder discovery — an unreadable card blocks rediscovery
//
// A trash tombstone whose `drive.id` cannot be read is exactly the card that
// suppresses a folder child. Discovery cannot tell it apart from an unrelated
// broken card, so the folder pass does not run at all while one exists — no
// Drive request, no recreated card, and the failure names the path.
void test("A trash tombstone whose drive.id cannot be read is exactly the card that supp...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L393
  const { box, initial, liveCard, calls, connector } = await syncedFolderChild("sheet-folder-unreadable");
  t.check({ success: initial.success, created: initial.created.includes(liveCard) }, {
    success: true,
    created: true,
  });

  // Trash the card, then corrupt the tombstone so its retained Drive ID is
  // unreadable.

  // doctest:L402
  await moveCardsToTrash(createCliContext(box.root), [liveCard]);
  await box.seed("_bookkeeping/trash/Folder_Child.gsheet.card", "---\ntitle: Folder Child\n---\n");
  calls.getFile = 0;
  const blocked = await connector.sync();
  t.check(
    {
      success: blocked.success,
      error: blocked.error,
      getFileCalls: calls.getFile,
      created: blocked.created.length,
      liveCardExists: (await box.list()).includes(liveCard),
    },
    {
    success: false,
    error: "Unreadable Drive card(s), folder discovery skipped: _bookkeeping/trash/Folder_Child.gsheet.card",
    getFileCalls: 0,
    created: 0,
    liveCardExists: false,
  },
  );
});
