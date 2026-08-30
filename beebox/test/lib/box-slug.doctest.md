# boxSlug

A box's URL slug, derived from where it lives on disk. Every box is
shapeVersion 2, so its `boxRoot` is the package's `content/` directory — which
makes `path.basename(boxRoot)` the literal string `"content"` for *every* box.
`boxSlug` reads the shape and takes the PACKAGE root's basename instead.
See `src/lib/box-slug.ts`.

```ts setup
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { boxSlug, boxSlugFromShape } from "../../src/lib/box-slug.js";
import { getBoxShape } from "../../src/lib/box-shape.js";

/** A minimal shapeVersion-2 box named `name` under a fresh temp parent. */
async function makeBox(parent: string, name: string): Promise<string> {
  const packageRoot = join(parent, name);
  const boxRoot = join(packageRoot, "content");
  await mkdir(boxRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name, dependencies: { "beebox": "*" } }),
  );
  await mkdir(join(boxRoot, ".beebox"), { recursive: true });
  await writeFile(join(boxRoot, ".beebox/box.json"), JSON.stringify({ shapeVersion: 2 }));
  return boxRoot;
}
```

Two different boxes get two different slugs. This is the regression the helper
exists for: both box roots are named `content`, so the naive
`basename(boxRoot)` collides them into one key — which is exactly how two
boxes ended up sharing a slug-keyed push-subscription store.

```ts
const parent = await mkdtemp(join(tmpdir(), "bbx-box-slug-"));
const alpha = await makeBox(parent, "alpha");
const beta = await makeBox(parent, "beta");

[basename(alpha), basename(beta)].join(",")
=> content,content

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
