/**
 * A child process that commits one file into a box, on a starting gun from the
 * parent. Exists so a test can create GENUINE cross-process contention on a
 * box's git index: a single-process test cannot demonstrate that the box git
 * lock works, because the thing it excludes is another process.
 *
 * Usage: `node --import tsx test/helpers/git-commit-child.ts <boxRoot> <name>`
 *
 * Writes `<name>.md` under the box root, prints `ready` on stdout, then waits
 * for a line on stdin before staging and committing. The parent releases every
 * child at once, so they all reach `stageAndCommitPaths` together.
 *
 * Prints `committed <hash>` on success, or `failed <message>` and exits 1.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageAndCommitPaths } from "../../src/lib/git.js";
import { errorMessage } from "../../src/lib/error-guards.js";
import { invariant } from "../../src/lib/invariant.js";

const boxRoot = process.argv[2];
const name = process.argv[3];
invariant(boxRoot !== undefined, "git-commit-child requires a box root argument");
invariant(name !== undefined, "git-commit-child requires a name argument");

const relPath = `${name}.md`;
await fs.writeFile(path.join(boxRoot, relPath), `written by ${name}\n`);

process.stdout.write("ready\n");

// Wait for the parent's starting gun so every child contends at once.
await new Promise<void>((resolve) => {
  process.stdin.once("data", () => {
    resolve();
  });
});

try {
  const hash = await stageAndCommitPaths(boxRoot, {
    paths: [relPath],
    message: `commit from ${name}`,
    trailers: { "Committed-By": name },
  });
  process.stdout.write(`committed ${hash ?? "null"}\n`);
  process.exit(0);
} catch (e) {
  process.stdout.write(`failed ${errorMessage(e)}\n`);
  process.exit(1);
}
