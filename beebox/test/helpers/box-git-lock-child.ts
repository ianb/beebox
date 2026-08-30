/**
 * A child process that takes a box's git lock and holds it forever, so a test
 * can SIGKILL it mid-hold and observe what a real crashed holder does to the
 * next writer.
 *
 * Usage: `node --import tsx test/helpers/box-git-lock-child.ts <boxRoot>`
 * Prints `held` on stdout once the lock is held; never exits on its own.
 */
import { withBoxGitLock } from "../../src/lib/git-lock.js";
import { invariant } from "../../src/lib/invariant.js";

const boxRoot = process.argv[2];
invariant(boxRoot !== undefined, "box-git-lock-child requires a box root argument");

await withBoxGitLock(boxRoot, async () => {
  process.stdout.write("held\n");
  // Hold until killed. The empty interval keeps the event loop alive, so
  // proper-lockfile's guard refresh keeps running exactly as a real holder's
  // would — the lock looks live right up to the moment we are killed.
  await new Promise<void>(() => {
    setInterval(() => {}, 1000);
  });
});
