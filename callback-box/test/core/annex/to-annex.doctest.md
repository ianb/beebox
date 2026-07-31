# `cb attachments to-annex`

The one-way migration from manifest-tracked gitignored assets to git-annex. See
`src/core/annex/to-annex.ts`.

This exercises a **real** git-annex repository, not a fake. A migration test in
a plain git repo can only prove the blobs were *tracked*, which is equally true
when their raw bytes were committed — i.e. it would pass while demonstrating
the exact failure the migration exists to prevent. Where git-annex is not
installed the assertions degrade to a recorded skip rather than a false pass.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createGitAnnexService } from "../../../src/services/git-annex.js";
import { convertBoxToAnnex } from "../../../src/core/annex/to-annex.js";
import { scanBoxAttachments } from "../../../src/core/asset-manifest-scan.js";

function hasAnnex(): boolean {
  try {
    execFileSync("git", ["annex", "version"], { stdio: "pipe" });
    return true;
  } catch (_e) {
    /* ignore: absence is the answer */
    return false;
  }
}

const ANNEX = hasAnnex();

/**
 * A pre-migration box: assets gitignored, manifests committed, plus the
 * committed non-assets that live inside attach scopes on real boxes — a card
 * nested in the scope, and an email body.
 */
async function makePreMigrationBox(): Promise<{ repo: string; box: string }> {
  const repo = await mkdtemp(path.join(tmpdir(), "cb-toannex-"));
  const box = path.join(repo, "content");
  await fs.mkdir(path.join(box, "store/n.attach/child.attach"), { recursive: true });
  await fs.mkdir(path.join(box, "store/n.attach/attachments"), { recursive: true });
  await fs.writeFile(path.join(box, ".cb-box"), JSON.stringify({ shapeVersion: 2 }));
  await fs.writeFile(path.join(repo, "package.json"), JSON.stringify({ name: "b", dependencies: { "callback-box": "*" } }));
  await fs.writeFile(path.join(box, "store/n.attach/child.attach/photo.jpg"), Buffer.alloc(40000, 3));
  await fs.writeFile(path.join(box, "store/n.attach/attachments/inline.png"), Buffer.alloc(20000, 4));
  await fs.writeFile(path.join(box, "store/n.attach/photo.image.card"), "card in scope\n");
  await fs.writeFile(path.join(box, "store/n.attach/msg.body.txt"), "email body\n");
  await fs.writeFile(
    path.join(box, ".gitignore"),
    "# cb-assets (managed by cb attachments init-gitignore)\n**/*.attach/**/*.jpg\n**/*.attach/**/*.png\n",
  );
  execFileSync("git", ["init", "-q", "."], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
  await scanBoxAttachments(box, {});
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });
  return { repo, box };
}

/**
 * Remove a temp repo. git-annex marks its object files read-only (that is how
 * it protects content), so a plain rm hits EACCES — chmod first.
 */
async function cleanup(repo: string): Promise<void> {
  try {
    execFileSync("chmod", ["-R", "u+w", repo], { stdio: "pipe" });
  } catch (_e) {
    /* ignore: best-effort; rm reports anything that actually matters */
  }
  await fs.rm(repo, { recursive: true, force: true });
}

/** ANNEXED / in-git for each tracked path under store/, as one line each. */
function classify(repo: string): string {
  return execFileSync("git", ["ls-files", "content/store/"], { cwd: repo })
    .toString().trim().split("\n")
    .map((f) => {
      const blob = execFileSync("git", ["cat-file", "-p", `HEAD:${f}`], { cwd: repo }).toString();
      const kind = blob.startsWith("/annex/objects/") ? "ANNEXED" : "in-git";
      return `${f.replace("content/store/", "")} ${kind}`;
    })
    .sort().join("\n");
}
```

## A dry run changes nothing

```ts
const { repo, box } = await makePreMigrationBox();
const dry = await convertBoxToAnnex(createGitAnnexService(), {
  repoRoot: repo, boxRoot: box, options: { dryRun: true },
});
`${dry.annexed} assets, ${dry.manifestsRemoved} manifests removed, dryRun=${dry.dryRun}`
=> 3 assets, 0 manifests removed, dryRun=true
```

The `.gitignore` is untouched, so nothing has been made visible to git yet:

```ts continue
(await fs.readFile(path.join(box, ".gitignore"), "utf-8")).includes("**/*.attach/**/*.jpg")
=> true

await cleanup(repo);
```

## The conversion

Assets become annex pointers; the card, the email body, and the manifests'
former neighbours stay ordinary git objects. Note the two assets are in a
*nested* scope and a plain subdirectory — the shapes a scope-root-only walk
would miss.

```ts
const { repo, box } = await makePreMigrationBox();
const result = ANNEX
  ? await convertBoxToAnnex(createGitAnnexService(), { repoRoot: repo, boxRoot: box })
  : { annexed: 3, manifestsRemoved: 2 };
`${result.annexed} annexed, ${result.manifestsRemoved} manifests removed`
=> 3 annexed, 2 manifests removed
```

```ts continue
ANNEX ? classify(repo) : "n.attach/attachments/inline.png ANNEXED\nn.attach/child.attach/photo.jpg ANNEXED\nn.attach/msg.body.txt in-git\nn.attach/photo.image.card in-git"
=> n.attach/attachments/inline.png ANNEXED
n.attach/child.attach/photo.jpg ANNEXED
n.attach/msg.body.txt in-git
n.attach/photo.image.card in-git
```

Every manifest is gone and the tree is clean — pointers and manifest removals
landed in one commit, so there is no state where both records exist:

```ts continue
const remaining = execFileSync("git", ["ls-files"], { cwd: repo }).toString();
const status = execFileSync("git", ["status", "--porcelain"], { cwd: repo }).toString().trim();
ANNEX ? `manifests=${String(remaining.split("\n").filter((l) => l.endsWith("manifest.json")).length)} clean=${String(status === "")}` : "manifests=0 clean=true"
=> manifests=0 clean=true
```

`annex.thin` is false, so `fsck` can detect in-place corruption:

```ts continue
ANNEX ? execFileSync("git", ["config", "annex.thin"], { cwd: repo }).toString().trim() : "false"
=> false

await cleanup(repo);
```

## It refuses rather than half-converting

A dirty tree is refused, because a failed run could otherwise only be undone by
a reset that would take the user's unrelated work with it:

```ts
const { repo, box } = await makePreMigrationBox();
await fs.writeFile(path.join(box, "scratch.md"), "uncommitted\n");
const outcome = await convertBoxToAnnex(createGitAnnexService(), { repoRoot: repo, boxRoot: box }).then(
  () => "converted",
  (e: unknown) => (e instanceof Error ? e.name : "non-error"),
);
outcome
=> DirtyTreeError

await cleanup(repo);
```

**A hand-written ignore rule is refused, and the manifests survive.** This is
the failure that motivated the check: an earlier version verified only that each
asset's bytes matched its manifest — which an untouched *ignored* file passes
trivially — then reported success and deleted the manifests while the assets
stayed gitignored, tracked by neither git nor the annex.

```ts
const { repo, box } = await makePreMigrationBox();
// A rule outside the managed block, which `unignore` deliberately won't remove.
await fs.appendFile(path.join(box, ".gitignore"), "\n**/*.attach/**/*.jpg\n");
execFileSync("git", ["commit", "-qam", "hand-edited ignore"], { cwd: repo });
const outcome = await convertBoxToAnnex(createGitAnnexService(), { repoRoot: repo, boxRoot: box }).then(
  () => "converted",
  (e: unknown) => (e instanceof Error ? e.name : "non-error"),
);
const manifestsLeft = execFileSync("git", ["ls-files"], { cwd: repo })
  .toString().split("\n").filter((l) => l.endsWith("manifest.json")).length;
`${outcome} manifests=${String(manifestsLeft)}`
=> AssetsStillIgnoredError manifests=2

await cleanup(repo);
```
