// # Deployment ownership survives its child command
//
// Use real Git boxes and a real child process. The child sees both boxes closed,
// can join only its own fleet permits, and declares readiness without reopening.
// Only the controller reopens after the trusted verification command succeeds.
// The controller starts one holder per box owner (`hold.ts`); here one, as the
// test's own user. Root on a host whose boxes have several owners is exercised
// by deploy.sh on the per-box-units VM, not here.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { defaultHubConfigPath } from "../../../src/hub/config.js";
import { pathToFileURL } from "node:url";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { runMaintenance } from "../../../src/cli/commands/maintenance/command.js";
import { boxMaintenanceStatus } from "../../../src/lib/box-maintenance/admission.js";

const library = pathToFileURL(join(import.meta.dirname, "../../../src/lib/box-maintenance/admission.ts")).href;
const readyScript = `
const { acquireBoxMaintenance, boxMaintenanceStatus, acquireBoxWork } = await import(${JSON.stringify(library)});
const roots = Object.keys(JSON.parse(process.env.BBX_MAINTENANCE_PERMITS));
for (const root of roots) {
  if ((await boxMaintenanceStatus(root)).phase !== "exclusive") throw Error("not closed");
  try { await acquireBoxWork(root, { reason: "test" }); throw Error("admitted"); }
  catch (error) { if (error.name !== "BoxMaintenanceError") throw error; }
}
for (const root of roots) {
  const nested = await acquireBoxMaintenance(root, { reason: "fixture", join: true });
  await nested.prepare();
  if ((await boxMaintenanceStatus(root)).phase !== "ready") throw Error("opened early");
}
`;

void test("line 37", async (t) => {
  t.teardown(async () => {
    try {
      const listening = canary;
      if (listening) await new Promise<void>((resolve) => listening.close(() => resolve()));
      await rm(configPath, { force: true });
      if (previousKey === undefined) delete process.env.BBX_DIAG_API_KEY;
      else process.env.BBX_DIAG_API_KEY = previousKey;
      await one.cleanup();
      await two.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const previousKey = process.env.BBX_DIAG_API_KEY;
  const configPath = defaultHubConfigPath();
  const one = await makeTmpBox({ git: true });
  const two = await makeTmpBox({ git: true });
  await one.write("input.txt", "valuable draft");
  one.commitAll("initial");
  await two.write("input.txt", "another draft");
  two.commitAll("initial");
  await one.write("input.txt", "dirty valuable draft");
  const cli = [process.execPath, "--import", "tsx", join(import.meta.dirname, "../../../src/cli/entry/run.ts")];
  const invoke = (script: string, verifyHub?: string) => runMaintenance([two.root, one.root], {
    command: process.execPath,
    cli,
    ...(verifyHub ? { verifyHub } : {}),
    args: ["--import", "tsx", "--input-type=module", "-e", script],
  });
  // A host with no box (a freshly provisioned server) runs the command and nothing else.
  t.check(await runMaintenance([], { command: process.execPath, cli, args: ["-e", "process.exitCode = 3"] }), 3);
  t.check(await invoke(readyScript), 0);

  t.check(await boxMaintenanceStatus(one.root), null);

  t.check(await boxMaintenanceStatus(two.root), null);

  t.check(await invoke(readyScript + "\nprocess.exitCode = 1;"), 1);

  t.check((await boxMaintenanceStatus(one.root))?.phase, "exclusive");

  t.check((await boxMaintenanceStatus(two.root))?.phase, "exclusive");

  t.check(await invoke(readyScript), 0);

  t.check(await boxMaintenanceStatus(one.root), null);

  process.env.BBX_DIAG_API_KEY = "fixture-diag";
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ boxes: { one: { path: one.root }, two: { path: two.root } } }));
  const verified: Array<string | null> = [];
  const canary = createServer((request, response) => {
    const slug = new URL(request.url ?? "", "http://localhost").searchParams.get("box");
    verified.push(slug);
    const ok = slug === "one" && request.headers.authorization === "Bearer fixture-diag";
    response.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ status: ok ? "ok" : "canary-failed", slug }));
  });
  canary.listen(0, "127.0.0.1");
  await once(canary, "listening");
  const address = canary.address();
  assert.ok(address && typeof address !== "string");
  t.check(
    await invoke(readyScript + "\nprocess.exitCode = 1;", `http://127.0.0.1:${address.port}`)
    ,
    1,
  );

  t.check(await boxMaintenanceStatus(one.root), null);

  t.check((await boxMaintenanceStatus(two.root))?.phase, "exclusive");

  t.check(verified.toSorted(), [
    "one",
    "two",
  ]);
});

// # The controller runs no git command in a box
//
// On the server the controller is root and git refuses a repository another
// user owns, so the production deploy of 2026-10-25 failed every box's
// verification. The controller reads the directory the holder's permit names.
// Here the controller's own git is broken by a bogus GIT_DIR; the holder gets
// an allowlisted environment without it, and the command script unsets it.
void test("line 124", async (t) => {
  const previousGitDir = process.env.GIT_DIR;
  const box = await makeTmpBox({ git: true });
  t.teardown(async () => {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    await box.cleanup();
  });
  await box.write("input.txt", "draft");
  box.commitAll("initial");
  const cli = [process.execPath, "--import", "tsx", join(import.meta.dirname, "../../../src/cli/entry/run.ts")];
  process.env.GIT_DIR = join(box.root, "no-such-git-dir");
  t.check(
    await runMaintenance([box.root], { command: process.execPath, cli, args: ["--import", "tsx", "--input-type=module", "-e", `delete process.env.GIT_DIR;\n${readyScript}`] }),
    0,
  );
  delete process.env.GIT_DIR;
  t.check(await boxMaintenanceStatus(box.root), null);
});
