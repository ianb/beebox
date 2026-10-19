// # `isTaskOutputPathForBox` — box-scoping a Claude Code background-task output path
//
// The shape check behind `GET /api/task-output` (`webapp/routes/api.ts`): a
// task's output file lives at
// `/private/tmp/claude-<uid>/<encoded agent cwd>/<session-id>/tasks/<id>.output`,
// and the route must refuse anything that isn't exactly one box's own file under
// that shape — see `src/core/chat/session/transcript-paths.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isTaskOutputPathForBox, encodeProjectDir } from "../../../../src/core/chat/session/transcript-paths.js";

const BOX_ROOT = "/srv/boxes/alpha";
const ENCODED = encodeProjectDir(BOX_ROOT);

function taskPath({ root, cwd, session, file }: { root?: string; cwd?: string; session?: string; file?: string }) {
  return `${root ?? "/private/tmp"}/claude-501/${cwd ?? ENCODED}/${session ?? "sess-1"}/tasks/${file ?? "t1.output"}`;
}

// The box's chat history binds one chat to the `landmarks/kitchen` directory.
const CONTEXT_DIRS = ["landmarks/kitchen"];

const ok = (filePath: string, boxRoot?: string) =>
  isTaskOutputPathForBox({ boxRoot: boxRoot ?? BOX_ROOT, contextDirs: CONTEXT_DIRS, filePath });

// ## A well-shaped path for this box's own root is accepted, on `/private/tmp` and `/tmp`
void test("A well-shaped path for this box's own root is accepted, on `/private/tmp` and `/tmp`", async (t) => {
  t.check(
    { privateTmp: ok(taskPath({})), bareTmp: ok(taskPath({ root: "/tmp" })) },
    { privateTmp: true, bareTmp: true },
  );

  // ## A landmark cwd the history records is this box's; one it does not record is not

  t.check(
    {
      recordedLandmark: ok(taskPath({ cwd: encodeProjectDir(`${BOX_ROOT}/landmarks/kitchen`) })),
      unrecordedLandmark: ok(taskPath({ cwd: encodeProjectDir(`${BOX_ROOT}/landmarks/garage`) })),
    },
    { recordedLandmark: true, unrecordedLandmark: false },
  );

  // ## Another box's encoded cwd is rejected, including a sibling whose name extends this one
  //
  // The encoding maps every non-alphanumeric character to `-`, so the sibling
  // `/srv/boxes/alpha-other` encodes to this box's encoded root plus `-other`.
  // The earlier prefix rule ("the root, or the root plus `-`") accepted it.
  // `prefixSharingBox` drops the trailing "a" of ".../alpha".

  t.check(
    {
      otherBox: ok(taskPath({ cwd: encodeProjectDir("/srv/boxes/beta") })),
      hyphenSibling: ok(taskPath({ cwd: encodeProjectDir("/srv/boxes/alpha-other") })),
      bareStringPrefixBox: ok(taskPath({}), BOX_ROOT.slice(0, -1)),
    },
    { otherBox: false, hyphenSibling: false, bareStringPrefixBox: false },
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
