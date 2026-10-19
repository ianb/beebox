// # Google Drive Connector — Google Docs
//
// Tests for the `drive-handler-docs` handler using fake services.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { access, unlink } from "node:fs/promises";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { initBox } from "../../../../src/core/box/structure/core.js";
import {
  createFakeGoogleDrive,
  type FakeDocument,
} from "../../../../src/services/google-drive/core.js";
import { createGoogleDriveConnector } from "../../../../src/connectors/google-drive/connector.js";
import { docsHandler } from "../../../../src/connectors/google-drive/handlers/docs/handler.js";
import { createGdocTemplate } from "../../../../src/schemas/gdoc.js";

// Several assertions exercise conflict/error paths that log to console.
// Silence so they don't pollute test output.
console.warn = () => {};
console.error = () => {};

function makeDoc(opts: {
  id: string;
  title: string;
  markdown: string;
  revisionId?: string;
  inlineObjects?: number;
  footnotes?: number;
  comments?: number;
}): FakeDocument {
  const inlineObjects: Record<string, unknown> = {};
  for (let i = 0; i < (opts.inlineObjects ?? 0); i++) inlineObjects[`io-${i}`] = {};
  const footnotes: Record<string, unknown> = {};
  for (let i = 0; i < (opts.footnotes ?? 0); i++) footnotes[`fn-${i}`] = {};

  return {
    structure: {
      documentId: opts.id,
      title: opts.title,
      revisionId: opts.revisionId ?? "rev-1",
      body: { content: [] },
      inlineObjects,
      footnotes,
    },
    exports: new Map([["text/markdown", opts.markdown]]),
    comments: Array.from({ length: opts.comments ?? 0 }, (_, i) => ({
      id: `c-${i}`,
      content: `comment ${i}`,
    })),
  };
}

/** A fake Drive holding one Google Doc. */
function docDrive(opts: { id: string; name: string; document: FakeDocument }) {
  return createFakeGoogleDrive({
    files: [{
      id: opts.id,
      name: opts.name,
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-04-26T10:00:00Z",
      trashed: false,
      owners: [{ emailAddress: "test@example.com" }],
      webViewLink: `https://docs.google.com/document/d/${opts.id}/edit`,
    }],
    documents: new Map([[opts.id, opts.document]]),
  });
}

/**
 * A box with a `<stem>.gdoc.card` mounting one fake Google Doc, committed but
 * not yet synced. `doc` describes the remote document; pass `document` to
 * supply a hand-built one.
 */
async function docBox(opts: {
  id: string;
  name: string;
  stem: string;
  doc?: { markdown: string; inlineObjects?: number; footnotes?: number; comments?: number };
  document?: FakeDocument;
}) {
  const box = await makeTmpBox({ git: true });
  await initBox(box.root);
  box.commitAll("init box");
  const document = opts.document ?? makeDoc({ id: opts.id, title: opts.name, ...opts.doc! });
  const drive = docDrive({ id: opts.id, name: opts.name, document });
  await box.seed(`_content/drive/${opts.stem}.gdoc.card`, createGdocTemplate({
    driveId: opts.id,
    title: opts.name,
    modified: "2026-04-26T10:00:00Z",
    revision: "rev-1",
    link: `https://docs.google.com/document/d/${opts.id}/edit`,
    owner: "test@example.com",
    contentFile: `${opts.stem}.md`,
  }));
  box.commitAll(`add ${opts.stem}`);
  return { box, drive, document, connector: createGoogleDriveConnector(box.root, drive) };
}

// ## Pull — creates card and markdown file from a Google Doc
//
// A new doc card produces a `.md` file inside the card's attach scope.
void test("A new doc card produces a .md file inside the card's attach scope.", async (t) => {
  // doctest:L107
  const { box, connector } = await docBox({
    id: "doc-1",
    name: "Project Notes",
    stem: "Project_Notes",
    doc: { markdown: "# Notes\n\nFirst paragraph.\n" },
  });
  const result = await connector.sync();
  t.check(result, {
    success: true,
    created: ["_content/drive/Project_Notes.attach/Project_Notes.md"],
    updated: [],
  });

  // doctest:L117
  t.check(await box.read("_content/drive/Project_Notes.attach/Project_Notes.md"), `# Notes

First paragraph.
`);

  // The card now records the upstream revision, and no conflict:

  // doctest:L124
  const card = await box.read("_content/drive/Project_Notes.gdoc.card");
  t.checkText(card, `---
drive:
  id: doc-1
  link: https://docs.google.com/document/d/doc-1/edit
  owner: test@example.com
  modified: «date»
  revision: rev-1
title: Project Notes
content:
  ref: attach/Project_Notes.md
---`);

  // An agent-written `contains:` survives the next sync's card rebuild
  // (connector templates preserve agent-owned fields), and a sync that
  // changes nothing else doesn't rewrite the card:

  // doctest:L140
  await box.write(
    "_content/drive/Project_Notes.gdoc.card",
    card.replace("drive:\n  id: doc-1", "contains: Planning notes for the project kickoff.\ndrive:\n  id: doc-1")
  );
  box.commitAll("agent adds contains");
  const resync = await connector.sync();
  t.check(resync, { success: true, created: [], updated: ["_content/drive/Project_Notes.gdoc.card"] });

  // doctest:L149
  const resynced = await box.read("_content/drive/Project_Notes.gdoc.card");
  t.checkText(
    resynced,
    `---
drive:
  id: doc-1
  link: https://docs.google.com/document/d/doc-1/edit
  owner: test@example.com
  modified: «date»
  revision: rev-1
title: Project Notes
content:
  ref: attach/Project_Notes.md
contains: Planning notes for the project kickoff.
---`,
  );
});

// ## Pull — lossy content surfaces in the card
//
// Footnotes and inline objects appear as `lossy` entries. Comments are NOT
// counted as lossy — they're captured in the sidecar instead.
void test("Footnotes and inline objects appear as lossy entries.", async (t) => {
  // doctest:L160
  const { box, connector } = await docBox({
    id: "doc-2",
    name: "Reviewed Doc",
    stem: "Reviewed_Doc",
    doc: { markdown: "Body.\n", inlineObjects: 2, footnotes: 1, comments: 3 },
  });
  await connector.sync();

  // doctest:L168
  const card = await box.read("_content/drive/Reviewed_Doc.gdoc.card");
  t.checkText(
    card,
    `---
drive:
  id: doc-2
  link: https://docs.google.com/document/d/doc-2/edit
  owner: test@example.com
  modified: «date»
  revision: rev-1
title: Reviewed Doc
content:
  ref: attach/Reviewed_Doc.md
comments:
  ref: attach/Reviewed_Doc.comments.json
lossy:
  - type: footnotes
    count: 1
  - type: images
    count: 2
---`,
  );

  // The comments are written to a sidecar and referenced from the card:

  // doctest:L182
  t.check(JSON.parse(await box.read("_content/drive/Reviewed_Doc.attach/Reviewed_Doc.comments.json")), [
    { id: "c-0", content: "comment 0" },
    { id: "c-1", content: "comment 1" },
    { id: "c-2", content: "comment 2" },
  ]);
});

// ## Push — local markdown edit pushes to Drive
//
// When the local `.md` (inside the doc's attach scope) differs from the last-pulled content and remote hasn't changed, the new content is uploaded.
void test("When the local .md (inside the doc's attach scope) differs from the last-pull...", async (t) => {
  // doctest:L198
  const { box, drive, connector } = await docBox({
    id: "doc-3",
    name: "Editable",
    stem: "Editable",
    doc: { markdown: "Original.\n" },
  });
  await connector.sync();

  // doctest:L206
  // Edit locally — the .md lives inside the doc's attach scope.
  await box.seed("_content/drive/Editable.attach/Editable.md", "Edited body.\n");
  box.commitAll("local edit");

  // doctest:L210
  await connector.sync();

  // doctest:L212
  t.check(drive.contentUpdateLog, [{ fileId: "doc-3", mimeType: "text/markdown", content: "Edited body.\n" }]);
});

// ## Conflict — remote changed since last pull
//
// When both local and remote have changed, push refuses to overwrite. The upstream content is written to a `.remote.md` inside the attach scope and the card gets `conflict: true`.
void test("When both local and remote have changed, push refuses to overwrite.", async (t) => {
  // doctest:L227
  const { box, drive, document, connector } = await docBox({
    id: "doc-4",
    name: "Contended",
    stem: "Contended",
    doc: { markdown: "Original.\n" },
  });
  await connector.sync();

  // doctest:L235
  // Local edit.
  await box.seed("_content/drive/Contended.attach/Contended.md", "Local edit.\n");
  box.commitAll("local edit");

  // doctest:L239
  // Remote edit (simulated by changing the doc's revision and exported markdown
  // out-of-band, plus bumping the file's modifiedTime).
  document.structure.revisionId = "rev-2";
  document.exports.set("text/markdown", "Remote edit.\n");
  const remoteFile = drive.files.find((f) => f.id === "doc-4");
  if (remoteFile) remoteFile.modifiedTime = "2026-04-26T12:00:00Z";

  await connector.sync();

  // doctest:L246
  // doctest:L248
  await t.checkText(
    // Local file is unchanged — push refused.
    await box.read("_content/drive/Contended.attach/Contended.md"),
    "Local edit.",
  );

  // doctest:L252
  await t.checkText(
    // .remote.md was written with the upstream content.
    await box.read("_content/drive/Contended.attach/Contended.remote.md"),
    "Remote edit.",
  );

  // doctest:L256
  // No content was uploaded (push aborted).
  t.check(drive.contentUpdateLog, []);

  // doctest:L260
  // Card marked in conflict.
  const card = await box.read("_content/drive/Contended.gdoc.card");
  t.checkText(card, `---
drive:
  id: doc-4
  link: https://docs.google.com/document/d/doc-4/edit
  owner: test@example.com
  modified: «date»
  revision: rev-2
title: Contended
content:
  ref: attach/Contended.md
conflict: true
---`);

  // ## Conflict — push stays skipped until `.remote.md` is removed
  //
  // While `.remote.md` exists, subsequent syncs don't push the still-unmerged local file.

  // doctest:L271
  // User does nothing — sync again.
  await connector.sync();
  t.check(drive.contentUpdateLog, []);

  // doctest:L276
  // User resolves: writes the merged version, deletes .remote.md, commits.
  await box.seed("_content/drive/Contended.attach/Contended.md", "Merged.\n");
  await unlink(join(box.root, "_content/drive/Contended.attach/Contended.remote.md"));
  box.commitAll("resolve conflict");

  // doctest:L281
  await connector.sync();

  // doctest:L283
  t.check(drive.contentUpdateLog, [{ fileId: "doc-4", mimeType: "text/markdown", content: "Merged.\n" }]);

  // doctest:L289
  // With the `.remote.md` gone, the card no longer says conflict.
  t.checkText(await box.read("_content/drive/Contended.gdoc.card"), `---
drive:
  id: doc-4
  link: https://docs.google.com/document/d/doc-4/edit
  owner: test@example.com
  modified: «date»
  revision: rev-«int»-1
title: Contended
content:
  ref: attach/Contended.md
---`);
});

// ## Graceful degradation when Docs API is unavailable
//
// If `getDocument` fails (e.g. the auth token lacks the `documents.readonly` scope), pull still succeeds — markdown is exported via the Drive API and the lossy block is empty (no Docs API structure to tally), but comments still come through the Drive API and are captured in the sidecar.
void test("If getDocument fails (e.g.", async (t) => {
  // doctest:L299
  const { box, drive, connector } = await docBox({
    id: "doc-5",
    name: "Degraded",
    stem: "Degraded",
    doc: { markdown: "Body.\n", inlineObjects: 5, comments: 2 },
  });

  // doctest:L306
  // Start the card with a stale title, so the title check below shows the pull rewrote it.
  const staleCard = await box.read("_content/drive/Degraded.gdoc.card");
  await box.seed("_content/drive/Degraded.gdoc.card", staleCard.replace("title: Degraded", "title: Stale Title"));
  box.commitAll("stale title");

  // doctest:L311
  // Simulate a 403 by replacing getDocument with a stub that throws.
  drive.getDocument = async () => {
    throw new Error("HTTPError: 403 Insufficient Permission");
  };

  // doctest:L316
  const result = await connector.sync();
  t.check(result, {
    success: true,
    created: [
      "_content/drive/Degraded.attach/Degraded.md",
      "_content/drive/Degraded.attach/Degraded.comments.json",
      "_content/drive/Degraded.gdoc.card",
    ],
    updated: [],
  });

  // doctest:L320
  await t.checkText(
    // Markdown still pulled.
    await box.read("_content/drive/Degraded.attach/Degraded.md"),
    "Body.",
  );

  // doctest:L324
  // Card still written, falls back to Drive metadata title.
  const card = await box.read("_content/drive/Degraded.gdoc.card");
  t.checkText(
    card,
    `---
drive:
  id: doc-5
  link: https://docs.google.com/document/d/doc-5/edit
  owner: test@example.com
  modified: «date»
title: Degraded
content:
  ref: attach/Degraded.md
comments:
  ref: attach/Degraded.comments.json
---`,
  );

  // Comments (Drive API) still captured in the sidecar; images (Docs API) absent.
  // doctest:L336
  t.check(JSON.parse(await box.read("_content/drive/Degraded.attach/Degraded.comments.json")), [
    { id: "c-0", content: "comment 0" },
    { id: "c-1", content: "comment 1" },
  ]);
});

// ## Comments sidecar — full thread preserved, and removed when comments clear
//
// The sidecar holds the raw comment objects verbatim: author, timestamps,
// resolved status, anchored text, and replies — everything an agent needs to
// read the feedback.
void test("The sidecar holds the raw comment objects verbatim:", async (t) => {
  // doctest:L347
  const richDoc: FakeDocument = {
    structure: {
      documentId: "doc-6",
      title: "Feedback",
      revisionId: "rev-1",
      body: { content: [] },
    },
    exports: new Map([["text/markdown", "Body.\n"]]),
    comments: [
      {
        id: "c-1",
        content: "These numbers look off — should be Q2.",
        author: { displayName: "Jane Doe", emailAddress: "jane@example.com" },
        resolved: true,
        createdTime: "2026-06-20T10:00:00Z",
        modifiedTime: "2026-06-21T09:00:00Z",
        quotedFileContent: { mimeType: "text/html", value: "the Q3 numbers" },
        replies: [
          {
            id: "r-1",
            content: "Fixed, thanks.",
            author: { displayName: "John" },
            createdTime: "2026-06-21T09:00:00Z",
          },
        ],
      },
    ],
  };
  const { box, drive, connector } = await docBox({
    id: "doc-6",
    name: "Feedback",
    stem: "Feedback",
    document: richDoc,
  });
  await connector.sync();

  // doctest:L383
  const sidecar = JSON.parse(await box.read("_content/drive/Feedback.attach/Feedback.comments.json"));
  t.check(sidecar, richDoc.comments);

  // When the upstream comments are all removed, the next sync deletes the
  // sidecar and drops the `comments:` ref from the card:

  // doctest:L401
  richDoc.comments = [];
  // Bump modifiedTime so the doc re-pulls (otherwise nothing changed upstream).
  const f6 = drive.files.find((f) => f.id === "doc-6");
  if (f6) f6.modifiedTime = "2026-04-26T12:00:00Z";

  // doctest:L406
  await connector.sync();

  // doctest:L408
  t.check(await access(join(box.root, "_content/drive/Feedback.attach/Feedback.comments.json")).then(() => "exists", () => "gone"), "gone");

  // doctest:L411
  t.checkText(await box.read("_content/drive/Feedback.gdoc.card"), `---
drive:
  id: doc-6
  link: https://docs.google.com/document/d/doc-6/edit
  owner: test@example.com
  modified: «date»
  revision: rev-1
title: Feedback
content:
  ref: attach/Feedback.md
---`);

  // doctest:L414
  t.check(
    // The sidecar deletion was staged and committed — no stray deletion left
    // dangling in the working tree.
    execSync("git status --porcelain", { cwd: box.root, encoding: "utf-8" }).trim(),
    "",
  );
});

// ## Inspect — comments reported separately from lossy
//
// The `inspect()` preview (used by `bbx drive inspect`) reports the comment
// count under `details.comments`, not bucketed into the lossy tally.
void test("The inspect() preview (used by bbx drive inspect) reports the comment count u...", async (t) => {
  // doctest:L426
  const drive7 = docDrive({
    id: "doc-7",
    name: "Previewed",
    document: makeDoc({ id: "doc-7", title: "Previewed", markdown: "Body.\n", footnotes: 1, comments: 4 }),
  });

  // doctest:L432
  const file7 = await drive7.getFile("doc-7");
  const info7 = await docsHandler.inspect(file7, drive7);
  t.check(info7.details, {
    revisionId: "rev-1",
    lossy: { comments: 0, footnotes: 1, images: 0, equations: 0, suggestions: 0, tables: 0 },
    comments: 4,
  });
});

// ## Stripped trailing whitespace — refused, not pushed
//
// Google's markdown export encodes a line break inside a nested list item as
// trailing spaces. A local change that strips them is lint damage rather than an
// edit, and pushing it would collapse nested checklists into paragraphs upstream.
// Push refuses and parks the upstream copy as `.remote.md`, the same resolution
// path as a divergence conflict.
void test("Google's markdown export encodes a line break inside a nested list item as tr...", async (t) => {
  // doctest:L453
  const upstream = "- [ ] Parent  \n      - [ ] Child  \n";
  const { box, drive, connector } = await docBox({
    id: "doc-w",
    name: "Checklist",
    stem: "Checklist",
    doc: { markdown: upstream },
  });
  await connector.sync();

  // doctest:L462
  // An agent strips the trailing spaces to satisfy markdownlint MD009.
  await box.seed(
    "_content/drive/Checklist.attach/Checklist.md",
    "- [ ] Parent\n      - [ ] Child\n",
  );
  box.commitAll("strip trailing whitespace");

  // doctest:L469
  await connector.sync();

  // doctest:L471
  t.check(drive.contentUpdateLog, []);

  // The upstream copy is parked for resolution and the card gets `conflict: true`:

  // doctest:L478
  t.check(await box.read("_content/drive/Checklist.attach/Checklist.remote.md"), `- [ ] Parent  
      - [ ] Child  
`);

  // doctest:L481
  t.checkText(await box.read("_content/drive/Checklist.gdoc.card"), `---
drive:
  id: doc-w
  link: https://docs.google.com/document/d/doc-w/edit
  owner: test@example.com
  modified: «date»
  revision: rev-1
title: Checklist
content:
  ref: attach/Checklist.md
conflict: true
---`);

  // A real content edit bundled with the same whitespace strip is refused too — the
  // structural loss is identical, so the question is asked per line, not per file.
  // (Resolve the parked conflict first, as a human would.)

  // doctest:L490
  await unlink(join(box.root, "_content/drive/Checklist.attach/Checklist.remote.md"));
  await box.seed(
    "_content/drive/Checklist.attach/Checklist.md",
    "- [ ] Parent\n      - [x] Child\n",
  );
  box.commitAll("edit plus strip");

  // doctest:L497
  await connector.sync();

  // doctest:L499
  t.check(drive.contentUpdateLog, []);

  // The same edit that leaves the export's trailing whitespace alone is a real edit
  // and pushes:

  // doctest:L507
  await unlink(join(box.root, "_content/drive/Checklist.attach/Checklist.remote.md"));
  await box.seed(
    "_content/drive/Checklist.attach/Checklist.md",
    "- [ ] Parent  \n      - [x] Child  \n",
  );
  box.commitAll("real edit");

  // doctest:L514
  await connector.sync();

  // doctest:L516
  t.check(drive.contentUpdateLog, [
    { fileId: "doc-w", mimeType: "text/markdown", content: "- [ ] Parent  \n      - [x] Child  \n" },
  ]);
});
