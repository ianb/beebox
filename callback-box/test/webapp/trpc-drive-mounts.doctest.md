# Drive mounts over tRPC

The settings page's four writes and one read: `drive.mount`, `drive.link`,
`drive.syncFolder`, `drive.unmount`, and `drive.mounts`. Each delegates to the
same `connectors/drive-mounts.ts` operation `cb drive mount` / `link` /
`unmount` calls, so what these tests pin is the boundary: the shape the page
renders, box-relative path validation, and a refusal arriving as BAD_REQUEST
rather than a 500.

The Drive service is injected the way every service is in a tRPC test — through
`ctx.services` — so no procedure here reaches Google.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { initBox } from "../../src/core/box/index.js";
import { createFakeGoogleDrive, type DriveFile, type FakeSpreadsheet } from "../../src/services/google-drive.js";
// Importing the connector registers the docs/sheets handlers — that is what
// makes a Doc or Sheet child syncable rather than pointer-only.
import { createGoogleDriveConnector } from "../../src/connectors/google-drive.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function driveFile(opts: { id: string; name: string; mimeType: string; parent?: string }): DriveFile {
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

/** One Drive folder holding one Sheet (syncable) and one PDF (pointer-only). */
function recipesDrive() {
  return createFakeGoogleDrive({
    files: [
      driveFile({ id: "folder-1", name: "Recipes", mimeType: FOLDER_MIME }),
      driveFile({ id: "sheet-1", name: "Budget 2026", mimeType: SHEET_MIME, parent: "folder-1" }),
      driveFile({ id: "pdf-1", name: "Scan.pdf", mimeType: "application/pdf", parent: "folder-1" }),
      // Outside the folder: what a pointer written by hand points at.
      driveFile({ id: "deck-9", name: "Kickoff.pptx", mimeType: "application/vnd.ms-powerpoint" }),
    ],
    spreadsheets: [["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Budget 2026" })]],
  });
}

function caller(boxRoot, drive) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: drive === undefined ? {} : { drive },
    user: null,
    authed: true,
    isOwner: true,
  };
  return appRouter.createCaller(ctx);
}

/** The tRPC error code a call fails with, or "none" when it succeeds. */
async function code(p) {
  return p.then(() => "none", (e) => e.code);
}

/** The message a refusal carries — what the settings page renders inline. */
async function refusal(p) {
  return p.then(() => "no refusal", (e) => `${e.code}: ${e.message}`);
}
```

## mounts reads the box, and says whether Drive is reachable at all

An empty list means two different things — no mounts yet, or Google was never
connected — so the query answers both. This box has no Google auth, so
`connected` is false and the page can say so instead of showing an empty list
as if it were the whole truth.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
JSON.stringify(await caller(box.root).drive.mounts())
=> {"connected":false,"mounts":[]}
```

```ts cleanup
await box.cleanup();
```

## mount mirrors the folder, and mounts reports what landed

`mount` writes the `.gfolder.card` and runs one mirror pass, so by the time the
page refetches, the directory holds the folder's children: the Sheet synced,
the PDF a pointer. The counts are the honest answer to "did this work" — a
mount whose listing failed still has a status but no children.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const c = caller(box.root, recipesDrive());

const mounted = await c.drive.mount({
  url: "https://drive.google.com/drive/folders/folder-1",
  dir: "store/drive/recipes",
});
JSON.stringify({ cardPath: mounted.cardPath, name: mounted.name, failures: mounted.failures })
=> {"cardPath":"store/drive/recipes/Recipes.gfolder.card","name":"Recipes","failures":[]}
```

```ts continue
const listed = await c.drive.mounts();
JSON.stringify(listed.mounts.map((m) => ({
  cardPath: m.cardPath,
  dir: m.dir,
  driveId: m.driveId,
  name: m.name,
  status: m.status,
  children: m.children,
  error: m.error,
})))
=> [{"cardPath":"store/drive/recipes/Recipes.gfolder.card","dir":"store/drive/recipes","driveId":"folder-1","name":"Recipes","status":"ok","children":{"files":1,"links":1},"error":null}]
```

An injected service is a connected one: the page shows the mount manager, not
the connect-Google prompt.

```ts continue
listed.connected
=> true

// `last-sync` is stamped, so the row can say when Drive was last heard from.
typeof listed.mounts[0].lastSync
=> string
```

`syncFolder` mirrors that same mount again on demand. Nothing changed upstream,
so the pass creates nothing and re-stamps the card.

```ts continue
const synced = await c.drive.syncFolder({ cardPath: "store/drive/recipes/Recipes.gfolder.card" });
JSON.stringify({
  cardPath: synced.cardPath,
  created: synced.created,
  updated: synced.updated,
  failures: synced.failures,
})
=> {"cardPath":"store/drive/recipes/Recipes.gfolder.card","created":[],"updated":["store/drive/recipes/Recipes.gfolder.card"],"failures":[]}
```

`link` writes a pointer to any Drive item, copying nothing. It is a separate
mount from the mirror, so it can sit anywhere in the box.

```ts continue
const linked = await c.drive.link({ url: "https://drive.google.com/file/d/deck-9/view", path: "store/notes/Kickoff" });
JSON.stringify(linked)
=> {"cardPath":"store/notes/Kickoff.glink.card","name":"Kickoff.pptx","mimeType":"application/vnd.ms-powerpoint"}
```

Pointing a second card at something the mirror already speaks for is refused —
one Drive ID, one card.

```ts continue
await refusal(c.drive.link({ url: "https://drive.google.com/file/d/pdf-1/view", path: "store/notes/Scan" }))
=> BAD_REQUEST: Drive item pdf-1 is already claimed by: store/drive/recipes/Scanpdf.glink.card — trash or move that card to put it somewhere else
```

```ts cleanup
await box.cleanup();
```

## unmount stops the mirror and leaves every child in place

Unmounting is `cb rm` on the mount card. The card lands in `store/trash/` (where
it also becomes the tombstone that stops a parent mirror re-creating it) and the
children stay exactly where they are — which is why `mounts` goes empty while
the directory does not.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const c = caller(box.root, recipesDrive());
await c.drive.mount({ url: "https://drive.google.com/drive/folders/folder-1", dir: "store/drive/recipes" });

const removed = await c.drive.unmount({ cardPath: "store/drive/recipes/Recipes.gfolder.card" });
JSON.stringify({ cardPath: removed.cardPath, trashed: removed.trashedTo.startsWith("store/trash/") })
=> {"cardPath":"store/drive/recipes/Recipes.gfolder.card","trashed":true}
```

```ts continue
JSON.stringify((await c.drive.mounts()).mounts)
=> []

// The Sheet and the pointer are untouched.
JSON.stringify((await box.list()).split("\n").filter((p) => p.startsWith("store/drive/recipes/") && p.endsWith(".card")))
=> ["store/drive/recipes/Budget_2026.gsheet.card","store/drive/recipes/Scanpdf.glink.card"]
```

```ts cleanup
await box.cleanup();
```

## A refusal is a BAD_REQUEST carrying its own message

Everything the mount operations refuse is something the person who asked has to
fix, so the message goes through verbatim for the page to render inline. A
Drive outage or a wedged git would still be a 500 — the two are not the same
failure and must not read the same.

```ts
const box = await makeTmpBox({ git: true });
await initBox(box.root);
const c = caller(box.root, recipesDrive());

await refusal(c.drive.mount({ url: "https://example.com/nope", dir: "store/drive/x" }))
=> BAD_REQUEST: Could not read a Drive ID from: https://example.com/nope — paste a Drive URL or the bare ID
```

A Drive URL that is not a folder names the command that would work instead.

```ts continue
await refusal(c.drive.mount({ url: "https://drive.google.com/file/d/pdf-1/view", dir: "store/drive/x" }))
=> BAD_REQUEST: Scan.pdf is a application/pdf, not a Drive folder — use `cb drive add` to sync a Doc or Sheet, or `cb drive link` to point at it
```

`syncFolder` on something that is not a mount card is the same kind of refusal —
a stale page, or a mount someone removed in between.

```ts continue
await refusal(c.drive.syncFolder({ cardPath: "store/drive/recipes/Missing.gfolder.card" }))
=> BAD_REQUEST: store/drive/recipes/Missing.gfolder.card is not a Drive folder mount card

await refusal(c.drive.syncFolder({ cardPath: "store/notes/Plan.memo.card" }))
=> BAD_REQUEST: store/notes/Plan.memo.card is not a Drive folder mount card
```

## A path that climbs out of the box is refused before anything is written

Every path input resolves through `shared/ref-path.ts`, which fails closed on a
`..` that escapes the box and never clamps it back to the root. The refusal
names the input so a typo is fixable.

```ts continue
await refusal(c.drive.mount({ url: "https://drive.google.com/drive/folders/folder-1", dir: "../outside" }))
=> BAD_REQUEST: The target directory must be a path inside the box: ../outside

await refusal(c.drive.link({ url: "https://drive.google.com/file/d/pdf-1/view", path: "/" }))
=> BAD_REQUEST: The pointer path must be a path inside the box: /

await code(c.drive.unmount({ cardPath: "../../etc/passwd" }))
=> BAD_REQUEST
```

A leading `/` is box-root-absolute, not filesystem-absolute — the one spelling
that looks like an escape and is not.

```ts continue
const rooted = await c.drive.mount({
  url: "https://drive.google.com/drive/folders/folder-1",
  dir: "/store/drive/recipes",
});
rooted.cardPath
=> store/drive/recipes/Recipes.gfolder.card
```

```ts cleanup
await box.cleanup();
```
