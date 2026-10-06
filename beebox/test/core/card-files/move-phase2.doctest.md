# Moving attachments with git-annex pointers

Card attachment scopes and standalone files can contain relative symlinks into
the box's annex object store. Moving them deeper in the tree must preserve the
link, and retrying a partially completed move must repair it.

```ts setup
import * as fs from "node:fs/promises";
import { movePhase2CardFiles, movePathPreservingAnnexSymlink } from "../../../src/core/card-files/move-phase2.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

The card move and the standalone file move both retain access to their object.
An unrelated relative symlink keeps its original text.

```ts
const box = await makeTmpBox();
const object = box.path(".git/annex/objects/aa/bb/SHA256E--asset.bin");
await fs.mkdir(box.path("_content/inbox/staged/Note.attach"), { recursive: true });
await fs.mkdir(box.path("_content/inbox"), { recursive: true });
await fs.mkdir(box.path(".git/annex/objects/aa/bb"), { recursive: true });
await fs.writeFile(object, "annex bytes");
await fs.writeFile(box.path("_content/inbox/staged/Note.memo.card"), "card");
const attach = box.path("_content/inbox/staged/Note.attach");
await fs.symlink("../../../../.git/annex/objects/aa/bb/SHA256E--asset.bin", `${attach}/asset.bin`);
await fs.writeFile(`${attach}/neighbor.bin`, "neighbor");
await fs.symlink("neighbor.bin", `${attach}/neighbor-link.bin`);
await movePhase2CardFiles(
  box.path("_content/inbox/staged/Note.memo.card"),
  box.path("_content/inbox/triaged/Filed/Note.memo.card"),
);
const filedAttach = box.path("_content/inbox/triaged/Filed/Note.attach");
const filed = await fs.readFile(`${filedAttach}/asset.bin`, "utf8");
const unrelatedLink = await fs.readlink(`${filedAttach}/neighbor-link.bin`);
await movePathPreservingAnnexSymlink(attach, filedAttach);
const filedAfterRetry = await fs.readFile(`${filedAttach}/asset.bin`, "utf8");

await fs.symlink("../../../.git/annex/objects/aa/bb/SHA256E--asset.bin", box.path("_content/inbox/staged/raw.pdf"));
await movePhase2CardFiles(
  box.path("_content/inbox/staged/raw.pdf"),
  box.path("_content/inbox/triaged/Filed/raw.pdf"),
);
const standalone = await fs.readFile(box.path("_content/inbox/triaged/Filed/raw.pdf"), "utf8");
await movePathPreservingAnnexSymlink(
  box.path("_content/inbox/staged/raw.pdf"),
  box.path("_content/inbox/triaged/Filed/raw.pdf"),
);
const standaloneAfterRetry = await fs.readFile(box.path("_content/inbox/triaged/Filed/raw.pdf"), "utf8");
JSON.stringify({ filed, filedAfterRetry, standalone, standaloneAfterRetry, unrelatedLink })
=> {"filed":"annex bytes","filedAfterRetry":"annex bytes","standalone":"annex bytes","standaloneAfterRetry":"annex bytes","unrelatedLink":"neighbor.bin"}
```

Recovery uses the original source location to interpret unchanged link text
after the directory rename already succeeded.

```ts continue
await fs.mkdir(box.path("_content/inbox/intake/Recover.memo.attach"), { recursive: true });
await fs.symlink("../../../../.git/annex/objects/aa/bb/SHA256E--asset.bin", box.path("_content/inbox/intake/Recover.memo.attach/asset.bin"));
const oldScope = box.path("_content/inbox/intake/Recover.memo.attach");
const newScope = box.path("_content/inbox/triaged/Filed/Recover.memo.attach");
await fs.mkdir(box.path("_content/inbox/triaged/Filed"), { recursive: true });
await fs.rename(oldScope, newScope);
await movePathPreservingAnnexSymlink(oldScope, newScope);
await fs.readFile(`${newScope}/asset.bin`, "utf8")
=> annex bytes
```

```ts cleanup
await box.cleanup();
```

Cards without attachments still move normally.
Both missing paths produce a visible retry failure.

```ts
const plain = await makeTmpBox();
await fs.writeFile(plain.path("_content/inbox/intake/Plain.memo.card"), "card");
(await movePhase2CardFiles(
  plain.path("_content/inbox/intake/Plain.memo.card"),
  plain.path("_content/inbox/staged/Plain.memo.card"),
)).length
=> 1

(await movePathPreservingAnnexSymlink(
  plain.path("_content/inbox/missing.pdf"),
  plain.path("_content/inbox/staged/missing.pdf"),
).then(() => "unexpected success", (error: Error) => error.name))
=> AnnexPreservingMoveError
```

```ts cleanup
await plain.cleanup();
```
