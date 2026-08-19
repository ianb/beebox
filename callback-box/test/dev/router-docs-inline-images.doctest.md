# Dev renderer: inlining local images into rendered markdown

`/dev/` pages are served with a bare `sandbox` CSP, so rendered markdown has an
opaque origin and its `<img>` subrequests carry no session cookie — the auth
gate 401s them and every relative image renders broken. `inlineLocalImages`
fixes that at render time: it rewrites relative `<img src>` to `data:` URIs
read from disk, so the emitted HTML carries the bytes and no subrequest
happens. Background:
[dev md images broken](../../../issues/bugs/2026-08-19-dev-md-images-broken-opaque-origin.md).

```ts setup
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inlineLocalImages } from "../../../bin/router-docs.js";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"/>`;
const SVG_URI = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;
```

## Relative images inline; external and absolute sources pass through

Only a relative, image-typed, inside-the-root src is rewritten. Scheme'd URLs,
origin-absolute paths, and non-image extensions are untouched:

```ts
const root = await mkdtemp(path.join(os.tmpdir(), "inline-images-"));
await mkdir(path.join(root, "dev", "story"), { recursive: true });
await writeFile(path.join(root, "dev", "story", "a.svg"), SVG);
const baseDir = path.join(root, "dev");

const html = [
  `<img src="story/a.svg" alt="local">`,
  `<img src="https://example.com/x.png" alt="external">`,
  `<img src="/main/dev/x.svg" alt="absolute">`,
  `<img src="story/notes.pdf" alt="not-an-image">`,
].join("\n");
const out = await inlineLocalImages(html, { baseDir, rootDir: root });
out.split("\n").map((l) => l.replace(/src="[^"]{40,}"/, 'src="<data-uri>"')).join("\n")
=> <img src="<data-uri>" alt="local">
<img src="https://example.com/x.png" alt="external">
<img src="/main/dev/x.svg" alt="absolute">
<img src="story/notes.pdf" alt="not-an-image">

out.includes(SVG_URI)
=> true
```

```ts continue
// The same file referenced twice is read once and both tags are rewritten.
const twice = await inlineLocalImages(`<img src="story/a.svg"><p><img src="story/a.svg"></p>`, { baseDir, rootDir: root });
twice.split(SVG_URI).length - 1
=> 2

// A missing file is left as-is — the broken-image icon is the signal.
await inlineLocalImages(`<img src="story/missing.svg">`, { baseDir, rootDir: root })
=> <img src="story/missing.svg">

// `..` that stays inside the root works; docs reference siblings freely.
await mkdir(path.join(root, "assets"));
await writeFile(path.join(root, "assets", "b.svg"), SVG);
const up = await inlineLocalImages(`<img src="../assets/b.svg">`, { baseDir, rootDir: root });
up.includes(SVG_URI)
=> true
```

## Escapes are refused: traversal and symlinks out of the root

Containment is checked on the realpath, so neither `..` traversal nor a
symlink inside the root that points outside it can pull foreign bytes into a
page:

```ts continue
const outside = await mkdtemp(path.join(os.tmpdir(), "inline-images-outside-"));
await writeFile(path.join(outside, "secret.svg"), SVG);

const rel = path.relative(baseDir, path.join(outside, "secret.svg"));
await inlineLocalImages(`<img src="${rel}">`, { baseDir, rootDir: root })
=> <img src="«*»">

await symlink(path.join(outside, "secret.svg"), path.join(root, "dev", "link.svg"));
await inlineLocalImages(`<img src="link.svg">`, { baseDir, rootDir: root })
=> <img src="link.svg">
```

```ts cleanup
await rm(root, { recursive: true, force: true });
await rm(outside, { recursive: true, force: true });
```
