// # Post-merge dependency installation
//
// The post-merge helper compares the checkout before and after a merge and runs a
// single frozen workspace install only when the lockfile changed. Tests replace
// `pnpm` with a recording executable, so they exercise the shell boundary without
// changing the real workspace.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd(), "..");
const helper = path.join(repoRoot, "bin/post-merge-install.sh");

function failureOf(error: unknown): { code?: number; stderr?: string } {
  return typeof error === "object" && error !== null ? error : {};
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "post-merge-install-"));
  const repo = path.join(root, "repo");
  const fakeBin = path.join(root, "bin");
  const marker = path.join(root, "pnpm-called");
  await fs.mkdir(repo);
  await fs.mkdir(fakeBin);
  await execFileAsync("git", ["init", "-q"], { cwd: repo });
  await execFileAsync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: repo,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repo });
  await fs.writeFile(
    path.join(repo, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n",
  );
  await execFileAsync("git", ["add", "pnpm-lock.yaml"], { cwd: repo });
  await execFileAsync("git", ["commit", "-qm", "old"], { cwd: repo });
  const { stdout: oldRef } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
  });
  await fs.writeFile(
    path.join(repo, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nchanged: true\n",
  );
  await execFileAsync("git", ["commit", "-qam", "new"], { cwd: repo });
  const { stdout: newRef } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
  });
  await fs.writeFile(
    path.join(fakeBin, "pnpm"),
    `#!/usr/bin/env bash\nprintf '%s\\n%s\\n' "$PWD" "$*" > "${marker}"\n`,
  );
  await fs.chmod(path.join(fakeBin, "pnpm"), 0o755);
  return {
    root,
    repo,
    oldRef: oldRef.trim(),
    newRef: newRef.trim(),
    marker,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
  };
}

// A changed lockfile runs from the invoking checkout and uses the frozen lockfile.
void test("A changed lockfile runs from the invoking checkout and uses the frozen lockfile.", async (t) => {
  const data = await fixture();
  t.teardown(async () => await fs.rm(data.root, { recursive: true, force: true }));
  const result = await execFileAsync(helper, [data.repo, data.oldRef, data.newRef], {
    env: data.env,
  });
  t.check(result.stdout, `[post-merge] pnpm-lock.yaml changed; synchronizing this checkout...
[post-merge] Dependencies synchronized.
`);
  t.check(await fs.readFile(data.marker, "utf8"), `${data.repo}\ninstall --frozen-lockfile\n`);
});

// An unchanged lockfile is a silent no-op.
void test("An unchanged lockfile is a silent no-op.", async (t) => {
  const data = await fixture();
  t.teardown(async () => await fs.rm(data.root, { recursive: true, force: true }));
  const result = await execFileAsync(helper, [data.repo, data.newRef, data.newRef], {
    env: data.env,
  });
  t.check(result.stdout, "");

  await assert.rejects(fs.access(data.marker));
});

// Install failures remain visible and tell direct callers that local commands may
// fail; the post-merge hook can separately decide whether deployment continues.
void test("Install failures remain visible and tell direct callers that local commands m...", async (t) => {
  const data = await fixture();
  t.teardown(
    async () => await fs.rm(data.root, { recursive: true, force: true }),
  );
  await fs.writeFile(
    path.join(path.dirname(data.marker), "bin", "pnpm"),
    "#!/usr/bin/env bash\nexit 23\n",
  );
  const failure = await execFileAsync(helper, [data.repo, data.oldRef, data.newRef], {
    env: data.env,
  }).then(
    () => { throw new Error("expected the helper to fail"); },
    (error: unknown) => failureOf(error),
  );
  t.check({ code: failure.code, stderr: failure.stderr }, {
    code: 1,
    stderr: "[post-merge] ⚠ pnpm install failed; the merge completed, but local commands may fail. Run pnpm install in this checkout after fixing the reported error.\n",
  });
});

// Squash merges have no post-merge old tree, so the helper compares the worktree
// against `HEAD` and still notices a changed lockfile.
void test("Squash merges have no post-merge old tree, so the helper compares the worktre...", async (t) => {
  const data = await fixture();
  t.teardown(async () => await fs.rm(data.root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(data.repo, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nsquashed: true\n",
  );
  await execFileAsync(helper, [data.repo, data.newRef, "WORKTREE"], { env: data.env });
  t.check(await fs.readFile(data.marker, "utf8"), `${data.repo}\ninstall --frozen-lockfile\n`);
});

// A missing `pnpm` has a distinct remedy instead of looking like an ordinary
// install failure.
void test("A missing pnpm has a distinct remedy instead of looking like an ordinary inst...", async (t) => {
  const data = await fixture();
  t.teardown(
    async () => await fs.rm(data.root, { recursive: true, force: true }),
  );
  const fakeBin = path.join(path.dirname(data.marker), "bin");
  await fs.unlink(path.join(fakeBin, "pnpm"));
  const { stdout: gitPath } = await execFileAsync("/bin/sh", [
    "-c",
    "command -v git",
  ]);
  await fs.symlink("/bin/bash", path.join(fakeBin, "bash"));
  await fs.symlink(gitPath.trim(), path.join(fakeBin, "git"));
  const failure = await execFileAsync(helper, [data.repo, data.oldRef, data.newRef], {
    env: { ...data.env, PATH: fakeBin },
  }).then(
    () => { throw new Error("expected the helper to fail"); },
    (error: unknown) => failureOf(error),
  );
  t.check(failure.stderr, "[post-merge] ⚠ pnpm is not available; install pnpm, then run pnpm install in this checkout.\n");
});
