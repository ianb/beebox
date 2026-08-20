# Box inventory grouping

The inventory reports literal file types and a content-oriented projection where
an attachment scope rolls into its owning card. Runtime/dependency directories
are excluded, while loose files and orphaned attachment directories stay visible.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { scanBoxInventory } from "../src/core/box-inventory.js";
import { scanBoxRepositoryStats } from "../src/core/box-repository-stats.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const box = await makeTmpBox();
function hasAnnex(): boolean {
  try {
    execFileSync("git", ["annex", "version"], { stdio: "pipe" });
    return true;
  } catch (_error) {
    return false;
  }
}
await fs.mkdir(box.path("people"), { recursive: true });
await fs.writeFile(box.path("people/Alice.image.card"), "card");
await fs.mkdir(box.path("people/Alice.attach"));
await fs.writeFile(box.path("people/Alice.attach/photo.webp"), "123456");
await fs.writeFile(box.path("people/Alice.attach/nested.doc.card"), "nested");
await fs.mkdir(box.path("people/Alice.attach/nested.attach"));
await fs.writeFile(box.path("people/Alice.attach/nested.attach/page.bin"), "page");
await fs.writeFile(box.path("people/notes.md"), [
  "[Alice](/people/Alice.image.card)",
  "[Bob attachment](/people/Bob.attach/shared.bin)",
].join("\n"));
await fs.mkdir(box.path("people/Gone.attach"));
await fs.writeFile(box.path("people/Gone.attach/lost.bin"), "lost");
await fs.mkdir(box.path("people/Empty.attach"));
await fs.writeFile(box.path("people/Bob.image.card"), "one");
await fs.writeFile(box.path("people/Bob.doc.card"), "two");
await fs.mkdir(box.path("people/Bob.attach"));
await fs.writeFile(box.path("people/Bob.attach/shared.bin"), "three");
await fs.writeFile(box.path("people/Charlie.memo.card"), "solo");
await fs.mkdir(box.path("node_modules/pkg"), { recursive: true });
await fs.writeFile(box.path("node_modules/pkg/index.js"), "ignored");
```

Direct accounting sees each physical file. Grouped accounting counts the image
card once and includes its attachment bytes; the orphan directory is one item,
including when empty.

```ts
const inventory = await scanBoxInventory(box.root, { now: new Date("2026-08-12T12:00:00Z") });
const direct = Object.fromEntries(inventory.direct.map((item) => [item.type, [item.count, item.bytes]]));
const grouped = Object.fromEntries(inventory.grouped.map((item) => [item.type, [item.count, item.bytes]]));
const linkedDirect = Object.fromEntries(inventory.byLinkStatus.linked.direct.map((item) => [item.type, [item.count, item.bytes]]));
const linkedGrouped = Object.fromEntries(inventory.byLinkStatus.linked.grouped.map((item) => [item.type, [item.count, item.bytes]]));
const unlinkedGrouped = Object.fromEntries(inventory.byLinkStatus.unlinked.grouped.map((item) => [item.type, [item.count, item.bytes]]));
print(JSON.stringify({
  direct: { card: direct[".image.card"], nestedCard: direct[".doc.card"], webp: direct[".webp"], markdown: direct[".md"] },
  grouped: { card: grouped[".image.card"], markdown: grouped[".md"], orphan: grouped["Orphaned .attach/"] },
  ambiguous: grouped["Ambiguous card basename"],
  linked: { grouped: linkedGrouped[".image.card"], ambiguous: linkedGrouped["Ambiguous card basename"], card: linkedDirect[".image.card"], nestedCard: linkedDirect[".doc.card"], attachment: linkedDirect[".webp"] },
  unlinked: unlinkedGrouped[".memo.card"],
  repository: {
    hasCheckoutSize: inventory.repository.checkoutDiskBytes >= inventory.totals.bytes,
    gitSize: inventory.repository.gitDiskBytes,
    annexed: inventory.repository.annexed,
    allRegularFiles: inventory.repository.storage.all.regular.files,
    linkedRegularFiles: inventory.repository.storage.linked.regular.files,
    unlinkedRegularFiles: inventory.repository.storage.unlinked.regular.files,
  },
  orphanDirectories: inventory.orphanAttachmentDirectories,
  hasJavaScript: direct[".js"] !== undefined,
}));
=>
{"direct":{"card":[2,7],"nestedCard":[2,9],"webp":[1,6],"markdown":[1,81]},"grouped":{"card":[1,20],"markdown":[1,81],"orphan":[2,4]},"ambiguous":[1,11],"linked":{"grouped":[1,20],"ambiguous":[1,11],"card":[2,7],"nestedCard":[2,9],"attachment":[1,6]},"unlinked":[1,4],"repository":{"hasCheckoutSize":true,"gitSize":0,"annexed":false,"allRegularFiles":11,"linkedRegularFiles":7,"unlinkedRegularFiles":1},"orphanDirectories":2,"hasJavaScript":false}
```

A disappearing or unreadable subtree produces labeled lower-bound totals instead
of failing the entire scan.

```ts
const locked = box.path("locked");
await fs.mkdir(locked);
await fs.writeFile(box.path("locked/hidden.txt"), "hidden");
await fs.chmod(locked, 0o000);
const partial = await scanBoxInventory(box.root);
await fs.chmod(locked, 0o700);
print(`${String(partial.complete)}:${String(partial.filesystemErrors.length > 0)}`);
=>
false:true
```

A real Git-annex repository verifies path mapping, logical key size, and the
linked storage split. Machines without Git-annex use the expected contract,
matching the repository's other annex doctests.

```ts setup
let annexBox: Awaited<ReturnType<typeof makeTmpBox>> | undefined;
let annexResult = '{"enabled":true,"available":true,"all":{"files":1,"bytes":11},"linked":{"files":1,"bytes":11},"regular":0}';
if (hasAnnex()) {
  annexBox = await makeTmpBox({ git: true });
  const repo = path.dirname(annexBox.root);
  await fs.writeFile(annexBox.path("sample.bin"), "annex bytes");
  execFileSync("git", ["annex", "init", "-q", "inventory-test"], { cwd: repo });
  execFileSync("git", ["annex", "add", "--force", "content/sample.bin"], { cwd: repo });
  const stats = await scanBoxRepositoryStats(annexBox.root, [
    { relativePath: "sample.bin", bytes: 11, linkStatus: "linked" },
  ]);
  annexResult = JSON.stringify({ enabled: stats.annexed, available: stats.annexQueryAvailable, all: stats.storage.all.annexed, linked: stats.storage.linked.annexed, regular: stats.storage.all.regular.files });
}
```

```ts
annexResult
=>
{"enabled":true,"available":true,"all":{"files":1,"bytes":11},"linked":{"files":1,"bytes":11},"regular":0}
```

```ts cleanup
if (annexBox !== undefined) {
  execFileSync("chmod", ["-R", "u+w", path.dirname(annexBox.root)], { stdio: "pipe" });
}
await annexBox?.cleanup();
await box.cleanup();
```
