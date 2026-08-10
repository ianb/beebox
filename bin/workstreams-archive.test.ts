import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";

const repoRoot = path.resolve(import.meta.dirname, "..");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function registryRecord(file: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  assert.ok(isRecord(parsed));
  return parsed;
}

test("archive and unarchive only update registry presentation state", async (t) => {
  const state = await fs.mkdtemp(
    path.join(os.tmpdir(), "workstreams-archive-"),
  );
  const worktreeRoot = path.join(state, "worktrees");
  const workstream = "synthetic-workstream";
  await fs.mkdir(path.join(worktreeRoot, workstream), { recursive: true });
  t.after(async () => await fs.rm(state, { recursive: true }));
  const env = {
    ...process.env,
    CALLBACK_STATE_DIR: state,
    CALLBACK_WORKTREE_ROOT: worktreeRoot,
  };

  await execa(path.join(repoRoot, "bin/workstreams"), ["archive", workstream], {
    cwd: repoRoot,
    env,
  });
  const registryFile = path.join(state, "workstreams", `${workstream}.json`);
  const archived = await registryRecord(registryFile);
  assert.ok(typeof archived.archived === "object" && archived.archived !== null);
  assert.ok("at" in archived.archived);
  assert.equal(typeof archived.archived.at, "string");
  const firstArchivedAt = archived.archived.at;

  await execa(path.join(repoRoot, "bin/workstreams"), ["archive", workstream], {
    cwd: repoRoot,
    env,
  });
  const rearchived = await registryRecord(registryFile);
  assert.ok(
    typeof rearchived.archived === "object" && rearchived.archived !== null,
  );
  assert.ok("at" in rearchived.archived);
  assert.equal(rearchived.archived.at, firstArchivedAt);
  await execa(
    path.join(repoRoot, "bin/workstreams"),
    ["unarchive", workstream],
    { cwd: repoRoot, env },
  );
  const unarchived = await registryRecord(registryFile);
  assert.equal(unarchived.archived, null);

  await fs.writeFile(
    registryFile,
    JSON.stringify({
      removed: { at: new Date().toISOString(), merged: false },
    }),
  );
  await assert.rejects(
    execa(path.join(repoRoot, "bin/workstreams"), ["archive", workstream], {
      cwd: repoRoot,
      env,
    }),
    /refusing to hide recovery state/,
  );

  await assert.rejects(
    execa(
      path.join(repoRoot, "bin/workstreams"),
      ["archive", "definitely-not-a-workstream"],
      { cwd: repoRoot, env },
    ),
    /unknown workstream/,
  );
});
