// Unit tests for the opt-in deploy-target layer: beebox/deploy/deploy-target.sh
// and the production diagnostics that read it. Runs the real bash against a
// throwaway git checkout + worktree, with fake `ssh`/`bin/browse` on PATH — no
// server is contacted. Run with:
//   node --import tsx --test bin/deploy-target.test.ts

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
import { after, before, test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_DEPLOY = join(ROOT, "beebox", "deploy");
const scratch = mkdtempSync(join(tmpdir(), "deploy-target-test-"));
const main = join(scratch, "main");
const worktree = join(scratch, "worktree");
const mainDeploy = join(main, "beebox", "deploy");
const worktreeDeploy = join(worktree, "beebox", "deploy");
const fakeBin = join(scratch, "bin");
const sshLog = join(scratch, "ssh.log");
const browseLog = join(scratch, "browse.log");

const TOOLS = ["deploy-target.sh", "prod-ssh", "prod-curl", "prod-browse"];

after(() => rmSync(scratch, { recursive: true, force: true }));

function git(...args: string[]): void {
  execFileSync("git", ["-C", main, ...args], { stdio: "ignore" });
}

/** Run a deploy-target.sh subcommand from the worktree copy. */
function target(...args: string[]) {
  return spawnSync(join(worktreeDeploy, "deploy-target.sh"), args, { encoding: "utf8" });
}

function writeTarget(dir: string, body: string): void {
  writeFileSync(join(dir, "target.env"), body);
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

  for (const name of TOOLS) {
    copyFileSync(join(SOURCE_DEPLOY, name), join(worktreeDeploy, name));
    chmodSync(join(worktreeDeploy, name), 0o755);
  }
  copyFileSync(join(SOURCE_DEPLOY, "deploy-target.sh"), join(mainDeploy, "deploy-target.sh"));
  chmodSync(join(mainDeploy, "deploy-target.sh"), 0o755);

  mkdirSync(fakeBin);
  writeFileSync(
    join(fakeBin, "ssh"),
    // The cookie-minting tools send their remote script on stdin, so the fake
    // has to look there, not in argv, to know it is being asked for a session.
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${sshLog}"\nremote=$(cat 2>/dev/null || true)\nif [[ "$remote" == *"BBX_SESSION_SECRET"* ]]; then printf cookie-token; fi\n`,
  );
  chmodSync(join(fakeBin, "ssh"), 0o755);
  mkdirSync(join(worktree, "bin"));
  writeFileSync(
    join(worktree, "bin", "browse"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${browseLog}"\n`,
  );
  chmodSync(join(worktree, "bin", "browse"), 0o755);
});

// ─── The enable switch ──────────────────────────────────────────────────────

test("a checkout with no target.env is unconfigured, and says nothing about it", () => {
  const result = target("path");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  // Silence is the point: the hooks print this script's failure nowhere, so a
  // visitor who never had a server is never told to restore one.
  assert.equal(result.stderr, "");
});

test("target.env in the invoking checkout wins over the main checkout's", () => {
  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\n");
  writeTarget(worktreeDeploy, "BBX_DEPLOY_HOST=198.51.100.20\n");

  const result = target("ssh-target");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "root@198.51.100.20\n");
});

test("a worktree falls back to the main checkout via git-common-dir", () => {
  rmSync(join(worktreeDeploy, "target.env"), { force: true });

  const result = target("ssh-target");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "root@198.51.100.10\n");
});

test("a whitespace-only local target.env does not shadow the main checkout", () => {
  writeTarget(worktreeDeploy, " \n\t");

  const result = target("ssh-target");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "root@198.51.100.10\n");
  rmSync(join(worktreeDeploy, "target.env"), { force: true });
});

// ─── Defaults and overrides ─────────────────────────────────────────────────

test("the SSH user is configurable and defaults to root", () => {
  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\n");
  assert.equal(target("ssh-target").stdout, "root@198.51.100.10\n");

  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\nBBX_DEPLOY_SSH_USER=admin\n");
  assert.equal(target("ssh-target").stdout, "admin@198.51.100.10\n");

  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\n");
});

test("a target.env present but missing the host is a broken config, not an absent one", () => {
  writeTarget(mainDeploy, "BBX_DEPLOY_SSH_USER=admin\n");
  const result = target("ssh-target");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sets no BBX_DEPLOY_HOST/);
  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\n");
});

// ─── The consumers ──────────────────────────────────────────────────────────

test("production diagnostic tools use the shared worktree fallback", () => {
  writeTarget(
    mainDeploy,
    "BBX_DEPLOY_HOST=198.51.100.10\nBBX_DEPLOY_PUBLIC_URL=https://example.invalid\n",
  );
  const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

  execFileSync(join(worktreeDeploy, "prod-ssh"), ["systemctl", "status", "bbx-hub"], {
    env,
    stdio: "ignore",
  });
  execFileSync(join(worktreeDeploy, "prod-curl"), ["/test1/"], { env, stdio: "ignore" });
  execFileSync(join(worktreeDeploy, "prod-browse"), ["/test1/"], { env, stdio: "ignore" });

  const sshCalls = readFileSync(sshLog, "utf8");
  assert.match(sshCalls, /-A root@198\.51\.100\.10 systemctl status bbx-hub/);
  // Both cookie tools reach the server's own loopback, so the service home and
  // hub port travel as arguments rather than being baked into the heredoc.
  assert.match(sshCalls, /root@198\.51\.100\.10 bash -s -- \/home\/beebox 3210 \/test1\//);
  assert.match(sshCalls, /root@198\.51\.100\.10 bash -s -- \/home\/beebox$/m);
  const browseCalls = readFileSync(browseLog, "utf8");
  assert.match(browseCalls, /cookies set bbx_session cookie-token/);
  assert.match(browseCalls, /open https:\/\/example\.invalid\/test1\//);
});

test("prod-browse names the missing public URL rather than opening a bare path", () => {
  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\n");
  const result = spawnSync(join(worktreeDeploy, "prod-browse"), ["/test1/"], {
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BBX_DEPLOY_PUBLIC_URL is unset/);
});

test("the deploy refuses, with the container install as the alternative, when unconfigured", () => {
  rmSync(join(mainDeploy, "target.env"), { force: true });
  const result = spawnSync(join(worktreeDeploy, "prod-ssh"), [], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no deploy target is configured/);
  assert.match(result.stderr, /docker-install\.md/);
});

// ─── Invariants the scripts must keep ───────────────────────────────────────

test("deploying from a worktree is refused even though the main checkout has a target", () => {
  // Diagnostics may borrow the main checkout's target; deploying must NOT, or
  // `deploy.sh` run from a worktree ships an unlanded branch to production.
  // Assert the behavior, not the call text: a regex over deploy.sh would pass
  // just as happily while the loader quietly fell back.
  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\n");
  rmSync(join(worktreeDeploy, "target.env"), { force: true });
  copyFileSync(join(SOURCE_DEPLOY, "deploy.sh"), join(worktreeDeploy, "deploy.sh"));
  chmodSync(join(worktreeDeploy, "deploy.sh"), 0o755);

  const result = spawnSync(join(worktreeDeploy, "deploy.sh"), ["--ref", "HEAD"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no beebox\/deploy\/target\.env of its own/);
  assert.match(result.stderr, /main-checkout-only/);
  // …and it says so because of the fallback, not because nothing is configured.
  assert.doesNotMatch(result.stderr, /no deploy target is configured/);
});

test("the fixed server layout cannot be overridden in target.env", () => {
  // deploy.sh's remote steps, add-box.sh, the leak scan and the CSP report all
  // name /opt/beebox, /home/beebox, `beebox` and 3210 literally. A settable
  // INSTALL_DIR would move the rsync destination and nothing else — a
  // half-deployed server reporting success. Refusing is the fail-closed half.
  for (const key of [
    "BBX_DEPLOY_INSTALL_DIR=/srv/bbx",
    "BBX_DEPLOY_SERVICE_USER=bbx",
    "BBX_DEPLOY_SERVICE_HOME=/home/bbx",
    "BBX_DEPLOY_HUB_PORT=4000",
  ]) {
    writeTarget(mainDeploy, `BBX_DEPLOY_HOST=198.51.100.10\n${key}\n`);
    const result = target("ssh-target");
    assert.notEqual(result.status, 0, `${key} should be refused`);
    assert.match(result.stderr, /is not configurable/);
  }
  // An `export`-prefixed line is the same setting, not a way around it.
  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\nexport BBX_DEPLOY_INSTALL_DIR=/srv/bbx\n");
  assert.match(target("ssh-target").stderr, /is not configurable/);

  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\n");
});

test("the fixed layout is still readable, so consumers share one source for it", () => {
  writeTarget(mainDeploy, "BBX_DEPLOY_HOST=198.51.100.10\n");
  assert.equal(target("get", "BBX_DEPLOY_INSTALL_DIR").stdout, "/opt/beebox\n");
  assert.equal(target("get", "BBX_DEPLOY_SERVICE_USER").stdout, "beebox\n");
  assert.equal(target("get", "BBX_DEPLOY_SERVICE_HOME").stdout, "/home/beebox\n");
  assert.equal(target("get", "BBX_DEPLOY_HUB_PORT").stdout, "3210\n");
});

test("both owner-cookie tools fail closed when BBX_OWNER_EMAIL is absent", () => {
  for (const tool of ["prod-curl", "prod-browse"]) {
    const script = readFileSync(join(SOURCE_DEPLOY, tool), "utf8");
    assert.match(script, /\[\[ -z "\${BBX_OWNER_EMAIL:-}" ]]/);
    assert.match(script, /Error: BBX_OWNER_EMAIL is unset/);
  }
});

test("the commit hooks gate on deploy-target.sh, silently", () => {
  for (const hook of ["post-commit", "post-merge"]) {
    const text = readFileSync(join(ROOT, ".husky", hook), "utf8");
    assert.match(text, /deploy-target\.sh" path >\/dev\/null 2>&1/);
    assert.doesNotMatch(text, /NOT deploying/);
  }
});
