# Git history filtered by card path

Path history follows a card through a rename and remains available after the
current path is deleted. This is the shared contract behind the card action
menu and the useful missing-card state.

```ts setup
import { rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getLogPaginated } from "../../src/lib/git.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

```ts
const box = await makeTmpBox({ git: true });
await box.write("box/notes/Original.doc.card", "---\ntype: doc\ntitle: Original\n---\n");
await box.commitAll("Create original");
await rename(join(box.root, "box/notes/Original.doc.card"), join(box.root, "box/notes/Renamed.doc.card"));
await box.commitAll("Rename card");

const beforeDelete = await getLogPaginated({ boxRoot: box.root, filter: { path: "box/notes/Renamed.doc.card" } });
beforeDelete.map((commit) => commit.subject).join(" | ")
=> Rename card | Create original

await unlink(join(box.root, "box/notes/Renamed.doc.card"));
await box.commitAll("Delete card");
const afterDelete = await getLogPaginated({ boxRoot: box.root, filter: { path: "box/notes/Renamed.doc.card" } });
afterDelete.map((commit) => commit.subject).join(" | ")
=> Delete card | Rename card | Create original
```
