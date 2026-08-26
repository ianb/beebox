/**
 * Everything the harness arranges in the box BEFORE the operator sees it
 * (`docs/plans/agent-field-tests.md`, Track 2).
 *
 * Field tests exercise operating order, never setup (boxholder decision): when
 * a scenario involves email, the box starts as if the boxholder had connected
 * their mail last month. So the connector config is written here, committed
 * with the baseline, and the operator never touches a settings screen.
 *
 * The model is seeded here too, and for a different reason: letting it float
 * would make two weekly runs incomparable.
 *
 * `models.chat` now writes the box's model policy (`agentModel` in
 * `config/box.json`), so it pins CHAT AND THE REACTOR — intake, the email→task
 * step this tier exists to watch, and every other reactor invocation. The
 * scenario field keeps its old name for now; renaming it to `models.box` is
 * tracked separately.
 */

import * as path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { isRecord } from "../lib/is-record.js";
import { clearBoxConfigCache } from "../core/box/config.js";
import { errnoCode } from "../lib/error-guards.js";
import { writeFileAtomic } from "../lib/atomic-write.js";
import { commit, getStatus, stageAll } from "../lib/git.js";
import type { FieldBox } from "./run-box.js";
import type { FieldScenario } from "./scenario.js";

/** The box's existing config, or an empty one when the box has none yet. */
async function readBoxConfigJson(configPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`Field-test seed could not read ${configPath}; rewriting it from scratch:`, e);
    }
    return {};
  }
}

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

  // Part of the committed baseline, so a `reset` mid-run rewinds onto the same
  // model the run started with rather than dropping the pin.
  const configPath = path.join(box.boxRoot, "config/box.json");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFileAtomic(configPath, {
    content: `${JSON.stringify({ ...(await readBoxConfigJson(configPath)), agentModel: scenario.models.chat }, null, 2)}\n`,
  });
  clearBoxConfigCache(box.boxRoot);

  const status = await getStatus(box.packageRoot);
  if (status.clean) return;
  await stageAll(box.packageRoot);
  await commit(box.packageRoot, {
    message: `Field-test setup for ${scenario.name}`,
    trailers: { "Created-By": "cb field-test" },
  });
}
