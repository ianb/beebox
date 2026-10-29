// # Admin: adding and removing OpenRouter chat models
//
// Adding a model in admin is the only way a box can run one
// (`docs/plans/openrouter-chat-models.md`). The add is checked against
// OpenRouter's catalog; removal refuses while the model is the box default or small model. The
// catalog and key responses here are the recorded fixtures, served through the
// `openrouterFetch` service so nothing leaves the machine.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { containing } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { makeTestServer } from "../../../helpers/test-route-server.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";
import { clearOpenRouterCatalogCache } from "../../../../src/core/openrouter-catalog.js";
import { grantSecret, setSecret } from "../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import type { TestServer } from "../../../helpers/test-route-server.js";

const fixture = async (name: string) => readFile(new URL(`../../../fixtures/openrouter/${name}`, import.meta.url), "utf8");
const models = await fixture("models.json");
const key = await fixture("key.json");
let catalog = models;
async function openrouterFetch(url: string) {
  return new Response(url.endsWith("/key") ? key : catalog, { status: 200 });
}

function caller(server: TestServer, opts?: { isOwner?: boolean }) {
  return appRouter.createCaller(trpcContext({
    boxRoot: server.boxRoot,
    eventBus: server.eventBus,
    services: { openrouterFetch },
    isOwner: opts?.isOwner !== false,
  }));
}

async function message(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ## An empty box: no models, no key
void test("An empty box: no models, no key", async (t) => {
  t.teardown(async () => {
    try {
      await server.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
  clearOpenRouterCatalogCache();
  const server = await makeTestServer();
  t.check(await caller(server).admin.openrouterModels(), {
    keyGranted: false,
    usage: null,
    models: [],
  });

  // ## Adding validates against the catalog
  //
  // A typo, an id OpenRouter does not carry, and a model with no tool calling are
  // all refused here, before any chat could try them.

  t.check(await message(() => caller(server).admin.addOpenrouterModel({ id: "DeepSeek V3", label: "x" })), "Enter an OpenRouter model id like deepseek/deepseek-v3.2 (lowercase, author/model) and a label of at most 60 characters.");

  t.check(await message(() => caller(server).admin.addOpenrouterModel({ id: "deepseek/not-a-model", label: "x" })), "OpenRouter has no model deepseek/not-a-model. Check the id on openrouter.ai/models.");

  t.check(await message(() => caller(server).admin.addOpenrouterModel({ id: "inference-net/schematron-v2-turbo", label: "x" })), "inference-net/schematron-v2-turbo does not support tool calling, which every chat and agent turn needs.");

  // A valid model is saved with its label and listed with its price.

  await caller(server).admin.addOpenrouterModel({ id: "moonshotai/kimi-k2-0905:exacto", label: " Kimi K2 " });
  clearBoxConfigCache(server.boxRoot);
  const listed = (await caller(server).admin.openrouterModels()).models[0];
  assert.ok(listed);
  t.check(listed, {
    id: "moonshotai/kimi-k2-0905:exacto",
    label: "Kimi K2",
    catalog: {
      ok: true,
      found: true,
      model: {
        id: "moonshotai/kimi-k2-0905:exacto",
        name: "MoonshotAI: Kimi K2 0905",
        contextLength: 262144,
        maxCompletionTokens: 98304,
        supportsTools: true,
        supportedParameters: containing<string>(["tools"]),
        inputModalities: ["text"],
        pricing: { promptPerMTok: 0.6, completionPerMTok: 2.5, cacheReadPerMTok: null },
      },
    },
    piWarning: null,
  });

  // ## The added model can be the box default, and then cannot be removed

  await caller(server).admin.updateBoxConfig({ agentModel: "moonshotai/kimi-k2-0905:exacto" });
  clearBoxConfigCache(server.boxRoot);
  t.check((await caller(server).admin.boxConfig()).agentModel, "moonshotai/kimi-k2-0905:exacto");

  t.check(await message(() => caller(server).admin.removeOpenrouterModel({ id: "moonshotai/kimi-k2-0905:exacto" })), "moonshotai/kimi-k2-0905:exacto is this box's default model. Change the default model first, then remove it.");

  // An id that was never added cannot become the default.

  t.check(await message(() => caller(server).admin.updateBoxConfig({ agentModel: "qwen/qwen3-coder" })), "Unknown model id qwen/qwen3-coder");

  // The small model is guarded the same way: background passes on an
  // OpenRouter-default box run on it, and removing it would send them to Claude.

  await caller(server).admin.updateBoxConfig({ agentModel: null });
  const configPath = join(server.boxRoot, "_config/box.json");
  const withSmall = JSON.parse(await readFile(configPath, "utf8"));
  await writeFile(configPath, JSON.stringify({ ...withSmall, smallModel: "moonshotai/kimi-k2-0905:exacto" }));
  clearBoxConfigCache(server.boxRoot);
  t.check(await message(() => caller(server).admin.removeOpenrouterModel({ id: "moonshotai/kimi-k2-0905:exacto" })), "moonshotai/kimi-k2-0905:exacto is this box's small model (smallModel in _config/box.json), used for chat titles, reviews and other quick background passes. Change it first, then remove it.");

  // Once neither slot names it, removal works and the list is empty again.

  await writeFile(configPath, JSON.stringify(withSmall));
  clearBoxConfigCache(server.boxRoot);
  await caller(server).admin.removeOpenrouterModel({ id: "moonshotai/kimi-k2-0905:exacto" });
  clearBoxConfigCache(server.boxRoot);
  t.check((await caller(server).admin.openrouterModels()).models, []);

  // ## With a key: the key's usage, and the picker sees added models
  //
  // `chat.status` offers added models only when the key is usable — rows whose
  // every run would refuse are noise.

  await caller(server).admin.addOpenrouterModel({ id: "qwen/qwen3-coder", label: "Qwen3 Coder" });
  clearBoxConfigCache(server.boxRoot);
  t.check((await caller(server).chat.status({})).addedModels, []);

  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(server.boxRoot), name: "openrouter", access: "server" });
  t.check((await caller(server).chat.status({})).addedModels, [
    {
      id: "qwen/qwen3-coder",
      label: "Qwen3 Coder",
    },
  ]);

  const withKey = await caller(server).admin.openrouterModels();
  t.check(withKey, {
    keyGranted: true,
    usage: {
      ok: true,
      usage: {
        totalUsd: 4.753326683,
        monthUsd: 4.753326683,
        limitUsd: 10,
        limitRemainingUsd: 5.246673317,
        limitReset: "monthly",
      },
    },
    models: [
      {
        id: "qwen/qwen3-coder",
        label: "Qwen3 Coder",
        catalog: {
          ok: true,
          found: true,
          model: {
            id: "qwen/qwen3-coder",
            name: "Qwen: Qwen3 Coder 480B A35B",
            contextLength: 262144,
            maxCompletionTokens: 65536,
            supportsTools: true,
            supportedParameters: containing<string>(["tools"]),
            inputModalities: ["text"],
            pricing: { promptPerMTok: 0.3, completionPerMTok: 1, cacheReadPerMTok: 0.1 },
          },
        },
        piWarning: null,
      },
    ],
  });

  // ## On a box that can run pi, a model pi's catalog lacks is flagged
  //
  // Quiet while pi is off; once pi is enabled, the row says pi builds the
  // model from OpenRouter's listing, and that an unlisted price counts as $0.

  const { data } = z.object({ data: z.array(z.record(z.string(), z.unknown())) }).parse(JSON.parse(models));
  const qwen = data.find((m) => m.id === "qwen/qwen3-coder");
  catalog = JSON.stringify({ data: [...data, { ...qwen, id: "acme/not-in-pi", pricing: {} }] });
  clearOpenRouterCatalogCache();
  t.teardown(() => { catalog = models; });
  await caller(server).admin.addOpenrouterModel({ id: "acme/not-in-pi", label: "Acme" });
  clearBoxConfigCache(server.boxRoot);
  const warnings = async () => (await caller(server).admin.openrouterModels()).models.map((m) => [m.id, m.piWarning]);
  t.check(await warnings(), [["qwen/qwen3-coder", null], ["acme/not-in-pi", null]]);
  await caller(server).admin.updateBoxConfig({ engines: { claude: true, pi: true } });
  clearBoxConfigCache(server.boxRoot);
  t.check(await warnings(), [
    ["qwen/qwen3-coder", null],
    ["acme/not-in-pi", "pi has no built-in settings for this model, so it uses OpenRouter's listing. OpenRouter lists no price for it, so pi counts its cost as $0."],
  ]);

  // ## Owner only

  t.check(await message(() => caller(server, { isOwner: false }).admin.addOpenrouterModel({ id: "qwen/qwen3-coder", label: "x" })), "Owner access required");
});
