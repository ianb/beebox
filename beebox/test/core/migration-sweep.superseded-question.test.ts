// # A recorded migration's stale question is closed
//
// A failed run with repair on writes `Migration_<name>-N.question.card`. When a
// later pass applies the migration, the question is no longer a decision anyone
// needs: left pending it keeps the box in `attention`, closes it to work on every
// yielding pass, and its answer would run a repair of a migration that applied.
// The sweep deletes it and commits the deletion. The one pending question a
// recorded migration keeps is the one its partial apply (exit 2) recorded in the
// manifest entry. See `src/core/migration-sweep.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { createFakeAgent } from "./fake-agent.js";
import { sweepMigrations, type SweepResult } from "../../src/core/migration-sweep.js";
import { migrationQuestions } from "../../src/core/migration-repair.js";
import { readManifest } from "../../src/core/migration-manifest.js";
import { createTextQuestionTemplate } from "../../src/schemas/question.js";

// Retired migrations run the shared no-op, so `runScript` decides each outcome.
const PROBE = "annex-config-2026-08";
const LATER = "search-interface-card";
const QUESTION = `_bookkeeping/questions/Migration_${PROBE}-0.question.card`;

async function seedManifest(box: TmpBox, opts: { pending: string[]; entries?: Record<string, unknown>[] }) {
  const pending = new Set(opts.pending);
  const lines = MIGRATIONS.filter((m) => !pending.has(m.name)).map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00.000Z" }));
  for (const entry of opts.entries ?? []) lines.push(JSON.stringify(entry));
  await box.write(MANIFEST_PATH, lines.join("\n") + "\n");
}

function git(box: TmpBox, ...args: string[]) {
  return execFileSync("git", args, { cwd: box.root }).toString().trim();
}

function exists(box: TmpBox, file: string): Promise<boolean> {
  return readFile(join(box.root, file)).then(() => true, () => false);
}

/** What a sweep left: its status, the pending questions, the working tree, and the last commit subject. */
async function state(box: TmpBox, result: SweepResult) {
  return { status: result.status, questions: await migrationQuestions(box.root), card: await exists(box, QUESTION), dirty: git(box, "status", "--porcelain"), head: git(box, "log", "-1", "--format=%s") };
}

const repairAgent = () => createFakeAgent({ name: "repair", sessionId: "repair-session", act: async () => ({}), structuredResult: () => ({ status: "needs-human", reason: "Choose between divergent copies." }) });

void test("a failed run's question is closed when a later pass applies the migration", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await seedManifest(box, { pending: [PROBE] });
  await box.commitAll("seed");

  let code = 1;
  const runScript = async () => code;
  const failed = await sweepMigrations({ boxRoot: box.root, repair: true, runScript, repairAgent: repairAgent() });
  t.check(await state(box, failed), { status: "failed", questions: [QUESTION], card: true, dirty: "", head: `Migration ${PROBE}: repair decision` });

  // The script is fixed and the next pass applies the migration. The question
  // was written for the failure, not for this run, so it is deleted and the
  // deletion committed; the box is current.
  code = 0;
  const applied = await sweepMigrations({ boxRoot: box.root, repair: true, runScript, repairAgent: repairAgent() });
  t.check(await state(box, applied), { status: "applied", questions: [], card: false, dirty: "", head: "Migration questions superseded by the applied migration" });
  t.check(git(box, "show", "--format=", "--name-status", "HEAD"), `D\t${QUESTION}`);
  t.check((await sweepMigrations({ boxRoot: box.root })).status, "current");
});

void test("a pending question for a migration the manifest already records is closed", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  // Every migration applied; the question is left over from a run before the apply.
  await seedManifest(box, { pending: [] });
  await box.write(QUESTION, createTextQuestionTemplate({ memo: `Migration ${PROBE} needs attention`, askedAt: "2026-10-20T10:00:00.000Z", prompt: `Migration: ${PROBE}\nfailed`, directive: "Inspect the manifest." }));
  await box.commitAll("seed");
  t.check(await migrationQuestions(box.root), [QUESTION]);

  const result = await sweepMigrations({ boxRoot: box.root });
  t.check(await state(box, result), { status: "current", questions: [], card: false, dirty: "", head: "Migration questions superseded by the applied migration" });
});

void test("a partial apply's question is recorded in the manifest and kept", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await seedManifest(box, { pending: [PROBE, LATER] });
  await box.commitAll("seed");
  // PROBE exits 2 until recorded; LATER applies cleanly after it.
  const runScript = async ({ boxRoot }: { boxRoot: string }) => ((await readFile(join(boxRoot, MANIFEST_PATH), "utf8")).includes(PROBE) ? 0 : 2);
  const partial = await sweepMigrations({ boxRoot: box.root, repair: true, runScript, repairAgent: repairAgent() });
  t.check(await state(box, partial), { status: "attention", questions: [QUESTION], card: true, dirty: "", head: `Apply migration: ${LATER}` });
  t.check((await readManifest(box.root))?.find((entry) => entry.name === PROBE), { name: PROBE, "applied-at": any(String), question: QUESTION });

  // The question carries the rerun's leftovers and its answer authorizes their repair: it stays.
  const next = await sweepMigrations({ boxRoot: box.root });
  t.check(await state(box, next), { status: "attention", questions: [QUESTION], card: true, dirty: "", head: `Apply migration: ${LATER}` });
});
