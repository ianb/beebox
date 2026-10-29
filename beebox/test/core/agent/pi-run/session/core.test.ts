// # The pi session factory
//
// One factory makes every pi session (docs/plans/pi-box-engine.md, Track 3):
// the box's guidance in its prompt, the run's tools and never grep/find, a
// shell with the box agent's environment rather than the server's, and a
// model built from OpenRouter's listing when pi's catalog lacks it. pi's
// `faux` provider stands in for OpenRouter, so nothing here spends or leaves
// the machine.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { defineTool, ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { NESTED_AGENTS_LINE } from "../../../../../src/core/agent/pi-run/session/context.js";
import { lookupPiModel, piBundledCatalog, resolvePiModel } from "../../../../../src/core/agent/pi-run/session/model.js";
import { piSessionsDir } from "../../../../../src/core/pi-sessions.js";
import { openPiSession, piRuntimeOptions, type PiSessionOptions } from "../../../../../src/core/agent/pi-run/session/core.js";
import { getOrCreateAgentToken } from "../../../../../src/core/agent/token.js";
import { clearOpenRouterCatalogCache } from "../../../../../src/core/openrouter-catalog.js";
import { grantSecret, setSecret } from "../../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../../src/lib/box-slug.js";
import { makeTmpBox, type TmpBox } from "../../../../helpers/test-helpers.js";

const MODEL = "test/faux";
const faux = fauxProvider({ provider: "openrouter", models: [{ id: MODEL }] });
// pi's OpenRouter provider replaced by faux: no catalog entry but MODEL exists.
const createRuntime = async (options: CreateModelRuntimeOptions) => {
  const runtime = await ModelRuntime.create(options);
  runtime.registerNativeProvider(faux.provider);
  return runtime;
};
const submit = defineTool({
  name: "submit_result", label: "Submit", description: "Submit the result.", parameters: { type: "object", properties: {} },
  execute: async () => ({ content: [], details: {}, terminate: true }),
});

async function piBox(t: Test): Promise<TmpBox> {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await mkdir(join(box.root, "_config"), { recursive: true });
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify({ openrouterModels: [{ id: MODEL, label: "Faux" }] }));
  await writeFile(join(box.root, "AGENTS.md"), "Root rule ZEBRA-4417.\n\n@notes/included.md\n");
  await mkdir(join(box.root, "notes"), { recursive: true });
  await writeFile(join(box.root, "notes/included.md"), "Included rule OTTER-2210.\n");
  await mkdir(join(box.root, ".agents/skills/rule-cards"), { recursive: true });
  await writeFile(join(box.root, ".agents/skills/rule-cards/SKILL.md"), "---\nname: rule-cards\ndescription: Card rule FROB-77.\n---\nBody.\n");
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  return box;
}

async function open(options: Partial<PiSessionOptions> & { boxRoot: string }) {
  const opened = await openPiSession({ model: MODEL, purpose: "test", ...options }, { createRuntime });
  if (opened.kind !== "session") throw new Error("expected a session");
  return opened;
}

function guidance(prompt: string) {
  return ["ZEBRA-4417", "OTTER-2210", "FROB-77", NESTED_AGENTS_LINE, "SYSTEM-5150"].filter((s) => prompt.includes(s));
}

// A box agent can write `.pi/` and pi's agent dir; a `SYSTEM.md` in either would replace pi's base prompt.
void test("a session carries the box's guidance; loadBoxContext false carries only the system prompt", async (t) => {
  const box = await piBox(t);
  await mkdir(join(box.root, ".pi"), { recursive: true });
  await writeFile(join(box.root, ".pi/SYSTEM.md"), "Project base KESTREL-31.\n");
  await mkdir(join(box.root, ".beebox/pi/agent"), { recursive: true });
  await writeFile(join(box.root, ".beebox/pi/agent/SYSTEM.md"), "Agent-dir base KESTREL-32.\n");
  const full = await open({ boxRoot: box.root, systemPrompt: "SYSTEM-5150" });
  t.teardown(() => full.session.dispose());
  t.check({
    guidance: guidance(full.session.systemPrompt),
    replaced: full.session.systemPrompt.includes("KESTREL"),
    tools: full.session.getActiveToolNames(),
  }, {
    guidance: ["ZEBRA-4417", "OTTER-2210", "FROB-77", NESTED_AGENTS_LINE, "SYSTEM-5150"],
    replaced: false,
    tools: ["read", "bash", "edit", "write", "ls"],
  });
  t.check(full.session.sessionFile, str`${piSessionsDir(box.root)}/${any(String)}_${full.sessionId}.jsonl`);

  const bare = await open({ boxRoot: box.root, systemPrompt: "SYSTEM-5150", loadBoxContext: false });
  t.teardown(() => bare.session.dispose());
  t.check(guidance(bare.session.systemPrompt), ["SYSTEM-5150"]);
});

// pi runs an `auth.json` key that starts with `!` as a shell command, with the
// server's environment. The box can write pi's agent dir, so pi reads no
// credential file; the real runtime is used here, not the faux one.
void test("a box-written auth.json command does not run", async (t) => {
  const box = await piBox(t);
  const catalogModel = "anthropic/claude-haiku-4.5";
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify({ openrouterModels: [{ id: catalogModel, label: "Haiku" }] }));
  const sentinel = join(box.root, "sentinel");
  const command = { type: "api_key", key: `!touch '${sentinel}'` };
  await mkdir(join(box.root, ".beebox/pi/agent"), { recursive: true });
  await writeFile(join(box.root, ".beebox/pi/agent/auth.json"), JSON.stringify({ anthropic: command, openai: command, openrouter: command }));
  const opened = await openPiSession({ boxRoot: box.root, model: catalogModel, purpose: "test" });
  if (opened.kind === "session") opened.session.dispose();
  t.check({ opened: opened.kind, ran: await access(sentinel).then(() => true, () => false) }, { opened: "session", ran: false });
});

// `[]` is a prompt-only pass; grep and find are never offered, because pi
// downloads their binaries on first use; a custom tool is always allowed.
void test("tools follow the invocation, and custom tools are always allowed", async (t) => {
  const box = await piBox(t);
  const tools = async (list: string[] | undefined) => {
    const { session } = await open({ boxRoot: box.root, tools: list, customTools: [submit] });
    t.teardown(() => session.dispose());
    return session.getActiveToolNames();
  };
  t.check(await tools([]), ["submit_result"]);
  t.check(await tools(["read", "grep", "find", "bash"]), ["read", "bash", "submit_result"]);
  t.check(await tools(undefined), ["read", "bash", "edit", "write", "ls", "submit_result"]);
});

void test("the shell sees each box's own environment and not the server's", async (t) => {
  process.env.PI_TEST_SERVER_SECRET = "sentinel-server-secret";
  t.teardown(() => delete process.env.PI_TEST_SERVER_SECRET);
  const shellOutput = async (box: TmpBox) => {
    const { session } = await open({ boxRoot: box.root, env: { PI_TEST_ADDITION: "added" } });
    t.teardown(() => session.dispose());
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("bash", { command: "echo \"secret=${PI_TEST_SERVER_SECRET:-none} token=$BBX_AGENT_TOKEN add=$PI_TEST_ADDITION\"" })),
      fauxAssistantMessage("done"),
    ]);
    await session.prompt("run it");
    return session.messages.flatMap((m) => (m.role === "toolResult" ? m.content : []));
  };
  const [first, second] = [await piBox(t), await piBox(t)];
  t.check(await shellOutput(first), [{ type: "text", text: `secret=none token=${getOrCreateAgentToken(first.root)} add=added\n` }]);
  t.check(await shellOutput(second), [{ type: "text", text: `secret=none token=${getOrCreateAgentToken(second.root)} add=added\n` }]);
});

void test("a dry run reads no key and writes no state; a resume reopens the session by id", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  t.check(await openPiSession({ boxRoot: box.root, model: MODEL, purpose: "test", dryRun: true, tools: [] }), {
    kind: "dry-run", model: MODEL, tools: [],
  });
  t.check(await box.list(".beebox/pi"), "");

  const piHome = await piBox(t);
  const first = await open({ boxRoot: piHome.root });
  faux.setResponses([fauxAssistantMessage("first answer")]);
  await first.session.prompt("hello");
  first.session.dispose();
  const resumed = await open({ boxRoot: piHome.root, resumeSessionId: first.sessionId });
  t.teardown(() => resumed.session.dispose());
  t.check(resumed.sessionId, first.sessionId);
  t.check(resumed.session.getLastAssistantText(), "first answer");
  await t.checkThrows(() => open({ boxRoot: piHome.root, resumeSessionId: "no-such-session" }), "PiSessionNotFoundError");
});

// ## A model pi's catalog lacks is built from OpenRouter's listing
const listing = (entries: object[]) => async () => new Response(JSON.stringify({ data: entries }));
const entry = { name: "Listed", context_length: 131072, top_provider: { max_completion_tokens: 8192 } };

void test("a listed model keeps its reasoning, images and prices; a missing context length refuses", async (t) => {
  clearOpenRouterCatalogCache();
  t.teardown(clearOpenRouterCatalogCache);
  const runtime = await createRuntime(piRuntimeOptions());
  const fetch = listing([
    { ...entry, id: "acme/thinker", supported_parameters: ["tools", "reasoning"], architecture: { input_modalities: ["text", "image"] },
      pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0.0000005" } },
    { ...entry, id: "acme/unpriced", supported_parameters: ["tools"], pricing: {} },
    { ...entry, id: "acme/no-context", context_length: null, pricing: {} },
  ]);
  const resolve = async (id: string) => (await resolvePiModel({ catalog: runtime, id }, { fetch, now: 0 })).model;
  t.check(await resolve("acme/thinker:exacto"), {
    id: "acme/thinker:exacto", name: "Listed", api: "openai-completions", provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1", reasoning: true, input: ["text", "image"],
    cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 }, contextWindow: 131072, maxTokens: 8192,
    compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter", supportsStrictMode: true, sendSessionAffinityHeaders: true },
  });
  t.check((await resolve("acme/unpriced")).cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  await t.checkThrows(
    () => resolve("acme/no-context"),
    "OpenRouterSetupError: This run uses the OpenRouter model acme/no-context, but OpenRouter lists no context length for it, "
      + "so pi cannot build a correct request for it. Pick another model in Admin → OpenRouter models.",
  );
});

// Admin warns from the same lookup, against pi's bundled catalog (no runtime).
void test("admin's lookup says where a model comes from, or what it lacks", async (t) => {
  clearOpenRouterCatalogCache();
  t.teardown(clearOpenRouterCatalogCache);
  const fetch = listing([
    { ...entry, id: "acme/unpriced", supported_parameters: ["tools"], pricing: {} },
    { ...entry, id: "acme/no-context", context_length: null, pricing: {} },
  ]);
  const source = async (id: string) => {
    const found = await lookupPiModel({ catalog: piBundledCatalog(), id }, { fetch, now: 0 });
    return found.source === "listing" ? { source: found.source, pricesKnown: found.pricesKnown } : found.source === "none" ? found : found.source;
  };
  t.check(await source("anthropic/claude-haiku-4.5:nitro"), "pi");
  t.check(await source("acme/unpriced"), { source: "listing", pricesKnown: false });
  t.check(await source("acme/no-context"), { source: "none", missing: "OpenRouter lists no context length for it" });
});
