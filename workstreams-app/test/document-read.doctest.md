# Reading a browsable document (src/server/document-read.ts)

The general browser addresses a **file**, repository-relative, with a workstream
as a lens over it — never a path segment you enter first
(`docs/plans/general-browser.md`). `relPath` arrives from a URL, so this is an
untrusted boundary: containment is checked lexically and again after `realpath`,
and content that is not served says why rather than arriving as an empty pane.

```ts setup
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

import {
  InvalidDocumentPathError,
  MAX_TEXT_BYTES,
  UnknownWorkstreamError,
  kindForPath,
  readDocument,
  rootForWorkstream,
} from "../src/server/document-read.js";

const mainRoot = await fs.mkdtemp(path.join(os.tmpdir(), "browse-main-"));
const wtRoot = await fs.mkdtemp(path.join(os.tmpdir(), "browse-wt-"));
const outside = await fs.mkdtemp(path.join(os.tmpdir(), "browse-outside-"));

await fs.mkdir(path.join(mainRoot, "beebox/docs/plans"), { recursive: true });
await fs.mkdir(path.join(mainRoot, "src"), { recursive: true });
await fs.writeFile(path.join(mainRoot, "beebox/docs/plans/foo.md"), "# Foo\n\nA plan.\n");
await fs.writeFile(path.join(mainRoot, "src/run.ts"), "export const x = 1;\n");
await fs.writeFile(path.join(mainRoot, "page.html"), "<h1>hi</h1>\n");
await fs.writeFile(path.join(mainRoot, "data.json"), '{"a":1}\n');
await fs.writeFile(path.join(outside, "secret.txt"), "not yours\n");

// The worktree holds a DIFFERENT version of the same address — the lens case.
await fs.mkdir(path.join(wtRoot, "beebox/docs/plans"), { recursive: true });
await fs.writeFile(path.join(wtRoot, "beebox/docs/plans/foo.md"), "# Foo\n\nEdited on a branch.\n");

// Only main is a git repo, so `tracked` has something real to answer.
await execa("git", ["init", "-q"], { cwd: mainRoot });
await execa("git", ["add", "beebox/docs/plans/foo.md"], { cwd: mainRoot });

const roots = { mainRoot, worktreeRoots: new Map([["demo", wtRoot]]) };
const read = (relPath: string, workstream: string | null = null) =>
  readDocument(roots, { relPath, workstream });
```

## Kind is a closed union, chosen by extension

Extension-driven because that is what the developer sees in the path. No
extension reads as `code`, which is the renderer that degrades best.

```ts
const kinds = ["a.md", "b.ts", "c.html", "d.json", "Makefile", "e.PNGX"].map(kindForPath);
JSON.stringify(kinds)
=> ["markdown","code","page","data","code","code"]
```

## A workstream is a lens, not a location

The same address reads differently through the lens, and the document says which
checkout answered.

```ts
const onMain = await read("beebox/docs/plans/foo.md");
const onBranch = await read("beebox/docs/plans/foo.md", "demo");
const lens = {
  sameAddress: onMain.relPath === onBranch.relPath,
  mainWorkstream: onMain.workstream,
  branchWorkstream: onBranch.workstream,
  differs: onMain.text !== onBranch.text,
  mainTracked: onMain.tracked,
};
JSON.stringify(lens)
=> {"sameAddress":true,"mainWorkstream":null,"branchWorkstream":"demo","differs":true,"mainTracked":true}
```

An unknown workstream is refused by name — the browser can say which worktree it
could not find, rather than rendering main's copy as if it were the branch's.

```ts
const unknown = await read("beebox/docs/plans/foo.md", "ghost")
  .then(() => "ALLOWED", (e: unknown) => (e instanceof Error ? e.name : "unknown"));
JSON.stringify({ unknown, mainRootIsDefault: rootForWorkstream(roots, null) === mainRoot })
=> {"unknown":"UnknownWorkstreamError","mainRootIsDefault":true}
```

## Paths cannot escape the checkout

Traversal, absolute paths, and a NUL byte are all refused rather than clamped.

```ts
const escapes = ["../escape.md", "beebox/../../escape.md", "/etc/passwd", `a${"\u0000"}b`];
const named = (e: unknown) => (e instanceof Error ? e.name : "unknown");
const outcomes = await Promise.all(escapes.map((relPath) => read(relPath).then(() => "ALLOWED", named)));
JSON.stringify(outcomes)
=> ["InvalidDocumentPathError","InvalidDocumentPathError","InvalidDocumentPathError","InvalidDocumentPathError"]
```

A **symlink** pointing out of the checkout passes every lexical check, which is
why containment is re-checked after `realpath`.

```ts continue
await fs.symlink(path.join(outside, "secret.txt"), path.join(mainRoot, "escape-link.txt"));
const viaSymlink = await read("escape-link.txt")
  .then((d) => `LEAKED: ${String(d.text)}`, (e: unknown) => (e instanceof Error ? e.name : "unknown"));
viaSymlink
=> InvalidDocumentPathError
```

## A directory is a browsable thing

Directories sort first, dotfiles are hidden, and each entry carries the address
the browser links to — so a listing is navigable rather than a dead end.

```ts
const dir = await read("beebox/docs");
JSON.stringify({ kind: dir.kind, entries: dir.entries, text: dir.text })
=> {"kind":"directory","entries":[{"name":"plans","relPath":"beebox/docs/plans","kind":"directory"}],"text":null}
```

The repository root is a legal address, spelled `""`.

```ts
const root = await read("");
JSON.stringify({ kind: root.kind, hasEntries: root.entries.length > 0 })
=> {"kind":"directory","hasEntries":true}
```

## Content that is not served says why

"No content" and "content we would not read" must not look alike, so `text` is
null and `problem` carries the reason.

```ts
await fs.writeFile(path.join(mainRoot, "binary.bin"), Buffer.from([0x41, 0x00, 0x42]));
const binary = await read("binary.bin");

const bigPath = path.join(mainRoot, "big.ts");
await fs.writeFile(bigPath, "x".repeat(MAX_TEXT_BYTES + 1024));
const big = await read("big.ts");

const refusals = {
  binaryText: binary.text,
  binaryNamed: binary.problem?.includes("not text") ?? false,
  bigText: big.text,
  bigNamed: big.problem?.includes("read limit") ?? false,
  bigBytesReported: big.bytes > MAX_TEXT_BYTES,
};
JSON.stringify(refusals)
=> {"binaryText":null,"binaryNamed":true,"bigText":null,"bigNamed":true,"bigBytesReported":true}
```

"That path is not here" and "you asked for something outside this checkout" are
different answers and arrive as different errors — the first is a 404 the
browser renders, the second is a refusal. A traversal that names a *missing*
file is still a refusal, which is why the nearest existing ancestor is checked.

```ts
const nameOf = (e: unknown) => (e instanceof Error ? e.name : "unknown");
const missing = await read("no/such/file.md").then(() => "ALLOWED", nameOf);
const missingDir = await read("no/such/dir/deeper/file.md").then(() => "ALLOWED", nameOf);
const escapingMissing = await read("../../nope/never.md").then(() => "ALLOWED", nameOf);
JSON.stringify({ missing, missingDir, escapingMissing })
=> {"missing":"DocumentNotFoundError","missingDir":"DocumentNotFoundError","escapingMissing":"InvalidDocumentPathError"}
```

## Untracked files are readable, and say so

The store's namespace choice depends on this, and the browser lists untracked
work deliberately — `scratch/` is where agents leave notes worth reading.

```ts
await fs.mkdir(path.join(mainRoot, "scratch"), { recursive: true });
await fs.writeFile(path.join(mainRoot, "scratch/notes.md"), "# Notes\n");
const notes = await read("scratch/notes.md");
JSON.stringify({ kind: notes.kind, tracked: notes.tracked, hasText: notes.text !== null })
=> {"kind":"markdown","tracked":false,"hasText":true}
```

```ts cleanup
await Promise.all([
  fs.rm(mainRoot, { recursive: true, force: true }),
  fs.rm(wtRoot, { recursive: true, force: true }),
  fs.rm(outside, { recursive: true, force: true }),
]);
```
