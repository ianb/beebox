// # A retired migration on a box that never applied it asks a human
//
// The tombstone `src/scripts/migrate/retired.ts` exits 1 so a box outside the
// fleet is not recorded as having applied a migration it never ran. The sweep
// must not start an agent repair for it (no attempt can succeed) and must not
// record it: it writes a question that names the migration and the way out.
// This test runs the real script runner, not an injected one.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTmpBox, type TmpBox } from "../helpers/test-helpers.js";
import { MIGRATIONS, MANIFEST_PATH, isRetiredMigration } from "../../src/core/migrations.js";
import { createFakeAgent } from "./fake-agent.js";
import { sweepMigrations } from "../../src/core/migration-sweep.js";
import { readManifest } from "../../src/core/migration-manifest.js";

const PROBE = "annex-config-2026-08";
const QUESTION = `_bookkeeping/questions/Migration_${PROBE}-0.question.card`;

async function seedManifestWithout(box: TmpBox, pending: string): Promise<void> {
  const lines = MIGRATIONS.filter((m) => m.name !== pending).map((m) => JSON.stringify({ name: m.name, "applied-at": "2026-01-01T00:00:00.000Z" }));
  await box.write(MANIFEST_PATH, lines.join("\n") + "\n");
}

void test("a pending retired migration asks a human, runs no agent, and is not recorded", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await seedManifestWithout(box, PROBE);
  await box.commitAll("seed");
  const agent = createFakeAgent({ name: "repair", act: async () => ({}), structuredResult: () => ({ status: "repaired", reason: "must not run" }) });

  t.check(MIGRATIONS.filter((m) => m.name === PROBE && isRetiredMigration(m)).map((m) => m.name), [PROBE]);
  const result = await sweepMigrations({ boxRoot: box.root, repair: true, repairAgent: agent });

  t.check(result.status, "failed");
  t.check(result.status === "failed" ? { failed: result.failed, exitCode: result.exitCode, question: result.question } : null, { failed: PROBE, exitCode: 1, question: QUESTION });
  t.check(agent.invocations, []);
  t.check((await readManifest(box.root))?.filter((entry) => entry.name === PROBE), []);
  const card = await readFile(join(box.root, QUESTION), "utf8");
  t.check(card, str`${any(String)}Migration ${PROBE} was retired on 2026-10-08${any(String)}81c647230${any(String)}Retired migrations${any(String)}`);
});
