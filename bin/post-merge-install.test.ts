import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const helper = path.join(import.meta.dirname, "post-merge-install.sh");

async function fixture(): Promise<{
  repo: string;
  oldRef: string;
  newRef: string;
  marker: string;
  env: NodeJS.ProcessEnv;
}> {
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
    repo,
    oldRef: oldRef.trim(),
    newRef: newRef.trim(),
    marker,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
  };
}

test("a changed lockfile runs a frozen workspace install", async () => {
  const data = await fixture();
  const result = await execFileAsync(
    helper,
    [data.repo, data.oldRef, data.newRef],
    { env: data.env },
  );
  assert.match(result.stdout, /pnpm-lock\.yaml changed/);
  assert.equal(
    await fs.readFile(data.marker, "utf8"),
    `${data.repo}\ninstall --frozen-lockfile\n`,
  );
});

test("an unchanged lockfile is silent and does not run pnpm", async () => {
  const data = await fixture();
  const result = await execFileAsync(
    helper,
    [data.repo, data.newRef, data.newRef],
    { env: data.env },
  );
  assert.equal(result.stdout, "");
  await assert.rejects(fs.access(data.marker));
});

test("an install failure is visible and returns failure to direct callers", async () => {
  const data = await fixture();
  await fs.writeFile(
    path.join(path.dirname(data.marker), "bin", "pnpm"),
    "#!/usr/bin/env bash\nexit 23\n",
  );
  await assert.rejects(
    execFileAsync(helper, [data.repo, data.oldRef, data.newRef], {
      env: data.env,
    }),
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, 1);
      assert.match(
        (error as { stderr?: string }).stderr ?? "",
        /local commands may fail/,
      );
      return true;
    },
  );
});

test("a squash merge compares the worktree against HEAD", async () => {
  const data = await fixture();
  await fs.writeFile(
    path.join(data.repo, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nsquashed: true\n",
  );
  await execFileAsync(helper, [data.repo, data.newRef, "WORKTREE"], {
    env: data.env,
  });
  assert.equal(
    await fs.readFile(data.marker, "utf8"),
    `${data.repo}\ninstall --frozen-lockfile\n`,
  );
});

test("a missing pnpm reports the installation remedy distinctly", async () => {
  const data = await fixture();
  const fakeBin = path.join(path.dirname(data.marker), "bin");
  await fs.unlink(path.join(fakeBin, "pnpm"));
  const { stdout: gitPath } = await execFileAsync("/bin/sh", [
    "-c",
    "command -v git",
  ]);
  await fs.symlink("/bin/bash", path.join(fakeBin, "bash"));
  await fs.symlink(gitPath.trim(), path.join(fakeBin, "git"));
  await assert.rejects(
    execFileAsync(helper, [data.repo, data.oldRef, data.newRef], {
      env: { ...data.env, PATH: fakeBin },
    }),
    (error: unknown) => {
      assert.match(
        (error as { stderr?: string }).stderr ?? "",
        /pnpm is not available.*run pnpm install/,
      );
      return true;
    },
  );
});
