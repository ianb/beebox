import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";
import { execChild } from "../../bin/lib/schedules-exec.js";
import { reportDecision, resultDetail, RESULT_PREFIX, framedCommand, shellQuote, sshUnreachable, unreachableDetail } from "./results.js";
import { configuredBoxes, localTargets, registryPaths } from "./targets.js";

const report = (value: unknown): string => RESULT_PREFIX + JSON.stringify(value);

test("repeated findings are logged even while their alert is suppressed", () => {
  const now = Date.parse("2026-09-17T00:00:00Z");
  const old = { message: "local /box: failed; exit 1", reportedAt: now - 60 * 60_000 };
  assert.deepEqual(reportDecision("", { old, now }), { alert: false, log: null });
  const repeated = reportDecision(old.message, { old, now });
  assert.equal(repeated.alert, false);
  assert.match(repeated.log ?? "", /unchanged since 2026-09-16T23:00:00.000Z; alert suppressed\nlocal \/box: failed; exit 1/u);
  assert.equal(reportDecision("something else", { old, now }).alert, true);
  assert.equal(reportDecision(old.message, { old, now: now + 24 * 60 * 60_000 }).alert, true);
  assert.equal(reportDecision(old.message, { old: null, now }).alert, true);
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
