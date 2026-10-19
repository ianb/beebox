// # Bounded migration repair
//
// The deterministic retry owns completion. A durable question stops another agent
// attempt; an interrupted receipt also becomes a question instead of a replay.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import type { Agent } from "../../src/core/agent/invoke/core.js";
import { createFakeAgent } from "./fake-agent.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { captureMigrationSnapshot } from "../../src/core/migration-recovery.js";
import { repairMigration, finishMigrationRepair, migrationQuestions } from "../../src/core/migration-repair.js";

void test("line 15", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L16
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
  // doctest:L53
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
  // doctest:L71
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

  // doctest:L80
  t.check(execFileSync("git", ["for-each-ref", "--format=%(refname)", "refs/bbx/migrations/unavailable/repair-started"], { cwd: box.root }).toString().trim(), "");
});
