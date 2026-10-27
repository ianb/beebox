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

test("lists doc cards, excluding directory docs and resolved items", () => {
  const { boxesDir, feedbackDir } = fixture();
  fs.writeFileSync(path.join(feedbackDir, "agent-observation.doc.card"), "---\ntitle: Agent observation\n---\nBody\n");
  fs.writeFileSync(path.join(feedbackDir, "AGENTS.md"), "Directory guidance\n");
  fs.mkdirSync(path.join(feedbackDir, "resolved"));
  fs.writeFileSync(path.join(feedbackDir, "resolved", "done.doc.card"), "Done\n");

  const result = run(boxesDir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Found 1 unresolved feedback item/);
  assert.match(result.stdout, /agent-observation\.doc\.card/);
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

// The server path, with `ssh` replaced by a script that runs the remote script
// locally under a temporary root and records which user it would run as. On
// the server the hub (`beebox`) lists the boxes from `hub.json`, and each box
// is scanned, read and resolved as its own user (`bbx-<slug>`).
function fakeServer(): { root: string; env: NodeJS.ProcessEnv; log: string; boxRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-collect-server-"));
  tempDirs.push(root);
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir);
  const log = path.join(root, "ssh.log");
  const bbx = fileURLToPath(new URL("../beebox/bin/bbx", import.meta.url));
  fs.writeFileSync(path.join(binDir, "ssh"), [
    "#!/bin/bash",
    "# ssh -A <target> <remote command>; the script arrives on stdin.",
    `echo "$3" >> ${JSON.stringify(log)}`,
    `sed -e "s#/home/beebox#${root}/home#g" -e "s#/var/lib/beebox#${root}/var#g" -e "s#/etc/beebox#${root}/etc#g" -e "s#/usr/local/bin/bbx#${bbx}#g" | bash -s`,
  ].join("\n"), { mode: 0o755 });
  fs.mkdirSync(path.join(root, "home", ".config", "beebox"), { recursive: true });
  fs.writeFileSync(path.join(root, "home", ".config", "beebox", "hub.json"), JSON.stringify({
    boxes: {
      a: { path: "/var/lib/beebox/a/box", socket: "/run/beebox/a.sock" },
      b: { path: "/var/lib/beebox/b/box", socket: "/run/beebox/b.sock" },
    },
  }));
  fs.mkdirSync(path.join(root, "etc"));
  fs.writeFileSync(path.join(root, "etc", "box.env"), "BBX_UNIT_HOST=\"1\"\n");
  fs.mkdirSync(path.join(root, "var", "b", "box"), { recursive: true });
  const boxRoot = path.join(root, "var", "a", "box");
  fs.mkdirSync(path.join(boxRoot, ".beebox"), { recursive: true });
  fs.writeFileSync(path.join(boxRoot, ".beebox", "box.json"), JSON.stringify({ version: "1.0.0", shapeVersion: 3 }));
  fs.writeFileSync(path.join(boxRoot, "package.json"), JSON.stringify({ name: "a", private: true, dependencies: { beebox: "0.0.0" } }));
  fs.mkdirSync(path.join(boxRoot, "_config", "feedback"), { recursive: true });
  return { root, env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` }, log, boxRoot };
}

function runRemote(server: { root: string; env: NodeJS.ProcessEnv }, ...args: string[]) {
  const emptyLocal = path.join(server.root, "no-local-boxes");
  return spawnSync(process.execPath, ["--import", "tsx", script, "--boxes", emptyLocal, "--ssh-target", "root@server.test", ...args], {
    encoding: "utf8",
    env: server.env,
  });
}

test("reads each server box as its own user, listing them as the hub user", () => {
  const server = fakeServer();
  fs.writeFileSync(path.join(server.boxRoot, "_config", "feedback", "observation.doc.card"), "---\ntitle: Observation\n---\nFrom the server\n");

  const result = runRemote(server);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Found 1 unresolved feedback item/);
  assert.match(result.stdout, /\[remote:a\] observation\.doc\.card/);
  assert.match(result.stdout, /From the server/);
  assert.deepEqual(fs.readFileSync(server.log, "utf8").trim().split("\n"), [
    "su - beebox -s /bin/bash",
    "su - bbx-a -s /bin/bash",
    "su - bbx-a -s /bin/bash",
    "su - bbx-b -s /bin/bash",
  ]);
});

test("resolves a server box's card as that box's user", () => {
  const server = fakeServer();
  const card = path.join(server.boxRoot, "_config", "feedback", "observation.doc.card");
  fs.writeFileSync(card, "---\ntitle: Observation\n---\nObservation\n");
  execFileSync("git", ["init", "-q", server.boxRoot]);
  execFileSync("git", ["-C", server.boxRoot, "config", "user.name", "Test User"]);
  execFileSync("git", ["-C", server.boxRoot, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", server.boxRoot, "config", "core.hooksPath", "/dev/null"]);
  execFileSync("git", ["-C", server.boxRoot, "add", "."]);
  execFileSync("git", ["-C", server.boxRoot, "commit", "-qm", "Initial"]);

  const result = runRemote(server, "--resolve", "observation.doc.card");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(card));
  assert.ok(fs.existsSync(path.join(server.boxRoot, "_config", "feedback", "resolved", "observation.doc.card")));
  assert.equal(fs.readFileSync(server.log, "utf8").trim().split("\n").at(-1), "su - bbx-a -s /bin/bash");
});

test("a hub.json slug that is not a valid box name stops the scan", () => {
  const server = fakeServer();
  fs.writeFileSync(path.join(server.root, "home", ".config", "beebox", "hub.json"), JSON.stringify({ boxes: { "a;rm": { path: "/var/lib/beebox/a/box" } } }));
  const result = runRemote(server);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a server user runOnServer may run as: "bbx-a;rm"/);
});
