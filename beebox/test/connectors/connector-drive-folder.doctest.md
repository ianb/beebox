# Google Drive Connector — mirrored folders

A `.gfolder.card` mirrors a Drive folder into **the directory the card sits
in**. These tests cover the decision core first (`planFolderSync` — pure, no
Drive, no disk), then the same behaviours end to end through the connector and
the fake Drive service.

```ts setup
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import {
  createFakeGoogleDrive,
  type DriveFile,
  type FakeDocument,
  type FakeSpreadsheet,
} from "../../src/services/google-drive.js";
// Importing the connector registers the docs/sheets handlers, which is what
// makes a Doc or Sheet child "syncable" rather than pointer-only.
import { createGoogleDriveConnector } from "../../src/connectors/google-drive.js";
import {
  MAX_FOLDER_DEPTH,
  MAX_FOLDERS_PER_PASS,
  mountEntries,
  planFolderSync,
  type MountEntry,
  type ResolvedChild,
} from "../../src/connectors/drive-folder-plan.js";
import { extractDriveFileId } from "../../src/connectors/drive-types.js";
import { moveCardsToTrash } from "../../src/core/commands/trash.js";
import { createGfolderTemplate } from "../../src/schemas/gfolder.js";
import { createGsheetTemplate } from "../../src/schemas/gsheet.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const DOC_MIME = "application/vnd.google-apps.document";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

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
    claimed: new Set(opts.claimed ?? []),
    restorable: new Set(opts.restorable ?? []),
    visitedFolders: new Set(opts.visited ?? []),
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
```

## The plan — syncable children become cards, everything else becomes a pointer

A Doc and a Sheet have handlers, so they are mirrored as synced cards. A PDF
has none: the box records that it exists and where, and copies nothing.

```ts
const plan = planFolderSync(planInput({
  children: [
    child({ id: "doc-1", name: "Trip Notes", mimeType: DOC_MIME }),
    child({ id: "sheet-1", name: "Budget 2026", mimeType: SHEET_MIME }),
    child({ id: "pdf-1", name: "Signed Lease.pdf", mimeType: "application/pdf" }),
  ],
}));
JSON.stringify(plan.createFiles)
=> [{"driveId":"doc-1","name":"Trip Notes","cardType":"gdoc","cardPath":"Trip_Notes.gdoc.card"},{"driveId":"sheet-1","name":"Budget 2026","cardType":"gsheet","cardPath":"Budget_2026.gsheet.card"}]

JSON.stringify(plan.createLinks)
=> [{"driveId":"pdf-1","name":"Signed Lease.pdf","mimeType":"application/pdf","cardPath":"Signed_Leasepdf.glink.card"}]
```

A child that already has a card here, or anywhere in the box, is left to the
box-wide card pass — the mirror only fills gaps.

```ts continue
const held = planFolderSync(planInput({
  children: [
    child({ id: "sheet-1", name: "Budget 2026", mimeType: SHEET_MIME }),
    child({ id: "pdf-1", name: "Signed Lease.pdf", mimeType: "application/pdf" }),
  ],
  entries: [{ driveId: "sheet-1", kind: "file", cardPath: "Budget_2026.gsheet.card" }],
  claimed: ["sheet-1", "pdf-1"],
}));
JSON.stringify({ files: held.createFiles.length, links: held.createLinks.length })
=> {"files":0,"links":0}
```

## The plan — a subfolder is a subdirectory with its own mount card

```ts
const plan = planFolderSync(planInput({
  children: [child({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME })],
}));
JSON.stringify(plan.subfolders)
=> [{"driveId":"folder-2","name":"Desserts","cardPath":"Desserts/Desserts.gfolder.card","create":true,"enter":true}]
```

An already-mirrored subfolder keeps the card it has, and is still descended
into (that is how its own children stay current).

```ts continue
const existing = planFolderSync(planInput({
  children: [child({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME })],
  entries: [{ driveId: "folder-2", kind: "folder", cardPath: "sweets/Sweets.gfolder.card" }],
  claimed: ["folder-2"],
}));
JSON.stringify(existing.subfolders)
=> [{"driveId":"folder-2","name":"Desserts","cardPath":"sweets/Sweets.gfolder.card","create":false,"enter":true}]
```

## The plan — cycles and caps refuse to descend, and say which

A folder already entered on this pass is a cycle (a shortcut pointing back at
an ancestor is the usual way). It is logged, not treated as a failure.

```ts
const cycle = planFolderSync(planInput({
  children: [child({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME, via: "shortcut-1" })],
  claimed: ["folder-1"],
  visited: ["folder-1"],
}));
JSON.stringify({ subfolders: cycle.subfolders, refusals: cycle.refusals })
=> {"subfolders":[],"refusals":[{"reason":"cycle","message":"Folder folder-1 (\"Recipes\") already mirrored on this pass (via shortcut shortcut-1) — cycle, not descended"}]}
```

The depth cap and the per-pass folder cap both leave the child's card in place
— membership is still recorded — but stop the walk there.

```ts continue
const deep = planFolderSync(planInput({
  children: [child({ id: "folder-9", name: "Deep", mimeType: FOLDER_MIME })],
  depth: MAX_FOLDER_DEPTH,
}));
JSON.stringify({
  subfolder: deep.subfolders[0],
  reason: deep.refusals[0]?.reason,
  message: deep.refusals[0]?.message,
})
=> {"subfolder":{"driveId":"folder-9","name":"Deep","cardPath":"Deep/Deep.gfolder.card","create":true,"enter":false},"reason":"depth-cap","message":"Folder folder-9 (\"Deep\") is deeper than the 8-level mirror depth cap — not descended"}

const wide = planFolderSync(planInput({
  children: [child({ id: "folder-9", name: "Deep", mimeType: FOLDER_MIME })],
  foldersSoFar: MAX_FOLDERS_PER_PASS,
}));
JSON.stringify({ reason: wide.refusals[0]?.reason, enter: wide.subfolders[0]?.enter })
=> {"reason":"folder-cap","enter":false}
```

## The plan — one resolved ID listed twice is mirrored once

Two shortcuts to one Doc, or a subfolder plus a shortcut to it, both resolve to
the same target. Carding each occurrence would put two cards on one Drive ID,
which the connector then refuses to sync at all — so the first wins and the
rest are named.

```ts
const plan = planFolderSync(planInput({
  children: [
    child({ id: "doc-1", name: "Trip Notes", mimeType: DOC_MIME }),
    child({ id: "doc-1", name: "Trip Notes (shortcut)", mimeType: DOC_MIME, via: "shortcut-1" }),
    child({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME }),
    child({ id: "folder-2", name: "Sweets", mimeType: FOLDER_MIME, via: "shortcut-2" }),
  ],
}));
JSON.stringify({
  files: plan.createFiles.map((a) => a.cardPath),
  subfolders: plan.subfolders.map((a) => a.cardPath),
  duplicates: plan.duplicates,
})
=> {"files":["Trip_Notes.gdoc.card"],"subfolders":["Desserts/Desserts.gfolder.card"],"duplicates":["Drive item doc-1 (\"Trip Notes (shortcut)\") is listed twice in this folder — mirrored once","Drive item folder-2 (\"Sweets\") is listed twice in this folder — mirrored once"]}
```

## The plan — a connector-made tombstone is re-created when Drive lists it again

A tombstone in `store/trash/` claims its Drive ID, which is what stops a mirror
re-creating a card someone deleted. But the connector makes tombstones too, when
Drive says a child was trashed — and if that file is restored on Drive the card
must come back. `restorable` is the set of IDs whose only claim is one of the
connector's own tombstones.

```ts
const blocked = planFolderSync(planInput({
  children: [child({ id: "sheet-1", name: "Budget", mimeType: SHEET_MIME })],
  claimed: ["sheet-1"],
}));
JSON.stringify(blocked.createFiles)
=> []

const restored = planFolderSync(planInput({
  children: [child({ id: "sheet-1", name: "Budget", mimeType: SHEET_MIME })],
  claimed: ["sheet-1"],
  restorable: ["sheet-1"],
}));
JSON.stringify(restored.createFiles.map((a) => a.cardPath))
=> ["Budget.gsheet.card"]
```

A restored subfolder comes back the same way, and a restored pointer too.

```ts continue
const folder = planFolderSync(planInput({
  children: [child({ id: "folder-2", name: "Desserts", mimeType: FOLDER_MIME })],
  claimed: ["folder-2"],
  restorable: ["folder-2"],
}));
JSON.stringify(folder.subfolders.map((a) => ({ path: a.cardPath, create: a.create })))
=> [{"path":"Desserts/Desserts.gfolder.card","create":true}]

const pointer = planFolderSync(planInput({
  children: [child({ id: "pdf-1", name: "Scan.pdf", mimeType: "application/pdf" })],
  claimed: ["pdf-1"],
  restorable: ["pdf-1"],
}));
JSON.stringify(pointer.createLinks.map((a) => a.cardPath))
=> ["Scanpdf.glink.card"]
```

## The plan — a card whose Drive ID left the listing is absent, not doomed

The plan only reports it; whether it was trashed, moved out, or unreadable is
a `getFile` the caller makes.

```ts
const plan = planFolderSync(planInput({
  children: [child({ id: "sheet-1", name: "Budget", mimeType: SHEET_MIME })],
  entries: [
    { driveId: "sheet-1", kind: "file", cardPath: "Budget.gsheet.card" },
    { driveId: "pdf-9", kind: "link", cardPath: "Old_Scan.glink.card" },
    { driveId: "folder-9", kind: "folder", cardPath: "Gone/Gone.gfolder.card" },
  ],
}));
JSON.stringify(plan.absent)
=> [{"driveId":"pdf-9","cardPath":"Old_Scan.glink.card","kind":"link"},{"driveId":"folder-9","cardPath":"Gone/Gone.gfolder.card","kind":"folder"}]
```

`mountEntries` is what builds that list: the mount's own children, plus the
folder cards one level down (a subfolder's card lives inside its directory, so
membership has to reach there to notice it went away). The mount's own card is
never its own child.

```ts continue
const liveCards = [
  { driveId: "folder-1", kind: "folder" as const, absPath: "/box/recipes/Recipes.gfolder.card", relPath: "", content: "" },
  { driveId: "sheet-1", kind: "file" as const, absPath: "/box/recipes/Budget.gsheet.card", relPath: "", content: "" },
  { driveId: "folder-2", kind: "folder" as const, absPath: "/box/recipes/Desserts/Desserts.gfolder.card", relPath: "", content: "" },
  { driveId: "sheet-2", kind: "file" as const, absPath: "/box/recipes/Desserts/Cookies.gsheet.card", relPath: "", content: "" },
  { driveId: "sheet-3", kind: "file" as const, absPath: "/box/elsewhere/Other.gsheet.card", relPath: "", content: "" },
];
JSON.stringify(mountEntries({
  liveCards,
  mountDir: "/box/recipes",
  folderCardPath: "/box/recipes/Recipes.gfolder.card",
}))
=> [{"driveId":"sheet-1","kind":"file","cardPath":"Budget.gsheet.card"},{"driveId":"folder-2","kind":"folder","cardPath":"Desserts/Desserts.gfolder.card"}]
```

## Folder URLs parse

A Drive folder URL has no `/d/` segment, so before this it only resolved by
accident when someone pasted a bare ID.

```ts
extractDriveFileId("https://drive.google.com/drive/folders/1AbCfolderID")
=> 1AbCfolderID

extractDriveFileId("https://drive.google.com/drive/u/0/folders/1AbCfolderID?usp=sharing")
=> 1AbCfolderID

extractDriveFileId("https://docs.google.com/document/d/doc-abc123/edit")
=> doc-abc123
```

## End to end — a mount discovers its children and points at the rest

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Recipes.gfolder.card",
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
JSON.stringify({ success: result.success, error: result.error ?? null })
=> {"success":true,"error":null}

JSON.stringify(cardsIn(await box.list(), "store/drive/recipes/"))
=> ["store/drive/recipes/Bake_Times.gsheet.card","store/drive/recipes/Recipes.gfolder.card","store/drive/recipes/Scan_2024pdf.glink.card","store/drive/recipes/Sourdough.gdoc.card"]
```

The pointer carries what the item is and where — and an empty body, because
the purpose notes are the boxholder's to write. (The card name comes from
`safeFilename`, which drops the dot in `Scan 2024.pdf`.)

```ts continue
await box.read("store/drive/recipes/Scan_2024pdf.glink.card")
=> ---
drive-id: pdf-1
link: https://drive.google.com/file/d/pdf-1/view
name: Scan 2024.pdf
mime: application/pdf
origin: mirror
---
```

The folder card is re-stamped with the Drive name, link, and the last outcome.

```ts continue
const folderCard = await box.read("store/drive/recipes/Recipes.gfolder.card");
folderCard.replace(/last-sync: .*/, "last-sync: «stamped»")
=> ---
drive-id: folder-1
name: Recipes
link: https://drive.google.com/file/d/folder-1/view
status: ok
last-sync: «stamped»
---
```

A second pass with nothing changed creates nothing and rewrites no pointer.

```ts continue
const again = await connector.sync();
JSON.stringify({ success: again.success, created: again.created })
=> {"success":true,"created":[]}
```

```ts cleanup
await box.cleanup();
```

## End to end — subfolders become subdirectories, mirrored on the same pass

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Recipes.gfolder.card",
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
JSON.stringify({ success: result.success, error: result.error ?? null })
=> {"success":true,"error":null}

JSON.stringify(cardsIn(await box.list(), "store/drive/recipes/"))
=> ["store/drive/recipes/Desserts/Cookies.gsheet.card","store/drive/recipes/Desserts/Desserts.gfolder.card","store/drive/recipes/Recipes.gfolder.card"]
```

The subfolder's own card is a mount in its own right — it can be moved,
unmounted, or given a status of its own.

```ts continue
(await box.read("store/drive/recipes/Desserts/Desserts.gfolder.card")).split("\n")[1]
=> drive-id: folder-2
```

```ts cleanup
await box.cleanup();
```

## End to end — a shortcut is followed to its target

The listing returns the shortcut, never the target, so the card's `drive-id`
is the target's while its name is the one shown in the folder.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Recipes.gfolder.card",
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
const card = await box.read("store/drive/recipes/Shared_Bake_Times.gsheet.card");
JSON.stringify({
  success: result.success,
  driveId: /drive-id: (\S+)/.exec(card)?.[1],
})
=> {"success":true,"driveId":"sheet-1"}
```

A shortcut pointing back at the folder it lives in is a cycle: reported, and
not descended into a second time. It is not a failure.

```ts continue
drive.files.push(driveFile({
  id: "shortcut-2",
  name: "Back To Recipes",
  mimeType: SHORTCUT_MIME,
  parent: "folder-1",
  targetId: "folder-1",
}));
let cycled: Awaited<ReturnType<typeof connector.sync>> | null = null;
const warnings = await captureWarnings(async () => {
  cycled = await connector.sync();
});
JSON.stringify({
  success: cycled?.success,
  cycleNoted: warnings.some((line) => line.includes("cycle, not descended")),
  status: /status: (\S+)/.exec(await box.read("store/drive/recipes/Recipes.gfolder.card"))?.[1],
})
=> {"success":true,"cycleNoted":true,"status":"ok"}
```

```ts cleanup
await box.cleanup();
```

## End to end — trashed, moved out, and unreadable are three different things

Only a `getFile` that says `trashed` justifies trashing the box card.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Recipes.gfolder.card",
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
JSON.stringify(cardsIn(await box.list(), "store/drive/recipes/"))
=> ["store/drive/recipes/Doomed.gsheet.card","store/drive/recipes/Recipes.gfolder.card","store/drive/recipes/Wanderer.gsheet.card"]
```

Now trash one on Drive and move the other into a different folder. Both drop
out of the listing; only the trashed one loses its card.

```ts continue
const doomed = drive.files.find((f) => f.id === "sheet-1");
if (doomed) doomed.trashed = true;
const wanderer = drive.files.find((f) => f.id === "sheet-2");
if (wanderer) wanderer.parents = ["folder-other"];

const warnings = await captureWarnings(async () => {
  await connector.sync();
});
JSON.stringify({
  cards: cardsIn(await box.list(), "store/drive/recipes/"),
  trashed: (await box.list()).includes("store/trash/Doomed.gsheet.card"),
  trashNote: warnings.some((l) => l.includes("trashed: store/drive/recipes/Doomed.gsheet.card")),
  movedNote: warnings.some((l) => l.includes("not-in-folder: store/drive/recipes/Wanderer.gsheet.card")),
})
=> {"cards":["store/drive/recipes/Recipes.gfolder.card","store/drive/recipes/Wanderer.gsheet.card"],"trashed":true,"trashNote":true,"movedNote":true}
```

The mount card carries the count, so a child the mirror no longer accounts for
is visible on the mount itself rather than only in a console warning. `trashed`
needs no count — that card is gone.

```ts continue
const stamped = await box.read("store/drive/recipes/Recipes.gfolder.card");
JSON.stringify({
  notInFolder: /not-in-folder: (\d+)/.exec(stamped)?.[1],
  unknown: /^unknown: (\d+)/m.exec(stamped)?.[1],
  status: /status: (\S+)/.exec(stamped)?.[1],
})
=> {"notInFolder":"1","status":"ok"}
```

A child whose `getFile` fails is left exactly where it is — an error is not
evidence that anything was removed.

```ts continue
drive.files = drive.files.filter((f) => f.id !== "sheet-2");
const failing = await captureWarnings(async () => {
  await connector.sync();
});
JSON.stringify({
  stillThere: (await box.list()).includes("store/drive/recipes/Wanderer.gsheet.card"),
  inTrash: (await box.list()).includes("store/trash/Wanderer.gsheet.card"),
  unknownNote: failing.some((l) => l.includes("unknown: store/drive/recipes/Wanderer.gsheet.card")),
})
=> {"stillThere":true,"inTrash":false,"unknownNote":true}
```

The stamp follows the pass: the child is now `unknown` rather than
`not-in-folder`, and the count that no longer applies is removed outright — a
stale number is worse than none.

```ts continue
const restamped = await box.read("store/drive/recipes/Recipes.gfolder.card");
JSON.stringify({
  notInFolder: /not-in-folder: (\d+)/.exec(restamped)?.[1],
  unknown: /^unknown: (\d+)/m.exec(restamped)?.[1],
})
=> {"unknown":"1"}
```

```ts cleanup
await box.cleanup();
```

## End to end — a safe-name collision is still refused, pointers included

Two Drive children can derive one local card name. The occupant is compared by
Drive ID; a different ID is a real collision and the sync says so rather than
silently overwriting or silently skipping.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Recipes.gfolder.card",
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
JSON.stringify({
  success: result.success,
  error: result.error,
  cards: cardsIn(await box.list(), "store/drive/recipes/"),
})
=> {"success":false,"error":"Drive file pdf-2 (\"Report.pdf\") maps to store/drive/recipes/Reportpdf.glink.card, already claimed by drive-id pdf-1","cards":["store/drive/recipes/Recipes.gfolder.card","store/drive/recipes/Reportpdf.glink.card"]}
```

The folder card still reads `ok`: the *mount* is healthy — it listed fine and
mirrored everything it could. The collision is a sync-report failure about one
child, not a broken mount, and `success: false` is what carries it.

```ts continue
/status: (\S+)/.exec(await box.read("store/drive/recipes/Recipes.gfolder.card"))?.[1]
=> ok
```

```ts cleanup
await box.cleanup();
```

## End to end — trashed on Drive, restored on Drive, and the card comes back

The tombstone the connector leaves behind is a mirror of Drive's trash, not a
decision by the boxholder. So when the file comes back on Drive, so does the
card.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Recipes.gfolder.card",
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
JSON.stringify({
  gone: cardsIn(await box.list(), "store/drive/recipes/"),
  tombstone: (await box.list()).includes("store/trash/Bake_Times.gsheet.card"),
})
=> {"gone":["store/drive/recipes/Recipes.gfolder.card"],"tombstone":true}
```

Restored on Drive, the next sync lists it again and re-creates the card — the
tombstone alone no longer suppresses it.

```ts continue
trashOnDrive("sheet-1", false);
const back = await connector.sync();
JSON.stringify({
  success: back.success,
  cards: cardsIn(await box.list(), "store/drive/recipes/"),
})
=> {"success":true,"cards":["store/drive/recipes/Bake_Times.gsheet.card","store/drive/recipes/Recipes.gfolder.card"]}
```

```ts cleanup
await box.cleanup();
```

## End to end — a `bbx rm` tombstone stays durable

The same tombstone made by a person means the opposite thing: they removed the
card from the box while the file is alive and well on Drive. Every later sync
lists that child, and the card stays gone.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Recipes.gfolder.card",
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
  ["store/drive/recipes/Bake_Times.gsheet.card"],
);
box.commitAll("bbx rm the synced child");
JSON.stringify({ moved: receipt.moves.length, cards: cardsIn(await box.list(), "store/drive/recipes/") })
=> {"moved":1,"cards":["store/drive/recipes/Recipes.gfolder.card"]}

const after = await connector.sync();
JSON.stringify({ success: after.success, cards: cardsIn(await box.list(), "store/drive/recipes/") })
=> {"success":true,"cards":["store/drive/recipes/Recipes.gfolder.card"]}
```

```ts cleanup
await box.cleanup();
```

## End to end — the mount's own folder in the Drive trash

A trashed folder lists as empty, and empty read as membership would trash every
child. So the pass stops at the card: it says what happened, and the children
are left alone.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
await box.seed(
  "store/drive/recipes/Recipes.gfolder.card",
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
JSON.stringify({
  cards: cardsIn(await box.list(), "store/drive/recipes/"),
  noted: warnings.some((l) => l.includes("folder is in Drive trash")),
})
=> {"cards":["store/drive/recipes/Bake_Times.gsheet.card","store/drive/recipes/Recipes.gfolder.card"],"noted":true}
```

The card itself carries the reason, so the mount reads as broken rather than as
an empty folder that mirrored fine.

```ts continue
const card = await box.read("store/drive/recipes/Recipes.gfolder.card");
JSON.stringify({
  status: /status: (\S+)/.exec(card)?.[1],
  error: /error: (.*)/.exec(card)?.[1],
})
=> {"status":"error","error":"folder is in Drive trash"}
```

Untrashed on Drive, the very next pass is ordinary again.

```ts continue
if (folder) folder.trashed = false;
await connector.sync();
/status: (\S+)/.exec(await box.read("store/drive/recipes/Recipes.gfolder.card"))?.[1]
=> ok
```

```ts cleanup
await box.cleanup();
```
