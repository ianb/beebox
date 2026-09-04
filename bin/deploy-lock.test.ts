import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "deploy-lock-test-"));
  fixtures.push(root);
  const deployDir = join(root, "beebox", "deploy");
  const fakeBin = join(root, "fake-bin");
  mkdirSync(deployDir, { recursive: true });
  mkdirSync(fakeBin);
  for (const name of ["deploy.sh", "deploy-target.sh"]) {
    copyFileSync(join(ROOT, "beebox", "deploy", name), join(deployDir, name));
    chmodSync(join(deployDir, name), 0o755);
  }
  writeFileSync(join(deployDir, "target.env"), "BBX_DEPLOY_HOST=192.0.2.1\n");
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
  assert.ok(result.stdout.includes(`Deploy superseded: ${f.first} queued`), result.stdout);
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
  assert.ok(result.stdout.includes(`Deploy superseded by ${f.second}`), result.stdout);
  const chainedLog = execFileSync("tail", ["-20", join(f.deployDir, ".last-deploy.log")], {
    encoding: "utf8",
  });
  assert.ok(chainedLog.includes(`Deploying ref '${f.second}'`), chainedLog);
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

test("deploy hooks persist intent before starting a detached child", () => {
  for (const hook of ["post-commit", "post-merge"]) {
    const source = readFileSync(join(ROOT, ".husky", hook), "utf8");
    const stamp = source.indexOf('echo "$SHA" > "$REPO_DIR/.deploy-requested"');
    const launch = source.indexOf('node "$REPO_DIR/bin/lib/detach.ts"');
    assert.notEqual(stamp, -1, `${hook} must stamp the requested ref`);
    assert.notEqual(launch, -1, `${hook} must detach the deploy child`);
    assert.ok(stamp < launch, `${hook} must stamp intent before launching`);
    assert.match(source, /exec "\$1" --ref "\$2" --request-recorded >>"\$3" 2>&1/);
    assert.match(source, /deploy\.sh" "\$SHA" "\$LOG_FILE"/);
  }
});

test("a hook-recorded request cannot be overwritten by a delayed child", () => {
  const f = fixture();
  fakeCommand(join(f.fakeBin, "shlock"), "exit 1");
  writeFileSync(join(f.root, ".deploy-requested"), `${f.second}\n`);
  const result = spawnSync(
    join(f.deployDir, "deploy.sh"),
    ["--ref", f.first, "--request-recorded"],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${f.fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0);
  assert.equal(readFileSync(join(f.root, ".deploy-requested"), "utf8"), `${f.second}\n`);
});
