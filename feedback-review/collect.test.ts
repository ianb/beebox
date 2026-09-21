import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const script = fileURLToPath(new URL("./collect.ts", import.meta.url));
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(): { boxesDir: string; boxRoot: string; feedbackDir: string } {
  const boxesDir = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-collect-"));
  tempDirs.push(boxesDir);
  const boxRoot = path.join(boxesDir, "test1");
  const feedbackDir = path.join(boxRoot, "_config", "feedback");
  fs.mkdirSync(path.join(boxRoot, ".beebox"), { recursive: true });
  fs.writeFileSync(path.join(boxRoot, ".beebox", "box.json"), JSON.stringify({ version: "1.0.0", shapeVersion: 3 }));
  fs.writeFileSync(path.join(boxRoot, "package.json"), JSON.stringify({ name: "test1", private: true, dependencies: { beebox: "0.0.0" } }));
  fs.mkdirSync(feedbackDir, { recursive: true });
  return { boxesDir, boxRoot, feedbackDir };
}

function run(boxesDir: string, ...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", script, "--boxes", boxesDir, "--no-remote", ...args], {
    encoding: "utf8",
  });
}

test("lists doc cards and legacy notes, excluding directory docs and resolved items", () => {
  const { boxesDir, feedbackDir } = fixture();
  fs.writeFileSync(path.join(feedbackDir, "agent-observation.doc.card"), "---\ntitle: Agent observation\n---\nBody\n");
  fs.writeFileSync(path.join(feedbackDir, "2026-09-21T10-20-30-old.md"), "Legacy body\n");
  fs.writeFileSync(path.join(feedbackDir, "CLAUDE.md"), "Directory guidance\n");
  fs.mkdirSync(path.join(feedbackDir, "resolved"));
  fs.writeFileSync(path.join(feedbackDir, "resolved", "done.doc.card"), "Done\n");

  const result = run(boxesDir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Found 2 unresolved feedback item/);
  assert.match(result.stdout, /agent-observation\.doc\.card/);
  assert.match(result.stdout, /2026-09-21T10-20-30-old\.md/);
  assert.doesNotMatch(result.stdout, /Directory guidance|done\.doc\.card/);
});

test("unknown files fail the scan and prevent resolve-all", () => {
  const { boxesDir, feedbackDir } = fixture();
  const card = path.join(feedbackDir, "observation.doc.card");
  fs.writeFileSync(card, "Observation\n");
  fs.writeFileSync(path.join(feedbackDir, "unexpected.md"), "Unrecognized\n");

  const result = run(boxesDir, "--resolve-all");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unrecognized feedback file/);
  assert.match(result.stderr, /Feedback scan incomplete/);
  assert.ok(fs.existsSync(card));
});

test("missing feedback directory fails instead of reporting an empty inbox", () => {
  const { boxesDir, feedbackDir } = fixture();
  fs.rmdirSync(feedbackDir);

  const result = run(boxesDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No _config\/feedback\/ directories found/);
  assert.doesNotMatch(result.stdout, /No unresolved agent feedback found/);
});

test("local-only scan with no boxes fails", () => {
  const boxesDir = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-collect-empty-"));
  tempDirs.push(boxesDir);
  const result = run(boxesDir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No local boxes found/);
});

test("resolves a doc card by moving and committing only that path", () => {
  const { boxesDir, boxRoot, feedbackDir } = fixture();
  const card = path.join(feedbackDir, "observation.doc.card");
  fs.writeFileSync(card, "---\ntitle: Observation\n---\nObservation\n");
  const linkingCard = path.join(feedbackDir, "follow-up.doc.card");
  fs.writeFileSync(linkingCard, "---\ntitle: Follow-up\n---\n[Earlier](/_config/feedback/observation.doc.card)\n");
  execFileSync("git", ["init", "-q", boxRoot]);
  execFileSync("git", ["-C", boxRoot, "config", "user.name", "Test User"]);
  execFileSync("git", ["-C", boxRoot, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", boxRoot, "config", "core.hooksPath", "/dev/null"]);
  execFileSync("git", ["-C", boxRoot, "add", "."]);
  execFileSync("git", ["-C", boxRoot, "commit", "-qm", "Initial"]);
  const unrelated = path.join(boxRoot, "unrelated.txt");
  fs.writeFileSync(unrelated, "Unrelated\n");
  execFileSync("git", ["-C", boxRoot, "add", "unrelated.txt"]);

  const result = run(boxesDir, "--resolve", "observation.doc.card");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(card));
  assert.ok(fs.existsSync(path.join(feedbackDir, "resolved", "observation.doc.card")));
  assert.match(fs.readFileSync(linkingCard, "utf8"), /\/_config\/feedback\/resolved\/observation\.doc\.card/);
  const committed = execFileSync("git", ["-C", boxRoot, "show", "--no-renames", "--pretty=format:", "--name-only", "HEAD"], { encoding: "utf8" });
  assert.deepEqual(committed.trim().split("\n"), ["_config/feedback/follow-up.doc.card", "_config/feedback/observation.doc.card", "_config/feedback/resolved/observation.doc.card"]);
  const staged = execFileSync("git", ["-C", boxRoot, "diff", "--cached", "--name-only"], { encoding: "utf8" });
  assert.equal(staged.trim(), "unrelated.txt");
});

test("legacy notes remain readable but require migration before resolution", () => {
  const { boxesDir, boxRoot, feedbackDir } = fixture();
  const name = "2026-09-21T10-20-30-old.md";
  const source = path.join(feedbackDir, name);
  fs.writeFileSync(source, "# Agent Feedback\n\n## Feedback\n\nOld note\n");
  execFileSync("git", ["init", "-q", boxRoot]);
  execFileSync("git", ["-C", boxRoot, "config", "user.name", "Test User"]);
  execFileSync("git", ["-C", boxRoot, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", boxRoot, "config", "core.hooksPath", "/dev/null"]);
  execFileSync("git", ["-C", boxRoot, "add", "."]);
  execFileSync("git", ["-C", boxRoot, "commit", "-qm", "Initial"]);

  const result = run(boxesDir, "--resolve", name);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /apply the feedback-to-doc-cards box migration first/);
  assert.ok(fs.existsSync(source));
  assert.ok(!fs.existsSync(path.join(feedbackDir, "resolved", name)));
});
