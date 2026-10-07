// Unit tests for the pure half of bin/deploy-status: parsers over fixture git,
// marker-file, and SSH-transcript text; lock rendering; the JSON shape; and
// degraded sections. No network, no subprocess, no filesystem. A traditional
// test rather than a doctest because the subject is the root `bin/` TS module
// itself and the caller asked for this form. Run with:
//   node --import tsx --test bin/deploy-status.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  available,
  degraded,
  parseDeployInfo,
  parseDf,
  parseDivergence,
  parseHealth,
  parseLastDeployRecord,
  parseMigrations,
  section,
  splitSections,
  type DeployStatusReport,
} from "./deploy-status-lib.js";
import { describeDivergence, renderLock, renderText } from "./deploy-status-render.js";

const NOW = new Date("2026-10-07T22:40:00Z");

test("ahead/behind comes from git rev-list --left-right --count output", () => {
  assert.deepEqual(parseDivergence("0\t5\n"), { prodOnly: 0, localOnly: 5 });
  assert.equal(parseDivergence("fatal: bad revision"), null);
  assert.equal(describeDivergence("main", available({ prodOnly: 0, localOnly: 5 })), "main 5 ahead of prod");
  assert.equal(describeDivergence("main", available({ prodOnly: 0, localOnly: 0 })), "main = prod");
  assert.equal(describeDivergence("HEAD (x)", available({ prodOnly: 9, localOnly: 14 })), "HEAD (x) 14 ahead, 9 behind prod");
  assert.equal(describeDivergence("main", available({ prodOnly: 3, localOnly: 0 })), "main 3 behind prod");
});

test("the last deploy record is the last parseable deploys.jsonl line", () => {
  const jsonl = [
    '{"startedAt":"2026-10-07T21:02:49Z","endedAt":"2026-10-07T21:06:49Z","sha":"aaa","outcome":"ok","exit":0,"downSeconds":183}',
    '{"startedAt":"2026-10-07T21:45:34Z","endedAt":"2026-10-07T21:49:49Z","sha":"bbb","outcome":"failed","exit":1,"downSeconds":null}',
    '{"startedAt":"torn',
    "",
  ].join("\n");
  assert.deepEqual(parseLastDeployRecord(jsonl), {
    startedAt: "2026-10-07T21:45:34Z", endedAt: "2026-10-07T21:49:49Z", sha: "bbb", outcome: "failed", exit: 1, downSeconds: null,
  });
  assert.equal(parseLastDeployRecord(""), null);
});

test("lock states render distinctly", () => {
  assert.match(renderLock({ state: "free", requestedSha: null }).join("\n"), /free — no deploy in progress/);
  assert.match(renderLock({ state: "stale", pid: 42 }).join("\n"), /stale .*pid 42/);
  const held = renderLock({ state: "held", pid: 7, alive: true, since: "2026-10-07T22:30:00Z", logTail: "[22:31:00Z] Converging boxes" });
  assert.match(held[0] ?? "", /HELD — deploy in progress \(pid 7 since 2026-10-07T22:30:00Z\)/);
  assert.match(held[1] ?? "", /log: \[22:31:00Z] Converging boxes/);
});

const TRANSCRIPT = [
  "@@section deploy-info",
  '{"deployedAt":"2026-10-07T21:46:20Z","requestedRef":"abc","commits":{"beebox":{"hash":"2ac8b9dc2","subject":"chat: a subject"}}}',
  "@@section disk",
  "Filesystem     1024-blocks     Used Available Capacity Mounted on",
  "/dev/sda1         78425224 41548764  33631720      56% /",
  "@@section services",
  "active",
  "inactive",
  "@@section healthz",
  "@@error BBX_DIAG_API_KEY is not set in /home/beebox/.env",
  "@@section migrations",
  "@@box alpha",
  '{"status":"status","manifest":true,"pending":[],"questions":[]}',
  "@@rc 0",
  "@@box beta",
  "warning: something on stderr",
  '{"status":"status","manifest":true,"pending":["rename-x"],"questions":["_bookkeeping/questions/Migration_x.question.card"]}',
  "@@rc 0",
  "@@box gamma",
  "bbx: command not found",
  "@@rc 127",
  "@@section end",
].join("\n");

test("the SSH transcript splits into independently degradable sections", () => {
  const sections = splitSections(TRANSCRIPT);
  const info = section(sections, "deploy-info");
  assert.ok(info.ok);
  assert.deepEqual(parseDeployInfo(info.data), { hash: "2ac8b9dc2", subject: "chat: a subject", deployedAt: "2026-10-07T21:46:20Z" });
  assert.deepEqual(section(sections, "healthz"), degraded("BBX_DIAG_API_KEY is not set in /home/beebox/.env"));
  assert.match(section(sections, "nonexistent").ok ? "" : "cut short", /cut short/);

  const disk = section(sections, "disk");
  assert.ok(disk.ok);
  assert.equal(parseDf(disk.data)?.status, "ok");
  assert.equal(parseDf("garbage"), null);

  const migrations = section(sections, "migrations");
  assert.ok(migrations.ok);
  const boxes = parseMigrations(migrations.data);
  assert.deepEqual(boxes.map((box) => box.box), ["alpha", "beta", "gamma"]);
  assert.deepEqual(boxes[1]?.status, available({ manifest: true, pending: ["rename-x"], questions: ["_bookkeeping/questions/Migration_x.question.card"] }));
  assert.deepEqual(boxes[2]?.status, degraded("bbx engine migrate --status --json: exit 127 (bbx: command not found)"));
});

test("healthz parsing reads the verdict, boxes, and unit states", () => {
  const body = '{"status":"unhealthy","boxes":[{"slug":"a","status":"running","restarts":0,"consecutiveFailures":0},{"slug":"b","status":"unhealthy","consecutiveFailures":5}]}';
  const health = parseHealth({ healthz: `${body}\n503\n`, services: "active\nactive\n" });
  assert.ok(health.ok);
  assert.equal(health.data.verdict, "unhealthy");
  assert.equal(health.data.code, 503);
  assert.deepEqual(health.data.services, { "beebox-hub": "active", "beebox-scheduler": "active" });
  const down = parseHealth({ healthz: "000\n", services: "failed\nactive\n" });
  assert.deepEqual(down, degraded("hub /healthz did not answer (services: beebox-hub failed, beebox-scheduler active)"));
});

test("a report with every remote section degraded still renders and serializes", () => {
  const reason = "ssh to the deploy target failed: Connection timed out";
  const report: DeployStatusReport = {
    commits: available({
      source: "local-marker",
      deployedSha: "2ac8b9dc2c7c155174e91da91a5d3105f9793d19",
      subject: null,
      deployedAt: null,
      main: available({ prodOnly: 0, localOnly: 2 }),
      head: { ref: "worktree-x", divergence: degraded("cannot compare") },
    }),
    lastDeploy: degraded("no deploy record at /x; this machine has not run deploy.sh"),
    lock: available({ state: "free", requestedSha: null }),
    health: degraded(reason),
    disk: degraded(reason),
    migrations: degraded(reason),
  };
  const text = renderText(report, NOW);
  assert.match(text, /^Deployed {3}2ac8b9dc2 \[server unreachable; local success marker]$/m);
  assert.match(text, /main 2 ahead of prod · HEAD \(worktree-x\): cannot compare/);
  assert.match(text, /^Health {5}unavailable: ssh to the deploy target failed/m);
  assert.match(text, /^Migrations unavailable: ssh/m);
  assert.equal(text.split("\n").length, 7);

  const json: unknown = JSON.parse(JSON.stringify(report));
  assert.deepEqual(Object.keys(json ?? {}), ["commits", "lastDeploy", "lock", "health", "disk", "migrations"]);
  assert.deepEqual(report.disk, { ok: false, reason });
});

test("a healthy report flags only boxes that need attention", () => {
  const report: DeployStatusReport = {
    commits: degraded("no deploy target"),
    lastDeploy: available({ startedAt: "2026-10-07T21:45:34Z", endedAt: "2026-10-07T21:49:49Z", sha: "2ac8b9dc2c7c", outcome: "ok", exit: 0, downSeconds: 175 }),
    lock: available({ state: "free", requestedSha: null }),
    health: available({ code: 200, verdict: "ok", boxes: [{ slug: "a", status: "stopped", consecutiveFailures: 0 }], services: { "beebox-hub": "active" } }),
    disk: available({ freeBytes: 1, freeGiB: 1, thresholdBytes: 2, thresholdGiB: 2, status: "low" }),
    migrations: available([
      { box: "a", status: available({ manifest: true, pending: [], questions: [] }) },
      { box: "b", status: available({ manifest: false, pending: [], questions: [] }) },
    ]),
  };
  const text = renderText(report, NOW);
  assert.match(text, /Last run {3}ok · 2ac8b9dc2 · .* \(50m ago\), down 175s/);
  assert.match(text, /Disk {7}1\.0 GiB free .* LOW — tell the boxholder/);
  assert.match(text, /Migrations 2 boxes, 1 need attention\n {11}b: no migration manifest/);
  assert.doesNotMatch(text, / a: /);
});
