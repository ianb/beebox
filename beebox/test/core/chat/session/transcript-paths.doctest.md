# `isTaskOutputPathForBox` — box-scoping a Claude Code background-task output path

The shape check behind `GET /api/task-output` (`webapp/routes/api.ts`): a
task's output file lives at
`/private/tmp/claude-<uid>/<encoded agent cwd>/<session-id>/tasks/<id>.output`,
and the route must refuse anything that isn't exactly one box's own file under
that shape — see `src/core/chat/session/transcript-paths.ts`.

```ts setup
import { isTaskOutputPathForBox, encodeProjectDir } from "../../../../src/core/chat/session/transcript-paths.js";

const BOX_ROOT = "/srv/boxes/alpha";
const ENCODED = encodeProjectDir(BOX_ROOT);

function taskPath({ root, cwd, session, file }) {
  return `${root ?? "/private/tmp"}/claude-501/${cwd ?? ENCODED}/${session ?? "sess-1"}/tasks/${file ?? "t1.output"}`;
}
```

## A well-shaped path for this box's own root is accepted, on `/private/tmp` and `/tmp`

```ts
print(`private tmp: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: taskPath({}) })}`);
print(`bare tmp: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: taskPath({ root: "/tmp" }) })}`);
=>
private tmp: true
bare tmp: true
```

## A landmark-bound subdirectory cwd (the `-`-extended encoded segment) is also this box's

`encodeProjectDir` turns the subdirectory's extra `/segment` into a literal
`-` plus more encoded characters appended to the box's own encoded root — so
`isTaskOutputPathForBox` must accept the extension, not just the exact match.

```ts continue
const subdirCwd = encodeProjectDir(`${BOX_ROOT}/landmarks/kitchen`);
print(`starts with box's encoded root: ${subdirCwd.startsWith(`${ENCODED}-`)}`);
print(`accepted: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: taskPath({ cwd: subdirCwd }) })}`);
=>
starts with box's encoded root: true
accepted: true
```

## Another box's encoded cwd is rejected — including one that merely shares a string prefix

```ts continue
const otherBox = "/srv/boxes/beta";
print(`other box: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: taskPath({ cwd: encodeProjectDir(otherBox) }) })}`);
// A box whose encoded root is a bare STRING PREFIX of this box's (no `-`
// separator) must not pass — only an exact match or a `-`-delimited
// extension counts. `prefixSharingBox` drops the trailing "a" of ".../alpha".
const prefixSharingBox = BOX_ROOT.slice(0, -1);
print(`bare string-prefix box: ${isTaskOutputPathForBox({ boxRoot: prefixSharingBox, filePath: taskPath({}) })}`);
=>
other box: false
bare string-prefix box: false
```

## Outside the tmp root, missing `/tasks/`, or a nested path under `tasks/` is rejected

```ts continue
print(`outside tmp: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: `/etc/passwd` })}`);
print(`no tasks segment: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: `/private/tmp/claude-501/${ENCODED}/sess-1/other/t1.output` })}`);
print(`nested under tasks: ${isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: `/private/tmp/claude-501/${ENCODED}/sess-1/tasks/nested/t1.output` })}`);
=>
outside tmp: false
no tasks segment: false
nested under tasks: false
```

## A `..` traversal is resolved (via `path.resolve`) before the shape check runs

```ts continue
const escaping = `/private/tmp/claude-501/${ENCODED}/sess-1/tasks/../../../../etc/passwd`;
isTaskOutputPathForBox({ boxRoot: BOX_ROOT, filePath: escaping })
=> false
```
