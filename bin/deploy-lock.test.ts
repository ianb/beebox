import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "deploy-lock-test-"));
  fixtures.push(root);
  const deployDir = join(root, "callback-box", "deploy");
  const fakeBin = join(root, "fake-bin");
  mkdirSync(deployDir, { recursive: true });
  mkdirSync(fakeBin);
  copyFileSync(join(ROOT, "callback-box", "deploy", "deploy.sh"), join(deployDir, "deploy.sh"));
  chmodSync(join(deployDir, "deploy.sh"), 0o755);
  writeFileSync(join(deployDir, "server-ip"), "192.0.2.1\n");
  writeFileSync(join(deployDir, ".last-deploy.log"), "");
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "test"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "first"]);
  const first = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  writeFileSync(join(root, "newer"), "newer\n");
  execFileSync("git", ["-C", root, "add", "newer"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "second"]);
  const second = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { root, deployDir, fakeBin, first, second };
}

function fakeCommand(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

test("a lock loser reports an explicit superseded terminal state", () => {
  const f = fixture();
  fakeCommand(join(f.fakeBin, "shlock"), "exit 1");
  const result = spawnSync(join(f.deployDir, "deploy.sh"), ["--ref", f.first], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${f.fakeBin}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`Deploy superseded: ${f.first} queued`));
});

test("a failed lock holder chains to a newer request", () => {
  const f = fixture();
  fakeCommand(join(f.fakeBin, "shlock"), "exit 0");
  fakeCommand(
    join(f.fakeBin, "ssh"),
    'if [ -e "$SSH_COUNTER" ]; then exit 24; fi\n' +
      'touch "$SSH_COUNTER"\n' +
      'printf "%s\\n" "$NEW_SHA" > "$REQUESTED_FILE_FOR_TEST"\n' +
      "exit 23",
  );
  const result = spawnSync(join(f.deployDir, "deploy.sh"), ["--ref", f.first], {
    encoding: "utf8",
    env: {
      ...process.env,
      NEW_SHA: f.second,
      PATH: `${f.fakeBin}:${process.env.PATH}`,
      REQUESTED_FILE_FOR_TEST: join(f.root, ".deploy-requested"),
      SSH_COUNTER: join(f.root, "ssh-counter"),
    },
  });

  assert.equal(result.status, 23);
  assert.match(result.stdout, /Deploy failed \(exit 23\)/);
  assert.match(result.stdout, new RegExp(`Deploy superseded by ${f.second}`));
  const chainedLog = execFileSync("tail", ["-20", join(f.deployDir, ".last-deploy.log")], {
    encoding: "utf8",
  });
  assert.match(chainedLog, new RegExp(`Deploying ref '${f.second}'`));
  assert.match(chainedLog, /Deploy failed \(exit 24\)/);
});

test("a signal-style failure does not start a chained deploy", () => {
  const f = fixture();
  fakeCommand(join(f.fakeBin, "shlock"), "exit 0");
  fakeCommand(
    join(f.fakeBin, "ssh"),
    'printf "%s\\n" "$NEW_SHA" > "$REQUESTED_FILE_FOR_TEST"\nexit 130',
  );
  const result = spawnSync(join(f.deployDir, "deploy.sh"), ["--ref", f.first], {
    encoding: "utf8",
    env: {
      ...process.env,
      NEW_SHA: f.second,
      PATH: `${f.fakeBin}:${process.env.PATH}`,
      REQUESTED_FILE_FOR_TEST: join(f.root, ".deploy-requested"),
    },
  });

  assert.equal(result.status, 130);
  assert.doesNotMatch(result.stdout, /chaining after failed attempt/);
});
