// # `bbx migrate --mark-applied <name>`
//
// Records a single migration as applied **without running it** — the escape hatch
// for a box already in a migration's post-state that never got the manifest entry
// (e.g. the retired `bill` migrator, which can no longer run). Unlike
// `--mark-all-applied` (seeds a whole missing manifest), this appends one entry to
// a box that already has a manifest. `markMigrationApplied` is the pure core the
// CLI action wraps.

import { test } from "tap";
import "agent-doctest/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { markMigrationApplied } from "../../../src/cli/commands/migrate.js";
import { MANIFEST_PATH } from "../../../src/core/migrations.js";

async function makeBox(entries: string[] | null) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bbx-markapplied-"));
  if (entries !== null) {
    const abs = path.join(tmp, MANIFEST_PATH);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const text = entries.map((n) => JSON.stringify({ name: n, "applied-at": "2026-01-01T00:00:00.000Z" })).join("\n");
    await fs.writeFile(abs, entries.length > 0 ? text + "\n" : "");
  }
  return tmp;
}

function manifestEntry(line: string): { name: string } {
  return JSON.parse(line);
}

async function readManifestNames(boxRoot: string) {
  const text = await fs.readFile(path.join(boxRoot, MANIFEST_PATH), "utf-8");
  return text.split("\n").filter((l) => l.trim() !== "").map((l) => manifestEntry(l).name);
}

// ## Marks a pending migration as applied and appends the entry
void test("Marks a pending migration as applied and appends the entry", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(box, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L41
  const box = await makeBox(["attachments", "card-frontmatter"]);
  const result = await markMigrationApplied({ boxRoot: box, name: "bill" });
  t.check(result, {
    status: "marked",
  });

  // doctest:L46
  t.check((await readManifestNames(box)).join(","), "attachments,card-frontmatter,bill");
});

// ## A second mark is an idempotent no-op
void test("A second mark is an idempotent no-op", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(box, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L57
  const box = await makeBox(["bill"]);
  const result = await markMigrationApplied({ boxRoot: box, name: "bill" });
  t.check(result, {
    status: "already-applied",
  });

  // doctest:L62
  t.check((await readManifestNames(box)).join(","), "bill");
});

// ## Refuses an unknown migration name (no manifest write)
void test("Refuses an unknown migration name (no manifest write)", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(box, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L73
  const box = await makeBox(["attachments"]);
  const result = await markMigrationApplied({ boxRoot: box, name: "not-a-real-migration" });
  t.check(result, {
    status: "unknown-migration",
  });

  // doctest:L78
  t.check((await readManifestNames(box)).join(","), "attachments");
});

// ## Refuses a box with no manifest (use `--mark-all-applied` first)
void test("Refuses a box with no manifest (use `--mark-all-applied` first)", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(box, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L89
  const box = await makeBox(null);
  const result = await markMigrationApplied({ boxRoot: box, name: "bill" });
  t.check(result, {
    status: "no-manifest",
  });
});
