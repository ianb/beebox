# Document-comment store (bin/lib/comments-store.ts)

Comments are the boxholder talking to an agent about a document: a remark
anchored to a span, written from a browser, waiting outside git until an agent
reads it and clears it. The store is the third persistence class — beside the
main checkout, surviving a worktree cull, never merged
(`docs/plans/document-comments.md`).

Two properties carry most of the risk and are tested hardest here: **a path may
never escape the store**, and **a file that does not parse is reported rather
than read as empty** — claiming "no comments" would hide what the boxholder
said.

```ts setup
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COMMENTS_SUFFIX,
  STORE_MARKER,
  appendComment,
  byNewest,
  clearComments,
  commentsFilePath,
  defaultStoreRoot,
  initStore,
  listAll,
  readComments,
  subjectKey,
  type Comment,
  type Subject,
} from "../../../bin/lib/comments-store.js";

const root = await mkdtemp(join(tmpdir(), "comments-store-doctest-"));
const store = join(root, "dev-comments");
await initStore(store);

const tracked: Subject = { scope: "tracked", relPath: "callback-box/docs/plans/foo.md" };
const scratch: Subject = { scope: "worktree", worktree: "dev-comments", relPath: "scratch/notes.md" };

function comment(over: Partial<Comment>): Comment {
  return {
    id: "c-0001",
    at: "2026-08-22T14:03:11Z",
    origin: "typed",
    body: "This assumes the router restarts.",
    workstream: null,
    worktree: "dev-comments",
    ...over,
  };
}
```

## Two namespaces, because a path is not a document

A tracked file is the same file in every checkout, so its comments follow it. An
untracked one is not — two worktrees routinely hold different `scratch/notes.md`
— so those are keyed by worktree and never merge.

```ts
const keys = { tracked: subjectKey(tracked), scratch: subjectKey(scratch) };
JSON.stringify(keys)
=> {"tracked":"tracked/callback-box/docs/plans/foo.md.comments.yaml","scratch":"worktree/dev-comments/scratch/notes.md.comments.yaml"}
```

## Paths cannot escape the store

Every shape below is a write outside the store if the guard is missing. The `..`
check runs before the join; the containment re-check after it holds even if that
guard is ever loosened. A path that merely needs normalizing is refused too,
rather than silently rewritten — the caller passed something it did not mean.

```ts
const escapes = [
  { scope: "tracked", relPath: "../../etc/passwd" },
  { scope: "tracked", relPath: "/etc/passwd" },
  { scope: "tracked", relPath: "a/../../b" },
  { scope: "tracked", relPath: "" },
  { scope: "tracked", relPath: "a/./b.md" },
  { scope: "worktree", worktree: "../evil", relPath: "notes.md" },
  { scope: "worktree", worktree: "has/slash", relPath: "notes.md" },
] satisfies Subject[];

function refusalName(subject: Subject): string {
  try {
    commentsFilePath(store, subject);
    return "ALLOWED";
  } catch (e) {
    return e instanceof Error ? e.name : "unknown";
  }
}
const outcomes = escapes.map(refusalName);
JSON.stringify(outcomes)
=> ["InvalidCommentPathError","InvalidCommentPathError","InvalidCommentPathError","InvalidCommentPathError","InvalidCommentPathError","InvalidCommentPathError","InvalidCommentPathError"]
```

A **symlinked ancestor** is the escape a lexical check cannot see: if
`$store/tracked` points somewhere else, every write under it lands outside the
store and every delete deletes someone else's file. Each component from the root
down is checked, so this is refused on read, on append, and on clear.

```ts
const outside = join(root, "outside");
await mkdir(outside, { recursive: true });
const linked = join(store, "linked");
await symlink(outside, linked);
const viaLink: Subject = { scope: "tracked", relPath: "x.md" };

// Point the `tracked` namespace itself at somewhere else.
const trackedDir = join(store, "tracked");
await rm(trackedDir, { recursive: true, force: true });
await symlink(outside, trackedDir);

const readRefusal = await readComments(store, viaLink);
const appendRefusal = await appendComment(store, { subject: viaLink, comment: comment({}) })
  .then(() => "ALLOWED", (e: unknown) => (e instanceof Error ? e.name : "unknown"));
const clearRefusal = await clearComments(store, { subject: viaLink })
  .then(() => "ALLOWED", (e: unknown) => (e instanceof Error ? e.name : "unknown"));
const escaped = await readdir(outside);

await rm(trackedDir);
await rm(linked);
const symlinkGuard = {
  readNamed: readRefusal.problem?.includes("refusing to follow it out of the store") ?? false,
  append: appendRefusal,
  clear: clearRefusal,
  nothingWrittenOutside: escaped.length === 0,
};
JSON.stringify(symlinkGuard)
=> {"readNamed":true,"append":"InvalidCommentPathError","clear":"InvalidCommentPathError","nothingWrittenOutside":true}
```

A `..` **segment** is an escape; a filename that merely starts with `..` is a
legal document and must not be refused.

```ts
subjectKey({ scope: "tracked", relPath: "..notes.md" })
=> tracked/..notes.md.comments.yaml
```

## Appending, and reading back newest-first

```ts
await appendComment(store, { subject: tracked, comment: comment({}) });
await appendComment(store, {
  subject: tracked,
  comment: comment({ id: "c-0002", at: "2026-08-22T15:00:00Z", origin: "voice", body: "Second." }),
});

const read = await readComments(store, tracked);
const summary = { problem: read.problem, count: read.comments.length, newest: byNewest(read.comments)[0]?.id };
JSON.stringify(summary)
=> {"problem":null,"count":2,"newest":"c-0002"}
```

The file on disk is plain YAML an agent can `cat` — the quoted text carries the
meaning whether or not anything ever re-resolves the anchor.

```ts
const onDisk = await readFile(commentsFilePath(store, tracked), "utf8");
onDisk.split("\n").slice(0, 3).join(" | ")
=> version: 1 | comments: |   - id: c-0001
```

## An unparseable file is reported, never read as empty

This is the property that keeps a corrupted store from looking like a quiet one.
A file that is valid YAML but not a comments file is refused the same way, with
the schema issue named.

```ts
const broken: Subject = { scope: "tracked", relPath: "broken.md" };
await mkdir(join(store, "tracked"), { recursive: true });

await writeFile(commentsFilePath(store, broken), "version: 1\ncomments: [oops\n", "utf8");
const badYaml = await readComments(store, broken);

await writeFile(commentsFilePath(store, broken), "version: 99\ncomments: []\n", "utf8");
const badShape = await readComments(store, broken);

const problems = {
  yamlEmpty: badYaml.comments.length === 0,
  yamlNamed: badYaml.problem?.includes("not valid YAML") ?? false,
  shapeNamed: badShape.problem?.includes("does not match the comments schema") ?? false,
};
JSON.stringify(problems)
=> {"yamlEmpty":true,"yamlNamed":true,"shapeNamed":true}
```

Appending over a file we could not read is refused rather than overwriting it —
the remarks are still on disk and a human can still recover them.

```ts continue
const refusal = await appendComment(store, { subject: broken, comment: comment({}) })
  .then(() => "ALLOWED", (e: unknown) => (e instanceof Error ? e.message : "unknown"));
await rm(commentsFilePath(store, broken));
const refusedAppend = refusal.includes("refusing to append over an unreadable file");
refusedAppend
=> true
```

## Concurrent appends to one document do not lose an update

Two browser tabs commenting on one document land in the same process, where a
lost update is invisible to any file lock.

```ts
const many: Subject = { scope: "tracked", relPath: "busy.md" };
await Promise.all(
  Array.from({ length: 8 }, (_unused, i) =>
    appendComment(store, {
      subject: many,
      comment: comment({ id: `c-${String(i)}`, at: `2026-08-22T16:0${String(i)}:00Z` }),
    }),
  ),
);
(await readComments(store, many)).comments.length
=> 8
```

## An unmarked directory is refused

A mistyped `CALLBACK_COMMENTS_ROOT` would otherwise scatter comment files
through an unrelated tree.

```ts
const unmarked = join(root, "not-a-store");
await mkdir(unmarked, { recursive: true });
const refused = await appendComment(unmarked, { subject: tracked, comment: comment({}) })
  .then(() => "ALLOWED", (e: unknown) => (e instanceof Error ? e.name : "unknown"));

// Listing must refuse it too. Walking an unmarked root would let
// CALLBACK_COMMENTS_ROOT=$HOME recurse an unrelated tree and report whatever
// `.comments.yaml` files it found there as waiting comments.
const listRefused = await listAll(unmarked)
  .then(() => "ALLOWED", (e: unknown) => (e instanceof Error ? e.name : "unknown"));

// A DIRECTORY named .dev-comments is not a marker.
const fakeMarker = join(root, "fake-store");
await mkdir(join(fakeMarker, STORE_MARKER), { recursive: true });
const fakeRefused = await appendComment(fakeMarker, { subject: tracked, comment: comment({}) })
  .then(() => "ALLOWED", (e: unknown) => (e instanceof Error ? e.name : "unknown"));

const guard = { refused, listRefused, fakeRefused, marker: STORE_MARKER, suffix: COMMENTS_SUFFIX };
JSON.stringify(guard)
=> {"refused":"UninitializedCommentStoreError","listRefused":"UninitializedCommentStoreError","fakeRefused":"UninitializedCommentStoreError","marker":".dev-comments","suffix":".comments.yaml"}
```

A store root that does not exist at all is genuinely empty — that is the state
before anyone has commented, and it is not an error.

```ts
(await listAll(join(root, "never-created"))).length
=> 0
```

## Listing answers both questions from one store

The store is file-keyed, so "what is on this document" is a read and "what is
addressed to this workstream" is a filter over the listing. One store, two
readings, no second index.

```ts
await appendComment(store, {
  subject: scratch,
  comment: comment({ id: "c-ws", workstream: "scanner-ingest", body: "For scanner." }),
});

// A hand-created file whose path is not a valid subject is REPORTED and skipped,
// not allowed to take the whole listing down with it.
await writeFile(join(store, "tracked", COMMENTS_SUFFIX), "version: 1\ncomments: []\n");

const entries = await listAll(store);
const forScanner = entries.flatMap((entry) =>
  entry.comments.filter((c) => c.workstream === "scanner-ingest").map((c) => c.body),
);
const malformed = entries.filter((entry) => entry.subject === null);
const listing = {
  withComments: entries.filter((e) => e.comments.length > 0).length,
  forScanner,
  malformedReported: malformed.length === 1,
  malformedNamed: malformed[0]?.problem?.includes("not a valid comment-store path") ?? false,
};
JSON.stringify(listing)
=> {"withComments":3,"forScanner":["For scanner."],"malformedReported":true,"malformedNamed":true}
```

## Clearing is how a comment stops waiting

Nothing expires on its own. Clearing the last comment removes the file, so a
listing shows nothing rather than an empty husk. Clearing an id that is not
there reports zero rather than pretending.

```ts
const removedOne = await clearComments(store, { subject: tracked, id: "c-0001" });
const afterOne = (await readComments(store, tracked)).comments.length;
const removedRest = await clearComments(store, { subject: tracked });
const listedAfter = await listAll(store);
const stillListed = listedAfter.some((e) => e.subject?.relPath === "callback-box/docs/plans/foo.md");
const missingId = await clearComments(store, { subject: scratch, id: "nope" });
const cleared = { removedOne, afterOne, removedRest, stillListed, missingId };
JSON.stringify(cleared)
=> {"removedOne":1,"afterOne":1,"removedRest":1,"stillListed":false,"missingId":0}
```

## The root sits beside the main checkout

Derived, never hardcoded — and overridable for tests and non-standard layouts,
the same shape `defaultStoreRoot` has in the exhibits store.

```ts
const previous = process.env["CALLBACK_COMMENTS_ROOT"];
delete process.env["CALLBACK_COMMENTS_ROOT"];
const derived = defaultStoreRoot("/checkouts/callback-box");
process.env["CALLBACK_COMMENTS_ROOT"] = "/tmp/pinned";
const overridden = defaultStoreRoot("/checkouts/callback-box");
if (previous === undefined) delete process.env["CALLBACK_COMMENTS_ROOT"];
else process.env["CALLBACK_COMMENTS_ROOT"] = previous;
const roots = { derived, overridden };
JSON.stringify(roots)
=> {"derived":"/checkouts/dev-comments","overridden":"/tmp/pinned"}
```

```ts cleanup
await rm(root, { recursive: true, force: true });
```
