import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execa } from "execa";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workstream = path.basename(repoRoot);

test("archive and unarchive only update registry presentation state", async (t) => {
  const state = await fs.mkdtemp(
    path.join(os.tmpdir(), "workstreams-archive-"),
  );
  t.after(async () => await fs.rm(state, { recursive: true }));
  const env = { ...process.env, CALLBACK_STATE_DIR: state };

  await execa(path.join(repoRoot, "bin/workstreams"), ["archive", workstream], {
    cwd: repoRoot,
    env,
  });
  const registryFile = path.join(state, "workstreams", `${workstream}.json`);
  const archived = JSON.parse(await fs.readFile(registryFile, "utf8")) as {
    archived?: { at?: unknown };
  };
  assert.equal(typeof archived.archived?.at, "string");

  await execa(path.join(repoRoot, "bin/workstreams"), ["archive", workstream], {
    cwd: repoRoot,
    env,
  });
  await execa(
    path.join(repoRoot, "bin/workstreams"),
    ["unarchive", workstream],
    { cwd: repoRoot, env },
  );
  const unarchived = JSON.parse(await fs.readFile(registryFile, "utf8")) as {
    archived?: unknown;
  };
  assert.equal(unarchived.archived, null);

  await assert.rejects(
    execa(
      path.join(repoRoot, "bin/workstreams"),
      ["archive", "definitely-not-a-workstream"],
      { cwd: repoRoot, env },
    ),
    /unknown workstream/,
  );
});
