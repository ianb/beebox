// # A pi box must name an added default model
//
// pi has no model of its own, so the admin write refuses a pi box whose
// default is not one of its added OpenRouter models
// (docs/plans/pi-box-engine.md, Track 2). Until pi's chat backend lands, the
// write also refuses selecting pi at all; both checks apply. A pi config can
// still arrive by hand edit, which is where the default rule is reachable now.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { resolveProcedureModel } from "../../../../src/shared/agent-models.js";

const qwen = { id: "qwen/qwen3-coder", label: "Qwen3 Coder" };
const deepseek = { id: "deepseek/deepseek-chat-v3.1", label: "DeepSeek v3.1" };

void test("a pi box's default model must be one it added", async (t) => {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  const admin = appRouter.createCaller(trpcContext({
    boxRoot: box.root,
    user: { email: "owner@example.com", name: "Owner" },
    isAuthenticatedOwner: true,
  })).admin;
  type Input = Parameters<typeof admin.updateBoxConfig>[0];
  const save = (input: Input) => admin.updateBoxConfig(input).then(
    (r) => `saved: ${r.agentEngine} ${r.agentModel ?? "no default"}`,
    (error) => `${error.code}: ${error.message}`,
  );
  const saved = async () => JSON.parse(await box.read("_config/box.json"));

  // Selecting pi is refused by the Track 1 guard, even with an added default.
  await box.write("_config/box.json", JSON.stringify({ openrouterModels: [qwen, deepseek] }));
  t.check(await save({ agentEngine: "pi", agentModel: qwen.id }), "BAD_REQUEST: the pi engine is not available yet (selecting it for a box)");

  // On a hand-edited pi box, a write that clears the default or sets one pi
  // cannot run is refused, and the file is left as it was.
  const piConfig = { agentEngine: "pi", agentModel: qwen.id, openrouterModels: [qwen, deepseek] };
  await box.write("_config/box.json", JSON.stringify(piConfig));
  const refused = "BAD_REQUEST: The pi engine runs only models added in Admin → OpenRouter models. Choose one of them as the default model in the same save.";
  t.check([
    await save({ agentModel: null }),
    await save({ agentModel: resolveProcedureModel({ engine: "claude", model: "strong" }) }),
  ], [refused, refused]);
  t.check(await saved(), piConfig);

  // Another added model is a valid default.
  t.check(await save({ agentModel: deepseek.id }), "saved: pi deepseek/deepseek-chat-v3.1");

  // A save that touches neither the engine nor the model is not blocked by a
  // pi box that lacks a default.
  await box.write("_config/box.json", JSON.stringify({ agentEngine: "pi", openrouterModels: [qwen] }));
  t.check(await save({ allowedEmails: ["member@example.com"] }), "saved: pi no default");
});
