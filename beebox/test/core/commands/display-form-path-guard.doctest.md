# `bbx ls` / `bbx create` reject a display-form path argument

`validate`, `ls`, `mv`, `rm`, and `create` all take a box-path CLI argument
and share one guard (`src/cli/lib/cli-target-path.ts`): a boxholder
DISPLAY-FORM path (`Config:box.json`) is rejected with a message naming the
canonical form, rather than being silently treated as (and failing to find)
a relative file of that literal name
(`docs/plans/display-path-guard.subplan.md`). `mv`/`rm`'s own doctests
(`move-command.doctest.md`, `trash-command.doctest.md`) cover those two
directly; this file covers `ls` and `create`, which are reached only through
`runCommand` (its catch-all converts the guard's thrown error into the same
`CommandResult` failure shape).

```ts setup
import { runCommand } from "../../../src/core/command-runner.js";
import { createCollectorContext } from "../../../src/core/commands/index.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## `bbx ls`

A display-form glob/path argument is rejected outright — not silently
expanded to an empty match (the pre-fix behavior: `Config:*.card` returned a
successful empty listing):

```ts
const box = await makeTmpBox();
const { ctx } = createCollectorContext(box.root);
const result = await runCommand({ name: "ls", args: { paths: ["Config:*.card"] }, ctx });
JSON.stringify(result)
=> {"success":false,"error":"`Config:*.card` is the boxholder's display form; write `/_config/*.card`"}
```

```ts continue
await box.cleanup();
```

## `bbx create`

```ts
const cbox = await makeTmpBox();
const { ctx: cctx } = createCollectorContext(cbox.root);
const createResult = await runCommand({
  name: "create",
  args: { path: "Bookkeeping:jobs/x.job.card", template: "doc" },
  ctx: cctx,
});
JSON.stringify(createResult)
=> {"success":false,"error":"`Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`"}
```

```ts continue
await cbox.cleanup();
```
