# boxSlug

A box's URL slug, derived from where it lives on disk. shapeVersion 3 has one
root, so `path.basename(boxRoot)` is simply the box's own directory name —
no "content dir" collision to work around (that was the v2 trap: `boxRoot`
was a `content/` directory nested inside a package, so its basename was the
literal string `"content"` for every box). `boxSlug` reads the shape and
returns `path.basename(shape.boxRoot)`. See `src/lib/box-slug.ts`.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { boxSlug, boxSlugFromShape } from "../../src/lib/box-slug.js";
import { getBoxShape } from "../../src/lib/box-shape.js";

/** A minimal shapeVersion-3 box named `name` under a fresh temp parent. */
async function makeBox(parent: string, name: string): Promise<string> {
  const boxRoot = join(parent, name);
  await mkdir(boxRoot, { recursive: true });
  await writeFile(
    join(boxRoot, "package.json"),
    JSON.stringify({ name, dependencies: { "beebox": "*" } }),
  );
  await mkdir(join(boxRoot, ".beebox"), { recursive: true });
  await writeFile(join(boxRoot, ".beebox/box.json"), JSON.stringify({ shapeVersion: 3 }));
  return boxRoot;
}
```

Two different boxes get two different slugs — their root directory names:

```ts
const parent = await mkdtemp(join(tmpdir(), "bbx-box-slug-"));
const alpha = await makeBox(parent, "alpha");
const beta = await makeBox(parent, "beta");

[basename(alpha), basename(beta)].join(",")
=> alpha,beta

[await boxSlug(alpha), await boxSlug(beta)].join(",")
=> alpha,beta
```

`boxSlugFromShape` is the same answer for a caller that already resolved the
shape, so the two never disagree:

```ts continue
const shape = await getBoxShape(alpha);
boxSlugFromShape(shape) === (await boxSlug(alpha))
=> true
```

A marker-less directory has no shape — the documented plain-directory serve
mode — and falls back to its own basename:

```ts continue
const plain = join(parent, "just-a-dir");
await mkdir(plain, { recursive: true });
await boxSlug(plain)
=> just-a-dir
```

```ts cleanup
await rm(parent, { recursive: true, force: true });
```
