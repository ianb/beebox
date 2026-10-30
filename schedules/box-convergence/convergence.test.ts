import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";
import { execChild } from "../../bin/lib/schedules-exec.js";
import { checkFailure, connectorWarnings, prodBoxCommand, reportPlan, resultDetail, RESULT_PREFIX, framedCommand, shellQuote, sshUnreachable, unreachableDetail } from "./results.js";
import { configuredBoxes, localTargets, registryPaths } from "./targets.js";

const report = (value: unknown): string => RESULT_PREFIX + JSON.stringify(value);

test("findings are one standing condition whatever boxes they name", () => {
  const first = reportPlan({ checkFailures: [], findings: ["local /a: needs-procedure"], unreachableDetail: null, convergenceCoverage: true, connectorFindings: [], connectorCoverage: true });
  const second = reportPlan({ checkFailures: [], findings: ["local /a: needs-procedure", "prod /b: needs-procedure"], unreachableDetail: null, convergenceCoverage: true, connectorFindings: [], connectorCoverage: true });
  assert.deepEqual(first.alerts.map((alert) => alert.condition), ["unconverged"]);
  assert.deepEqual(second.alerts.map((alert) => alert.condition), ["unconverged"]);
  assert.equal(second.alerts[0]?.message, "- local /a: needs-procedure\n- prod /b: needs-procedure");
  assert.deepEqual(first.keep, ["unconverged"]);
});
test("a clean run resolves everything, but not when production went unchecked", () => {
  assert.deepEqual(reportPlan({ checkFailures: [], findings: [], unreachableDetail: null, convergenceCoverage: true, connectorFindings: [], connectorCoverage: true }), { alerts: [], keep: [] });
  const offline = reportPlan({ checkFailures: [], findings: [], unreachableDetail: null, convergenceCoverage: false, connectorFindings: [], connectorCoverage: false });
  assert.deepEqual(offline, { alerts: [], keep: ["unconverged", "check-failed", "prod-connector-activity"] });
  const longOffline = reportPlan({ checkFailures: [], findings: [], unreachableDetail: "Production unreachable for 25h: line", convergenceCoverage: false, connectorFindings: [], connectorCoverage: false });
  assert.deepEqual(longOffline.alerts.map((alert) => alert.condition), ["prod-unreachable"]);
  assert.deepEqual(longOffline.keep, ["prod-unreachable", "unconverged", "check-failed", "prod-connector-activity"]);
});
test("production connector warnings are one standing condition, resolved only by complete coverage", () => {
  const warned = reportPlan({ checkFailures: [], findings: [], unreachableDetail: null, convergenceCoverage: true,
    connectorFindings: ["/boxes/a: gmail has failed every sync on its last 2 days of running, since 2026-10-09: 404"], connectorCoverage: true });
  assert.deepEqual(warned, {
    alerts: [{
      condition: "prod-connector-activity",
      title: "Production connectors: 1 warning",
      message: "- /boxes/a: gmail has failed every sync on its last 2 days of running, since 2026-10-09: 404",
    }],
    keep: ["prod-connector-activity"],
  });
  assert.deepEqual(reportPlan({ checkFailures: [], findings: [], unreachableDetail: null, convergenceCoverage: true, connectorFindings: [], connectorCoverage: true }),
    { alerts: [], keep: [] });
  // Health unread for a box: a check-failed alert from an earlier run must not resolve.
  assert.deepEqual(reportPlan({ checkFailures: [], findings: [], unreachableDetail: null, convergenceCoverage: true,
    connectorFindings: [], connectorCoverage: false }).keep, ["check-failed", "prod-connector-activity"]);
  // One unreadable box leaves convergence covered, but the connector condition stays open:
  assert.deepEqual(reportPlan({ checkFailures: ["prod /b: health unreadable"], findings: [], unreachableDetail: null, convergenceCoverage: true,
    connectorFindings: [], connectorCoverage: false }).keep, ["check-failed", "prod-connector-activity"]);
});
test("connector warnings are read from health JSON whatever the exit code", () => {
  const health = JSON.stringify({
    tasks: [{ name: "overdue" }],
    boxChecks: [
      { name: "git", ok: true, message: "ok", severity: "info" },
      { name: "connector-activity:gmail", ok: false, message: "gmail has failed every sync", severity: "warning" },
      { name: "connector-activity", ok: false, message: "record invalid", severity: "warning" },
      { name: "connector-activityx", ok: false, message: "not ours", severity: "warning" },
    ],
  }, null, 2);
  assert.deepEqual(connectorWarnings(`noise\n${RESULT_PREFIX}debug line\n${health}\n`), ["gmail has failed every sync", "record invalid"]);
  assert.equal(connectorWarnings("ssh: something failed"), null);
  assert.equal(connectorWarnings(`${RESULT_PREFIX}\n`), null);
  assert.equal(connectorWarnings(`${RESULT_PREFIX}{\n  "boxChecks": "no"\n}`), null);
});
test("JSON outcomes preserve questions and refuse unknown or failed coverage", () => {
  assert.equal(resultDetail(report({ status: "current" }), 0), null);
  assert.equal(resultDetail(report({ status: "applied", applied: [] }), 0), null);
  assert.match(resultDetail(report({ status: "applied", applied: [{ name: "partial", partial: true }] }), 0) ?? "", /Partial conversion/u);
  assert.match(resultDetail(report({ status: "attention", questions: ["decision.question.card"] }), 1) ?? "", /decision.question.card/u);
  assert.match(resultDetail(report({ status: "current" }), 1) ?? "", /exit 1/u);
  assert.match(resultDetail("", 0) ?? "", /Unknown/u);
  assert.match(resultDetail(report({ status: "future" }), 0) ?? "", /Invalid/u);
  assert.match(resultDetail(report({ status: "status", manifest: true, pending: [], questions: ["unresolved"] }), 0) ?? "", /unresolved/u);
  assert.equal(resultDetail(report({ status: "status", manifest: true, pending: [], questions: [] }), 0), null);
  assert.match(resultDetail(report({ status: "status" }), 0) ?? "", /Incomplete/u);
  assert.match(resultDetail(report({ status: "no-manifest" }), 0) ?? "", /no-manifest/u);
});

// Replays the 2026-10-25 regression: the check ran as the shared user after boxes
// moved to per-box users, and every box reported "unconverged" with a node stack.
test("a check that produced no result is a check failure; a box that answered is not", async () => {
  const noEngine = await execa("bash", ["-c", framedCommand("node /no/such/cli.mjs")], { reject: false, all: true });
  assert.match(checkFailure(noEngine.all, noEngine.exitCode ?? null) ?? "", /^Unknown result \(exit 1\): .*Cannot find module/su);
  // sudo and cd fail before the frame is printed.
  assert.equal(checkFailure("sudo: unknown user bbx-gone", 1), "Unknown result (exit 1): sudo: unknown user bbx-gone");
  assert.equal(checkFailure(report({ status: "failed", failed: "some-migration" }), 1), null);
});

test("a check that could not run alerts on its own and holds unconverged open", () => {
  assert.deepEqual(reportPlan({ checkFailures: ["prod /a: Unknown result (exit 1): boom"], findings: [], unreachableDetail: null,
    convergenceCoverage: false, connectorFindings: [], connectorCoverage: true }), {
    alerts: [{
      condition: "check-failed",
      title: "Box convergence: 1 check could not run",
      message: "- prod /a: Unknown result (exit 1): boom",
    }],
    keep: ["check-failed", "unconverged"],
  });
});

// Runs the command through a stub sudo, so the argv is what the server would receive.
test("production commands run as the box's own user with the units' env", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "convergence-sudo-"));
  try {
    await fs.writeFile(path.join(dir, "sudo"), '#!/bin/bash\nprintf \'%s\\n\' "$@"\n', { mode: 0o755 });
    const command = prodBoxCommand("/var/lib/beebox/my-box/box", { cliArgs: ["health", "--json"], timeoutSeconds: 100 });
    const { stdout } = await execa("bash", ["-c", command], { env: { PATH: `${dir}:${process.env.PATH ?? ""}` } });
    const [sudoFlags, remote] = [stdout.split("\n").slice(0, 6), stdout.split("\n").slice(6).join("\n")];
    assert.deepEqual(sudoFlags, ["-n", "-u", "bbx-my-box", "-H", "bash", "-lc"]);
    const framed = shellQuote(framedCommand("'node' 'node_modules/beebox/dist/cli.mjs' 'health' '--json'"));
    assert.equal(remote, `set -a; source /etc/beebox/box.env || exit; set +a; unset BBX_BOX_WORK NODE_COMPILE_CACHE; export NODE_DISABLE_COMPILE_CACHE=1; umask 0007; cd '/var/lib/beebox/my-box/box' || exit; timeout --kill-after=5s 100s bash -c ${framed}`);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("a production root outside the per-box layout has no user to run as", () => {
  assert.throws(() => prodBoxCommand("/home/beebox/boxes/old", { cliArgs: ["health"], timeoutSeconds: 100 }), /Not a production box root/u);
  assert.throws(() => prodBoxCommand("/var/lib/beebox/a/../b/box", { cliArgs: ["health"], timeoutSeconds: 100 }), /Not a production box root/u);
});

test("a deferred pass is quiet until the box has held work for a day", () => {
  const ago = (hours: number) => [{ pid: 4242, reason: "chat run abc", since: new Date(Date.now() - hours * 3_600_000).toISOString() }];
  assert.equal(resultDetail(report({ status: "deferred", holders: ago(0.2) }), 0), null);
  assert.equal(resultDetail(report({ status: "deferred", holders: ago(23) }), 0), null);
  assert.match(resultDetail(report({ status: "deferred", holders: ago(25) }), 0) ?? "", /held work for 25h: chat run abc \(pid 4242/u);
  assert.match(resultDetail(report({ status: "deferred" }), 0) ?? "", /Incomplete deferred/u);
  assert.match(resultDetail(report({ status: "deferred", holders: [] }), 1) ?? "", /exit 1/u);
});

test("an offline laptop is quiet for a day; a server that answers is not offline", () => {
  const offline = "debug\nssh: connect to host 192.0.2.1 port 22: Network is unreachable\n";
  assert.equal(sshUnreachable(255, offline), "ssh: connect to host 192.0.2.1 port 22: Network is unreachable");
  assert.equal(sshUnreachable(255, "ssh: Could not resolve hostname box.example.com: nodename nor servname provided, or not known"),
    "ssh: Could not resolve hostname box.example.com: nodename nor servname provided, or not known");
  assert.equal(sshUnreachable(255, "ssh: connect to host 192.0.2.1 port 22: Connection refused"), null);
  assert.equal(sshUnreachable(1, offline), null);
  const now = Date.now();
  assert.equal(unreachableDetail(now - 23 * 3_600_000, { now, line: "line" }), null);
  assert.match(unreachableDetail(now - 25 * 3_600_000, { now, line: "line" }) ?? "", /unreachable for 25h: line/u);
});

test("framing preserves exit failures and treats shell metacharacters as data", async () => {
  const value = "apostrophe' and $(printf BAD) and `printf BAD`";
  const result = await execa("bash", ["-c", framedCommand(`printf '%s' ${shellQuote(value)}; exit 2`)], { reject: false });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, RESULT_PREFIX + value);
});

test("configured targets use BOXES and production registry relative paths", () => {
  assert.deepEqual(configuredBoxes("OTHER=x\nBOXES=~/boxes/one /boxes/two\n", "/srv/user"), ["/srv/user/boxes/one", "/boxes/two"]);
  assert.deepEqual(configuredBoxes("OTHER=x", "/srv/user"), []);
  assert.deepEqual(registryPaths('{"boxes":{"box":{"path":"../../boxes/box"}}}', "/srv/user/config/hub.json"), ["/srv/boxes/box"]);
  assert.throws(() => registryPaths('{"boxes":{"box":{}}}', "/hub.json"));
});

test("canonical selection excludes clones, aliases, and worktree claimed roots", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "convergence-targets-")));
  try {
    const mainRoot = path.join(root, "main"), worktree = path.join(root, "worktree");
    const clonesRoot = path.join(root, "clones"), configDir = path.join(root, "configs");
    const eligible = path.join(root, "real"), claimed = path.join(root, "claimed"), envClaim = path.join(root, "env-claim");
    for (const dir of [mainRoot + "/beebox", worktree + "/beebox", clonesRoot + "/test1", configDir, eligible, claimed, envClaim]) {
      await fs.mkdir(dir, { recursive: true });
    }
    const alias = path.join(root, "alias");
    await fs.symlink(clonesRoot + "/test1", alias);
    await fs.writeFile(mainRoot + "/beebox/.env", `BOXES=${eligible} ${alias} ${claimed} ${envClaim} ${eligible}\n`);
    await fs.writeFile(worktree + "/beebox/.env", `BOXES=${envClaim}\n`);
    await fs.writeFile(configDir + "/worktree.json", JSON.stringify({ boxes: { box: { path: claimed } } }));
    const result = await localTargets({ mainRoot, worktrees: [mainRoot, worktree], clonesRoot, configDir, home: root });
    assert.deepEqual(result.eligible, [eligible]);
    assert.deepEqual(result.excluded, [clonesRoot + "/test1", claimed, envClaim]);
    await fs.writeFile(configDir + "/worktree.json", "broken");
    await assert.rejects(localTargets({ mainRoot, worktrees: [worktree], clonesRoot, configDir, home: root }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

 test("per-box timeout terminates the child process group", async () => {
  const result = await execChild({ file: process.execPath, args: ["-e",
    "const {spawn}=require('node:child_process'); const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); console.log(p.pid); setInterval(()=>{},1000);"] },
    { cwd: os.tmpdir(), env: process.env, timeoutMs: 300, input: null, logFile: null });
  assert.equal(result.timedOut, true);
  const childPid = Number(result.output.trim());
  assert.ok(childPid > 0);
  assert.throws(() => process.kill(childPid, 0));
});

test("terminating the schedule also kills an uncooperative detached descendant", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "convergence-signal-"));
  const pidFile = path.join(dir, "pid");
  const grandchild = "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)";
  const child = `const {spawn}=require('node:child_process');const fs=require('node:fs');
const p=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});
setTimeout(()=>fs.writeFileSync(${JSON.stringify(pidFile)},String(p.pid)),100);setInterval(()=>{},1000);`;
  const helper = new URL("../../bin/lib/schedules-exec.ts", import.meta.url).href;
  const script = `import {execChild} from ${JSON.stringify(helper)};
await execChild({file:process.execPath,args:['-e',${JSON.stringify(child)}]},
{cwd:${JSON.stringify(dir)},env:process.env,timeoutMs:60000,input:null,logFile:null});`;
  const running = execa(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], { reject: false });
  try {
    let pid: number | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { pid = Number(await fs.readFile(pidFile, "utf8")); break; }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(pid, "descendant started");
    running.kill("SIGTERM");
    const result = await running;
    assert.equal(result.exitCode, 143);
    assert.throws(() => process.kill(pid, 0));
  } finally {
    running.kill("SIGTERM");
    await running;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
