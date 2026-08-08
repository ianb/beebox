/**
 * Everything the harness arranges in the box BEFORE the operator sees it
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * Field tests exercise operating order, never setup (boxholder decision): when
 * a scenario involves email, the box starts as if the boxholder had connected
 * their mail last month. So the connector config is written here, committed
 * with the baseline, and the operator never touches a settings screen.
 *
 * The box-agent model is seeded here too, and for a different reason: the
 * persisted chat model is opaque and letting it float would make two weekly
 * runs incomparable.
 *
 * **`models.box` pins CHAT ONLY.** The reactor's agent invocations go through
 * `runAgent`, which takes a model nobody passes it, so reactor work — intake,
 * the email→task step this tier exists to watch — runs on the SDK default. A
 * report header saying `box: opus` is therefore true of chat and not of the
 * agent that processed the mail. Tracked in
 * `issues/features/2026-08-08-reactor-agent-model-not-pinnable.md`.
 */

import * as path from "node:path";
import { mkdir } from "node:fs/promises";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { commit, getStatus, stageAll } from "../lib/git.js";
import { DEFAULT_MODEL_FILE } from "../core/chat/session/state.js";
import type { FieldBox } from "./run-box.js";
import type { FieldScenario } from "./scenario.js";

/**
 * The seeded Gmail config: one rule that tracks everything in the inbox.
 *
 * A field run's mailbox contains only what the scenario injected, so a
 * narrower query would just be a second place for a scenario author's typo to
 * hide. The budget is wide enough that a three-day scenario cannot age a
 * message out of the tracking window.
 */
const TRACK_EVERYTHING_CONFIG = {
  rules: [
    {
      name: "inbox",
      query: "label:INBOX",
      action: { type: "track", budget: { threads: 25, window: "30d" } },
    },
  ],
};

/** True when the scenario ever puts mail in the box, i.e. when the run needs a
 *  Gmail connector at all. */
export function scenarioNeedsGmail(scenario: FieldScenario): boolean {
  return scenario.checklist.some((item) => item.pre.some((a) => a.type === "inject-email"));
}

export interface SeedFieldBoxOptions {
  box: FieldBox;
  scenario: FieldScenario;
}

/**
 * Seed the run's box and commit the result, so the baseline the `reset` policy
 * rewinds to already contains the arranged setup.
 */
export async function seedFieldBox(options: SeedFieldBoxOptions): Promise<void> {
  const { box, scenario } = options;

  if (scenarioNeedsGmail(scenario)) {
    const connectorsDir = path.join(box.boxRoot, "config/connectors");
    await mkdir(connectorsDir, { recursive: true });
    await writeFileAtomic(path.join(connectorsDir, "gmail.json"), {
      content: `${JSON.stringify(TRACK_EVERYTHING_CONFIG, null, 2)}\n`,
    });
  }

  // Gitignored, so it is not part of the committed baseline — which is what we
  // want: a `reset` must not rewind the box agent onto a different model than
  // the run started with.
  const modelFile = path.join(box.boxRoot, DEFAULT_MODEL_FILE);
  await mkdir(path.dirname(modelFile), { recursive: true });
  await writeFileAtomic(modelFile, {
    content: `${JSON.stringify({ model: scenario.models.box }, null, 2)}\n`,
  });

  const status = await getStatus(box.packageRoot);
  if (status.clean) return;
  await stageAll(box.packageRoot);
  await commit(box.packageRoot, {
    message: `Field-test setup for ${scenario.name}`,
    trailers: { "Created-By": "cb field-test" },
  });
}
