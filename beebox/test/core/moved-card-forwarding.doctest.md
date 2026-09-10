# Recovering a card path from Git after a miss

The normal card read happens before this helper is called. Once that read has
reported `ENOENT`, the helper can recover an unstaged filesystem move without
changing the real Git index.

```ts setup
import { mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { parseGitRenameRecords, resolveMovedCardPath } from "../../src/core/moved-card-forwarding.js";
import { fileExists } from "../../src/lib/file-exists.js";

const CARD = `---
type: memo
title: A card with enough content for rename detection
---
The body stays recognizable when the card moves to another directory.
`;

function hasAnnex(): boolean {
  try {
    execFileSync("git", ["annex", "version"], { stdio: "pipe" });
    return true;
  } catch (_e) {
    /* ignore: absence is the answer */
    return false;
  }
}

const ANNEX = hasAnnex();
```

```ts
const box = await makeTmpBox({ git: true });
await box.seed("_content/Old.memo.card", CARD);
box.commitAll("seed old card");
await box.seed("_content/archive/.keep", "");
await rename(box.path("_content/Old.memo.card"), box.path("_content/archive/New.memo.card"));

JSON.stringify(await resolveMovedCardPath({ boxRoot: box.root, missingPath: "_content/Old.memo.card" }))
=> {"kind":"moved","path":"_content/archive/New.memo.card"}
```

The scratch lookup did not stage either end in the real index.

```ts continue
const status = simpleGit(box.root);
const realIndex = await status.diff(["--cached", "--name-status"]);
realIndex
=>
```

If a new card reuses the old path, that card wins before historical recovery.

```ts continue
await box.seed("_content/Old.memo.card", CARD.replace("title: A card", "title: Reused path"));
JSON.stringify(await resolveMovedCardPath({ boxRoot: box.root, missingPath: "_content/Old.memo.card" }))
=> {"kind":"not-moved"}
```

```ts cleanup
await box.cleanup();
```

The recovery relationship belongs to box files, not only typed `.card` files.
An unstaged Markdown move is detected through the same scratch index.

```ts
const markdown = await makeTmpBox({ git: true });
await markdown.seed("_content/documents/legal/status.md", "A sufficiently distinctive legal status document.\n");
markdown.commitAll("seed markdown document");
await markdown.seed("_content/archive/.keep", "");
await rename(
  markdown.path("_content/documents/legal/status.md"),
  markdown.path("_content/archive/legal-status.md"),
);

JSON.stringify(await resolveMovedCardPath({
  boxRoot: markdown.root,
  missingPath: "_content/documents/legal/status.md",
}))
=> {"kind":"moved","path":"_content/archive/legal-status.md"}
```

```ts cleanup
await markdown.cleanup();
```

The scratch lookup isolates Git filter state as well as the ordinary index and
object store. A clean filter that writes beneath `GIT_DIR` leaves no marker in
the real repository when recovery scans the whole box.

```ts
const filtered = await makeTmpBox({ git: true });
await filtered.seed("filter.mjs", `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.GIT_DIR ?? ".git", "filter-ran"), "ran");
process.stdin.pipe(process.stdout);
`);
await writeFile(filtered.path(".git/info/attributes"), "*.probe filter=probe\n");
const filteredGit = simpleGit({ baseDir: filtered.root, unsafe: { allowUnsafeFilter: true } });
await filteredGit.raw(["config", "filter.probe.clean", "node filter.mjs"]);
await filteredGit.raw(["config", "filter.probe.required", "true"]);
await filtered.seed("_content/Old.probe", "Filtered content that Git can recognize after a move.\n");
filtered.commitAll("seed filtered file");
await rm(filtered.path(".git/filter-ran"));
await rename(filtered.path("_content/Old.probe"), filtered.path("_content/New.probe"));

JSON.stringify({
  resolution: await resolveMovedCardPath({ boxRoot: filtered.root, missingPath: "_content/Old.probe" }),
  realFilterMarker: await fileExists(filtered.path(".git/filter-ran")),
})
=> {"resolution":{"kind":"moved","path":"_content/New.probe"},"realFilterMarker":false}
```

```ts cleanup
await filtered.cleanup();
```

A real git-annex move still produces the same rename, and its read-only scratch
objects are made removable before the recovery call returns.

```ts
async function annexMoveResult(): Promise<string> {
  const annex = await makeTmpBox({ git: true });
  try {
    execFileSync("git", ["annex", "init", "-q", "moved-path-test"], { cwd: annex.root, stdio: "pipe" });
    execFileSync("git", ["annex", "config", "--set", "annex.largefiles", "anything"], { cwd: annex.root, stdio: "pipe" });
    execFileSync("git", ["config", "annex.thin", "false"], { cwd: annex.root, stdio: "pipe" });
    await writeFile(annex.path("_content/Old.bin"), Buffer.alloc(200_000, 0x42));
    annex.commitAll("seed annex asset");
    execFileSync("git", ["annex", "unlock", "_content/Old.bin"], { cwd: annex.root, stdio: "pipe" });
    await rename(annex.path("_content/Old.bin"), annex.path("_content/New.bin"));
    return JSON.stringify(await resolveMovedCardPath({ boxRoot: annex.root, missingPath: "_content/Old.bin" }));
  } finally {
    try {
      execFileSync("chmod", ["-R", "u+w", annex.root], { stdio: "pipe" });
    } catch (_e) {
      /* ignore: best-effort; cleanup reports anything that actually matters */
    }
    await annex.cleanup();
  }
}

ANNEX ? await annexMoveResult() : '{"kind":"moved","path":"_content/New.bin"}'
=> {"kind":"moved","path":"_content/New.bin"}
```

## Committed and chained moves

A committed rename is read from the latest commit that touched the old path.
The same lookup follows a committed move into a second, still-uncommitted move.

```ts
const chain = await makeTmpBox({ git: true });
await chain.seed("_content/First.memo.card", CARD);
chain.commitAll("seed first path");
await rename(chain.path("_content/First.memo.card"), chain.path("_content/Second.memo.card"));
chain.commitAll("first move");
await rename(chain.path("_content/Second.memo.card"), chain.path("_content/Third.memo.card"));

JSON.stringify(await resolveMovedCardPath({ boxRoot: chain.root, missingPath: "_content/First.memo.card" }))
=> {"kind":"moved","path":"_content/Third.memo.card"}
```

```ts cleanup
await chain.cleanup();
```

## Directory moves are recovered per card

Git reports the cards inside a renamed directory as ordinary rename records,
so the resolver needs no separate directory-forwarding format.

```ts
const directory = await makeTmpBox({ git: true });
await directory.seed("_content/session/Note.memo.card", CARD);
directory.commitAll("seed session");
await rename(directory.path("_content/session"), directory.path("_content/archive-session"));

JSON.stringify(await resolveMovedCardPath({
  boxRoot: directory.root,
  missingPath: "_content/session/Note.memo.card",
}))
=> {"kind":"moved","path":"_content/archive-session/Note.memo.card"}
```

```ts cleanup
await directory.cleanup();
```

## Unusual paths survive the full Git lookup

The NUL-delimited parser is exercised through Git as well as directly.

```ts
const unusual = await makeTmpBox({ git: true });
await unusual.seed("_content/Old name.memo.card", CARD);
unusual.commitAll("seed unusual path");
await rename(
  unusual.path("_content/Old name.memo.card"),
  unusual.path("_content/New\tname.memo.card"),
);

JSON.stringify(await resolveMovedCardPath({
  boxRoot: unusual.root,
  missingPath: "_content/Old name.memo.card",
}))
=> {"kind":"moved","path":"_content/New\tname.memo.card"}
```

```ts cleanup
await unusual.cleanup();
```

## Failing closed

An incomplete or unsafe record is not enough to navigate. A box without Git
also keeps the ordinary not-found result and reports the recovery failure to
the supplied warning boundary.

```ts
const plain = await makeTmpBox();
const warnings: string[] = [];
const result = await resolveMovedCardPath({
  boxRoot: plain.root,
  missingPath: "_content/Gone.memo.card",
  warn: message => warnings.push(message),
});
print(JSON.stringify(result));
warnings.length
=>
{"kind":"not-moved"}
1
```

```ts cleanup
await plain.cleanup();
```

A committed rename whose destination was later deleted or replaced by any
symlink stays an ordinary miss.

```ts
const deleted = await makeTmpBox({ git: true });
await deleted.seed("_content/Old.memo.card", CARD);
deleted.commitAll("seed deleted destination");
await rename(deleted.path("_content/Old.memo.card"), deleted.path("_content/Gone.memo.card"));
deleted.commitAll("move before delete");
await rm(deleted.path("_content/Gone.memo.card"));
JSON.stringify(await resolveMovedCardPath({ boxRoot: deleted.root, missingPath: "_content/Old.memo.card" }))
=> {"kind":"not-moved"}
```

```ts cleanup
await deleted.cleanup();
```

```ts
const otherFile = await makeTmpBox({ git: true });
await otherFile.seed("_content/Old.txt", "A plain file whose identity survives its move.\n");
otherFile.commitAll("seed plain file");
await rename(otherFile.path("_content/Old.txt"), otherFile.path("_content/New.data"));
otherFile.commitAll("move plain file");
JSON.stringify(await resolveMovedCardPath({ boxRoot: otherFile.root, missingPath: "_content/Old.txt" }))
=> {"kind":"moved","path":"_content/New.data"}
```

```ts cleanup
await otherFile.cleanup();
```

```ts
const unsafe = await makeTmpBox({ git: true });
await unsafe.seed("_content/Old.memo.card", CARD);
unsafe.commitAll("seed unsafe destination");
await rename(unsafe.path("_content/Old.memo.card"), unsafe.path("_content/New.memo.card"));
unsafe.commitAll("move before symlink replacement");
const outsideRoot = await mkdtemp(join(tmpdir(), "bbx-move-outside-"));
const outsideCard = join(outsideRoot, "Outside.memo.card");
await writeFile(outsideCard, CARD);
await rm(unsafe.path("_content/New.memo.card"));
await symlink(outsideCard, unsafe.path("_content/New.memo.card"));
JSON.stringify(await resolveMovedCardPath({ boxRoot: unsafe.root, missingPath: "_content/Old.memo.card" }))
=> {"kind":"not-moved"}
```

```ts cleanup
await unsafe.cleanup();
await rm(outsideRoot, { recursive: true, force: true });
```

```ts
const insideSymlink = await makeTmpBox({ git: true });
await insideSymlink.seed("_content/Old.md", "A document that later becomes an in-box symlink.\n");
await insideSymlink.seed("_content/Other.md", "A different in-box document.\n");
insideSymlink.commitAll("seed in-box symlink case");
await rename(insideSymlink.path("_content/Old.md"), insideSymlink.path("_content/New.md"));
insideSymlink.commitAll("move before in-box symlink replacement");
await rm(insideSymlink.path("_content/New.md"));
await symlink("Other.md", insideSymlink.path("_content/New.md"));
JSON.stringify(await resolveMovedCardPath({ boxRoot: insideSymlink.root, missingPath: "_content/Old.md" }))
=> {"kind":"not-moved"}
```

```ts cleanup
await insideSymlink.cleanup();
```

The NUL parser preserves unusual filenames and rejects truncated records.

```ts
JSON.stringify(parseGitRenameRecords("R100\0_content/Old name.card\0_content/New\tname.card\0"))
=> [{"from":"_content/Old name.card","to":"_content/New\tname.card"}]

parseGitRenameRecords("R100\0_content/only-one-path.card\0")
=> null
```
