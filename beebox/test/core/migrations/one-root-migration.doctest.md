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
import { runOneRootMigration, OneRootPreflightError, OneRootLinkGateError, OneRootGitignoreRegressionError } from "../../../src/core/migrations/one-root-run.js";
import { probeV2Box } from "../../../src/core/migrations/one-root-v2-probe.js";
import { initBox } from "../../../src/core/box/index.js";
import { getBoxShape } from "../../../src/lib/box-shape.js";
import { executeMoves, planMoves } from "../../../src/core/migrations/one-root-move-plan.js";
import { appendManifestEntry, SymlinkedManifestError } from "../../../src/core/migration-run.js";

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
    foo +
      "\nSee [Dana too][dana-ref].\n\n[dana-ref]: ../../people/Dana_Lee.person.card\n" +
      // Two more legal CommonMark reference-definition forms this codebase's
      // Markdoc parser already renders as real links: a continuation-line
      // destination (on the line AFTER the `[id]:` label) and an
      // angle-bracket-delimited destination.
      "\nSee [Dana cont][dana-cont-ref].\n\n[dana-cont-ref]:\n  ../../people/Dana_Lee.person.card\n" +
      "\nSee [Dana angle][dana-angle-ref].\n\n[dana-angle-ref]: <../../people/Dana_Lee.person.card>\n",
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

The continuation-line and angle-bracket reference definitions rewrote too —
same new v3 target, no literal `<` leaking into the rewritten path — and the
hard link gate the migration ran (Track E step 6) passed, so both resolve
cleanly after the move:

```ts continue
JSON.stringify({
  continuationForm: fooAfter.includes("[dana-cont-ref]:\n  /_content/people/Dana_Lee.person.card"),
  angleForm: fooAfter.includes("[dana-angle-ref]: </_content/people/Dana_Lee.person.card>"),
  noStrayAngle: !fooAfter.includes("<<") && !fooAfter.includes("card><"),
})
=> {"continuationForm":true,"angleForm":true,"noStrayAngle":true}
```

```ts cleanup
await cleanup(root);
```

## Finding 1 (round 4 hardening): a symlinked card/doc is never opened for rewrite

`content/docs/alias.md` is a TRACKED symlink to a file OUTSIDE the box
entirely (not even under the v2 package root) — the annex-style shape, but
pointing somewhere the ref rewriter must never touch. `fs.readFile`/
`writeFile` FOLLOW a symlink, so the old code read and rewrote the EXTERNAL
file's bytes; rollback can't undo that (the box's own git history has no
record of a file outside it). The migration now `lstat`s each candidate and
skips a symlinked entry outright, reporting it in `skippedSymlinkRefs`.

```ts
const root = await makeV2Box();
const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-external-"));
const externalFile = path.join(externalDir, "shared.md");
await fs.writeFile(externalFile, "# Shared\n\nSee [Dana](../../people/Dana_Lee.person.card).\n");

await fs.mkdir(path.join(root, "content", "docs"), { recursive: true });
await fs.symlink(externalFile, path.join(root, "content", "docs", "alias.md"));
execSync("git add -A && git commit -q -m external-symlink-fixture", { cwd: root, stdio: "pipe" });

const externalBytesBefore = await fs.readFile(externalFile, "utf-8");
const result = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") });
JSON.stringify({ filesMoved: result.filesMoved, skippedSymlinkRefs: result.skippedSymlinkRefs })
=> {"filesMoved":8,"skippedSymlinkRefs":["_content/docs/alias.md"]}
```

The external file's bytes are byte-for-byte unchanged — the migration never
opened it — and the migrated symlink still points at the same external
absolute path:

```ts continue
const externalBytesAfter = await fs.readFile(externalFile, "utf-8");
const linkTarget = await fs.readlink(path.join(root, "_content", "docs", "alias.md"));
JSON.stringify({ unchanged: externalBytesAfter === externalBytesBefore, linkTargetUnchanged: linkTarget === externalFile })
=> {"unchanged":true,"linkTargetUnchanged":true}
```

```ts cleanup
await fs.rm(externalDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await cleanup(root);
```

## Finding 3 (round 5 hardening): a symlinked view is never opened for rewrite

`src/views/Shared.tsx` is a TRACKED symlink to a file OUTSIDE the box
entirely (an external shared component) — `rewriteViewRefs` used to
`fs.readFile`/`writeFile` every path `listBoxViewFiles` returns, which FOLLOW
a symlink and would overwrite the external referent's bytes. Same policy as
the card/doc rewriter (finding 1 above): `lstat` first, skip a symlinked
leaf, and report it in `skippedSymlinkRefs`.

```ts
const root = await makeV2Box();
const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-external-view-"));
const externalView = path.join(externalDir, "Shared.tsx");
await fs.writeFile(externalView, 'export default function Shared() { return <div cardRef="/store/recipes/Soup.recipe.card" />; }\n');

await fs.mkdir(path.join(root, "src", "views"), { recursive: true });
await fs.symlink(externalView, path.join(root, "src", "views", "Shared.tsx"));
execSync("git add -A && git commit -q -m external-view-symlink-fixture", { cwd: root, stdio: "pipe" });

const externalBytesBefore = await fs.readFile(externalView, "utf-8");
const result = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") });
JSON.stringify({ filesMoved: result.filesMoved, skippedSymlinkRefs: result.skippedSymlinkRefs })
=> {"filesMoved":7,"skippedSymlinkRefs":["src/views/Shared.tsx"]}
```

The external view's bytes are byte-for-byte unchanged — the migration never
opened it — and the symlink still points at the same external absolute path:

```ts continue
const externalBytesAfter = await fs.readFile(externalView, "utf-8");
const linkTarget = await fs.readlink(path.join(root, "src", "views", "Shared.tsx"));
JSON.stringify({ unchanged: externalBytesAfter === externalBytesBefore, linkTargetUnchanged: linkTarget === externalView })
=> {"unchanged":true,"linkTargetUnchanged":true}
```

```ts cleanup
await fs.rm(externalDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await cleanup(root);
```

## Finding 1 (round 5 hardening): a package-root-ignored private file is never staged

`.claude/rules/private.md` is ignored by the v2 package-root `.gitignore` —
custom, hand-added, not part of the closed v2 vocabulary. `initBox`'s
`.gitignore` regen (step 5) briefly REPLACES that file wholesale before the
migrated-forward custom rule is merged back in; the old code ran
`mergeIgnoreRules` only after the FULL `bbx init` tail (`runInitTail`), whose
own provisioning step (`commitTemplateSyncChanges`) makes a real git commit of
any now-briefly-unignored template-managed path — `.claude/rules/*.md`
matches. That window let `private.md`'s bytes land in a git object before the
merge ever ran to re-ignore it; a later rollback's `reset --hard` can't
un-commit an object already written to the store. The merge now runs
immediately after the first `initBox` call, closing the window: the file is
never staged, and no git object for its content exists at any point.

```ts
const root = await makeV2Box();
await fs.writeFile(path.join(root, ".gitignore"), ".claude/rules/private.md\n");
await fs.mkdir(path.join(root, ".claude", "rules"), { recursive: true });
const privateContent = "# Private rules\n\nSecret operating instructions.\n";
await fs.writeFile(path.join(root, ".claude", "rules", "private.md"), privateContent);
execSync("git add -A && git commit -q -m private-rule-fixture", { cwd: root, stdio: "pipe" });
const privateBlobSha = execSync("git hash-object --stdin", { cwd: root, input: privateContent, encoding: "utf-8" }).trim();

await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") });

const stillThere = await fs.readFile(path.join(root, ".claude", "rules", "private.md"), "utf-8");
const stillIgnored = execSync("git check-ignore -q .claude/rules/private.md && echo yes || echo no", { cwd: root, encoding: "utf-8" }).trim();
const objectExists = execSync(`git cat-file -e ${privateBlobSha} && echo yes || echo no`, { cwd: root, encoding: "utf-8" }).trim();
JSON.stringify({ contentUnchanged: stillThere === privateContent, stillIgnored, objectExists })
=> {"contentUnchanged":true,"stillIgnored":"yes","objectExists":"no"}
```

It also never appears in any commit's tree, not just the object store:

```ts continue
const everListed = execSync('git log --all --name-only --pretty=format: -- .claude/rules/private.md', { cwd: root, encoding: "utf-8" }).trim();
everListed.length
=> 0
```

```ts cleanup
await cleanup(root);
```

## Finding 1 (round 6 hardening): a symlinked `src/views` ancestor aborts preflight, nothing mutated

`src/views` here is a TRACKED symlink to a directory OUTSIDE the box entirely.
Before this fix, `listBoxViewFiles`'s `glob` follows a symlinked `cwd`
transparently, and a per-file `lstat` inside it never sees the symlinked
PARENT — the ref rewriter would happily rewrite ordinary files EXTERNAL to
this box. Preflight now `lstat`s `src`, `src/views`, `src/schemas`,
`src/tricks`, and `.claude` and refuses before anything moves.

```ts
const root = await makeV2Box();
const externalViewsDir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-external-views-"));
await fs.writeFile(path.join(externalViewsDir, "Ordinary.tsx"), "export default function Ordinary() { return null; }\n");
await fs.rm(path.join(root, "src", "views"), { recursive: true, force: true });
await fs.symlink(externalViewsDir, path.join(root, "src", "views"));
execSync("git add -A && git commit -q -m symlinked-views-fixture", { cwd: root, stdio: "pipe" });

const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({
  isPreflightError: err instanceof OneRootPreflightError,
  mentionsPath: err.message.includes(path.join(root, "src", "views")),
  contentStillThere: await fs.access(path.join(root, "content")).then(() => true, () => false),
})
=> {"isPreflightError":true,"mentionsPath":true,"contentStillThere":true}
```

The external directory's file is untouched — the migration never walked
through the symlink at all:

```ts continue
const externalFiles = await fs.readdir(externalViewsDir);
JSON.stringify(externalFiles)
=> ["Ordinary.tsx"]
```

```ts cleanup
await fs.rm(externalViewsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await cleanup(root);
```

## Finding 3 (round 6 hardening): an ignored view's rewrite is journaled and restored on rollback

`src/views/Private.tsx` is gitignored (never committed) and carries a
`cardRef` that needs rewriting. Before this fix, `rewriteViewRefs` overwrote
it in place with no journal entry — a view never moves, so it has no
{@link PlannedMove} the way an untracked card/doc gets journaled. A later
gate failure (a separate dangling ref) rolls back everything else via
`revertToSnapshot`'s `reset --hard`, which only restores TRACKED content —
the ignored view's rewritten bytes would have survived the rollback
unrestored. They're now journaled and restored like every other untracked
in-place edit.

```ts
const root = await makeV2Box();
await fs.writeFile(path.join(root, ".gitignore"), "src/views/Private.tsx\n");
await fs.mkdir(path.join(root, "src", "views"), { recursive: true });
const privateViewSource = 'export default function Private() { return <div cardRef="/store/recipes/Soup.recipe.card" />; }\n';
await fs.writeFile(path.join(root, "src", "views", "Private.tsx"), privateViewSource);
await fs.mkdir(path.join(root, "content", "store", "recipes"), { recursive: true });
await fs.writeFile(path.join(root, "content", "store", "recipes", "Soup.recipe.card"), '---\ntitle: Soup\n---\nSoup.\n');
execSync("git add -A && git commit -q -m ignored-view-fixture", { cwd: root, stdio: "pipe" });

// A separate, unrelated dangling ref trips the hard link gate so the WHOLE
// migration rolls back — the same induced failure the earlier rollback test
// uses.
const fooPath = path.join(root, "content", "box", "inbox", "Foo.memo.card");
const fooBefore = await fs.readFile(fooPath, "utf-8");
await fs.writeFile(fooPath, fooBefore + "\n[ghost](../../nonexistent/Ghost.card)\n");
execSync("git add -A && git commit -q -m dangling-plus-ignored-view", { cwd: root, stdio: "pipe" });

const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({ isLinkGateError: err instanceof OneRootLinkGateError })
=> {"isLinkGateError":true}
```

The gitignored view's bytes are restored to exactly what they were before
the migration touched them — not left at the migration's rewritten (but now
orphaned, since the whole conversion rolled back) `cardRef`:

```ts continue
const privateViewAfter = await fs.readFile(path.join(root, "src", "views", "Private.tsx"), "utf-8");
privateViewAfter === privateViewSource
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

## `executeMoves`'s journal is caller-owned, so a mid-sequence throw doesn't lose track of what already moved

Before the fix, `executeMoves` built its own local array and returned it only
on full success — a `try`/`catch` in the caller assigned that return value to
its own tracking variable, so a throw partway through the loop left the
caller's variable at its initial empty value, with no record of the renames
that DID land (and so nothing for rollback to undo). Now the caller passes in
the journal array and `executeMoves` pushes to it after EACH successful
untracked rename, so it's populated exactly as far as the loop got — even
when the very next move throws.

This constructs two moves directly (bypassing the `content/` walk, so the
failure is deterministic instead of depending on filesystem readdir order):
the first (a "secret") succeeds; the second is forced to fail by pre-creating
a plain FILE at the exact directory slot its move needs to create (`fs.mkdir`
then throws `ENOTDIR`).

```ts
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-move-journal-"));
const contentRoot = path.join(root, "content");
await fs.mkdir(contentRoot, { recursive: true });
await fs.writeFile(path.join(contentRoot, "secret.txt"), "shh\n");
await fs.writeFile(path.join(contentRoot, "other.txt"), "other\n");
// "blocked" exists as a plain FILE, so `fs.mkdir("blocked/inner", { recursive: true })`
// for the second move throws ENOTDIR — a controlled, order-independent failure.
await fs.writeFile(path.join(root, "blocked"), "not a directory\n");

const journal = [];
const err = await executeMoves({
  packageRoot: root,
  contentRoot,
  moves: [
    { contentRelPath: "secret.txt", newRelPath: "_config/secret.txt", tracked: false },
    { contentRelPath: "other.txt", newRelPath: "blocked/inner/other.txt", tracked: false },
  ],
  journal,
}).catch((e) => e);

JSON.stringify({
  threw: err instanceof Error,
  journalLength: journal.length,
  journalEntryIsTheSecret: journal[0]?.oldAbs === path.join(contentRoot, "secret.txt") && journal[0]?.newAbs === path.join(root, "_config", "secret.txt"),
})
=> {"threw":true,"journalLength":1,"journalEntryIsTheSecret":true}
```

The journal alone (no other bookkeeping) is enough to restore the secret to
exactly one location — the same reversal `moveAndCommitBox`'s rollback
performs, in reverse order:

```ts continue
for (const entry of journal.toReversed()) {
  await fs.rename(entry.newAbs, entry.oldAbs);
}
const secretAtOldLocation = await fs.access(path.join(contentRoot, "secret.txt")).then(() => true, () => false);
const secretAtNewLocation = await fs.access(path.join(root, "_config", "secret.txt")).then(() => true, () => false);
JSON.stringify({ secretAtOldLocation, secretAtNewLocation })
=> {"secretAtOldLocation":true,"secretAtNewLocation":false}
```

```ts cleanup
await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```

## Colliding v3 destinations abort preflight instead of silently overwriting one source with the other

`content/docs/Collide.md` and `content/store/docs/Collide.md` both default
into `_content/docs/Collide.md` (`docs` → `_content/docs`; `store/docs` isn't
one of `mapStoreArea`'s named cases, so it falls to the free-form default —
also `_content/docs`). Without a preflight check, whichever move ran second
would silently clobber the first with no error. Both sources are named in the
abort, and nothing moves.

```ts
const root = await makeV2Box();
const content = path.join(root, "content");
await fs.mkdir(path.join(content, "docs"), { recursive: true });
await fs.writeFile(path.join(content, "docs", "Collide.md"), "docs copy\n");
await fs.mkdir(path.join(content, "store", "docs"), { recursive: true });
await fs.writeFile(path.join(content, "store", "docs", "Collide.md"), "store copy\n");
execSync("git add -A && git commit -q -m collision-fixture", { cwd: root, stdio: "pipe" });

const err = await runOneRootMigration({ packageRoot: root, contentRoot: content }).catch((e) => e);
JSON.stringify({
  isPreflightError: err instanceof OneRootPreflightError,
  mentionsBothSources: err.message.includes("docs/Collide.md") && err.message.includes("store/docs/Collide.md"),
  contentStillThere: await fs.access(content).then(() => true, () => false),
})
=> {"isPreflightError":true,"mentionsBothSources":true,"contentStillThere":true}
```

```ts cleanup
await cleanup(root);
```

## A moved symlink's relative target is remapped for its new depth

`content/store/drive/` is 3 levels below the package root; `_content/drive/`
(its v3 destination) is 2. A TRACKED symlink there with an annex-object-shape
relative target computed for the OLD depth (`../../../.git/…`) would dangle
at the new depth — one `../` too many. The migration recomputes it. (The
fixture's external target lives under `.git/info/` rather than the real
`.git/annex/` — creating that literal path would make the box's own
`isAnnexInitialized` probe, `src/core/annex/is-annex-box.ts`, believe it's a
real git-annex box and engage annex-aware code paths this fixture isn't
trying to exercise; the depth-remap logic itself doesn't care which
unmoved-external path it is.)

```ts
const root = await makeV2Box();
const externalObjDir = path.join(root, ".git", "info", "attic", "aa", "bb");
await fs.mkdir(externalObjDir, { recursive: true });
await fs.writeFile(path.join(externalObjDir, "SHA-dummy"), "annex bytes\n");

const content = path.join(root, "content");
await fs.mkdir(path.join(content, "store", "drive"), { recursive: true });
await fs.symlink(
  path.join("..", "..", "..", ".git", "info", "attic", "aa", "bb", "SHA-dummy"),
  path.join(content, "store", "drive", "annex-photo.bin"),
);
execSync("git add -A && git commit -q -m annex-depth-fixture", { cwd: root, stdio: "pipe" });

const result = await runOneRootMigration({ packageRoot: root, contentRoot: content });
result.filesMoved
=> 8
```

The link now resolves at its new (shallower) depth — two `../`, not three —
and still reads the same real bytes through it:

```ts continue
const newLinkPath = path.join(root, "_content", "drive", "annex-photo.bin");
const target = await fs.readlink(newLinkPath);
const bytes = await fs.readFile(newLinkPath, "utf-8");
JSON.stringify({ target, bytes })
=> {"target":"../../.git/info/attic/aa/bb/SHA-dummy","bytes":"annex bytes\n"}
```

```ts cleanup
await cleanup(root);
```

## `.gitignore`/`.gitattributes` custom rules merge forward instead of being discarded by the wholesale regen

`initBox` regenerates both files wholesale — a v2 box's own hand-added rules
(package-root-relative, like a `src/tricks/private.env` secret) would
otherwise vanish, silently un-ignoring whatever they protected. The migration
snapshots both files' custom rules before the regen and appends whatever
isn't already covered under a marked section afterward; the box-wide ignore
inventory (`git status --ignored`, taken at preflight, covering the WHOLE
box, not just this run's own moved entries) then verifies nothing lost
coverage.

```ts
const root = await makeV2Box();
await fs.writeFile(
  path.join(root, ".gitignore"),
  "node_modules/\nsrc/tricks/private.env\ncontent/docs/private2.env\n",
);
await fs.mkdir(path.join(root, "src", "tricks"), { recursive: true });
await fs.writeFile(
  path.join(root, ".gitattributes"),
  "*.psd -diff\ncontent/config/connectors/google-calendar-state.json -diff\n",
);
// Finding 8: a `.gitattributes` line has a PATTERN plus an attribute list —
// remapping the WHOLE line (attributes included) through `mapV2Path` maps
// nothing (a path with a trailing ` -diff` matches no real path) and, worse,
// bypasses the connector-state-file split (`_bookkeeping/connectors/`, not
// `_config/connectors/`) that a bare path string would have hit. Committed
// (tracked), unlike the untracked secrets below — this rule only needs to
// survive the regen and remap correctly, not exercise the ignore-regression
// check.
await fs.mkdir(path.join(root, "content", "config", "connectors"), { recursive: true });
await fs.writeFile(
  path.join(root, "content", "config", "connectors", "google-calendar-state.json"),
  '{"lastSync":"2026-01-01"}\n',
);
execSync("git add -A && git commit -q -m ignore-fixture-tracked", { cwd: root, stdio: "pipe" });
// Written AFTER the .gitignore rule above lands, so `git add -A` never picks
// it up — a real untracked secret, exactly like `config/connectors/*.secret.*`.
await fs.writeFile(path.join(root, "src", "tricks", "private.env"), "SECRET=shh\n");
// Finding 8 (round 3 hardening): a PACKAGE-root rule naming a `content/…`
// path — package-root-relative, so it needs remapping through `mapV2Path`
// just like a content-root rule does (it wasn't remapped at all before this
// fix, so the box-wide regression check aborted an otherwise-legit
// migration).
await fs.mkdir(path.join(root, "content", "docs"), { recursive: true });
await fs.writeFile(path.join(root, "content", "docs", "private2.env"), "SECRET2=shh\n");

const result = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") });
result.filesMoved
=> 9
```

The custom `.gitignore`/`.gitattributes` lines both survived the regen, under
a clearly marked section, and the secret they protect is still genuinely
ignored (not just textually present in the file):

```ts continue
const gitignore = await fs.readFile(path.join(root, ".gitignore"), "utf-8");
const gitattributes = await fs.readFile(path.join(root, ".gitattributes"), "utf-8");
const stillIgnored = execSync("git check-ignore -q src/tricks/private.env && echo yes || echo no", { cwd: root, encoding: "utf-8" }).trim();
JSON.stringify({
  gitignoreCarriedRule: gitignore.includes("src/tricks/private.env"),
  gitattributesCarriedRule: gitattributes.includes("*.psd -diff"),
  stillIgnored,
})
=> {"gitignoreCarriedRule":true,"gitattributesCarriedRule":true,"stillIgnored":"yes"}
```

The PACKAGE-root `content/docs/private2.env` rule remapped to its v3
location, and the secret it protects is still genuinely ignored there:

```ts continue
const private2Ignored = execSync("git check-ignore -q _content/docs/private2.env && echo yes || echo no", { cwd: root, encoding: "utf-8" }).trim();
JSON.stringify({
  gitignoreRemappedRule: gitignore.includes("/_content/docs/private2.env"),
  private2Ignored,
})
=> {"gitignoreRemappedRule":true,"private2Ignored":"yes"}
```

The `.gitattributes` PATTERN remapped to the connector-state-file split
(`_bookkeeping/connectors/`), with the ` -diff` attribute preserved verbatim
— not the whole line mapped as one opaque string (which would have landed,
wrongly, under `_config/connectors/`):

```ts continue
gitattributes.includes("/_bookkeeping/connectors/google-calendar-state.json -diff")
=> true
```

Finding 4 (round 3 hardening): a routine `bbx init` re-run — long after this
migration landed, e.g. at a later chat start — regenerates `.gitignore`/
`.gitattributes` wholesale like it always has. Before this fix that silently
discarded the migrated section this migration just merged forward; now
`initBox` preserves it across its own regeneration:

```ts continue
await initBox(root);
const gitignoreAfterInit = await fs.readFile(path.join(root, ".gitignore"), "utf-8");
const gitattributesAfterInit = await fs.readFile(path.join(root, ".gitattributes"), "utf-8");
JSON.stringify({
  gitignoreStillCarriesRule: gitignoreAfterInit.includes("/_content/docs/private2.env"),
  gitattributesStillCarriesRule: gitattributesAfterInit.includes("/_bookkeeping/connectors/google-calendar-state.json -diff"),
})
=> {"gitignoreStillCarriesRule":true,"gitattributesStillCarriesRule":true}
```

```ts cleanup
await cleanup(root);
```

## Round-7 hardening finding 1(b): a symlinked root `CLAUDE.md` write target aborts

A tracked root `CLAUDE.md -> /shared/persona.md` is a FILE symlink — legal on
disk — but the migration's own merge step writes the box's persona text
straight into it via `fs.writeFile`, which FOLLOWS the link. Before this fix
that landed the merged content at `/shared/persona.md`, outside the box's own
git history where rollback could never undo it. The write now `lstat`s its
target first and aborts rather than write through it:

```ts
const root = await makeV2Box();
const externalPersona = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-external-persona-"));
const personaFile = path.join(externalPersona, "persona.md");
await fs.writeFile(personaFile, "external persona bytes\n");
await fs.rm(path.join(root, "CLAUDE.md"));
await fs.symlink(personaFile, path.join(root, "CLAUDE.md"));
execSync("git add -A && git commit -q -m symlinked-claude-md-fixture", { cwd: root, stdio: "pipe" });

const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({
  isPreflightError: err instanceof OneRootPreflightError,
  mentionsPath: err.message.includes(path.join(root, "CLAUDE.md")),
})
=> {"isPreflightError":true,"mentionsPath":true}
```

The external file was never touched:

```ts continue
await fs.readFile(personaFile, "utf-8")
=> external persona bytes
```

```ts cleanup
await fs.rm(externalPersona, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await cleanup(root);
```

## Round-7 hardening finding 1(a): a symlinked `content/.claude` directory aborts preflight

`content/.claude` here is a TRACKED symlink to a directory OUTSIDE the box —
the shape the round-6 fixed ancestor list couldn't see (it only checks the
PACKAGE-ROOT `.claude`, which doesn't exist yet at preflight time). Left
unchecked, `git mv` would relocate the symlink ENTRY itself to become the
box's own `.claude`, and every later write into it (init's rule generation)
would land in the external directory. The full `content/` tree is now walked
once, before anything moves, and aborts on any symlinked DIRECTORY:

```ts
const root = await makeV2Box();
const externalClaudeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-external-claude-"));
await fs.writeFile(path.join(externalClaudeDir, "settings.json"), "{}\n");
await fs.symlink(externalClaudeDir, path.join(root, "content", ".claude"));
execSync("git add -A && git commit -q -m symlinked-content-claude-fixture", { cwd: root, stdio: "pipe" });

const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({
  isPreflightError: err instanceof OneRootPreflightError,
  mentionsPath: err.message.includes(path.join(root, "content", ".claude")),
  contentStillThere: await fs.access(path.join(root, "content")).then(() => true, () => false),
})
=> {"isPreflightError":true,"mentionsPath":true,"contentStillThere":true}
```

The external directory's file is untouched — nothing walked through the
symlink at all:

```ts continue
JSON.stringify(await fs.readdir(externalClaudeDir))
=> ["settings.json"]
```

```ts cleanup
await fs.rm(externalClaudeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await cleanup(root);
```

## Round-8 hardening finding 1: a symlinked package-root `.gitattributes` aborts preflight

`initBox`'s `.gitattributes` regen (step 5) runs BEFORE `mergeIgnoreRules`'s
own guard — a tracked package-root `.gitattributes -> /shared/attributes`
would otherwise have the migration's regenerated content written straight
through it via `fs.writeFile`, landing external bytes with no record in the
box's own git history. Preflight now `lstat`s this exact callee-written
target (along with `.gitignore`, `CLAUDE.md`, and the migration manifest's
old and new paths) before anything moves.

```ts
const root = await makeV2Box();
const externalAttrs = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-external-attrs-"));
const attrsFile = path.join(externalAttrs, "attributes");
await fs.writeFile(attrsFile, "external attributes bytes\n");
// `scaffoldPackageRoot` (`makeV2Box`) never writes a package-root
// `.gitattributes` — that file is first created by `initBox` at migration
// step 5, which is exactly the write this symlink must intercept.
await fs.symlink(attrsFile, path.join(root, ".gitattributes"));
execSync("git add -A && git commit -q -m symlinked-gitattributes-fixture", { cwd: root, stdio: "pipe" });

const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({
  isPreflightError: err instanceof OneRootPreflightError,
  mentionsPath: err.message.includes(path.join(root, ".gitattributes")),
  contentStillThere: await fs.access(path.join(root, "content")).then(() => true, () => false),
})
=> {"isPreflightError":true,"mentionsPath":true,"contentStillThere":true}
```

The external file was never touched:

```ts continue
await fs.readFile(attrsFile, "utf-8")
=> external attributes bytes
```

```ts cleanup
await fs.rm(externalAttrs, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await cleanup(root);
```

## Round-8 hardening finding 1: `appendManifestEntry` refuses a symlinked manifest path

Even past preflight, `appendManifestEntry` (`core/migration-run.ts`) is the
engine-general backstop: a symlinked `_config/migrations.jsonl` at the box's
v3 location — created here directly, bypassing the migration's own preflight
to exercise this call site in isolation — refuses rather than appending the
migration record through it.

```ts continue
const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-manifest-symlink-"));
const externalManifestDir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-external-manifest-"));
const externalManifest = path.join(externalManifestDir, "migrations.jsonl");
await fs.writeFile(externalManifest, "external manifest bytes\n");
await fs.mkdir(path.join(isolatedRoot, "_config"), { recursive: true });
await fs.symlink(externalManifest, path.join(isolatedRoot, "_config", "migrations.jsonl"));

const manifestErr = await appendManifestEntry(isolatedRoot, { name: "one-root", "applied-at": "2026-01-01T00:00:00.000Z" }).catch((e) => e);
JSON.stringify({ isSymlinkedManifestError: manifestErr instanceof SymlinkedManifestError })
=> {"isSymlinkedManifestError":true}
```

The external file is untouched:

```ts continue
await fs.readFile(externalManifest, "utf-8")
=> external manifest bytes
```

```ts cleanup
await fs.rm(externalManifestDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
await fs.rm(isolatedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
```

## Round-8 hardening finding 2: an untracked persona-merge source aborts move planning

`content/CLAUDE.md` untracked (never committed at all) can't be reached
through the FULL migration entry point in this exact shape — an untracked
file anywhere already fails `runOneRootMigration`'s own clean-tree preflight
check first. So this exercises `planMoves` (`one-root-move-plan.ts`) — the
function that actually classifies the merge source — directly, the same way
`bbx migrate`'s bootstrap would if it ever called it against a tree that
somehow got here (e.g. a hand-rolled partial migration). Before this fix,
the old code merged an untracked source into the tracked root `CLAUDE.md`
and `git add`ed the result regardless — staging its bytes into a git object
even before a LATER step could fail and roll the whole migration back
(`reset --hard` cannot un-commit an object already written to the store).

```ts
const root = await makeV2Box();
execSync("git rm -q --cached content/CLAUDE.md", { cwd: root, stdio: "pipe" });
execSync("git commit -q -m untrack-persona", { cwd: root, stdio: "pipe" });

const planErr = await planMoves({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({
  isPreflightError: planErr instanceof OneRootPreflightError,
  mentionsPath: planErr.message.includes(path.join(root, "content", "CLAUDE.md")),
  mentionsUntracked: planErr.message.includes("untracked"),
})
=> {"isPreflightError":true,"mentionsPath":true,"mentionsUntracked":true}
```

```ts cleanup
await cleanup(root);
```

## Round-8 hardening finding 2: a gitignored persona-merge source aborts the full migration

Same refusal for a `content/CLAUDE.md` that's genuinely ignored (not just
uncommitted) — the message distinguishes the two so the operator knows which
fix applies.

```ts
const root = await makeV2Box();
await fs.writeFile(path.join(root, ".gitignore"), "content/CLAUDE.md\n");
execSync("git rm -q --cached content/CLAUDE.md", { cwd: root, stdio: "pipe" });
execSync("git add -A && git commit -q -m ignored-persona-fixture", { cwd: root, stdio: "pipe" });

const err = await runOneRootMigration({ packageRoot: root, contentRoot: path.join(root, "content") }).catch((e) => e);
JSON.stringify({
  isPreflightError: err instanceof OneRootPreflightError,
  mentionsIgnored: err.message.includes("gitignored"),
})
=> {"isPreflightError":true,"mentionsIgnored":true}
```

```ts cleanup
await cleanup(root);
```
