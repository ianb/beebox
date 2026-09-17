#!/usr/bin/env node

/**
 * Bee Box CLI entry point.
 *
 * `bbx` carries the box agent's surface. Operator and engine verbs — the ones
 * an agent can never call — live under `bbx engine`; `surface-data.ts` holds
 * the classification and says why for each one.
 */

// MUST be first import - sets TSX_TSCONFIG_PATH before any JSX modules load
import "./bootstrap.js";

import { installBoxAdmission } from "./lib/box-admission.js";
import { BoxMaintenanceError } from "../lib/box-maintenance.js";
import { loadEnv, cliEnvSchema } from "../lib/env.js";
import { migrateUserState } from "../lib/state-migration.js";
import { LEGACY_CONFIG_DIR, LEGACY_STATE_DIR, BBX_CONFIG_DIR, BBX_STATE_DIR } from "../lib/state-dir.js";
import { buildProgram } from "./program.js";
import { rewriteLegacyHandoff, legacyHandoffNotice } from "./legacy-argv.js";

// Validate the environment before any command runs (Track D.8). The CLI
// schema is permissive (every field optional) — this only rejects a genuinely
// malformed value (e.g. a non-numeric PORT), never absence, so test
// invocations that set only harness vars pass through untouched.
loadEnv(cliEnvSchema);
await migrateUserState(LEGACY_STATE_DIR, BBX_STATE_DIR);
await migrateUserState(LEGACY_CONFIG_DIR, BBX_CONFIG_DIR);

const program = buildProgram();

// An older engine's `bbx upgrade` spawns this binary with the pre-split verb
// names; accept them so a box can actually cross the split (legacy-argv.ts).
const handoff = rewriteLegacyHandoff(process.argv);
if (handoff.rewrote !== null) console.error(legacyHandoffNotice(handoff.rewrote));

const releaseAdmission = installBoxAdmission(program);
try {
  await program.parseAsync([...handoff.argv]);
} catch (error) {
  if (!(error instanceof BoxMaintenanceError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await releaseAdmission();
}
