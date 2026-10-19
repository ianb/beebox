// # `bbx ls` / `bbx create` reject a display-form path argument
//
// `validate`, `ls`, `mv`, `rm`, and `create` all take a box-path CLI argument
// and share one guard (`src/cli/lib/cli-target-path.ts`): a boxholder
// DISPLAY-FORM path (`Config:box.json`) is rejected with a message naming the
// canonical form, rather than being silently treated as (and failing to find)
// a relative file of that literal name
// (`docs/plans/display-path-guard.subplan.md`). `mv`/`rm`'s own doctests
// (`move-command.doctest.md`, `trash-command.doctest.md`) cover those two
// directly; this file covers `ls` and `create`, which are reached only through
// `runCommand` (its catch-all converts the guard's thrown error into the same
// `CommandResult` failure shape).

import { test } from "tap";
import "agent-doctest/tap";
import { runCommand } from "../../../src/core/command-runner.js";
import { createCollectorContext } from "../../../src/core/command-runner.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { createCommand } from "../../../src/cli/commands/create.js";

// ## `bbx create` template argument help
//
// Unknown option errors guide users to positional template key=value arguments
// and template-specific argument descriptions:

// ## `bbx ls`
//
// A display-form glob/path argument is rejected outright — not silently
// expanded to an empty match (the pre-fix behavior: `Config:*.card` returned a
// successful empty listing):
void test("A display-form glob/path argument is rejected outright — not silently expande...", async (t) => {
  // doctest:L27
  const box = await makeTmpBox();
  const { ctx } = createCollectorContext(box.root);
  const result = await runCommand({ name: "ls", args: { paths: ["Config:*.card"] }, ctx });
  t.check(result, {
    success: false,
    error: "`Config:*.card` is the boxholder's display form; write `/_config/*.card`",
  });

  // doctest:L35
  await box.cleanup();
});

// ## `bbx create`
void test("`bbx create`", async (t) => {
  // doctest:L41
  const cbox = await makeTmpBox();
  const { ctx: cctx } = createCollectorContext(cbox.root);
  const createResult = await runCommand({
    name: "create",
    args: { path: "Bookkeeping:jobs/x.job.card", template: "doc" },
    ctx: cctx,
  });
  t.check(createResult, {
    success: false,
    error: "`Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`",
  });

  // doctest:L53
  await cbox.cleanup();
});

void test("`bbx create` template argument help", async (t) => {
  // doctest:L66
  let errorText = "";
  createCommand.configureOutput({ writeErr: (text) => { errorText += text; } }).exitOverride();
  try { createCommand.parse(["node", "bbx", "example.doc.card", "--title", "Example"]); } catch (_error) { /* Commander exitOverride throws after writing the expected error hint. */ }
  t.checkText(errorText, `error: unknown option '--title'
Template arguments use positional key=value pairs. Use --describe-template <name> to see a template's keys.`);
});
