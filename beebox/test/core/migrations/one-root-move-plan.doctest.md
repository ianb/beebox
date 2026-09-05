# one-root migration: remapping a symlink whose target moved at the DIRECTORY level

`remapMovedSymlinkTargets` (`src/core/migrations/one-root-move-plan.ts`)
recomputes a moved symlink's relative target for its new depth. Before
finding 5 (round 3 hardening) it only looked the target up in the EXACT
planned-move table — a link whose target names a DIRECTORY (whose contents
moved file-by-file, never itself a `PlannedMove`) fell through unresolved and
was left pointing at the removed `content/` location. The fix falls back to
`mapV2Path` at the directory level.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { remapMovedSymlinkTargets } from "../../../src/core/migrations/one-root-move-plan.js";
import { OneRootPreflightError } from "../../../src/core/migrations/one-root-errors.js";

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bbx-move-plan-"));
}
async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
```

## A symlink whose target is a whole directory remaps through `mapV2Path`

`content/store/drive/docs-link` points at `../../docs` (i.e. `content/docs`,
a directory) — its own move relocates it to `_content/drive/docs-link`, but
`content/docs` was never an entry in `moves` (only the files under it were).
The post-move on-disk state is set up directly (as if `executeMoves` already
ran): the symlink's TEXT is still the un-remapped v2-depth value.

```ts
const root = await mkTmp();
await fs.mkdir(path.join(root, "_content", "docs"), { recursive: true });
await fs.mkdir(path.join(root, "_content", "drive"), { recursive: true });
await fs.writeFile(path.join(root, "_content", "docs", "readme.md"), "hi\n");
await fs.symlink("../../docs", path.join(root, "_content", "drive", "docs-link"));

const moves = [
  { contentRelPath: "docs/readme.md", newRelPath: "_content/docs/readme.md", tracked: false },
  { contentRelPath: "store/drive/docs-link", newRelPath: "_content/drive/docs-link", tracked: false },
];
const journal = [
  { oldAbs: path.join(root, "content", "store", "drive", "docs-link"), newAbs: path.join(root, "_content", "drive", "docs-link"), wasIgnored: false },
];
await remapMovedSymlinkTargets({ packageRoot: root, contentRoot: path.join(root, "content"), moves, journal });

await fs.readlink(path.join(root, "_content", "drive", "docs-link"))
=> ../docs
```

The link now resolves to the real, moved directory:

```ts continue
const target = await fs.realpath(path.join(root, "_content", "drive", "docs-link"));
target === await fs.realpath(path.join(root, "_content", "docs"))
=> true
```

Finding 6: the journal entry for this (untracked) move now carries the
symlink's ORIGINAL target text, for rollback to restore if a later step
fails:

```ts continue
journal[0].originalLinkTarget
=> ../../docs
```

```ts cleanup
await cleanup(root);
```

## A directory-level target `mapV2Path` can't resolve either aborts preflight, naming the link

An unknown *dotfile* entry under `content/` is the one thing `mapV2Path`
leaves unmapped (unknown plain directories are the user's own content and
default into `_content/` — `009e00eec`), so a link into one has no v3 home:

```ts
const root2 = await mkTmp();
await fs.mkdir(path.join(root2, "_content", "drive"), { recursive: true });
await fs.symlink("../../.bogus-unmapped-state", path.join(root2, "_content", "drive", "broken-link"));

const moves2 = [
  { contentRelPath: "store/drive/broken-link", newRelPath: "_content/drive/broken-link", tracked: false },
];
const err = await remapMovedSymlinkTargets({ packageRoot: root2, contentRoot: path.join(root2, "content"), moves: moves2, journal: [] }).catch((e) => e);
JSON.stringify({ isPreflightError: err instanceof OneRootPreflightError, mentionsLink: err.message.includes("broken-link") })
=> {"isPreflightError":true,"mentionsLink":true}
```

```ts cleanup
await cleanup(root2);
```

## A target outside `content/` entirely (unmoved, e.g. an annex object) still remaps for the new depth

The target itself never moved (an annex object lives under `.git/`,
unaffected by the migration) — but the LINK did, from `content/store/drive/`
(3 levels below the package root) to `_content/drive/` (2 levels), so its
unchanged relative text (still the old, one-`../`-too-many form `git mv`
left it with) needs recomputing even though `mapDirectoryLevelTarget` has
nothing to map (the target isn't under `content/` at all).

```ts
const root3 = await mkTmp();
await fs.mkdir(path.join(root3, ".git", "annex", "objects"), { recursive: true });
await fs.writeFile(path.join(root3, ".git", "annex", "objects", "SHA-dummy"), "bytes\n");
await fs.mkdir(path.join(root3, "_content", "drive"), { recursive: true });
await fs.symlink(path.join("..", "..", "..", ".git", "annex", "objects", "SHA-dummy"), path.join(root3, "_content", "drive", "annex-link"));

const moves3 = [
  { contentRelPath: "store/drive/annex-link", newRelPath: "_content/drive/annex-link", tracked: true },
];
await remapMovedSymlinkTargets({ packageRoot: root3, contentRoot: path.join(root3, "content"), moves: moves3, journal: [] });
await fs.readlink(path.join(root3, "_content", "drive", "annex-link"))
=> ../../.git/annex/objects/SHA-dummy
```

```ts cleanup
await cleanup(root3);
```
