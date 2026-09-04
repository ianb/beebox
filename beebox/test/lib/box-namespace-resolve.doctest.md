# `resolveBoxNamespacePath` — the box namespace fence, checked on the resolved path

Every fenced HTTP/tRPC route resolves a client-supplied box path through
`resolveBoxNamespacePath` (`src/lib/box-namespace-resolve.ts`), which checks
the box namespace fence (`isInBoxNamespace`, Track B,
`docs/plans/one-root-box-layout.md`) against the RESOLVED filesystem path —
not the raw request string. Checking the raw string is a traversal bypass:
`_content/../package.json` starts with `_content` (passes a naive raw-string
check) but *resolves* to `package.json`, outside the namespace.

```ts setup
import { resolveBoxNamespacePath } from "../../src/lib/box-namespace-resolve.js";
```

An ordinary in-namespace path resolves normally:

```ts
JSON.stringify(resolveBoxNamespacePath("/box", "_content/inbox/x.memo.card"))
=> {"resolved":"/box/_content/inbox/x.memo.card","relativePath":"_content/inbox/x.memo.card"}
```

A path outside every underscore area is rejected:

```ts
resolveBoxNamespacePath("/box", "package.json")
=> null

resolveBoxNamespacePath("/box", "src/lib/paths.ts")
=> null

resolveBoxNamespacePath("/box", "node_modules/foo/index.js")
=> null
```

The box root itself (empty relative path) is never in-namespace:

```ts
resolveBoxNamespacePath("/box", "")
=> null
```

A genuine escape outside the box root entirely is rejected:

```ts
resolveBoxNamespacePath("/box", "../outside.txt")
=> null

resolveBoxNamespacePath("/box", "../box-other/secret.txt")
=> null
```

**The bypass this fixes**: a traversal form that starts inside an underscore
area but resolves outside the namespace once normalized. A raw-string check
on `isInBoxNamespace` alone would pass every one of these (each starts with
`_content`); checking the RESOLVED path catches them all:

```ts
resolveBoxNamespacePath("/box", "_content/../package.json")
=> null

resolveBoxNamespacePath("/box", "_content/./../src/x")
=> null

resolveBoxNamespacePath("/box", "_content/../../box-other/secret.txt")
=> null

resolveBoxNamespacePath("/box", "_content/foo/../../package.json")
=> null
```

A traversal form that stays inside the SAME underscore area after
normalizing is still fine — only the resolved location matters, not whether
the raw string contained dots:

```ts
JSON.stringify(resolveBoxNamespacePath("/box", "_content/inbox/../drafts/x.memo.card"))
=> {"resolved":"/box/_content/drafts/x.memo.card","relativePath":"_content/drafts/x.memo.card"}
```

## On-disk verification — the lexical check alone is not enough

`resolveBoxNamespacePath` above is purely lexical (string/segment manipulation)
— it never touches the filesystem. In the one-root box layout the box root is
ALSO the npm package root (`package.json`, `node_modules/`, `src/`,
`.git/` all live right there beside the underscore areas), so a SYMLINK
anywhere along an otherwise-valid-looking `_content/...` path can walk the
fence straight into the package internals even though every lexical segment
looked fine. `resolveBoxNamespacePathOnDisk` (and its building block
`verifyBoxNamespaceOnDisk`) is the async filesystem-sink layer every
consuming route calls in addition to the lexical check — it `realpath`s the
target (or the walk to reach it) and re-verifies both box-root containment
and namespace membership against the RESOLVED path.

```ts setup
import { symlink, mkdir, rm } from "node:fs/promises";
import {
  resolveBoxNamespacePath,
  resolveBoxNamespacePathOnDisk,
  verifyBoxNamespaceOnDisk,
} from "../../src/lib/box-namespace-resolve.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

An ordinary in-namespace path with no symlinks involved resolves the same way
under both modes:

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/x.memo.card", "hello");

const ordinaryRead = await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/inbox/x.memo.card", mode: "read" });
ordinaryRead?.relativePath
=> _content/inbox/x.memo.card

const ordinaryWrite = await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/inbox/x.memo.card", mode: "write" });
ordinaryWrite?.relativePath
=> _content/inbox/x.memo.card
```

### The `_content/pkg` → package-root symlink escape (the adversarial probe)

A box where `_content/pkg` is a symlink pointing back at `..` (the box root
itself, which in the one-root layout IS the npm package root) tries to reach
`package.json` through it. Plain box-root containment would pass this (the
symlink resolves to somewhere still inside `boxRoot`) — it's the NAMESPACE
re-check on the resolved path that catches it, since the real relative path
comes out as `package.json`, outside every underscore area:

```ts continue
await symlink("..", box.path("_content/pkg"));

await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg/package.json", mode: "read" })
=> null

await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg/package.json", mode: "write" })
=> null
```

Browsing the symlinked directory itself (its own leaf IS the symlink) is
refused too — the leaf-symlink allowance below only exempts a leaf that
resolves to a non-directory, so a directory-listing route stays safe even
under `mode: "read"`:

```ts continue
await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg", mode: "read" })
=> null
```

Reaching further into the package internals (`src/`, `node_modules/`)
through the same symlink is refused identically:

```ts continue
await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg/src/lib/paths.ts", mode: "read" })
=> null

await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg/node_modules/foo", mode: "read" })
=> null
```

### The area segment itself being a symlink is refused before walking deeper

```ts continue
await mkdir(box.path("elsewhere/_content"), { recursive: true });
await box.write("elsewhere/_content/x.memo.card", "hi");
// `bbx init` scaffolds `_config/` as a real directory (migrations manifest,
// transcription config) — remove it first so the symlink can take its place.
await rm(box.path("_config"), { recursive: true, force: true });
await symlink(box.path("elsewhere/_content"), box.path("_config"));

await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_config/x.memo.card", mode: "read" })
=> null
```

```ts cleanup
await box.cleanup();
```

### Annex-style leaf symlinks — allowed on read, refused on write/delete

A leaf symlink whose target is a plain FILE outside `boxRoot` entirely (the
git-annex shape: the visible box path is a symlink into
`.git/annex/objects/...`) still serves on a read — only the WALK to its
containing directory is re-checked, not the leaf's own target:

```ts
const annexBox = await makeTmpBox();
await mkdir(annexBox.path("_content/photos.attach"), { recursive: true });
await mkdir(annexBox.path(".git/annex/objects/xx/yy"), { recursive: true });
await annexBox.write(".git/annex/objects/xx/yy/realbytes.jpg", "fake-jpeg-bytes");
await symlink(
  annexBox.path(".git/annex/objects/xx/yy/realbytes.jpg"),
  annexBox.path("_content/photos.attach/img.jpg"),
);

const annexRead = await resolveBoxNamespacePathOnDisk({
  boxRoot: annexBox.root,
  rawPath: "_content/photos.attach/img.jpg",
  mode: "read",
});
annexRead?.relativePath
=> _content/photos.attach/img.jpg
```

The same leaf symlink is refused for a write or delete — an existing leaf
symlink resolving outside the box root is never writable through it:

```ts continue
await resolveBoxNamespacePathOnDisk({ boxRoot: annexBox.root, rawPath: "_content/photos.attach/img.jpg", mode: "write" })
=> null
```

A leaf symlink that resolves INSIDE the box (a same-directory relative
symlink) is still fine on write — only an out-of-box target is refused:

```ts continue
await annexBox.write("_content/photos.attach/real.jpg", "real-bytes");
await symlink("real.jpg", annexBox.path("_content/photos.attach/alias.jpg"));

const aliasWrite = await resolveBoxNamespacePathOnDisk({
  boxRoot: annexBox.root,
  rawPath: "_content/photos.attach/alias.jpg",
  mode: "write",
});
aliasWrite?.relativePath
=> _content/photos.attach/alias.jpg
```

```ts cleanup
await annexBox.cleanup();
```

### `verifyBoxNamespaceOnDisk` — the lower-level building block

Callers that already have a lexically-resolved `BoxNamespacePath` (e.g. one
derived from a card's own ref, not the raw request path) can call this
directly instead of re-resolving from a raw string:

```ts
const directBox = await makeTmpBox();
await directBox.write("_content/note.memo.card", "hi");
const ns = resolveBoxNamespacePath(directBox.root, "_content/note.memo.card")!;
await verifyBoxNamespaceOnDisk({ boxRoot: directBox.root, ns, mode: "read" })
=> true

await symlink("..", directBox.path("_content/pkg"));
const escapedNs = resolveBoxNamespacePath(directBox.root, "_content/pkg/package.json")!;
await verifyBoxNamespaceOnDisk({ boxRoot: directBox.root, ns: escapedNs, mode: "read" })
=> false
```

```ts cleanup
await directBox.cleanup();
```
