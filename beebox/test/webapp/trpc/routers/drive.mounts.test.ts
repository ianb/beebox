// # Drive mounts over tRPC
//
// The settings page's four writes and one read: `drive.mount`, `drive.link`,
// `drive.syncFolder`, `drive.unmount`, and `drive.mounts`. Each delegates to the
// same `connectors/drive-mounts.ts` operation `bbx drive mount` / `link` /
// `unmount` calls, so what these tests pin is the boundary: the shape the page
// renders, box-relative path validation, and a refusal arriving as BAD_REQUEST
// rather than a 500.
//
// The Drive service is injected the way every service is in a tRPC test — through
// `ctx.services` — so no procedure here reaches Google.

import { test } from "tap";
import { execSync } from "node:child_process";
import "@ianbicking/tap-check/tap";
import { containing, isoDate } from "@ianbicking/tap-check/check";
import { TRPCError } from "@trpc/server";
import type { TrpcActor, TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { initBox } from "../../../../src/core/box/structure/core.js";
import { createFakeGoogleDrive, type DriveFile, type FakeSpreadsheet, type GoogleDriveService } from "../../../../src/services/google-drive/core.js";
import "../../../../src/connectors/google-drive/connector.js";
import { getLog } from "../../../../src/lib/git/core/operations.js";

// Importing the connector registers the docs/sheets handlers — that is what
// makes a Doc or Sheet child syncable rather than pointer-only.

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
    spreadsheets: new Map([["sheet-1", spreadsheetFor({ id: "sheet-1", name: "Budget 2026" })]]),
  });
}

function caller(boxRoot: string, options?: { drive?: GoogleDriveService; actor?: TrpcActor }) {
  const ctx: TrpcContext = trpcContext({
    actor: options?.actor ?? "user",
    boxRoot,
    services: options?.drive === undefined ? {} : { drive: options.drive },
    isAuthenticatedOwner: true,
  });
  return appRouter.createCaller(ctx);
}

/** What mounting the Recipes folder reports: the Sheet synced, the PDF a pointer. */
const RECIPES_MOUNTED = {
  cardPath: "_content/drive/recipes/Recipes.gfolder.card",
  name: "Recipes",
  created: [
    "_content/drive/recipes/Budget_2026.attach/Sheet1.json",
    "_content/drive/recipes/Budget_2026.gsheet.card",
    "_content/drive/recipes/Scanpdf.glink.card",
  ],
  // The mount wrote the card with Drive's name and link already; the first
  // pass finds nothing on it to change.
  updated: [],
  pushed: [],
  failures: [],
  notes: [],
  scheduleHint: null,
};

/** The `Triggered-By` trailer on the box's most recent commit, or "none". */
async function lastTrigger(boxRoot: string) {
  const entry = (await getLog(boxRoot, 1))[0];
  return entry?.trailers?.["Triggered-By"] ?? "none";
}

/** The tRPC error code a call fails with, or "none" when it succeeds. */
async function code(p: Promise<unknown>) {
  return p.then(() => "none", (e: unknown) => (e instanceof TRPCError ? e.code : String(e)));
}

/** The message a refusal carries — what the settings page renders inline. */
async function refusal(p: Promise<unknown>) {
  return p.then(() => "no refusal", (e: unknown) => (e instanceof TRPCError ? `${e.code}: ${e.message}` : String(e)));
}

// ## mounts reads the box, and says whether Drive is reachable at all
//
// An empty list means two different things — no mounts yet, or Google was never
// connected — so the query answers both. This box has no Google auth, so
// `connected` is false and the page can say so instead of showing an empty list
// as if it were the whole truth.
void test("An empty list means two different things — no mounts yet, or Google was never...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  t.check(await caller(box.root).drive.mounts(), {
    connected: false,
    mounts: [],
  });
});

// ## mount mirrors the folder, and mounts reports what landed
//
// `mount` writes the `.gfolder.card` and runs one mirror pass, so by the time the
// page refetches, the directory holds the folder's children: the Sheet synced,
// the PDF a pointer. The counts are the honest answer to "did this work" — a
// mount whose listing failed still has an error but no children.
void test("mount writes the .gfolder.card and runs one mirror pass, so by the time the p...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const c = caller(box.root, { drive: recipesDrive() });

  const mounted = await c.drive.mount({
    url: "https://drive.google.com/drive/folders/folder-1",
    dir: "_content/drive/recipes",
  });
  t.check(mounted, RECIPES_MOUNTED);

  const listed = await c.drive.mounts();
  t.check(listed, {
    connected: true,
    mounts: [
      {
        cardPath: "_content/drive/recipes/Recipes.gfolder.card",
        dir: "_content/drive/recipes",
        driveId: "folder-1",
        name: "Recipes",
        link: "https://drive.google.com/file/d/folder-1/view",
        // From Drive state, so the row can say when Drive was last heard from.
        lastSync: isoDate(),
        error: null,
        children: { files: 1, links: 1 },
        problems: { notInFolder: 0, unknown: 0 },
      },
    ],
  });

  // An injected service is a connected one: the page shows the mount manager, not
  // the connect-Google prompt.

  // `syncFolder` mirrors that same mount again on demand ("Sync now"). Nothing
  // changed upstream, so the pass changes no file and makes no commit.

  const head = () => execSync("git rev-parse HEAD", { cwd: box.root, encoding: "utf-8" });
  const beforeSync = head();
  const synced = await c.drive.syncFolder({ cardPath: "_content/drive/recipes/Recipes.gfolder.card" });
  t.check(head(), beforeSync);
  t.check(synced, {
    created: [],
    updated: [],
    pushed: [],
    failures: [],
    notes: [],
    cardPath: "_content/drive/recipes/Recipes.gfolder.card",
  });

  // `link` writes a pointer to any Drive item, copying nothing. It is a separate
  // mount from the mirror, so it can sit anywhere in the box.

  const linked = await c.drive.link({ url: "https://drive.google.com/file/d/deck-9/view", path: "_content/notes/Kickoff" });
  t.check(linked, {
    cardPath: "_content/notes/Kickoff.glink.card",
    name: "Kickoff.pptx",
    mimeType: "application/vnd.ms-powerpoint",
  });

  // Pointing a second card at something the mirror already speaks for is refused —
  // one Drive ID, one card.

  t.check(
    await refusal(c.drive.link({ url: "https://drive.google.com/file/d/pdf-1/view", path: "_content/notes/Scan" }))
    ,
    "BAD_REQUEST: Drive item pdf-1 is already claimed by: _content/drive/recipes/Scanpdf.glink.card — trash or move that card to put it somewhere else",
  );
});

// ## A mount records which credential asked for it
//
// The context knows how the request authenticated, so the commit says so. Without
// this, a mount an agent made in chat and one the boxholder made on the settings
// page are the same anonymous commit, and "who mounted this" has no answer
// (`docs/plans/agent-capability-delegation.md`).
void test("The context knows how the request authenticated, so the commit says so.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const agent = caller(box.root, { drive: recipesDrive(), actor: "agent" });

  await agent.drive.mount({ url: "https://drive.google.com/drive/folders/folder-1", dir: "_content/drive/recipes" });
  t.check(await lastTrigger(box.root), "agent");

  // A pointer written from the settings page is the same commit shape with the other
  // actor — one mechanism, not a second record.

  await caller(box.root, { drive: recipesDrive(), actor: "user" }).drive.link({
    url: "https://drive.google.com/file/d/deck-9/view",
    path: "_content/notes/Kickoff",
  });
  t.check(await lastTrigger(box.root), "user");

  // Unmounting is a trash commit, which carries its own `Trashed-By` trailer — the
  // actor joins it rather than replacing it, so one commit answers both "what
  // happened" and "who asked".

  await agent.drive.unmount({ cardPath: "_content/drive/recipes/Recipes.gfolder.card" });
  t.check(await lastTrigger(box.root), "agent");
});

// ## unmount stops the mirror and leaves every child in place
//
// Unmounting is `bbx rm` on the mount card. The card lands in `_bookkeeping/trash/` (where
// it also becomes the tombstone that stops a parent mirror re-creating it) and the
// children stay exactly where they are — which is why `mounts` goes empty while
// the directory does not.
void test("Unmounting is bbx rm on the mount card.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const c = caller(box.root, { drive: recipesDrive() });
  await c.drive.mount({ url: "https://drive.google.com/drive/folders/folder-1", dir: "_content/drive/recipes" });

  const removed = await c.drive.unmount({ cardPath: "_content/drive/recipes/Recipes.gfolder.card" });
  t.check(removed, { cardPath: "_content/drive/recipes/Recipes.gfolder.card", trashedTo: "_bookkeeping/trash/Recipes.gfolder.card" });

  t.check((await c.drive.mounts()).mounts, []);

  // The Sheet and the pointer are untouched.
  t.check((await box.list()).split("\n").filter((p) => p.startsWith("_content/drive/recipes/") && p.endsWith(".card")), [
    "_content/drive/recipes/Budget_2026.gsheet.card",
    "_content/drive/recipes/Scanpdf.glink.card",
  ]);
});

// ## A refusal is a BAD_REQUEST carrying its own message
//
// Everything the mount operations refuse is something the person who asked has to
// fix, so the message goes through verbatim for the page to render inline. A
// Drive outage or a wedged git would still be a 500 — the two are not the same
// failure and must not read the same.
void test("Everything the mount operations refuse is something the person who asked has...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const c = caller(box.root, { drive: recipesDrive() });

  t.check(
    await refusal(c.drive.mount({ url: "https://example.com/nope", dir: "_content/drive/x" }))
    ,
    "BAD_REQUEST: Could not read a Drive ID from: https://example.com/nope — paste a Drive URL or the bare ID",
  );

  // A Drive URL that is not a folder names the command that would work instead.

  t.check(
    await refusal(c.drive.mount({ url: "https://drive.google.com/file/d/pdf-1/view", dir: "_content/drive/x" }))
    ,
    "BAD_REQUEST: Scan.pdf is a application/pdf, not a Drive folder — use `bbx drive add` to sync a Doc or Sheet, or `bbx drive link` to point at it",
  );

  // `syncFolder` on something that is not a mount card is the same kind of refusal —
  // a stale page, or a mount someone removed in between.

  t.check(await refusal(c.drive.syncFolder({ cardPath: "_content/drive/recipes/Missing.gfolder.card" })), "BAD_REQUEST: _content/drive/recipes/Missing.gfolder.card is not a Drive folder mount card");

  t.check(await refusal(c.drive.syncFolder({ cardPath: "_content/notes/Plan.doc.card" })), "BAD_REQUEST: _content/notes/Plan.doc.card is not a Drive folder mount card");

  // ## A path that climbs out of the box is refused before anything is written
  //
  // Every path input resolves through `shared/ref-path.ts`, which fails closed on a
  // `..` that escapes the box and never clamps it back to the root. The refusal
  // names the input so a typo is fixable.

  t.check(
    await refusal(c.drive.mount({ url: "https://drive.google.com/drive/folders/folder-1", dir: "../outside" }))
    ,
    "BAD_REQUEST: The target directory must be a path inside the box: ../outside",
  );

  t.check(
    await refusal(c.drive.link({ url: "https://drive.google.com/file/d/pdf-1/view", path: "/" }))
    ,
    "BAD_REQUEST: The pointer path must be a path inside the box: /",
  );

  t.check(await code(c.drive.unmount({ cardPath: "../../etc/passwd" })), "BAD_REQUEST");

  // A leading `/` is box-root-absolute, not filesystem-absolute — the one spelling
  // that looks like an escape and is not.

  const rooted = await c.drive.mount({
    url: "https://drive.google.com/drive/folders/folder-1",
    dir: "/_content/drive/recipes",
  });
  t.check(rooted, RECIPES_MOUNTED);
});

// ## inspect answers "what is this, and do we already have it"
//
// The verification step the 2026-09-14 incident lacked. It writes nothing, so an
// agent can run it before a mount to check the id resolves and after one to
// confirm what landed. `claimedBy` is the part a bare Drive lookup cannot answer:
// whether a card in this box already speaks for the item.
void test("The verification step the 2026-09-14 incident lacked.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const c = caller(box.root, { drive: recipesDrive() });

  const folder = await c.drive.inspect({ url: "https://drive.google.com/drive/folders/folder-1" });
  t.check(folder, {
    id: "folder-1",
    name: "Recipes",
    mimeType: "application/vnd.google-apps.folder",
    modifiedTime: "2026-08-26T10:00:00Z",
    owner: "test@example.com",
    webViewLink: "https://drive.google.com/file/d/folder-1/view",
    cardType: null,
    claimedBy: [],
    details: null,
  });

  // A Sheet names the card type a sync would write, and the handler's own preview
  // comes through — which is how the CLI can print tabs without a second call.

  const sheet = await c.drive.inspect({ url: "https://drive.google.com/file/d/sheet-1/view" });
  t.check(sheet, {
    id: "sheet-1",
    name: "Budget 2026",
    mimeType: "application/vnd.google-apps.spreadsheet",
    modifiedTime: "2026-08-26T10:00:00Z",
    owner: "test@example.com",
    webViewLink: "https://drive.google.com/file/d/sheet-1/view",
    cardType: "gsheet",
    claimedBy: [],
    details: { tabs: [{ title: "Sheet1", gid: 0 }], comments: 0 },
  });

  // Once the folder is mirrored, the same inspect names the card that claims it —
  // so "is this already mounted?" stops being a guess.

  await c.drive.mount({ url: "https://drive.google.com/drive/folders/folder-1", dir: "_content/drive/recipes" });
  t.check(
    (await c.drive.inspect({ url: "https://drive.google.com/file/d/sheet-1/view" })).claimedBy
    ,
    [
    "_content/drive/recipes/Budget_2026.gsheet.card",
  ],
  );

  // An unreadable input is the caller's mistake, not a Drive outage.

  t.check(
    await refusal(c.drive.inspect({ url: "https://example.com/nope" }))
    ,
    "BAD_REQUEST: Could not read a Drive ID from: https://example.com/nope — paste a Drive URL or the bare ID",
  );
});

// ## add syncs one Doc or Sheet two-way
//
// The file verb. It writes the card, pulls once, records the file in the
// connector's transient state, and commits — the same span `bbx drive add` ran
// in-process, now reachable by a caller that holds no credential.
void test("The file verb.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  const c = caller(box.root, { drive: recipesDrive() });

  const added = await c.drive.add({ url: "https://drive.google.com/file/d/sheet-1/view", path: "_content/budget" });
  t.check(added, {
    cardPath: "_content/budget.gsheet.card",
    name: "Budget 2026",
    cardType: "gsheet",
    written: ["_content/budget.attach/Sheet1.json", "_content/budget.gsheet.card"],
  });

  t.check((await box.list()).split("\n"), containing(["_content/budget.gsheet.card"]));

  // A second card for one Drive id is refused: transient state is keyed by id while
  // attachments are per-card, so two cards are two working copies that overwrite
  // each other upstream.

  t.check(
    await refusal(c.drive.add({ url: "https://drive.google.com/file/d/sheet-1/view", path: "_content/budget-again" }))
    ,
    "BAD_REQUEST: Drive item sheet-1 is already claimed by: _content/budget.gsheet.card — trash or move that card to put it somewhere else",
  );

  // A type nothing syncs two-way names the verb that would work instead, and a path
  // that climbs out of the box is refused before anything is written.

  t.check(
    await refusal(c.drive.add({ url: "https://drive.google.com/file/d/pdf-1/view", path: "_content/scan" }))
    ,
    "BAD_REQUEST: Scan.pdf is a application/pdf, which nothing syncs two-way — use `bbx drive link` to point at it, or `bbx drive mount` if it is a folder",
  );

  t.check(
    await refusal(c.drive.add({ url: "https://drive.google.com/file/d/sheet-1/view", path: "../outside" }))
    ,
    "BAD_REQUEST: The card path must be a path inside the box: ../outside",
  );

  // ## list browses Drive without writing anything

  t.check(
    (await c.drive.list({ folder: "https://drive.google.com/drive/folders/folder-1" })).map((f) => f.name).toSorted()
    ,
    [
    "Budget 2026",
    "Scan.pdf",
  ],
  );

  // An unreadable folder id is a BAD_REQUEST like every other bad input, not a 500.

  t.check(
    await code(c.drive.list({ folder: "https://example.com/nope" }))
    ,
    "BAD_REQUEST",
  );
});
