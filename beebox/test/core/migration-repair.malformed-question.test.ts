// A migration question card a person or agent edited into an invalid shape is
// reported as an open question. It does not make the sweep, the health check,
// or a repair attempt throw, and it does not count as an answer. An open
// question, malformed or not, does not let a later exit 2 record its migration.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { MIGRATIONS, MANIFEST_PATH } from "../../src/core/migrations.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";
import { migrationQuestions, repairMigration } from "../../src/core/migration-repair.js";
import { pendingMigrationsCheck } from "../../src/webapp/trpc/routers/health/checks/migrations.js";
import { createFakeAgent } from "./fake-agent.js";

const CARD = "_bookkeeping/questions/Migration_probe-0.question.card";
// `answer` must be an object; a hand edit that writes a bare string fails QuestionSchema.
const MALFORMED = "---\nmemo: Migration probe needs attention\nprompt: p\ninput:\n  type: text\nanswer: kept both\nasked-at: 2026-10-20T00:00:00.000Z\n---\n";

async function currentBoxWithMalformedQuestion(): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  const lines = MIGRATIONS.map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00.000Z" }));
  await box.write(MANIFEST_PATH, lines.join("\n") + "\n");
  await box.write(CARD, MALFORMED);
  await box.commitAll("seed");
  return box;
}

void test("a malformed question card is an attention item for the sweep and the health check", async (t) => {
  const box = await currentBoxWithMalformedQuestion();
  t.teardown(() => box.cleanup());
  const sweep = await sweepMigrations({ boxRoot: box.root, repair: true });
  const health = await pendingMigrationsCheck(box.root);
  // Nothing is pending, so the only attention item is the unreadable card, named by path.
  t.check({ sweep, questions: await migrationQuestions(box.root), healthOk: health.ok, named: health.message.includes(CARD) }, {
    sweep: { status: "attention", questions: [CARD], applied: [] },
    questions: [CARD],
    healthOk: false,
    named: true,
  });
});

void test("a malformed question card stops a repair attempt as unanswered", async (t) => {
  const box = await currentBoxWithMalformedQuestion();
  t.teardown(() => box.cleanup());
  let invocations = 0;
  const agent = createFakeAgent({ name: "repair", act: async () => ({}), structuredResult: () => { invocations += 1; return { status: "failed", reason: "x" }; } });
  const result = await repairMigration({ boxRoot: box.root, name: "probe", recoveryRef: "HEAD", failure: "f", code: 1, retry: async () => 0, agent });
  // An unreadable card is no authorization: the attempt returns the card and runs no agent.
  t.check({ result, invocations }, { result: { code: 1, question: CARD, stale: true }, invocations: 0 });
});

// A script migration; its name only has to be in the registry.
const PENDING = "annex-config-2026-08";
const UNANSWERED = "---\nmemo: Migration needs attention\nprompt: p\ninput:\n  type: text\nasked-at: 2026-10-20T00:00:00.000Z\n---\n";

for (const [label, card] of [["unanswered", UNANSWERED], ["malformed", MALFORMED]] as const) {
  void test(`an exit 2 under an earlier ${label} question is deferred, not recorded`, async (t) => {
    const box = await makeTmpBox({ git: true });
    t.teardown(() => box.cleanup());
    const lines = MIGRATIONS.filter((m) => m.name !== PENDING).map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00.000Z" }));
    await box.write(MANIFEST_PATH, lines.join("\n") + "\n");
    await box.write(`_bookkeeping/questions/Migration_${PENDING}-0.question.card`, card);
    await box.commitAll("seed");
    let agents = 0;
    const repairAgent = createFakeAgent({ name: "repair", act: async () => ({}), structuredResult: () => { agents += 1; return { status: "failed", reason: "x" }; } });
    const result = await sweepMigrations({ boxRoot: box.root, repair: true, repairAgent,
      runScript: async ({ onOutput }) => { onOutput?.("leftover: src/views/Notes.tsx\n"); return 2; } });
    const manifest = await readFile(join(box.root, MANIFEST_PATH), "utf8");
    // The open question holds no record of these leftovers, so the migration stays pending for the next pass.
    t.check({ status: result.status, recorded: manifest.includes(PENDING), agents }, { status: "deferred-repair", recorded: false, agents: 0 });
  });
}
