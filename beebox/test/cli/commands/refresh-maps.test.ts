// # bbx refresh-maps — the saved brief
//
// The bare command (the procedure's precheck shell) saves the brief that
// `--finalize` later reads as its baseline. `--brief` prints the same JSON but
// must not save it: re-saving at a later HEAD — an agent's own `--brief` after
// it committed, or the validate shell's — would empty finalize's diff window,
// and a real rewrite would read as unchanged and go unstamped.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { refreshMapsCommand } from "../../../src/cli/commands/refresh-maps.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { fileExists } from "../../../src/lib/file-exists.js";
import { join } from "node:path";

async function run(args: string[]): Promise<void> {
  const log = console.log;
  console.log = () => {};
  try {
    await refreshMapsCommand.parseAsync(args, { from: "user" });
  } finally {
    console.log = log;
  }
}

void test("line 26", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L27
  const box = await makeTmpBox({ git: true });
  await box.write("work/notes/a.md", "a");
  await box.write("work/refs/b.md", "b");
  box.commitAll("seed");
  const briefPath = join(box.root, ".beebox", "refresh-maps-brief.json");
  const cwd = process.cwd();
  process.chdir(box.root);

  // doctest:L35
  await run(["--brief"]);
  const afterBrief = await fileExists(briefPath);
  await run([]);
  const afterBare = await fileExists(briefPath);
  process.chdir(cwd);
  t.check({ afterBrief, afterBare }, { afterBrief: false, afterBare: true });
});
