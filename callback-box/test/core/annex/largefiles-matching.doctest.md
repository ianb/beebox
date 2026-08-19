# `annex.largefiles` matches an asset in any spelling of its extension

A real git-annex repository configured exactly as `cb doctor annex` leaves one,
committing the same photo under three spellings of `.jpg`. The point is the one
that used to fail: git-annex matches its globs case-sensitively, so an
expression built from the lowercase and all-uppercase spellings alone let
`Mixed.Jpg` through, and the bytes landed in git. Both renderings in
`src/lib/asset-extensions.ts` now use the same per-character any-case glob, so
neither can match a path the other misses.

Where git-annex is not installed the assertion degrades to a recorded skip
rather than a false pass — a plain git repo would report every file as
"committed" and prove nothing.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { assetAnnexAttributes, assetLargefilesExpression } from "../../../src/lib/asset-extensions.js";

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

/** ANNEXED / in-git for each committed path, one line each. */
function classify(repo: string): string {
  return execFileSync("git", ["ls-files"], { cwd: repo })
    .toString().trim().split("\n")
    .map((f) => {
      const blob = execFileSync("git", ["cat-file", "-p", `HEAD:${f}`], { cwd: repo }).toString();
      return `${path.basename(f)} ${blob.startsWith("/annex/objects/") ? "ANNEXED" : "in-git"}`;
    })
    .sort().join("\n");
}
```

```ts
const repo = await mkdtemp(path.join(tmpdir(), "cb-largefiles-"));
execFileSync("git", ["init", "-q", "."], { cwd: repo });
execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
execFileSync("git", ["annex", "init", "-q", "test"], { cwd: repo });
execFileSync("git", ["annex", "config", "--set", "annex.largefiles", assetLargefilesExpression()], { cwd: repo, stdio: "pipe" });
await fs.writeFile(path.join(repo, ".git", "info", "attributes"), assetAnnexAttributes());

await fs.mkdir(path.join(repo, "Note.attach"), { recursive: true });
for (const name of ["lower.jpg", "UPPER.JPG", "Mixed.Jpg"]) {
  await fs.writeFile(path.join(repo, "Note.attach", name), Buffer.alloc(200_000, 0x42));
}
await fs.writeFile(path.join(repo, "Note.memo.card"), "a card is text, wherever it sits\n");
execFileSync("git", ["add", "-A"], { cwd: repo });
execFileSync("git", ["commit", "-q", "-m", "assets"], { cwd: repo });

ANNEX ? classify(repo) : "skipped: git-annex not installed"
=>
Mixed.Jpg ANNEXED
Note.memo.card in-git
UPPER.JPG ANNEXED
lower.jpg ANNEXED
```

```ts cleanup
try {
  execFileSync("chmod", ["-R", "u+w", repo], { stdio: "pipe" });
} catch (_e) {
  /* ignore: best-effort; rm reports anything that actually matters */
}
await fs.rm(repo, { recursive: true, force: true });
```
