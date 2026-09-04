/**
 * Unit coverage for `host-audit.ts`'s classification against a fake HOME
 * built in a temp dir, and for the pure decision helpers `run.ts` exports
 * (`prodAuditGate`, `describeFirstRun`) — split out of
 * `cross-box-leak-scan.test.ts` (the static-sweep half) to stay under the
 * repo's per-file line budget.
 *
 *   node --import tsx --test schedules/cross-box-leak-scan/*.test.ts
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { checkModes, checkSharedLogs, checkPerCwdKeying, checkNestedBoxes, checkUnknownSharedFiles, loadBoxRoots, type BoxRoot } from "./host-audit.js";
import { prodAuditGate, describeFirstRun } from "./run.js";

// ─── host-audit ─────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

async function makeBox(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".beebox"), { recursive: true });
  await fs.writeFile(path.join(root, ".beebox", "box.json"), "{}", "utf8");
}

test("checkModes: flags a group/other-readable secret file, not a private one", async () => {
  const home = await tempDir("home");
  await fs.mkdir(path.join(home, ".config", "beebox"), { recursive: true });
  const secretsFile = path.join(home, ".config", "beebox", "secrets.json");
  await fs.writeFile(secretsFile, "{}", "utf8");
  await fs.chmod(secretsFile, 0o644);
  const privateFile = path.join(home, ".bbx-auth.json");
  await fs.writeFile(privateFile, "{}", "utf8");
  await fs.chmod(privateFile, 0o600);

  const findings = await checkModes(home);
  const paths = findings.map((f) => f.path);
  assert.ok(paths.includes(secretsFile), "expected the 0644 secrets.json to be flagged");
  assert.ok(!paths.includes(privateFile), "did not expect the 0600 auth file to be flagged");
});

test("checkModes: does not check hub.json / boxes.json — box paths are not confidential", async () => {
  const home = await tempDir("home");
  await fs.mkdir(path.join(home, ".config", "beebox"), { recursive: true });
  const hubJson = path.join(home, ".config", "beebox", "hub.json");
  await fs.writeFile(hubJson, "{}", "utf8");
  await fs.chmod(hubJson, 0o644);

  const findings = await checkModes(home);
  assert.ok(!findings.some((f) => f.path === hubJson));
});

test("checkModes: flags a group/other-accessible secrets-log/ dir, not a private one", async () => {
  const home = await tempDir("home");
  const secretsLogDir = path.join(home, ".config", "beebox", "secrets-log");
  await fs.mkdir(secretsLogDir, { recursive: true, mode: 0o750 });

  const findings = await checkModes(home);
  assert.ok(findings.some((f) => f.path === secretsLogDir));
});

test("checkSharedLogs: flags a non-empty scheduler-stderr.log, not an empty one", async () => {
  const home = await tempDir("home");
  const stateDir = path.join(home, ".local", "share", "beebox");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "scheduler-stderr.log"), "some box's stack trace\n", "utf8");

  const findings = await checkSharedLogs(home);
  assert.equal(findings.length, 1);

  const emptyHome = await tempDir("home");
  const emptyStateDir = path.join(emptyHome, ".local", "share", "beebox");
  await fs.mkdir(emptyStateDir, { recursive: true });
  await fs.writeFile(path.join(emptyStateDir, "scheduler-stderr.log"), "", "utf8");
  assert.deepEqual(await checkSharedLogs(emptyHome), []);
});

test("checkSharedLogs: a rotated scheduler-stderr sibling gets its own finding too", async () => {
  const home = await tempDir("home");
  const stateDir = path.join(home, ".local", "share", "beebox");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "scheduler-stderr.log"), "live\n", "utf8");
  await fs.writeFile(path.join(stateDir, "scheduler-stderr.legacy-cb-20260902.log"), "rotated\n", "utf8");

  const findings = await checkSharedLogs(home);
  assert.equal(findings.length, 2);
});

test("checkNestedBoxes: flags a box root nested inside another, not two siblings", () => {
  const boxes: BoxRoot[] = [
    { slug: "outer", root: "/boxes/outer" },
    { slug: "inner", root: "/boxes/outer/nested" },
    { slug: "sibling", root: "/boxes/sibling" },
    { slug: "prefix-collision", root: "/boxes/outer-evil" },
  ];
  const findings = checkNestedBoxes(boxes);
  const flaggedPaths = findings.map((f) => f.path);
  assert.deepEqual(flaggedPaths, ["/boxes/outer/nested"]);
});

test("checkPerCwdKeying: flags an encoded project dir claimed by two box roots (a nested box)", async () => {
  const home = await tempDir("home");
  const boxParent = path.join(home, "boxes", "parent");
  const boxChild = path.join(boxParent, "child"); // nested — the case that produces a collision
  await makeBox(boxParent);
  await makeBox(boxChild);
  const boxes: BoxRoot[] = [
    { slug: "parent", root: boxParent },
    { slug: "child", root: boxChild },
  ];
  // A landmark-bound session whose cwd is boxChild encodes to encode(boxChild),
  // which is ALSO a prefix match for boxParent (encode(boxChild) ===
  // encode(boxParent) + "-child") — so this one dir "belongs" to both.
  const projectsDir = path.join(home, ".claude", "projects");
  const encodedBoxChild = boxChild.replace(/[^\dA-Za-z]/gu, "-");
  await fs.mkdir(path.join(projectsDir, encodedBoxChild), { recursive: true });

  const findings = await checkPerCwdKeying(home, boxes);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /parent, child|child, parent/);
});

test("checkUnknownSharedFiles: flags a file not on the documented allowlist", async () => {
  const home = await tempDir("home");
  const configDir = path.join(home, ".config", "beebox");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "hub.json"), "{}", "utf8");
  await fs.writeFile(path.join(configDir, "mystery.json"), "{}", "utf8");

  const findings = await checkUnknownSharedFiles(home);
  const names = findings.map((f) => path.basename(f.path));
  assert.deepEqual(names, ["mystery.json"]);
});

test("checkUnknownSharedFiles: secrets-log (a config-dir directory) and origin-id (a state-dir file) are both allowlisted", async () => {
  const home = await tempDir("home");
  const configDir = path.join(home, ".config", "beebox");
  const stateDir = path.join(home, ".local", "share", "beebox");
  await fs.mkdir(path.join(configDir, "secrets-log"), { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "origin-id"), "abc123\n", "utf8");
  await fs.writeFile(path.join(stateDir, "engine-availability.json"), "{}", "utf8");

  assert.deepEqual(await checkUnknownSharedFiles(home), []);
});

test("checkUnknownSharedFiles: a rotated scheduler-stderr sibling is allowed, not reported as undocumented", async () => {
  const home = await tempDir("home");
  const stateDir = path.join(home, ".local", "share", "beebox");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "scheduler-stderr.legacy-cb-20260902.log"), "rotated\n", "utf8");

  assert.deepEqual(await checkUnknownSharedFiles(home), []);
});

test("checkUnknownSharedFiles: backups/ and legacy scheduler.jsonl/scheduler.log are NOT allowlisted — no current writer was found", async () => {
  const home = await tempDir("home");
  const configDir = path.join(home, ".config", "beebox");
  const stateDir = path.join(home, ".local", "share", "beebox");
  await fs.mkdir(path.join(configDir, "backups"), { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "scheduler.jsonl"), "{}\n", "utf8");
  await fs.writeFile(path.join(stateDir, "scheduler.log"), "log\n", "utf8");

  const names = (await checkUnknownSharedFiles(home)).map((f) => path.basename(f.path)).toSorted();
  assert.deepEqual(names, ["backups", "scheduler.jsonl", "scheduler.log"]);
});

test("loadBoxRoots: unions hub.json (resolving a v2 package root to its content dir) and boxes.json", async () => {
  const home = await tempDir("home");
  const configDir = path.join(home, ".config", "beebox");
  await fs.mkdir(configDir, { recursive: true });

  const hubBoxPackageRoot = path.join(home, "hub-box");
  await fs.mkdir(hubBoxPackageRoot, { recursive: true }); // v2 package root, no .beebox at top
  await makeBox(path.join(hubBoxPackageRoot, "content"));

  const manifestBoxRoot = path.join(home, "manifest-box");
  await makeBox(manifestBoxRoot); // v1: .beebox/box.json directly under it

  await fs.writeFile(
    path.join(configDir, "hub.json"),
    JSON.stringify({ boxes: { "hub-slug": { path: hubBoxPackageRoot } } }),
    "utf8",
  );
  await fs.writeFile(path.join(configDir, "boxes.json"), JSON.stringify({ boxes: [manifestBoxRoot] }), "utf8");

  const { boxes, findings } = await loadBoxRoots(home);
  const roots = boxes.map((b) => b.root).toSorted();
  assert.deepEqual(roots, [manifestBoxRoot, path.join(hubBoxPackageRoot, "content")].toSorted());
  assert.deepEqual(findings, []);
});

test("loadBoxRoots: a present-but-malformed hub.json is a finding, not silent empty boxes", async () => {
  const home = await tempDir("home");
  const configDir = path.join(home, ".config", "beebox");
  await fs.mkdir(configDir, { recursive: true });
  const hubJsonPath = path.join(configDir, "hub.json");
  await fs.writeFile(hubJsonPath, "{ not valid json", "utf8");
  // A valid boxes.json still resolves, so a nested/keying check on ITS boxes
  // is not silently vacated just because the sibling manifest is broken.
  const manifestBoxRoot = path.join(home, "manifest-box");
  await makeBox(manifestBoxRoot);
  await fs.writeFile(path.join(configDir, "boxes.json"), JSON.stringify({ boxes: [manifestBoxRoot] }), "utf8");

  const { boxes, findings } = await loadBoxRoots(home);
  assert.deepEqual(boxes.map((b) => b.root), [manifestBoxRoot]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, hubJsonPath);
  assert.match(findings[0]?.message ?? "", /unreadable or malformed box manifest/);
});

test("loadBoxRoots: boxes.json with the wrong shape (boxes not an array) is also a finding", async () => {
  const home = await tempDir("home");
  const configDir = path.join(home, ".config", "beebox");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "boxes.json"), JSON.stringify({ boxes: "not-an-array" }), "utf8");

  const { boxes, findings } = await loadBoxRoots(home);
  assert.deepEqual(boxes, []);
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /unreadable or malformed box manifest.*not an array/);
});

test("loadBoxRoots: both manifests absent is its own finding (a wrong --home is visible, not silently zero boxes)", async () => {
  const home = await tempDir("home");

  const { boxes, findings } = await loadBoxRoots(home);
  assert.deepEqual(boxes, []);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.path, path.join(home, ".config", "beebox"));
  assert.match(findings[0]?.message ?? "", /no box manifest found/);
});

test("loadBoxRoots: a MISSING hub.json (only boxes.json present) is not a finding — absent is fine, only broken isn't", async () => {
  const home = await tempDir("home");
  const configDir = path.join(home, ".config", "beebox");
  await fs.mkdir(configDir, { recursive: true });
  const manifestBoxRoot = path.join(home, "manifest-box");
  await makeBox(manifestBoxRoot);
  await fs.writeFile(path.join(configDir, "boxes.json"), JSON.stringify({ boxes: [manifestBoxRoot] }), "utf8");

  const { findings } = await loadBoxRoots(home);
  assert.deepEqual(findings, []);
});

// ─── run.ts pure helpers ────────────────────────────────────────────────

test("prodAuditGate: runs with a deploy target, refuses on a real run without one, skips only under --dry-run", () => {
  assert.equal(prodAuditGate({ deployTargetConfigured: true, dryRun: false }), "run");
  assert.equal(prodAuditGate({ deployTargetConfigured: true, dryRun: true }), "run");
  assert.equal(prodAuditGate({ deployTargetConfigured: false, dryRun: false }), "refuse");
  assert.equal(prodAuditGate({ deployTargetConfigured: false, dryRun: true }), "skip");
});

test("describeFirstRun: an empty first report is a quiet fyi, not a handoff", () => {
  const outcome = describeFirstRun([]);
  assert.equal(outcome.kind, "clean");
});

test("describeFirstRun: a non-empty first report is a full handoff (not baselined without adjudication)", () => {
  const current = ["static  beebox/src/webapp/routes/api.ts:1  const x = request.query.file;"];
  const outcome = describeFirstRun(current);
  assert.equal(outcome.kind, "handoff");
  if (outcome.kind !== "handoff") return;
  assert.match(outcome.handoffTitle, /initial 1 finding/);
  assert.match(outcome.handoffBody, /not a diff/);
  assert.match(outcome.handoffBody, /request\.query\.file/);
});
