# Google Drive Connector — Google Docs

Tests for the `drive-handler-docs` handler using fake services.

```ts setup
import { join } from "node:path";
import { readFile, access, unlink, writeFile } from "node:fs/promises";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { initBox } from "../src/core/box.js";
import {
  createFakeGoogleDrive,
  type FakeDocument,
} from "../src/services/google-drive.js";
import { createGoogleDriveConnector } from "../src/connectors/google-drive.js";
import { createGdocTemplate } from "../src/schemas/gdoc.js";

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
```

## Pull — creates card and markdown file from a Google Doc

A new doc card produces a `.md` file inside the card's attach scope.

```
const box = await makeTmpBox({ git: true });
await initBox(box.root);
box.commitAll("init box");

const drive = createFakeGoogleDrive({
  files: [{
    id: "doc-1",
    name: "Project Notes",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-04-26T10:00:00Z",
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/document/d/doc-1/edit",
  }],
  documents: new Map([["doc-1", makeDoc({
    id: "doc-1",
    title: "Project Notes",
    markdown: "# Notes\n\nFirst paragraph.\n",
  })]]),
});

await box.seed("store/drive/Project_Notes.gdoc.card", createGdocTemplate({
  driveId: "doc-1",
  title: "Project Notes",
  modified: "2026-04-26T10:00:00Z",
  revision: "rev-1",
  link: "https://docs.google.com/document/d/doc-1/edit",
  owner: "test@example.com",
  contentFile: "Project_Notes.md",
  status: "new",
}));
box.commitAll("add doc card");

const connector = createGoogleDriveConnector(box.root, drive);
const result = await connector.sync();
result.success
=> true

JSON.stringify(await box.read("store/drive/Project_Notes.attach/Project_Notes.md"))
=> "# Notes\n\nFirst paragraph.\n"
```

The card now has status synced and the upstream revision recorded:

``` continue
const card = await box.read("store/drive/Project_Notes.gdoc.card");
card.includes("drive-id: doc-1")
=> true

card.includes("status: synced")
=> true

card.includes("revision: rev-1")
=> true
```

An agent-written `contains:` survives the next sync's card rebuild
(connector templates preserve agent-owned fields), and a sync that
changes nothing else doesn't rewrite the card:

``` continue
await box.write(
  "store/drive/Project_Notes.gdoc.card",
  card.replace("drive-id: doc-1", "contains: Planning notes for the project kickoff.\ndrive-id: doc-1")
);
box.commitAll("agent adds contains");
const resync = await connector.sync();
resync.success
=> true

const resynced = await box.read("store/drive/Project_Notes.gdoc.card");
resynced.includes("contains: Planning notes for the project kickoff.")
=> true
```

## Pull — lossy content surfaces in the card

Comments, footnotes, and inline objects appear as `<item>` entries.

```
const box2 = await makeTmpBox({ git: true });
await initBox(box2.root);
box2.commitAll("init box");

const drive2 = createFakeGoogleDrive({
  files: [{
    id: "doc-2",
    name: "Reviewed Doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-04-26T10:00:00Z",
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/document/d/doc-2/edit",
  }],
  documents: new Map([["doc-2", makeDoc({
    id: "doc-2",
    title: "Reviewed Doc",
    markdown: "Body.\n",
    inlineObjects: 2,
    footnotes: 1,
    comments: 3,
  })]]),
});

await box2.seed("store/drive/Reviewed_Doc.gdoc.card", createGdocTemplate({
  driveId: "doc-2",
  title: "Reviewed Doc",
  modified: "2026-04-26T10:00:00Z",
  revision: "rev-1",
  link: "https://docs.google.com/document/d/doc-2/edit",
  owner: "test@example.com",
  contentFile: "Reviewed_Doc.md",
  status: "new",
}));
box2.commitAll("add reviewed doc");

await createGoogleDriveConnector(box2.root, drive2).sync();

const card2 = await box2.read("store/drive/Reviewed_Doc.gdoc.card");
card2.includes("type: comments") && card2.includes("count: 3")
=> true

card2.includes("type: footnotes") && card2.includes("count: 1")
=> true

card2.includes("type: images") && card2.includes("count: 2")
=> true
```

## Push — local markdown edit pushes to Drive

When the local `.md` (inside the doc's attach scope) differs from the last-pulled content and remote hasn't changed, the new content is uploaded.

```
const box3 = await makeTmpBox({ git: true });
await initBox(box3.root);
box3.commitAll("init box");

const drive3 = createFakeGoogleDrive({
  files: [{
    id: "doc-3",
    name: "Editable",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-04-26T10:00:00Z",
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/document/d/doc-3/edit",
  }],
  documents: new Map([["doc-3", makeDoc({
    id: "doc-3",
    title: "Editable",
    markdown: "Original.\n",
  })]]),
});

await box3.seed("store/drive/Editable.gdoc.card", createGdocTemplate({
  driveId: "doc-3",
  title: "Editable",
  modified: "2026-04-26T10:00:00Z",
  revision: "rev-1",
  link: "https://docs.google.com/document/d/doc-3/edit",
  owner: "test@example.com",
  contentFile: "Editable.md",
  status: "new",
}));
box3.commitAll("add editable");

const conn3 = createGoogleDriveConnector(box3.root, drive3);
await conn3.sync();

// Edit locally — the .md lives inside the doc's attach scope.
await box3.seed("store/drive/Editable.attach/Editable.md", "Edited body.\n");
box3.commitAll("local edit");

await conn3.sync();

drive3.contentUpdateLog.length
=> 1

drive3.contentUpdateLog[0]?.mimeType
=> text/markdown

drive3.contentUpdateLog[0]?.content
=> Edited body.
```

## Conflict — remote changed since last pull

When both local and remote have changed, push refuses to overwrite. The upstream content is written to a `.remote.md` inside the attach scope and the card status flips to `conflict`.

```
const box4 = await makeTmpBox({ git: true });
await initBox(box4.root);
box4.commitAll("init box");

const driveDoc = makeDoc({
  id: "doc-4",
  title: "Contended",
  markdown: "Original.\n",
});
const drive4 = createFakeGoogleDrive({
  files: [{
    id: "doc-4",
    name: "Contended",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-04-26T10:00:00Z",
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/document/d/doc-4/edit",
  }],
  documents: new Map([["doc-4", driveDoc]]),
});

await box4.seed("store/drive/Contended.gdoc.card", createGdocTemplate({
  driveId: "doc-4",
  title: "Contended",
  modified: "2026-04-26T10:00:00Z",
  revision: "rev-1",
  link: "https://docs.google.com/document/d/doc-4/edit",
  owner: "test@example.com",
  contentFile: "Contended.md",
  status: "new",
}));
box4.commitAll("add contended");

const conn4 = createGoogleDriveConnector(box4.root, drive4);
await conn4.sync();

// Local edit.
await box4.seed("store/drive/Contended.attach/Contended.md", "Local edit.\n");
box4.commitAll("local edit");

// Remote edit (simulated by changing the doc's revision and exported markdown
// out-of-band, plus bumping the file's modifiedTime).
driveDoc.structure.revisionId = "rev-2";
driveDoc.exports.set("text/markdown", "Remote edit.\n");
const remoteFile = drive4.files.find((f) => f.id === "doc-4");
if (remoteFile) remoteFile.modifiedTime = "2026-04-26T12:00:00Z";

await conn4.sync();

// Local file is unchanged — push refused.
await box4.read("store/drive/Contended.attach/Contended.md")
=> Local edit.

// .remote.md was written with the upstream content.
await box4.read("store/drive/Contended.attach/Contended.remote.md")
=> Remote edit.

// No content was uploaded (push aborted).
drive4.contentUpdateLog.length
=> 0

// Card flipped to conflict status.
const card4 = await box4.read("store/drive/Contended.gdoc.card");
card4.includes("status: conflict")
=> true
```

## Conflict — push stays skipped until `.remote.md` is removed

While `.remote.md` exists, subsequent syncs don't push the still-unmerged local file.

``` continue
// User does nothing — sync again.
await conn4.sync();
drive4.contentUpdateLog.length
=> 0

// User resolves: writes the merged version, deletes .remote.md, commits.
await box4.seed("store/drive/Contended.attach/Contended.md", "Merged.\n");
await unlink(join(box4.root, "store/drive/Contended.attach/Contended.remote.md"));
box4.commitAll("resolve conflict");

await conn4.sync();

drive4.contentUpdateLog.length
=> 1

drive4.contentUpdateLog[0]?.content
=> Merged.
```

## Graceful degradation when Docs API is unavailable

If `getDocument` fails (e.g. the auth token lacks the `documents.readonly` scope), pull still succeeds — markdown is exported via the Drive API and the lossy block falls back to comment count only.

```
const box5 = await makeTmpBox({ git: true });
await initBox(box5.root);
box5.commitAll("init box");

const drive5 = createFakeGoogleDrive({
  files: [{
    id: "doc-5",
    name: "Degraded",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-04-26T10:00:00Z",
    owners: [{ emailAddress: "test@example.com" }],
    webViewLink: "https://docs.google.com/document/d/doc-5/edit",
  }],
  documents: new Map([["doc-5", makeDoc({
    id: "doc-5",
    title: "Degraded",
    markdown: "Body.\n",
    inlineObjects: 5,
    comments: 2,
  })]]),
});

// Simulate a 403 by replacing getDocument with a stub that throws.
drive5.getDocument = async () => {
  throw new Error("HTTPError: 403 Insufficient Permission");
};

await box5.seed("store/drive/Degraded.gdoc.card", createGdocTemplate({
  driveId: "doc-5",
  title: "Degraded",
  modified: "2026-04-26T10:00:00Z",
  revision: "rev-1",
  link: "https://docs.google.com/document/d/doc-5/edit",
  owner: "test@example.com",
  contentFile: "Degraded.md",
  status: "new",
}));
box5.commitAll("add degraded");

const result5 = await createGoogleDriveConnector(box5.root, drive5).sync();
result5.success
=> true

// Markdown still pulled.
await box5.read("store/drive/Degraded.attach/Degraded.md")
=> Body.

// Card still written, falls back to Drive metadata title.
const card5 = await box5.read("store/drive/Degraded.gdoc.card");
card5.includes("title: Degraded")
=> true

// Lossy block contains comments (Drive API) but NOT images (Docs API).
card5.includes("type: comments") && card5.includes("count: 2")
=> true

card5.includes("type: images")
=> false
```
