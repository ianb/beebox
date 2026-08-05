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
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DEPLOY = join(ROOT, "callback-box", "deploy");
const scratch = mkdtempSync(join(tmpdir(), "deploy-server-ip-test-"));
const main = join(scratch, "main");
const worktree = join(scratch, "worktree");
const mainDeploy = join(main, "callback-box", "deploy");
const worktreeDeploy = join(worktree, "callback-box", "deploy");
const fakeBin = join(scratch, "bin");
const sshLog = join(scratch, "ssh.log");
const browseLog = join(scratch, "browse.log");

after(() => rmSync(scratch, { recursive: true, force: true }));

function git(...args: string[]): void {
  execFileSync("git", ["-C", main, ...args], { stdio: "ignore" });
}

function resolveIp(deployDir: string) {
  return spawnSync(
    "bash",
    [
      "-c",
      '. "$1"; resolve_server_ip "$2"',
      "bash",
      join(SOURCE_DEPLOY, "resolve-server-ip.sh"),
      deployDir,
    ],
    { encoding: "utf8" },
  );
}

before(() => {
  mkdirSync(mainDeploy, { recursive: true });
  writeFileSync(join(mainDeploy, ".keep"), "");
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("add", ".");
  git("commit", "-qm", "fixture");
  git("worktree", "add", "-q", worktree);

  for (const name of [
    "resolve-server-ip.sh",
    "prod-ssh",
    "prod-curl",
    "prod-browse",
  ]) {
    copyFileSync(join(SOURCE_DEPLOY, name), join(worktreeDeploy, name));
    chmodSync(join(worktreeDeploy, name), 0o755);
  }

  mkdirSync(fakeBin);
  writeFileSync(
    join(fakeBin, "ssh"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${sshLog}"\nif [[ "$*" == *"CB_SESSION_SECRET"* ]]; then printf cookie-token; fi\n`,
  );
  chmodSync(join(fakeBin, "ssh"), 0o755);
  mkdirSync(join(worktree, "bin"));
  writeFileSync(
    join(worktree, "bin", "browse"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${browseLog}"\n`,
  );
  chmodSync(join(worktree, "bin", "browse"), 0o755);
});

test("uses the invoking checkout's non-empty server-ip first", () => {
  writeFileSync(join(mainDeploy, "server-ip"), "198.51.100.10\n");
  writeFileSync(join(worktreeDeploy, "server-ip"), "198.51.100.20\n");

  const result = resolveIp(worktreeDeploy);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "198.51.100.20\n");
});

test("falls back from a worktree to the main checkout via git-common-dir", () => {
  rmSync(join(worktreeDeploy, "server-ip"), { force: true });

  const result = resolveIp(worktreeDeploy);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "198.51.100.10\n");
});

test("a whitespace-only local value does not shadow the main checkout", () => {
  writeFileSync(join(worktreeDeploy, "server-ip"), " \n\t");

  const result = resolveIp(worktreeDeploy);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "198.51.100.10\n");
});

test("fails loudly when neither checkout has a server-ip", () => {
  rmSync(join(mainDeploy, "server-ip"), { force: true });
  rmSync(join(worktreeDeploy, "server-ip"), { force: true });

  const result = resolveIp(worktreeDeploy);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(
    result.stderr,
    /Error: No server IP found\. Run create-server\.sh first\./,
  );
});

test("production diagnostic tools use the shared worktree fallback", () => {
  writeFileSync(join(mainDeploy, "server-ip"), "198.51.100.10\n");
  writeFileSync(join(mainDeploy, "public-url"), "https://example.invalid");
  const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

  execFileSync(
    join(worktreeDeploy, "prod-ssh"),
    ["systemctl", "status", "cb-hub"],
    {
      env,
      stdio: "ignore",
    },
  );
  execFileSync(join(worktreeDeploy, "prod-curl"), ["/test1/"], {
    env,
    stdio: "ignore",
  });
  execFileSync(join(worktreeDeploy, "prod-browse"), ["/test1/"], {
    env,
    stdio: "ignore",
  });

  const sshCalls = readFileSync(sshLog, "utf8");
  assert.match(sshCalls, /-A root@198\.51\.100\.10 systemctl status cb-hub/);
  assert.match(sshCalls, /root@198\.51\.100\.10 bash -s --/);
  assert.match(sshCalls, /root@198\.51\.100\.10 .*CB_SESSION_SECRET/);
  const browseCalls = readFileSync(browseLog, "utf8");
  assert.match(browseCalls, /cookies set cb_session cookie-token/);
  assert.match(browseCalls, /open https:\/\/example\.invalid\/test1\//);
});

test("deploy.sh retains its local-only server-ip backstop", () => {
  const deployScript = readFileSync(join(SOURCE_DEPLOY, "deploy.sh"), "utf8");
  assert.doesNotMatch(deployScript, /resolve-server-ip/);
  assert.match(deployScript, /if \[ ! -s "\$SCRIPT_DIR\/server-ip" \]/);
});

test("both owner-cookie tools fail closed when CB_OWNER_EMAIL is absent", () => {
  for (const tool of ["prod-curl", "prod-browse"]) {
    const script = readFileSync(join(SOURCE_DEPLOY, tool), "utf8");
    assert.match(script, /\[\[ -z "\$\{CB_OWNER_EMAIL:-\}" \]\]/);
    assert.match(script, /Error: CB_OWNER_EMAIL is unset/);
  }
});
