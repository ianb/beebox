# extfile sync: stamp version/size/mtime from the live file

`syncExtfile` re-stamps an extfile card's drift metadata (`version`/`size`/
`mtime`) from its live external file. It rewrites **only when the content hash
changed** (churn control), and reports cards whose href can't be resolved
instead of throwing. The box's own root is always an allowed root, so a target
inside the box resolves without extra `externalRoots` config.

```ts setup
import { readFile, utimes, writeFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../src/cards/index.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import { syncExtfile } from "../src/core/extfile-sync.js";

async function readFm(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, "utf8");
  return (parseYaml(splitCardContent(content).frontmatterText) ?? {}) as Record<string, unknown>;
}
```

## A fresh card gets stamped with version/size/mtime

```ts
const box = await makeTmpBox();
await box.write("store/src/foo.ts", "console.log(1);\n");
const cardPath = box.path("store/review/Foo.extfile.card");
await box.write("store/review/Foo.extfile.card", `---\ntype: extfile\nhref: file:${box.path("store/src/foo.ts")}\n---\n`);
const r1 = await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
r1[0]!.status
=> stamped

const fm = await readFm(cardPath);
typeof fm.version === "string" && (fm.version as string).startsWith("sha256:")
=> true

typeof fm.size === "number" && typeof fm.mtime === "string"
=> true
```

## A bumped mtime with unchanged content is "unchanged" (no rewrite)

```ts
const box = await makeTmpBox();
await box.write("store/src/foo.ts", "console.log(1);\n");
const cardPath = box.path("store/review/Foo.extfile.card");
await box.write("store/review/Foo.extfile.card", `---\ntype: extfile\nhref: file:${box.path("store/src/foo.ts")}\n---\n`);
await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
const before = await readFm(cardPath);
// Bump only the file's mtime; the bytes are identical.
await utimes(box.path("store/src/foo.ts"), new Date("2031-01-01T00:00:00Z"), new Date("2031-01-01T00:00:00Z"));
const r2 = await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
r2[0]!.status
=> unchanged

const after = await readFm(cardPath);
after.mtime === before.mtime
=> true
```

## Changed content re-stamps with a new version

```ts
const box = await makeTmpBox();
await box.write("store/src/foo.ts", "console.log(1);\n");
const cardPath = box.path("store/review/Foo.extfile.card");
await box.write("store/review/Foo.extfile.card", `---\ntype: extfile\nhref: file:${box.path("store/src/foo.ts")}\n---\n`);
await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
const v1 = (await readFm(cardPath)).version;
await writeFile(box.path("store/src/foo.ts"), "console.log(2);\nconsole.log(3);\n");
const r3 = await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
r3[0]!.status
=> stamped

const v2 = (await readFm(cardPath)).version;
v2 !== v1
=> true
```

## An unresolvable href is reported, not thrown

```ts
const box = await makeTmpBox();
const cardPath = box.path("store/review/Gone.extfile.card");
await box.write("store/review/Gone.extfile.card", "---\ntype: extfile\nhref: file:/nonexistent/nope.ts\n---\n");
const r = await syncExtfile({ boxRoot: box.root, paths: [cardPath] });
r[0]!.status
=> unresolved
```
