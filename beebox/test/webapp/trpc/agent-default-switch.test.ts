// # Automatic recovery never moves a box to or from pi
//
// When a box's default engine cannot run, recovery picks another that can:
// Claude Code, then Codex, then an added OpenRouter model on the claude engine.
// pi is never a source or a target (boxholder, 2026-10-29: "if someone wants pi
// then they want pi"). A pi box stays on pi and shows why it cannot run.
//
// `reconcileDefaultEngine` cannot run on a pi box until the config guard is
// removed (docs/plans/pi-box-engine.md, Track 6), so this checks its target
// choice directly.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { pickTarget } from "../../../src/webapp/trpc/agent-default-switch.js";
import type { AgentReadiness } from "../../../src/core/agent/readiness.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const allReady: AgentReadiness = {
  claude: "ready",
  codex: "ready",
  openrouter: "ready",
  anyReady: true,
  defaultReady: false,
};

void test("A pi box is never moved, and no box is moved to pi", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await box.write("_config/box.json", JSON.stringify({ openrouterModels: [{ id: "qwen/qwen3-coder", label: "Qwen3 Coder" }] }));

  t.check(await pickTarget(box.root, { readiness: allReady, current: "pi" }), null);

  // With only OpenRouter ready, a claude or codex box moves to the added model on
  // the claude engine, the same as before pi existed.

  const onlyOpenRouter: AgentReadiness = { ...allReady, claude: "not-ready", codex: "not-ready" };
  t.check([
    await pickTarget(box.root, { readiness: onlyOpenRouter, current: "claude" }),
    await pickTarget(box.root, { readiness: onlyOpenRouter, current: "codex" }),
  ], [
    { agentEngine: "claude", agentModel: "qwen/qwen3-coder" },
    { agentEngine: "claude", agentModel: "qwen/qwen3-coder" },
  ]);
});
