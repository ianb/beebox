// # `isTaskOutputPathForBox` — box-scoping a Claude Code background-task output path
//
// The shape check behind `GET /api/task-output` (`webapp/routes/api.ts`): a
// task's output file lives at
// `/private/tmp/claude-<uid>/<encoded agent cwd>/<session-id>/tasks/<id>.output`,
// and the route must refuse anything that isn't exactly one box's own file under
// that shape — see `src/core/chat/session/transcript-paths.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { isTaskOutputPathForBox, encodeProjectDir } from "../../../../src/core/chat/session/transcript-paths.js";

const BOX_ROOT = "/srv/boxes/alpha";
const ENCODED = encodeProjectDir(BOX_ROOT);

function taskPath({ root, cwd, session, file }: { root?: string; cwd?: string; session?: string; file?: string }) {
  return `${root ?? "/private/tmp"}/claude-501/${cwd ?? ENCODED}/${session ?? "sess-1"}/tasks/${file ?? "t1.output"}`;
}

const ok = (filePath: string, boxRoot?: string) => isTaskOutputPathForBox({ boxRoot: boxRoot ?? BOX_ROOT, filePath });

// ## A well-shaped path for this box's own root is accepted, on `/private/tmp` and `/tmp`
void test("A well-shaped path for this box's own root is accepted, on `/private/tmp` and `/tmp`", async (t) => {
  t.check(
    { privateTmp: ok(taskPath({})), bareTmp: ok(taskPath({ root: "/tmp" })) },
    { privateTmp: true, bareTmp: true },
  );

  // ## A landmark-bound subdirectory cwd (the `-`-extended encoded segment) is also this box's
  //
  // `encodeProjectDir` turns the subdirectory's extra `/segment` into a literal
  // `-` plus more encoded characters appended to the box's own encoded root — so
  // `isTaskOutputPathForBox` must accept the extension, not just the exact match.

  const subdirCwd = encodeProjectDir(`${BOX_ROOT}/landmarks/kitchen`);
  t.check(subdirCwd, str`${ENCODED}-${any(String)}`);
  t.check(ok(taskPath({ cwd: subdirCwd })), true);

  // ## Another box's encoded cwd is rejected — including one that merely shares a string prefix

  const otherBox = "/srv/boxes/beta";
  // A box whose encoded root is a bare STRING PREFIX of this box's (no `-`
  // separator) must not pass — only an exact match or a `-`-delimited
  // extension counts. `prefixSharingBox` drops the trailing "a" of ".../alpha".
  const prefixSharingBox = BOX_ROOT.slice(0, -1);
  t.check(
    {
      otherBox: ok(taskPath({ cwd: encodeProjectDir(otherBox) })),
      bareStringPrefixBox: ok(taskPath({}), prefixSharingBox),
    },
    { otherBox: false, bareStringPrefixBox: false },
  );

  // ## Outside the tmp root, missing `/tasks/`, or a nested path under `tasks/` is rejected

  t.check(
    {
      outsideTmp: ok("/etc/passwd"),
      noTasksSegment: ok(`/private/tmp/claude-501/${ENCODED}/sess-1/other/t1.output`),
      nestedUnderTasks: ok(`/private/tmp/claude-501/${ENCODED}/sess-1/tasks/nested/t1.output`),
    },
    { outsideTmp: false, noTasksSegment: false, nestedUnderTasks: false },
  );

  // ## A `..` traversal is resolved (via `path.resolve`) before the shape check runs

  const escaping = `/private/tmp/claude-501/${ENCODED}/sess-1/tasks/../../../../etc/passwd`;
  t.check(ok(escaping), false);
});
