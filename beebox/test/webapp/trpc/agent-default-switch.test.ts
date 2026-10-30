// # Automatic recovery never moves a box to or from pi
//
// When a box's default engine cannot run, recovery picks another that can:
// Claude Code, then Codex, then an added OpenRouter model on the claude engine.
// pi is never a source or a target (boxholder, 2026-10-29: "if someone wants pi
// then they want pi"). A pi box stays on pi and shows why it cannot run.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { reconcileDefaultEngine } from "../../../src/webapp/trpc/agent-default-switch.js";
import { resetAgentReadinessCache } from "../../../src/core/agent/readiness.js";
import { clearBoxConfigCache } from "../../../src/core/box/config.js";
import { grantSecret, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { createFakeClaudeCli } from "../../../src/services/claude-cli.js";
import { createFakeCodexCli } from "../../../src/services/codex-cli/core.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const qwen = { id: "qwen/qwen3-coder", label: "Qwen3 Coder" };

void test("A pi box is never moved, and no box is moved to pi", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  t.teardown(resetAgentReadinessCache);
  const reconcile = async (config: object, claudeLoggedIn: boolean) => {
    await box.write("_config/box.json", JSON.stringify(config));
    clearBoxConfigCache(box.root);
    resetAgentReadinessCache();
    const result = await reconcileDefaultEngine(box.root, {
      claudeCli: createFakeClaudeCli({ loggedIn: claudeLoggedIn }),
      codexCli: createFakeCodexCli({ status: { kind: "logged-out" } }),
    });
    const saved = JSON.parse(await box.read("_config/box.json"));
    return { switched: result.switched, agentEngine: saved.agentEngine, agentModel: saved.agentModel, pi: result.readiness.pi };
  };

  // No key: the pi box cannot run, Claude Code can, and the box stays on pi.
  t.check(await reconcile({ agentEngine: "pi", agentModel: qwen.id, openrouterModels: [qwen] }, true), {
    switched: false, agentEngine: "pi", agentModel: qwen.id, pi: "needs-key",
  });

  // With only OpenRouter ready, a claude box moves to the added model on the
  // claude engine, the same as before pi existed.
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  t.check(await reconcile({ openrouterModels: [qwen] }, false), {
    switched: true, agentEngine: "claude", agentModel: qwen.id, pi: undefined,
  });
});
