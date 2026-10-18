// # Cross-process box authorization writes
//
// Hub invite acceptance and a running box's Admin UI can mutate the same
// `_config/box.json`. The shared file lock preserves both updates when separate
// processes race.

import { test } from "tap";
import "agent-doctest/tap";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const PACKAGE_ROOT = join(import.meta.dirname, "../..");

async function grantInChild(boxRoot: string, email: string) {
  const code = "const { grantBoxAccess } = await import(\"./src/webapp/box-config-write.ts\"); await grantBoxAccess({ boxRoot: process.env.TEST_BOX_ROOT, email: process.env.TEST_EMAIL });";
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, TEST_BOX_ROOT: boxRoot, TEST_EMAIL: email },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += String(chunk); });
  const codeResult = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (codeResult !== 0) throw new Error(`box-config child failed (${codeResult}): ${stderr}`);
}

void test("line 31", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L32
  const box = await makeTmpBox({ git: true });
  await Promise.all([
    grantInChild(box.root, "first@example.com"),
    grantInChild(box.root, "second@example.com"),
  ]);
  const config = JSON.parse(await box.read("_config/box.json"));
  t.check(config.allowedEmails.toSorted().join(","), "first@example.com,second@example.com");
});
