/**
 * Live smoke for the pi engine on real OpenRouter models. Rerun after each pi
 * upgrade (docs/pi-engine.md, "Upgrade"); it is not part of the test suite.
 *
 *   pnpm pi-smoke [--dir <parent>] [model ...]
 *
 * With no model, it runs DEFAULT_MODELS. It stops once pi's estimated spend
 * passes COST_CAP_USD.
 *
 * Each model runs five cases against a throwaway box: a batch turn that reads a
 * file, a structured call, a resume, a chat-backend turn read back through the
 * pi session store, and a bash call that must not see a server-only variable.
 *
 * Key handling: box code reads the OpenRouter key from the machine secret
 * store through a per-box grant. This script never touches that store. It
 * points `BBX_SECRETS_FILE` at a store in the throwaway directory holding a
 * placeholder value granted to the throwaway box, so the production grant check
 * runs unchanged. The real key, `BBX_OPENROUTER_API_KEY` from the environment
 * or `beebox/.env`, reaches pi only in memory, through the `createRuntime`
 * seam the tests use for pi's `faux` provider.
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { z } from "zod";
import { ModelRuntime, type CreateModelRuntimeOptions } from "@earendil-works/pi-coding-agent";
import { createPiAgent } from "../core/agent/invoke/core.js";
import type { AgentResult } from "../core/agent/types.js";
import { scaffoldBoxRoot } from "../core/box/package.js";
import { SESSION_STORES } from "../core/chat/session/native-store.js";
import { grantSecret, setSecret } from "../core/secrets/lifecycle.js";
import { boxSlug } from "../lib/box-slug.js";
import { errnoCode } from "../shared/error-guards.js";
import { createPiChatBackend } from "../services/claude-chat/core.js";

const KEY_NAME = "BBX_OPENROUTER_API_KEY";
/**
 * One model pi runs with reasoning on and one with it off. Not
 * `deepseek/deepseek-chat-v3.1`: at pi's default thinking level it writes its
 * tool calls into its reasoning text, so no tool runs.
 */
const DEFAULT_MODELS = ["deepseek/deepseek-v3.2", "qwen/qwen3-coder"];
const COST_CAP_USD = 0.25;
const PLACEHOLDER_KEY = "pi-smoke-placeholder";
const SENTINEL_NAME = "BBX_PI_SMOKE_SENTINEL";
const SENTINEL_VALUE = `server-only-${process.pid}`;

/** pi's estimated spend across every model run so far. */
let spentSoFar = 0;

/** The session handed pi a key other than the scratch store's placeholder. */
class UnexpectedKeyError extends Error {
  constructor() {
    super("pi-smoke: the session did not pass the scratch store's placeholder key");
    this.name = "UnexpectedKeyError";
  }
}

interface CaseResult {
  name: string;
  ok: boolean;
  costUsd: number;
  detail: string;
}

async function openRouterKey(): Promise<string | null> {
  const fromEnv = process.env[KEY_NAME];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const envFile = resolve(import.meta.dirname, "../../.env");
  let text: string;
  try {
    text = await readFile(envFile, "utf8");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw error;
  }
  const value = parseEnv(text)[KEY_NAME];
  return value === undefined || value === "" ? null : value;
}

/** pi's real runtime, with the placeholder from the scratch store swapped for the real key in memory. */
function runtimeWithKey(key: string) {
  return {
    createRuntime: async (options: CreateModelRuntimeOptions): Promise<ModelRuntime> => {
      const runtime = await ModelRuntime.create(options);
      const set = runtime.setRuntimeApiKey.bind(runtime);
      runtime.setRuntimeApiKey = async (provider, value) => {
        if (value !== PLACEHOLDER_KEY) throw new UnexpectedKeyError();
        await set(provider, key);
      };
      return runtime;
    },
  };
}

async function makeBox(parent: string, model: string): Promise<string> {
  const root = await mkdtemp(join(parent, "box-"));
  await scaffoldBoxRoot(root);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "pipe" });
  await writeFile(join(root, "_config/box.json"), `${JSON.stringify({
    agentEngine: "pi",
    agentModel: model,
    openrouterModels: [{ id: model, label: model }],
  }, null, 2)}\n`);
  await setSecret({ name: "openrouter", value: PLACEHOLDER_KEY });
  await grantSecret({ slug: await boxSlug(root), name: "openrouter", access: "server" });
  return root;
}

function batchCost(result: AgentResult): number {
  const match = /pi estimated cost: \$([\d.]+)/.exec(result.output);
  return match === null ? 0 : Number(match[1]);
}

function failureText(result: AgentResult | { success: false; error: string } | { success: true }): string {
  return result.success ? "" : ` (${result.error})`;
}

async function runModel({ parent, model, key }: { parent: string; model: string; key: string }): Promise<CaseResult[]> {
  const boxRoot = await makeBox(parent, model);
  console.log(`\n== ${model}\nbox: ${boxRoot}`);
  const deps = runtimeWithKey(key);
  const results: CaseResult[] = [];
  const word = `heron-${String(process.pid).slice(-3)}`;
  await writeFile(join(boxRoot, "_content/smoke-note.txt"), `The code word is ${word}.\n`);

  const cases: Array<[string, () => Promise<CaseResult>]> = [];
  const agent = createPiAgent({ name: "pi-smoke" }, deps);

  cases.push(["batch turn reads a file", async () => {
    const result = await agent.invoke({
      boxRoot,
      prompt: "Read the file _content/smoke-note.txt and reply with only the code word it names.",
    });
    const ok = result.success && (result.resultText ?? "").includes(word);
    return { name: "", ok, costUsd: batchCost(result), detail: `reply ${JSON.stringify((result.resultText ?? "").slice(0, 80))}${failureText(result)}` };
  }]);

  cases.push(["resume remembers", async () => {
    const before = agent.sessionId;
    const result = await agent.invoke({
      boxRoot,
      prompt: "Without using any tools, what was the code word you read earlier? Reply with only the word.",
      tools: [],
    });
    const ok = result.success && result.sessionId === before && (result.resultText ?? "").includes(word);
    return {
      name: "", ok, costUsd: batchCost(result),
      detail: `same session ${String(result.sessionId === before)}, reply ${JSON.stringify((result.resultText ?? "").slice(0, 80))}${failureText(result)}`,
    };
  }]);

  cases.push(["structured call", async () => {
    const schema = z.object({ city: z.string(), population_millions: z.number() });
    const result = await createPiAgent({ name: "pi-smoke-structured" }, deps).invokeStructured(schema, {
      boxRoot,
      prompt: "Give the capital of France and its city population in millions, as the result.",
      tools: [],
    });
    const ok = result.success && /paris/i.test(result.data.city) && result.data.population_millions > 0;
    return { name: "", ok, costUsd: batchCost(result), detail: `data ${JSON.stringify(result.data)}${failureText(result)}` };
  }]);

  cases.push(["bash cannot see a server variable", async () => {
    process.env[SENTINEL_NAME] = SENTINEL_VALUE;
    const result = await createPiAgent({ name: "pi-smoke-bash" }, deps).invoke({
      boxRoot,
      prompt: "Run exactly this command with the bash tool, then reply \"done\":\n"
        + `printf 'ran:%s' "$${SENTINEL_NAME}" > _content/sentinel-out.txt`,
    });
    const written = await readFile(join(boxRoot, "_content/sentinel-out.txt"), "utf8").catch(() => null);
    const ok = result.success && written === "ran:";
    return { name: "", ok, costUsd: batchCost(result), detail: `file ${JSON.stringify(written)}${failureText(result)}` };
  }]);

  cases.push(["chat turn and pi store history", async () => {
    const run = createPiChatBackend(deps).start({
      engine: "pi", cwd: boxRoot, boxRoot, systemPrompt: "You are a terse assistant.", env: {}, model,
    });
    let sessionId = "";
    let costUsd = 0;
    let outcome = "no result";
    try {
      run.send([{ type: "text", text: "Reply with exactly the word: marmalade" }]);
      for await (const item of run.messages) {
        if (!("provider" in item) || item.message.type !== "result") continue;
        const { message } = item;
        sessionId = message.session_id;
        costUsd = message.total_cost_usd ?? 0;
        outcome = message.is_error ? `failed: ${JSON.stringify(message)}` : message.subtype;
        break;
      }
    } finally {
      await run.close();
    }
    const history = sessionId === "" ? null : await SESSION_STORES.pi.readHistory(boxRoot, { sessionId, slice: { mode: "tail", tail: 20 } });
    const assistantText = (history?.entries ?? [])
      .filter((entry) => entry.type === "assistant")
      .flatMap((entry) => entry.content.flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : [])))
      .join(" ");
    const ok = outcome === "completed" && /marmalade/i.test(assistantText);
    return { name: "", ok, costUsd, detail: `result ${outcome}, stored assistant text ${JSON.stringify(assistantText.slice(0, 80))}` };
  }]);

  for (const [name, run] of cases) {
    if (spentSoFar > COST_CAP_USD) {
      results.push({ name, ok: false, costUsd: 0, detail: `skipped: estimated spend passed $${COST_CAP_USD}` });
      continue;
    }
    let result: CaseResult;
    try {
      result = { ...(await run()), name };
    } catch (error) {
      result = { name, ok: false, costUsd: 0, detail: `threw ${error instanceof Error ? error.message : String(error)}` };
    }
    results.push(result);
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${name}  $${result.costUsd.toFixed(4)}  ${result.detail.replaceAll(key, "[key]")}`);
    spentSoFar += result.costUsd;
  }
  return results;
}


async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ options: { dir: { type: "string" } }, allowPositionals: true });
  const key = await openRouterKey();
  if (key === null) {
    console.error(`pi-smoke: set ${KEY_NAME} in the environment or in beebox/.env. It spends real OpenRouter credit (a few cents).`);
    return 2;
  }
  const parent = await mkdtemp(join(values.dir ?? tmpdir(), "pi-smoke-"));
  // A scratch store: the machine secret store is never read or written.
  process.env.BBX_SECRETS_FILE = join(parent, "secrets.json");
  const models = positionals.length > 0 ? positionals : DEFAULT_MODELS;
  console.log(`pi-smoke in ${parent}; stops once the estimate passes $${COST_CAP_USD}`);

  let failed = 0;
  for (const model of models) {
    const results = await runModel({ parent, model, key });
    failed += results.filter((r) => !r.ok).length;
  }
  console.log(`\n${failed === 0 ? "all passed" : `${failed} failed`}; pi estimated cost $${spentSoFar.toFixed(4)}`);
  return failed === 0 ? 0 : 1;
}

process.exit(await main());
