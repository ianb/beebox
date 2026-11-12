// # Git commands fed on stdin
//
// `gitWithInput` writes a work list to git's stdin. Git can exit before it
// reads all of it. The result then comes from git's exit code and stderr; the
// failed write must not escape as an uncaught `write EPIPE`, which crashes the
// box server and, in tests, fails whichever test happens to be running.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { gitWithInput } from "../../src/lib/git/internal.js";

// 4 MB is far more than a pipe buffer, so the write is still pending when git exits.
const UNREAD = "x".repeat(4_000_000);

void test("Git that exits without reading its input still settles by exit code.", async (t) => {
  t.check(await gitWithInput({ cwd: import.meta.dirname, args: ["--version"], input: UNREAD }), any(String).startsWith("git version "));
  const failure = await gitWithInput({ cwd: import.meta.dirname, args: ["no-such-subcommand"], input: UNREAD }).then(() => "resolved", (error: unknown) => String(error));
  t.check(failure, any(String).startsWith("GitBatchFailedError: git no-such-subcommand exited 1: git: 'no-such-subcommand' is not a git command."));
});
