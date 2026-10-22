// # Bounded migration repair
//
// The deterministic retry owns completion. A durable question stops another agent
// attempt; an interrupted receipt also becomes a question instead of a replay.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import type { Agent } from "../../src/core/agent/invoke/core.js";
import { createFakeAgent } from "./fake-agent.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { findAbsoluteMachinePaths } from "../../src/lib/absolute-path-check.js";
import { captureMigrationSnapshot } from "../../src/core/migration-recovery.js";
import { repairMigration, finishMigrationRepair, migrationQuestions, redactMigrationQuestions } from "../../src/core/migration-repair.js";

void test("line 15", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const snapshot = await captureMigrationSnapshot(box.root, "probe");
  let invocations = 0;
  let retries = 0;
  const fake = createFakeAgent({
    name: "repair", sessionId: "test-session", act: async () => ({}),
    structuredResult: () => {
      invocations += 1;
      return { status: "needs-human", reason: "Which divergent content should be kept?" };
    },
  });
  // The fake validates the verdict against the caller's schema; this wrapper adds the turn bound check.
  const agent: Agent = {
    ...fake,
    invokeStructured: async (schema, args) => {
      if (args.maxTurns !== 12) throw new Error("Unbounded repair");
      return fake.invokeStructured(schema, args);
    },
  };
  const opts = {
    boxRoot: box.root, name: "probe", recoveryRef: snapshot.ref, failure: "invalid card", code: 2,
    retry: async () => { retries += 1; return 2; },
    agent,
  };
  const first = await repairMigration(opts);
  await box.commitAll("record repair question");
  await finishMigrationRepair(box.root, "probe");
  const second = await repairMigration(opts);
  t.check({ invocations, retries, sameQuestion: second.question, pending: (await migrationQuestions(box.root)).length }, {
    invocations: 1,
    retries: 1,
    sameQuestion: first.question,
    pending: 1,
  });
});

void test("line 52", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const snapshot = await captureMigrationSnapshot(box.root, "interrupted");
  execFileSync("git", ["update-ref", "refs/bbx/migrations/interrupted/repair-started", snapshot.ref], { cwd: box.root });
  let invoked = false;
  const result = await repairMigration({
    boxRoot: box.root, name: "interrupted", recoveryRef: snapshot.ref, failure: "interrupted", code: 1,
    retry: async () => 0,
    agent: createFakeAgent({ name: "repair", act: async () => ({}), structuredResult: () => { invoked = true; return null; } }),
  });
  t.check({ invoked, question: result.question, code: result.code }, {
    invoked: false,
    question: "_bookkeeping/questions/Migration_interrupted-0.question.card",
    code: 1,
  });
});

void test("line 70", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const snapshot = await captureMigrationSnapshot(box.root, "unavailable");
  await t.checkThrows(
    async () => (await repairMigration({
      boxRoot: box.root, name: "unavailable", recoveryRef: snapshot.ref, failure: "invalid", code: 1,
      retry: async () => 0,
      agent: createFakeAgent({ name: "repair", act: async () => ({}), structuredFailure: { error: "unavailable", invocationFailure: true } }),
    })),
    "MigrationRepairUnavailableError",
  );

  t.check(execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/bbx/migrations/unavailable/repair-started"], { cwd: box.root }).toString().trim(), "");
});

// The question quotes the failure, which names host paths (a pnpm cache, the
// box root). The box commit lint refuses a machine path in a card, so the
// question is written with `~<name>/` instead; a question written before that
// is rewritten in place. 2026-10-21: every production box held one it could
// not commit.
void test("A migration question carries no machine path", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox({ git: true });
  const snapshot = await captureMigrationSnapshot(box.root, "hostpath");
  const result = await repairMigration({
    boxRoot: box.root, name: "hostpath", recoveryRef: snapshot.ref, code: 1,
    failure: "ERR_PNPM_NO_OFFLINE_META in package mirror /home/beebox/.cache/pnpm/typescript.json",
    retry: async () => 1,
    agent: createFakeAgent({ name: "repair", act: async () => ({}), structuredResult: () => ({ status: "failed", reason: "Checked /home/beebox/boxes/a." }) }),
  });
  assert.ok(result.question !== undefined);
  const written = await box.read(result.question);

  const old = "_bookkeeping/questions/Migration_older-0.question.card";
  await box.write(old, written.replaceAll("~beebox/", "/home/beebox/"));
  const answered = "_bookkeeping/questions/Migration_answered-0.question.card";
  const answeredText = written.replace("input:\n  type: text\n", "input:\n  type: text\nanswer:\n  text: kept /home/beebox/work/\nanswered-at: 2026-10-21T00:00:00.000Z\n");
  await box.write(answered, answeredText);
  const rewritten = await redactMigrationQuestions(box.root);
  t.check({
    answeredKept: (await box.read(answered)).includes("kept /home/beebox/work/"),
    written: { leaks: findAbsoluteMachinePaths(written), quotesCache: written.includes("~beebox/.cache/pnpm/typescript.json") },
    rewritten,
    old: findAbsoluteMachinePaths(await box.read(old)),
    again: await redactMigrationQuestions(box.root),
  }, {
    answeredKept: true,
    written: { leaks: [], quotesCache: true },
    rewritten: [old],
    old: [],
    again: [],
  });
});
