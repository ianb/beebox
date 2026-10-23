// # Google Drive Connector — mirrored folders
//
// A `.gfolder.card` mirrors a Drive folder into **the directory the card sits
// in**. These tests cover the decision core first (`planFolderSync` — pure, no
// Drive, no disk), then the same behaviours end to end through the connector and
// the fake Drive service.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { initBox } from "../../src/core/box/structure/core.js";
import {
  createFakeGoogleDrive,
  type DriveFile,
  type FakeDocument,
  type FakeSpreadsheet,
} from "../../src/services/google-drive/core.js";
import { createGoogleDriveConnector } from "../../src/connectors/google-drive/connector.js";
import {
  MAX_FOLDER_DEPTH,
  MAX_FOLDERS_PER_PASS,
  mountEntries,
  planFolderSync,
  type MountEntry,
  type ResolvedChild,
} from "../../src/connectors/google-drive/folder-plan.js";
import { extractDriveFileId } from "../../src/connectors/google-drive/types.js";
import { createGfolderTemplate } from "../../src/schemas/gfolder.js";
import ky from "ky";
import { any } from "@ianbicking/tap-check/check";
import {
  loadDocsApiDiagnosis,
  recordDocsApiDiagnosis,
  type DocsApiDiagnosis,
} from "../../src/connectors/google-drive/docs-api-status.js";

// Importing the connector registers the docs/sheets handlers, which is what
// makes a Doc or Sheet child "syncable" rather than pointer-only.

const FOLDER_MIME = "application/vnd.google-apps.folder";

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

const DOC_MIME = "application/vnd.google-apps.document";

function child(opts: { id: string; name: string; mimeType: string; via?: string }): ResolvedChild {
  return {
    id: opts.id,
    name: opts.name,
    mimeType: opts.mimeType,
    viaShortcutId: opts.via ?? null,
  };
}

/** planFolderSync's inputs, with the empty-box defaults filled in. */
function planInput(opts: {
  children: ResolvedChild[];
  entries?: MountEntry[];
  claimed?: string[];
  restorable?: string[];
  visited?: string[];
  depth?: number;
  foldersSoFar?: number;
}) {
  return {
    children: opts.children,
    entries: opts.entries ?? [],
    claimed: new Set(opts.claimed),
    restorable: new Set(opts.restorable),
    visitedFolders: new Set(opts.visited),
    depth: opts.depth ?? 0,
    foldersSoFar: opts.foldersSoFar ?? 0,
  };
}

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

function documentFor(opts: { id: string; name: string }): FakeDocument {
  return {
    structure: {
      documentId: opts.id,
      title: opts.name,
      revisionId: "rev-1",
      body: { content: [] },
      inlineObjects: {},
      footnotes: {},
    },
    exports: new Map([["text/markdown", `# ${opts.name}\n`]]),
    comments: [],
  };
}

function cardsIn(listing: string, dir: string): string[] {
  return listing.split("\n").filter((p) => p.startsWith(dir) && p.endsWith(".card"));
}

// ## The plan — syncable children become cards, everything else becomes a pointer
//
// A Doc and a Sheet have handlers, so they are mirrored as synced cards. A PDF
// has none: the box records that it exists and where, and copies nothing.
void test("A Doc and a Sheet have handlers, so they are mirrored as synced cards.", async (t) => {
  const plan = planFolderSync(planInput({
    children: [
      child({ id: "doc-1", name: "Trip Notes", mimeType: DOC_MIME }),
      child({ id: "sheet-1", name: "Budget 2026", mimeType: SHEET_MIME }),
      child({ id: "pdf-1", name: "Signed Lease.pdf", mimeType: "application/pdf" }),
    ],
  }));
  t.check(plan.createFiles, [
    {
      driveId: "doc-1",
      name: "Trip Notes",
      cardType: "gdoc",
      cardPath: "Trip_Notes.gdoc.card",
    },
    {
      driveId: "sheet-1",
      name: "Budget 2026",
      cardType: "gsheet",
      cardPath: "Budget_2026.gsheet.card",
    },
  ]);

  t.check(plan.createLinks, [
    {
      driveId: "pdf-1",
      name: "Signed Lease.pdf",
      mimeType: "application/pdf",
      cardPath: "Signed_Leasepdf.glink.card",
    },
  ]);

  // A child that already has a card here, or anywhere in the box, is left to the
  // box-wide card pass — the mirror only fills gaps.

  const held = planFolderSync(planInput({
    children: [
      child({ id: "sheet-1", name: "Budget 2026", mimeType: SHEET_MIME }),
      child({ id: "pdf-1", name: "Signed Lease.pdf", mimeType: "application/pdf" }),
    ],
    entries: [{ driveId: "sheet-1", kind: "file", cardPath: "Budget_2026.gsheet.card" }],
    claimed: ["sheet-1", "pdf-1"],
  }));
  t.check(held, { createFiles: [], createLinks: [], subfolders: [], absent: [], refusals: [], duplicates: [] });
});

// ## The plan — a subfolder is a subdirectory with its own mount card
void test("The plan — a subfolder is a subdirectory with its own mount card", async (t) => {
  const plan = planFolderSync(planInput({
    children: [child({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME })],
  }));
  t.check(plan.subfolders, [
    {
      driveId: "folder-2",
      name: "Desserts",
      cardPath: "Desserts/Desserts.gfolder.card",
      create: true,
      enter: true,
    },
  ]);

  // An already-mirrored subfolder keeps the card it has, and is still descended
  // into (that is how its own children stay current).

  const existing = planFolderSync(planInput({
    children: [child({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME })],
    entries: [{ driveId: "folder-2", kind: "folder", cardPath: "sweets/Sweets.gfolder.card" }],
    claimed: ["folder-2"],
  }));
  t.check(existing.subfolders, [
    {
      driveId: "folder-2",
      name: "Desserts",
      cardPath: "sweets/Sweets.gfolder.card",
      create: false,
      enter: true,
    },
  ]);
});

// ## The plan — cycles and caps refuse to descend, and say which
//
// A folder already entered on this pass is a cycle (a shortcut pointing back at
// an ancestor is the usual way). It is logged, not treated as a failure.
void test("A folder already entered on this pass is a cycle (a shortcut pointing back at...", async (t) => {
  const cycle = planFolderSync(planInput({
    children: [child({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME, via: "shortcut-1" })],
    claimed: ["folder-1"],
    visited: ["folder-1"],
  }));
  t.check(cycle, {
    createFiles: [],
    createLinks: [],
    subfolders: [],
    absent: [],
    refusals: [
      {
        reason: "cycle",
        message: "Folder folder-1 (\"Recipes\") already mirrored on this pass (via shortcut shortcut-1) — cycle, not descended",
      },
    ],
    duplicates: [],
  });

  // The depth cap and the per-pass folder cap both leave the child's card in place
  // — membership is still recorded — but stop the walk there.

  const deep = planFolderSync(planInput({
    children: [child({ id: "folder-9", name: "Deep", mimeType: FOLDER_MIME })],
    depth: MAX_FOLDER_DEPTH,
  }));
  t.check(deep, {
    createFiles: [],
    createLinks: [],
    subfolders: [{ driveId: "folder-9", name: "Deep", cardPath: "Deep/Deep.gfolder.card", create: true, enter: false }],
    absent: [],
    refusals: [
      {
        reason: "depth-cap",
        message: "Folder folder-9 (\"Deep\") is deeper than the 8-level mirror depth cap — not descended",
      },
    ],
    duplicates: [],
  });

  const wide = planFolderSync(planInput({
    children: [child({ id: "folder-9", name: "Deep", mimeType: FOLDER_MIME })],
    foldersSoFar: MAX_FOLDERS_PER_PASS,
  }));
  t.check(wide, {
    createFiles: [],
    createLinks: [],
    subfolders: [{ driveId: "folder-9", name: "Deep", cardPath: "Deep/Deep.gfolder.card", create: true, enter: false }],
    absent: [],
    refusals: [
      {
        reason: "folder-cap",
        message: "Folder folder-9 (\"Deep\") hit the 500-folder-per-sync cap — not descended",
      },
    ],
    duplicates: [],
  });
});

// ## The plan — one resolved ID listed twice is mirrored once
//
// Two shortcuts to one Doc, or a subfolder plus a shortcut to it, both resolve to
// the same target. Carding each occurrence would put two cards on one Drive ID,
// which the connector then refuses to sync at all — so the first wins and the
// rest are named.
void test("Two shortcuts to one Doc, or a subfolder plus a shortcut to it, both resolve...", async (t) => {
  const plan = planFolderSync(planInput({
    children: [
      child({ id: "doc-1", name: "Trip Notes", mimeType: DOC_MIME }),
      child({ id: "doc-1", name: "Trip Notes (shortcut)", mimeType: DOC_MIME, via: "shortcut-1" }),
      child({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME }),
      child({ id: "folder-2", name: "Sweets", mimeType: FOLDER_MIME, via: "shortcut-2" }),
    ],
  }));
  t.check(plan, {
    createFiles: [{ driveId: "doc-1", name: "Trip Notes", cardType: "gdoc", cardPath: "Trip_Notes.gdoc.card" }],
    createLinks: [],
    subfolders: [
      { driveId: "folder-2", name: "Desserts", cardPath: "Desserts/Desserts.gfolder.card", create: true, enter: true },
    ],
    absent: [],
    refusals: [],
    duplicates: [
      "Drive item doc-1 (\"Trip Notes (shortcut)\") is listed twice in this folder — mirrored once",
      "Drive item folder-2 (\"Sweets\") is listed twice in this folder — mirrored once",
    ],
  });
});

// ## The plan — a connector-made tombstone is re-created when Drive lists it again
//
// A tombstone in `_bookkeeping/trash/` claims its Drive ID, which is what stops a mirror
// re-creating a card someone deleted. But the connector makes tombstones too, when
// Drive says a child was trashed — and if that file is restored on Drive the card
// must come back. `restorable` is the set of IDs whose only claim is one of the
// connector's own tombstones.
void test("A tombstone in bookkeeping/trash/ claims its Drive ID, which is what stops a...", async (t) => {
  const blocked = planFolderSync(planInput({
    children: [child({ id: "sheet-1", name: "Budget", mimeType: SHEET_MIME })],
    claimed: ["sheet-1"],
  }));
  t.check(blocked.createFiles, []);

  const restored = planFolderSync(planInput({
    children: [child({ id: "sheet-1", name: "Budget", mimeType: SHEET_MIME })],
    claimed: ["sheet-1"],
    restorable: ["sheet-1"],
  }));
  t.check(restored.createFiles, [{ driveId: "sheet-1", name: "Budget", cardType: "gsheet", cardPath: "Budget.gsheet.card" }]);

  // A restored subfolder comes back the same way, and a restored pointer too.

  const folder = planFolderSync(planInput({
    children: [child({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME })],
    claimed: ["folder-2"],
    restorable: ["folder-2"],
  }));
  t.check(folder.subfolders, [
    { driveId: "folder-2", name: "Desserts", cardPath: "Desserts/Desserts.gfolder.card", create: true, enter: true },
  ]);

  const pointer = planFolderSync(planInput({
    children: [child({ id: "pdf-1", name: "Scan.pdf", mimeType: "application/pdf" })],
    claimed: ["pdf-1"],
    restorable: ["pdf-1"],
  }));
  t.check(pointer.createLinks, [
    { driveId: "pdf-1", name: "Scan.pdf", mimeType: "application/pdf", cardPath: "Scanpdf.glink.card" },
  ]);
});

// ## The plan — a card whose Drive ID left the listing is absent, not doomed
//
// The plan only reports it; whether it was trashed, moved out, or unreadable is
// a `getFile` the caller makes.
void test("The plan only reports it; whether it was trashed, moved out, or unreadable is...", async (t) => {
  const plan = planFolderSync(planInput({
    children: [child({ id: "sheet-1", name: "Budget", mimeType: SHEET_MIME })],
    entries: [
      { driveId: "sheet-1", kind: "file", cardPath: "Budget.gsheet.card" },
      { driveId: "pdf-9", kind: "link", cardPath: "Old_Scan.glink.card" },
      { driveId: "folder-9", kind: "folder", cardPath: "Gone/Gone.gfolder.card" },
    ],
  }));
  t.check(plan.absent, [
    {
      driveId: "pdf-9",
      cardPath: "Old_Scan.glink.card",
      kind: "link",
    },
    {
      driveId: "folder-9",
      cardPath: "Gone/Gone.gfolder.card",
      kind: "folder",
    },
  ]);

  // `mountEntries` is what builds that list: the mount's own children, plus the
  // folder cards one level down (a subfolder's card lives inside its directory, so
  // membership has to reach there to notice it went away). The mount's own card is
  // never its own child.

  const liveCards = [
    { driveId: "folder-1", kind: "folder" as const, absPath: "/_content/recipes/Recipes.gfolder.card", relPath: "", content: "" },
    { driveId: "sheet-1", kind: "file" as const, absPath: "/_content/recipes/Budget.gsheet.card", relPath: "", content: "" },
    { driveId: "folder-2", kind: "folder" as const, absPath: "/_content/recipes/Desserts/Desserts.gfolder.card", relPath: "", content: "" },
    { driveId: "sheet-2", kind: "file" as const, absPath: "/_content/recipes/Desserts/Cookies.gsheet.card", relPath: "", content: "" },
    { driveId: "sheet-3", kind: "file" as const, absPath: "/_content/elsewhere/Other.gsheet.card", relPath: "", content: "" },
  ];
  t.check(
    mountEntries({
      liveCards,
      mountDir: "/_content/recipes",
      folderCardPath: "/_content/recipes/Recipes.gfolder.card",
    }),
    [
    {
      driveId: "sheet-1",
      kind: "file",
      cardPath: "Budget.gsheet.card",
    },
    {
      driveId: "folder-2",
      kind: "folder",
      cardPath: "Desserts/Desserts.gfolder.card",
    },
  ],
  );
});

// ## Folder URLs parse
//
// A Drive folder URL has no `/d/` segment, so before this it only resolved by
// accident when someone pasted a bare ID.
void test("A Drive folder URL has no /d/ segment, so before this it only resolved by acc...", async (t) => {
  t.check(
    extractDriveFileId("https://drive.google.com/drive/folders/1AbCfolderID")
    ,
    "1AbCfolderID",
  );

  t.check(
    extractDriveFileId("https://drive.google.com/drive/u/0/folders/1AbCfolderID?usp=sharing")
    ,
    "1AbCfolderID",
  );
});

// ## End to end — a mount discovers its children and points at the rest
void test("End to end — a mount discovers its children and points at the rest", async (t) => {
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
      driveFile({ id: "doc-1", name: "Sourdough", mimeType: DOC_MIME, parent: "folder-1" }),
      driveFile({ id: "sheet-1", name: "Bake Times", mimeType: SHEET_MIME, parent: "folder-1" }),
      driveFile({ id: "pdf-1", name: "Scan 2024.pdf", mimeType: "application/pdf", parent: "folder-1" }),
    ],
    documents: new Map([["doc-1", documentFor({ id: "doc-1", name: "Sourdough" })]]),
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Bake Times" })]]),
  });

  const connector = createGoogleDriveConnector(box.root, drive);
  const result = await connector.sync();
  t.check(result, {
    success: true,
    created: [
      "_content/drive/recipes/Sourdough.attach/Sourdough.md",
      "_content/drive/recipes/Sourdough.gdoc.card",
      "_content/drive/recipes/Bake_Times.attach/Sheet1.json",
      "_content/drive/recipes/Bake_Times.gsheet.card",
      "_content/drive/recipes/Scan_2024pdf.glink.card",
    ],
    updated: ["_content/drive/recipes/Recipes.gfolder.card"],
  });

  t.check(cardsIn(await box.list(), "_content/drive/recipes/"), [
    "_content/drive/recipes/Bake_Times.gsheet.card",
    "_content/drive/recipes/Recipes.gfolder.card",
    "_content/drive/recipes/Scan_2024pdf.glink.card",
    "_content/drive/recipes/Sourdough.gdoc.card",
  ]);

  // The pointer carries what the item is and where — and an empty body, because
  // the purpose notes are the boxholder's to write. (The card name comes from
  // `safeFilename`, which drops the dot in `Scan 2024.pdf`.)

  await t.checkText(await box.read("_content/drive/recipes/Scan_2024pdf.glink.card"), `---
drive:
  id: pdf-1
  link: https://drive.google.com/file/d/pdf-1/view
  mime: application/pdf
title: Scan 2024.pdf
origin: mirror
---`);

  // The folder card is re-stamped with the Drive name, link, and the last outcome.

  const folderCard = await box.read("_content/drive/recipes/Recipes.gfolder.card");
  await t.checkText(folderCard.replace(/last-sync: .*/, "last-sync: «stamped»"), `---
drive:
  id: folder-1
  link: https://drive.google.com/file/d/folder-1/view
title: Recipes
last-sync: «stamped»
---`);

  // A second pass with nothing changed creates nothing and rewrites no pointer.

  const again = await connector.sync();
  t.check(again, { success: true, created: [], updated: ["_content/drive/recipes/Recipes.gfolder.card"] });
});

// ## Docs API diagnosis — folder discovery counts, and a capped pass clears only on evidence
//
// A Doc that folder discovery creates is pulled through the folder pass, not
// the card loop; its Docs API outcome must still reach the diagnosis. A pass
// that hit a folder cap left part of the tree unscanned, so finding no Docs
// there cannot clear an open problem. The problem is box-wide, so one Doc that
// reaches the Docs API clears it on any pass, complete or not.

async function scopeInsufficientError(): Promise<unknown> {
  const body = JSON.stringify({
    error: {
      code: 403,
      message: "Request had insufficient authentication scopes.",
      status: "PERMISSION_DENIED",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
    },
  });
  try {
    await ky.get("https://docs.googleapis.com/v1/documents/x", { retry: 0, fetch: async () => new Response(body, { status: 403 }) });
  } catch (e) {
    return e;
  }
  throw new Error("expected the request to fail");
}

void test("A Doc found by a newly mounted folder opens the diagnosis on that first sync", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await initBox(box.root);
  await box.seed("_content/drive/notes/Notes.gfolder.card", createGfolderTemplate({ driveId: "folder-1" }));
  box.commitAll("mount the Notes folder");
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Notes", mimeType: FOLDER_MIME }),
      driveFile({ id: "doc-1", name: "Plan", mimeType: DOC_MIME, parent: "folder-1" }),
    ],
    documents: new Map([["doc-1", documentFor({ id: "doc-1", name: "Plan" })]]),
  });
  const missingScope = await scopeInsufficientError();
  drive.getDocument = async () => { throw missingScope; };

  const result = await createGoogleDriveConnector(box.root, drive).sync();
  t.check(result.created, ["_content/drive/notes/Plan.attach/Plan.md", "_content/drive/notes/Plan.gdoc.card"]);
  t.check(await loadDocsApiDiagnosis(box.root), {
    kind: "scope-insufficient",
    message:
      "1 Google Doc is syncing without revision tracking or lossy-content details: " +
      "the Google sign-in lacks the documents.readonly scope. Re-authorize Google in Settings, under Google services, to grant it.",
    link: null,
    docs: 1,
    since: any(String),
  });
});

const openDiagnosis: DocsApiDiagnosis = {
  kind: "service-disabled",
  message: "1 Google Doc is syncing without revision tracking or lossy-content details: disabled",
  link: "https://enable",
  docs: 1,
  since: "2026-10-20T12:00:00.000Z",
};

/** folder-0 … folder-9, each inside the last: the mirror stops at the 8-level cap. */
function tooDeepFolders(): DriveFile[] {
  return Array.from({ length: MAX_FOLDER_DEPTH + 2 }, (_, i) =>
    driveFile({ id: `folder-${String(i)}`, name: `Level ${String(i)}`, mimeType: FOLDER_MIME, ...(i === 0 ? {} : { parent: `folder-${String(i - 1)}` }) }),
  );
}

void test("A pass that hit the folder depth cap keeps an open diagnosis when it found no Docs", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await initBox(box.root);
  await box.seed("_content/drive/deep/Deep.gfolder.card", createGfolderTemplate({ driveId: "folder-0" }));
  box.commitAll("mount a deep folder");
  await recordDocsApiDiagnosis(box.root, () => openDiagnosis);

  const result = await createGoogleDriveConnector(box.root, createFakeGoogleDrive({ files: tooDeepFolders() })).sync();
  // The cap is a note, not a failure.
  t.check(result.success, true);
  // The unscanned levels may hold Docs that still fail.
  t.check(await loadDocsApiDiagnosis(box.root), openDiagnosis);
});

void test("A pass that hit the folder depth cap clears the diagnosis when a Doc reached the Docs API", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await initBox(box.root);
  await box.seed("_content/drive/notes/Notes.gfolder.card", createGfolderTemplate({ driveId: "notes" }));
  await box.seed("_content/drive/deep/Deep.gfolder.card", createGfolderTemplate({ driveId: "folder-0" }));
  box.commitAll("mount a Docs folder and a deep folder");
  await recordDocsApiDiagnosis(box.root, () => openDiagnosis);
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "notes", name: "Notes", mimeType: FOLDER_MIME }),
      driveFile({ id: "doc-1", name: "Plan", mimeType: DOC_MIME, parent: "notes" }),
      ...tooDeepFolders(),
    ],
    documents: new Map([["doc-1", documentFor({ id: "doc-1", name: "Plan" })]]),
  });

  const result = await createGoogleDriveConnector(box.root, drive).sync();
  // The cap is a note, not a failure.
  t.check(result.success, true);
  // The Doc reached the Docs API, so the box-wide problem is gone.
  t.check(await loadDocsApiDiagnosis(box.root), null);
});

void test("A Drive file that fails every pass does not keep the diagnosis once a Doc reached the Docs API", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await initBox(box.root);
  await box.seed("_content/drive/notes/Notes.gfolder.card", createGfolderTemplate({ driveId: "notes" }));
  box.commitAll("mount the Notes folder");
  await recordDocsApiDiagnosis(box.root, () => openDiagnosis);
  const drive = createFakeGoogleDrive({
    files: [
      driveFile({ id: "notes", name: "Notes", mimeType: FOLDER_MIME }),
      driveFile({ id: "doc-1", name: "Plan", mimeType: DOC_MIME, parent: "notes" }),
      driveFile({ id: "doc-big", name: "Huge", mimeType: DOC_MIME, parent: "notes" }),
    ],
    documents: new Map([
      ["doc-1", documentFor({ id: "doc-1", name: "Plan" })],
      ["doc-big", documentFor({ id: "doc-big", name: "Huge" })],
    ]),
  });
  const realExport = drive.exportFile.bind(drive);
  drive.exportFile = async (id, mime) => {
    if (id === "doc-big") throw new Error("This file is too large to be exported.");
    return realExport(id, mime);
  };

  const result = await createGoogleDriveConnector(box.root, drive).sync();
  // The oversized Doc fails this pass, and would fail every pass.
  t.check(result.success, false);
  // A Doc reached the Docs API, so the box-wide problem is gone.
  t.check(await loadDocsApiDiagnosis(box.root), null);
});
