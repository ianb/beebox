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

/**
 * Adds a second layer of fixture to a `makeV2Box()` box, exercising findings
 * from the Track E hardening review in one extra commit:
 *  - a TRACKED symlink (`store/drive/photo-link.bin`, annex-asset shape) and
 *    an UNTRACKED-but-gitignored symlink (`config/connectors/other.secret.json`)
 *    — both must survive the migration pointing at the right (untouched,
 *    same-directory-relative) target;
 *  - a plain gitignored secret (`config/connectors/gmail.secret.json`), a
 *    connector state file, and schedule state — all untracked, exercising
 *    the git-mv-refuses-untracked-files split;
 *  - a view (`src/views/Test.tsx`) with a `cardRef` pointing at a new v2
 *    recipe card, and a reference-style markdown link (`[x][id]` +
 *    `[id]: path`) in `Foo.memo.card`'s body.
 */
async function extendWithHardeningFixture(root) {
  const content = path.join(root, "content");
  await fs.appendFile(
    path.join(content, ".gitignore"),
    "config/connectors/*.secret.*\nconfig/connectors/*.state.*\nconfig/schedules/.state/\n",
  );

  await fs.mkdir(path.join(content, "store", "drive"), { recursive: true });
  await fs.writeFile(path.join(content, "store", "drive", "photo.bin"), "photo bytes\n");
  await fs.symlink("photo.bin", path.join(content, "store", "drive", "photo-link.bin"));

  await fs.mkdir(path.join(content, "config", "connectors"), { recursive: true });
  await fs.writeFile(path.join(content, "config", "connectors", "gmail.secret.json"), '{"token":"shh"}\n');
  await fs.symlink("gmail.secret.json", path.join(content, "config", "connectors", "other.secret.json"));
  await fs.writeFile(path.join(content, "config", "connectors", "gmail.state.json"), '{"lastSync":"2026-01-01"}\n');

  await fs.mkdir(path.join(content, "config", "schedules", ".state"), { recursive: true });
  await fs.writeFile(path.join(content, "config", "schedules", ".state", "tick.json"), '{"lastRun":"2026-01-01"}\n');

  await fs.mkdir(path.join(content, "store", "recipes"), { recursive: true });
  await fs.writeFile(path.join(content, "store", "recipes", "Soup.recipe.card"), '---\ntitle: Soup\n---\nSoup.\n');

  await fs.mkdir(path.join(root, "src", "views"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "views", "Test.tsx"),
    'export default function Test() { return <div cardRef="/store/recipes/Soup.recipe.card" />; }\n',
  );

  const fooPath = path.join(content, "box", "inbox", "Foo.memo.card");
  const foo = await fs.readFile(fooPath, "utf-8");
  await fs.writeFile(
    fooPath,
    foo + "\nSee [Dana too][dana-ref].\n\n[dana-ref]: ../../people/Dana_Lee.person.card\n",
  );

  execSync("git add -A && git commit -q -m hardening-fixture", { cwd: root, stdio: "pipe" });
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

The rolled-back marker is still v2 — not just on disk, but as `probeV2Box` (the bootstrap `bbx migrate` itself uses) reads it. Before the fix, `bumpMarker` mutated `.beebox/box.json` in place with nothing to undo it: the marker said `shapeVersion: 3` even though the whole conversion had rolled back, so a retry's `probeV2Box` refused to recognize the box as v2 at all.

```ts continue
const probeAfterRollback = await probeV2Box(path.join(root, "content"));
probeAfterRollback.shapeVersion
=> 2
```

Fixing the dangling ref and re-running succeeds — the migration is retryable after a rollback, not stranded:

```ts continue
const fooPath2 = path.join(root, "content", "box", "inbox", "Foo.memo.card");
const dangling = await fs.readFile(fooPath2, "utf-8");
await fs.writeFile(fooPath2, dangling.replace("\n[ghost](../../nonexistent/Ghost.card)\n", ""));
execSync("git add -A && git commit -q -m fix-dangling", { cwd: root, stdio: "pipe" });

const retried = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") });
JSON.stringify({ filesMoved: retried.filesMoved, unresolvedRefs: retried.unresolvedRefs })
=> {"filesMoved":7,"unresolvedRefs":[]}
```

```ts cleanup
await cleanup(root);
```

## Hardening: tracked/untracked symlinks, gitignored secrets and state, view refs, and reference-style links

A TRACKED symlink (`store/drive/photo-link.bin`, the annex-asset shape) moves
via `git mv`; an UNTRACKED-but-gitignored symlink and gitignored secret/state
files (which `git mv` refuses outright) move via a recorded filesystem
rename. A view's `cardRef` and a card body's reference-style `[x][id]` +
`[id]: path` link both get rewritten too — neither is a form the plain
inline-link/frontmatter walkers see on their own.

```ts
const root = await makeV2Box();
await extendWithHardeningFixture(root);
const result = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") });
result.filesMoved
=> 14
```

The tracked symlink survived the move, still pointing at its sibling:

```ts continue
const photoLinkTarget = await fs.readlink(path.join(root, "_content", "drive", "photo-link.bin"));
const photoLinkContent = await fs.readFile(path.join(root, "_content", "drive", "photo-link.bin"), "utf-8");
JSON.stringify({ photoLinkTarget, photoLinkContent })
=> {"photoLinkTarget":"photo.bin","photoLinkContent":"photo bytes\n"}
```

The untracked symlink survived too, and both it and the secret it points at
are still gitignored at their new `_config/connectors/` home:

```ts continue
const secretLinkTarget = await fs.readlink(path.join(root, "_config", "connectors", "other.secret.json"));
const secretContent = await fs.readFile(path.join(root, "_config", "connectors", "gmail.secret.json"), "utf-8");
const secretIgnored = execSync("git check-ignore -q _config/connectors/gmail.secret.json && echo yes || echo no", { cwd: root, encoding: "utf-8" }).trim();
const linkIgnored = execSync("git check-ignore -q _config/connectors/other.secret.json && echo yes || echo no", { cwd: root, encoding: "utf-8" }).trim();
JSON.stringify({ secretLinkTarget, secretToken: JSON.parse(secretContent).token, secretIgnored, linkIgnored })
=> {"secretLinkTarget":"gmail.secret.json","secretToken":"shh","secretIgnored":"yes","linkIgnored":"yes"}
```

Connector state and schedule state moved to their bookkeeping/config homes,
and the tree is fully clean (nothing untracked, nothing dirty — the
gitignored entries above included):

```ts continue
const stateContent = await fs.readFile(path.join(root, "_bookkeeping", "connectors", "gmail.state.json"), "utf-8");
const scheduleState = await fs.readFile(path.join(root, "_config", "schedules", ".state", "tick.json"), "utf-8");
const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();
JSON.stringify({ lastSync: JSON.parse(stateContent).lastSync, lastRun: JSON.parse(scheduleState).lastRun, dirty: status !== "" })
=> {"lastSync":"2026-01-01","lastRun":"2026-01-01","dirty":false}
```

The view's `cardRef` rewrote to the new recipe path (the view file itself
never moved — same relative location at the package/box root in v2 and v3):

```ts continue
const viewSource = await fs.readFile(path.join(root, "src", "views", "Test.tsx"), "utf-8");
viewSource.includes('cardRef="/_content/recipes/Soup.recipe.card"')
=> true
```

The reference-style link definition rewrote too:

```ts continue
const fooAfter = await fs.readFile(path.join(root, "_content", "inbox", "Foo.memo.card"), "utf-8");
fooAfter.includes("[dana-ref]: /_content/people/Dana_Lee.person.card")
=> true
```

```ts cleanup
await cleanup(root);
```

## Claude Code transcript directories are re-keyed to the new cwd

Claude Code keys `~/.claude/projects/<encoded-cwd>/` by the absolute cwd a
session ran with. The box's cwd moves from `<packageRoot>/content` to
`<packageRoot>` — without re-keying, every existing transcript becomes
unreachable. `BBX_CLAUDE_PROJECTS_DIR` points this at a fixture directory
instead of the real `~/.claude/projects`.

```ts
const projectsDir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-claude-projects-"));
process.env["BBX_CLAUDE_PROJECTS_DIR"] = projectsDir;
const encode = (p) => p.replace(/[^\dA-Za-z]/g, "-");

const root = await makeV2Box();
const oldCwd = path.join(root, "content");
const oldDir = path.join(projectsDir, encode(oldCwd));
await fs.mkdir(oldDir, { recursive: true });
await fs.writeFile(path.join(oldDir, "sess1.jsonl"), '{"type":"summary"}\n');

await runOneRootMigration({ packageRoot: root, contentRoot: oldCwd });

const newDir = path.join(projectsDir, encode(root));
const transcriptMoved = await fs.access(path.join(newDir, "sess1.jsonl")).then(() => true, () => false);
const oldDirStillExists = await fs.access(oldDir).then(() => true, () => false);
JSON.stringify({ transcriptMoved, oldDirStillExists })
=> {"transcriptMoved":true,"oldDirStillExists":false}
```

```ts cleanup
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await fs.rm(projectsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await cleanup(root);
```
