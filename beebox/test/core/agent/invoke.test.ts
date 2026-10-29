// # Agent engine selection
//
// `createAgent()` selects one native harness from `_config/box.json` on its first
// invocation. Existing boxes have no setting and continue to use Claude. The
// selected delegate remains fixed for the lifetime of that agent.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createAgent } from "../../../src/core/agent/invoke/core.js";
import { clearBoxConfigCache } from "../../../src/core/box/config.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

async function setEngine(boxRoot: string, agentEngine: unknown): Promise<void> {
  const configDir = path.join(boxRoot, "_config");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "box.json"), JSON.stringify({ agentEngine }));
  clearBoxConfigCache(boxRoot);
}

// ## Existing boxes default to Claude
//
// The dry-run banner identifies the selected harness without starting either
// vendor subprocess.
void test("The dry-run banner identifies the selected harness without starting either ve...", async (t) => {
  const box = await makeTmpBox();
  const agent = createAgent({ name: "selection-test" });
  const result = await agent.invoke({ boxRoot: box.root, prompt: "hello", dryRun: true });

  t.check(result, { success: true, output: "[DRY RUN] Would run Claude via SDK with prompt:\nhello", exitCode: 0, sessionId: "" });

  await box.cleanup();
});

// ## A box can select Codex
void test("A box can select Codex", async (t) => {
  const box = await makeTmpBox();
  await setEngine(box.root, "codex");
  const agent = createAgent({ name: "selection-test" });
  const result = await agent.invoke({ boxRoot: box.root, prompt: "hello", dryRun: true });

  t.check(result, { success: true, output: "[DRY RUN] Would run Codex SDK with prompt:\nhello", exitCode: 0, sessionId: "" });

  await box.cleanup();
});

// ## An unknown engine fails before agent invocation
//
// Configuration errors never fall back silently to a different vendor.
void test("Configuration errors never fall back silently to a different vendor.", async (t) => {
  const box = await makeTmpBox();
  await setEngine(box.root, "mystery");
  const agent = createAgent({ name: "selection-test" });

  await t.checkThrows(async () => (await agent.invoke({ boxRoot: box.root, prompt: "hello", dryRun: true })), "InvalidAgentEngineError: Box config agentEngine must be either claude or codex");

  await box.cleanup();
});

// ## pi is a known engine but cannot be selected yet
//
// Until pi's chat backend lands (docs/plans/pi-box-engine.md, Track 6), a box
// config naming pi is refused rather than run on another engine.
void test("A box config naming pi is refused rather than run on another engine.", async (t) => {
  const box = await makeTmpBox();
  await setEngine(box.root, "pi");
  const agent = createAgent({ name: "selection-test" });

  await t.checkThrows(async () => (await agent.invoke({ boxRoot: box.root, prompt: "hello", dryRun: true })), "EngineNotImplementedError: the pi engine is not available yet (box config agentEngine)");

  await box.cleanup();
});
