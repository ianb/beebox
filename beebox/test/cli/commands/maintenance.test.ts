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
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
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

const cli = [process.execPath, "--import", "tsx", join(import.meta.dirname, "../../../src/cli/entry/run.ts")];

/**
 * `bbx engine maintenance` as a shell runs it: the exit code and what it wrote
 * to stderr (the controller's own notices and the holders'). The command is
 * the node script given.
 */
async function maintain(roots: string[], opts: { script: string; verifyHub?: string }): Promise<{ code: number; stderr: string }> {
  const args = [...cli.slice(1), "engine", "maintenance", ...roots.flatMap((root) => ["--box", root]), ...(opts.verifyHub ? ["--verify-hub", opts.verifyHub] : []), "--", process.execPath, "--import", "tsx", "--input-type=module", "-e", opts.script];
  const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { code: code ?? 1, stderr };
}

/** The recovery snapshot the holder reports for each box it closes (boxes close in path order). */
function snapshotLines(roots: string[]): string {
  return roots.toSorted().map((root) => `Deployment recovery snapshot: ${root} refs/bbx/migrations/deployment/snapshots/«uuid»`).join("\n");
}

/** The notice for each box that did not complete maintenance. */
function unverifiedLines(roots: string[]): string {
  return roots.toSorted().map((root) => `Box not verified; it reopens with unfinished maintenance: ${root}`).join("\n");
}

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
  const roots = [await realpath(one.root), await realpath(two.root)];
  const invoke = (script: string, verifyHub?: string) => maintain([two.root, one.root], { script, ...(verifyHub ? { verifyHub } : {}) });
  // A host with no box (a freshly provisioned server) runs the command and nothing else.
  t.check(await runMaintenance([], { command: process.execPath, cli, args: ["-e", "process.exitCode = 3"] }), 3);
  // Each holder reports the recovery snapshot it took of its box:
  const completed = await invoke(readyScript);
  t.check(completed.code, 0);
  await t.checkText(completed.stderr, snapshotLines(roots));

  t.check(await boxMaintenanceStatus(one.root), null);

  t.check(await boxMaintenanceStatus(two.root), null);

  // A command that fails leaves every box unverified; the controller and then
  // each holder say so (the holder prints after it receives the verdict):
  const failed = await invoke(readyScript + "\nprocess.exitCode = 1;");
  t.check(failed.code, 1);
  await t.checkText(failed.stderr, [snapshotLines(roots), unverifiedLines(roots), unverifiedLines(roots)].join("\n"));

  t.check((await boxMaintenanceStatus(one.root))?.phase, "exclusive");

  t.check((await boxMaintenanceStatus(two.root))?.phase, "exclusive");

  const recovered = await invoke(readyScript);
  t.check(recovered.code, 0);
  await t.checkText(recovered.stderr, snapshotLines(roots));

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
  // The hub canary accepts only box "one", so only "two" is reported unverified:
  const canaryRun = await invoke(readyScript + "\nprocess.exitCode = 1;", `http://127.0.0.1:${address.port}`);
  t.check(canaryRun.code, 1);
  await t.checkText(canaryRun.stderr, [snapshotLines(roots), unverifiedLines([roots[1]!]), unverifiedLines([roots[1]!])].join("\n"));

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
  process.env.GIT_DIR = join(box.root, "no-such-git-dir");
  const run = await maintain([box.root], { script: `delete process.env.GIT_DIR;\n${readyScript}` });
  t.check(run.code, 0);
  await t.checkText(run.stderr, snapshotLines([await realpath(box.root)]));
  delete process.env.GIT_DIR;
  t.check(await boxMaintenanceStatus(box.root), null);
});
