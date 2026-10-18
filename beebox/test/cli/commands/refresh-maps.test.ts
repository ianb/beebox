// # bbx refresh-maps — the saved brief
//
// The bare command (the procedure's precheck shell) saves the brief that
// `--finalize` later reads as its baseline. `--brief` prints the same JSON but
// must not save it: re-saving at a later HEAD — an agent's own `--brief` after
// it committed, or the validate shell's — would empty finalize's diff window,
// and a real rewrite would read as unchanged and go unstamped.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import { refreshMapsCommand } from "../../../src/cli/commands/refresh-maps.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
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
  const out = printed();
  const print = out.print;
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
  print(`after --brief: saved=${await fileExists(briefPath)}`);
  await run([]);
  print(`after bare run: saved=${await fileExists(briefPath)}`);
  await t.checkText(out.with(process.chdir(cwd)), `after --brief: saved=false
after bare run: saved=true`);
});
