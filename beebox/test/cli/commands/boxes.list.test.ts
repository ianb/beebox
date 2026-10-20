// # `bbx boxes list` keeps going past a broken entry
//
// Box identity reads each entry's `package.json` (`isBoxRoot`), and one that
// does not parse beside `_config/` throws. The listing reports that entry's
// problem and goes on, so one broken box does not hide the ones after it.
// The test preload isolates home, so `boxes.json` here is a throwaway.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { boxesCommand } from "../../../src/cli/commands/boxes.js";
import { BBX_CONFIG_DIR } from "../../../src/lib/state-dir.js";
import { writeBoxFiles } from "../../helpers/test-helpers.js";

void test("A valid box after a malformed one is still listed", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-boxes-list-"));
  const configFile = path.join(BBX_CONFIG_DIR, "boxes.json");
  t.teardown(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(configFile, { force: true });
  });
  const broken = path.join(dir, "broken");
  await fs.mkdir(path.join(broken, "_config"), { recursive: true });
  await fs.writeFile(path.join(broken, "package.json"), "{not json");
  const good = path.join(dir, "good");
  await writeBoxFiles(good);
  await fs.mkdir(BBX_CONFIG_DIR, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify({ boxes: [broken, good] }));

  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ").replaceAll(dir, "<dir>")); };
  try {
    await boxesCommand.parseAsync(["list"], { from: "user" });
  } finally {
    console.log = original;
  }
  t.check(lines, [str`! <dir>/broken (Box at <dir>/broken has no readable package.json. ${any(String)})`, "  <dir>/good"]);
});
