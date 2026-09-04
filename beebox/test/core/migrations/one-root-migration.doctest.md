# one-root migration: v2 -> v3 end to end

`runOneRootMigration` (`src/core/migrations/one-root-run.ts`) converts a v2
box (package root + nested `content/`) into the v3 one-root layout, in place,
as one commit. This doctest builds a small v2 fixture by hand (`makeTmpBox`
can't — it scaffolds v3), then exercises the happy path and the failure
modes: preflight aborts (dirty tree, a stray package-root entry) and rollback
on an induced dangling ref.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { scaffoldPackageRoot } from "../../../src/core/box/package.js";
import { runOneRootMigration, OneRootPreflightError, OneRootLinkGateError } from "../../../src/core/migrations/one-root-run.js";
import { probeV2Box } from "../../../src/core/migrations/one-root-v2-probe.js";
import { getBoxShape } from "../../../src/lib/box-shape.js";

// The box's git hooks embed an absolute `bbx` path (`install-validation-hooks.ts`);
// running inside a worktree it defaults to the STABLE MAIN checkout's `bbx`,
// which can lag whatever this worktree is developing. Pin it to this
// worktree's own bin/bbx — the documented override for exactly this case.
process.env["BBX_HOOK_BIN"] = path.resolve(import.meta.dirname, "../../../bin/bbx");

async function readIfExists(p) {
  try { return await fs.readFile(p, "utf-8"); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

/** A v2 box: package root (scaffoldPackageRoot's npm half only — no v3
 * operational half) + hand-built content/ tree, git-initialized. Carries a
 * few cards exercising several ref forms: a frontmatter `refs:` inline-map
 * entry, a relative markdown link, and an `attach/` ref (left untouched). */
async function makeV2Box() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-v2-e2e-"));
  await scaffoldPackageRoot(root, { symlinkBeeBox: true });
  await fs.writeFile(path.join(root, "CLAUDE.md"), "# Root persona\n\nEngine-facing notes.\n");

  const content = path.join(root, "content");
  await fs.mkdir(content, { recursive: true });
  // .beebox is gitignored runtime state in a real v2 box — reproduce that so
  // the rollback path genuinely exercises the fs-rename-back (not a git
  // reset that happens to restore a tracked copy).
  await fs.writeFile(path.join(content, ".gitignore"), ".beebox/\n");
  await fs.mkdir(path.join(content, ".beebox"), { recursive: true });
  await fs.writeFile(
    path.join(content, ".beebox", "box.json"),
    JSON.stringify({ version: "1.0.0", shapeVersion: 2, created: "2026-01-01T00:00:00.000Z" }),
  );

  await fs.mkdir(path.join(content, "box", "inbox", "Foo.attach"), { recursive: true });
  await fs.writeFile(
    path.join(content, "box", "inbox", "Foo.memo.card"),
    '---\nstatus: new\ncreated: "2026-01-01T00:00:00.000Z"\n---\nSee [Dana](../../people/Dana_Lee.person.card) and an attachment: [photo](attach/photo.txt)\n',
  );
  await fs.writeFile(path.join(content, "box", "inbox", "Foo.attach", "photo.txt"), "not really a photo\n");

  await fs.mkdir(path.join(content, "people"), { recursive: true });
  await fs.writeFile(path.join(content, "people", "Dana_Lee.person.card"), '---\nname: Dana Lee\n---\nDana Lee.\n');

  await fs.mkdir(path.join(content, "config"), { recursive: true });
  await fs.writeFile(
    path.join(content, "Box.landmark.card"),
    '---\nnavigation:\n  label: Test Box\n  links:\n    - ref: "/people/Dana_Lee.person.card"\nrefs: [{ ref: "/people/Dana_Lee.person.card" }]\n---\n',
  );
  await fs.writeFile(path.join(content, "briefing.md"), "# Briefing\n");
  await fs.writeFile(path.join(content, "briefing.briefing.card"), "---\n{}\n---\n");
  await fs.writeFile(path.join(content, "MAP.md"), "# Map\n");
  await fs.writeFile(path.join(content, "CLAUDE.md"), "Box persona notes (v2 operational root).\n");

  execSync(
    'git init -q -b main && git config user.email t@test.local && git config user.name Test && git add -A && git commit -q -m "v2 fixture"',
    { cwd: root, stdio: "pipe" },
  );
  return root;
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
```

## The v2-tolerant probe finds the box from either the package or content root

```ts
const root = await makeV2Box();
const fromPackageRoot = await probeV2Box(root);
const fromContentRoot = await probeV2Box(path.join(root, "content"));
JSON.stringify({
  fromPackageRoot: { shapeVersion: fromPackageRoot.shapeVersion, samePackageRoot: fromPackageRoot.packageRoot === root },
  fromContentRoot: { shapeVersion: fromContentRoot.shapeVersion, samePackageRoot: fromContentRoot.packageRoot === root },
})
=> {"fromPackageRoot":{"shapeVersion":2,"samePackageRoot":true},"fromContentRoot":{"shapeVersion":2,"samePackageRoot":true}}
```

```ts cleanup
await cleanup(root);
```

## Happy path: moves, ref rewrite, marker bump, one commit, validate-clean

```ts
const root = await makeV2Box();
const result = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") });
JSON.stringify({ filesMoved: result.filesMoved, unresolvedRefs: result.unresolvedRefs })
=> {"filesMoved":7,"unresolvedRefs":[]}
```

The box now resolves as v3, `content/` is gone, and the moved cards landed
under their mapped `_`-area:

```ts continue
const shape = await getBoxShape(root);
JSON.stringify({ shapeVersion: shape.shapeVersion, boxRoot: shape.boxRoot === root })
=> {"shapeVersion":3,"boxRoot":true}
```

```ts continue
const contentGone = await fs.access(path.join(root, "content")).then(() => "still there", () => "gone");
contentGone
=> gone
```

```ts continue
await readIfExists(path.join(root, "_content", "inbox", "Foo.memo.card"))
=> «*»
```

The markdown link and the frontmatter inline-map `ref` both rewrote to
canonical leading-`/` v3 form; the `attach/` ref is untouched:

```ts continue
const foo = await fs.readFile(path.join(root, "_content", "inbox", "Foo.memo.card"), "utf-8");
foo.includes("/_content/people/Dana_Lee.person.card") && foo.includes("(attach/photo.txt)")
=> true
```

```ts continue
const landmark = await fs.readFile(path.join(root, "_content", "Box.landmark.card"), "utf-8");
landmark.includes("/_content/people/Dana_Lee.person.card")
=> true
```

`content/CLAUDE.md` merged into the root `CLAUDE.md` instead of moving:

```ts continue
const claudeMd = await fs.readFile(path.join(root, "CLAUDE.md"), "utf-8");
claudeMd.includes("Engine-facing notes") && claudeMd.includes("Box persona notes (v2 operational root)")
=> true
```

Exactly one commit landed the whole conversion, and the working tree is clean:

```ts continue
const log = execSync("git log --oneline", { cwd: root, encoding: "utf-8" }).trim().split("\n");
const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();
JSON.stringify({ commits: log.length, dirty: status !== "" })
=> {"commits":2,"dirty":false}
```

```ts cleanup
await cleanup(root);
```

## Preflight aborts on a dirty tree — nothing moves

```ts
const root = await makeV2Box();
await fs.writeFile(path.join(root, "content", "box", "inbox", "Uncommitted.memo.card"), "---\n{}\n---\n");
const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({ isPreflightError: err instanceof OneRootPreflightError, contentStillThere: await fs.access(path.join(root, "content")).then(() => true, () => false) })
=> {"isPreflightError":true,"contentStillThere":true}
```

```ts cleanup
await cleanup(root);
```

## Preflight aborts on a stray package-root entry (the test1 incident shape)

```ts
const root = await makeV2Box();
await fs.mkdir(path.join(root, "config"), { recursive: true });
await fs.writeFile(path.join(root, "config", "stray.json"), "{}\n");
execSync("git add -A && git commit -q -m stray", { cwd: root, stdio: "pipe" });
const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({ isPreflightError: err instanceof OneRootPreflightError, mentionsStray: err.message.includes("config") })
=> {"isPreflightError":true,"mentionsStray":true}
```

```ts cleanup
await cleanup(root);
```

## Rollback: a dangling ref trips the hard link gate and the box lands back on v2

A markdown link to a target that never existed in the v2 box stays broken
after the move (the rewriter can't map a target `mapV2Path` doesn't
recognize, so it's left as written) — the hard link gate refuses to commit,
and the whole conversion rolls back: `.beebox` is back under `content/`, and
`git log` shows no new commit.

```ts
const root = await makeV2Box();
const fooPath = path.join(root, "content", "box", "inbox", "Foo.memo.card");
const before = await fs.readFile(fooPath, "utf-8");
await fs.writeFile(fooPath, before + "\n[ghost](../../nonexistent/Ghost.card)\n");
execSync("git add -A && git commit -q -m dangling", { cwd: root, stdio: "pipe" });
const preSha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8" }).trim();

const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
const afterSha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8" }).trim();
const beeboxBackUnderContent = await fs.access(path.join(root, "content", ".beebox", "box.json")).then(() => true, () => false);
JSON.stringify({
  isLinkGateError: err instanceof OneRootLinkGateError,
  shaUnchanged: afterSha === preSha,
  beeboxBackUnderContent,
})
=> {"isLinkGateError":true,"shaUnchanged":true,"beeboxBackUnderContent":true}
```

```ts cleanup
await cleanup(root);
```
