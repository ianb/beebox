// # Readiness of a pi default
//
// pi runs only an added OpenRouter model chosen as the box default, with the
// box's granted `openrouter` key (docs/plans/pi-box-engine.md, Track 2). Its
// readiness names the first piece missing, in the order the spawn gate checks
// them: the default model, then the key.
//
// `piReadiness` reads only the model fields and the key, so these boxes need
// no `agentEngine: "pi"`, which config refuses until pi's chat backend lands.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { piReadiness } from "../../../src/core/agent/readiness.js";
import { clearBoxConfigCache } from "../../../src/core/box/config.js";
import { grantSecret, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { resolveProcedureModel } from "../../../src/shared/agent-models.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const qwen = { id: "qwen/qwen3-coder", label: "Qwen3 Coder" };

void test("a pi default needs an added default model, then the key", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await mkdir(join(box.root, "_config"), { recursive: true });
  const configure = async (config: Record<string, unknown>) => {
    await writeFile(join(box.root, "_config/box.json"), JSON.stringify(config));
    clearBoxConfigCache(box.root);
    return piReadiness(box.root);
  };

  // No default, a Claude default left from the box's claude days, and a
  // default the owner has since removed from the list: none is a pi default.
  t.check([
    await configure({ openrouterModels: [qwen] }),
    await configure({ openrouterModels: [qwen], agentModel: resolveProcedureModel({ engine: "claude", model: "strong" }) }),
    await configure({ agentModel: qwen.id }),
  ], ["needs-default-model", "needs-default-model", "needs-default-model"]);

  t.check(await configure({ openrouterModels: [qwen], agentModel: qwen.id }), "needs-key");

  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  t.check(await piReadiness(box.root), "ready");
});
