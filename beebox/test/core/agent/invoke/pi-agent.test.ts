// # The pi batch agent
//
// A pi run ends completed, interrupted, at a limit, or failed, and maps to the
// same `AgentResult` the other engines return (docs/plans/pi-box-engine.md,
// Track 4). A structured run answers through a `submit_result` tool, with one
// follow-up when the model answers in prose. Edits the box validator rejects
// are steered back to the model and fail the run if they still stand. pi's
// `faux` provider stands in for OpenRouter: nothing here spends.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider, fauxToolCall, type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createPiAgent } from "../../../../src/core/agent/invoke/pi-agent.js";
import type { AgentInvokeOptions } from "../../../../src/core/agent/types.js";
import { clearOpenRouterCatalogCache } from "../../../../src/core/openrouter-catalog.js";
import { grantSecret, setSecret } from "../../../../src/core/secrets/lifecycle.js";
import { queryUsage, syncUsage } from "../../../../src/core/usage.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const MODEL = "test/faux";
const faux = fauxProvider({ provider: "openrouter", models: [{ id: MODEL }] });
// faux prices every message at 0; tests set what pi's provider would report.
let costPerMessage = 0;
function costed(inner: AssistantMessageEventStream): AssistantMessageEventStream {
  const outer = createAssistantMessageEventStream();
  void (async () => {
    for await (const event of inner) {
      if (event.type === "done") event.message.usage.cost.total = costPerMessage;
      outer.push(event);
    }
    outer.end();
  })();
  return outer;
}
const deps = {
  createRuntime: async ({ authPath }: { authPath: string }) => {
    const runtime = await ModelRuntime.create({ authPath, modelsPath: null });
    const { provider } = faux;
    runtime.registerNativeProvider({
      ...provider,
      stream: (...args: Parameters<typeof provider.stream>) => costed(provider.stream(...args)),
      streamSimple: (...args: Parameters<typeof provider.streamSimple>) => costed(provider.streamSimple(...args)),
    });
    return runtime;
  },
  // An added model pi's catalog lacks is looked up here; this listing has no prices.
  fetch: async () => new Response(JSON.stringify({ data: [{ id: "acme/unpriced", name: "Unpriced", context_length: 8192, pricing: {} }] })),
};

async function piBox(t: Test, config?: object) {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  costPerMessage = 0;
  const openrouterModels = [{ id: MODEL, label: "Faux" }, { id: "acme/unpriced", label: "Unpriced" }];
  await writeFile(join(box.root, "_config/box.json"), JSON.stringify({ openrouterModels, ...(config ?? { agentModel: MODEL }) }));
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  const invoke = (options?: Partial<AgentInvokeOptions>): AgentInvokeOptions => ({ boxRoot: box.root, prompt: "go", ...options });
  return { box, invoke };
}

const bash = (command: string) => fauxAssistantMessage(fauxToolCall("bash", { command }));

void test("a completed run returns its text, records its session, and feeds the usage database", async (t) => {
  const { box, invoke } = await piBox(t);
  const agent = createPiAgent({ name: "pi-test" }, deps);
  faux.setResponses([bash("echo hi"), fauxAssistantMessage("All done.")]);
  const result = await agent.invoke(invoke({ systemPrompt: "SYSTEM-1" }));
  t.check(result, {
    success: true, exitCode: 0, sessionId: agent.sessionId ?? "", resultText: "All done.", structuredOutput: undefined,
    output: "[bash]\nAll done.\npi estimated cost: $0.0000\n",
  });
  t.check(await readFile(join(box.root, "_bookkeeping/usage/session-manifest.jsonl"), "utf8"),
    str`{"sessionId":"${result.sessionId}","task":"pi-test","timestamp":"${any(String)}"}\n`);
  await syncUsage(box.root);
  t.check(queryUsage(box.root, "SELECT session_id, task, model, message_count FROM usage"), [
    { session_id: result.sessionId, task: "pi-test", model: MODEL, message_count: 2 },
  ]);

  // A resume reopens the same session, under the cwd it was created in, with the carried model.
  faux.setResponses([fauxAssistantMessage("Again.")]);
  const resumed = await agent.invoke(invoke({ cwd: join(box.root, "_content") }));
  t.check({ success: resumed.success, sessionId: resumed.sessionId, resultText: resumed.resultText }, {
    success: true, sessionId: result.sessionId, resultText: "Again.",
  });
});

// An OpenRouter 402 or 429 is an ordinary failure: no availability entry.
void test("a provider error fails the run with the provider's message", async (t) => {
  const { invoke } = await piBox(t);
  faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "402 Insufficient credits" })]);
  const result = await createPiAgent({ name: "pi-test" }, deps).invoke(invoke());
  t.check(result, {
    success: false, exitCode: 1, error: "402 Insufficient credits", invocationFailure: true,
    sessionId: any(String), output: any(String), resultText: "", structuredOutput: undefined,
  });
});

void test("the caller's signal interrupts a run", async (t) => {
  const { invoke } = await piBox(t);
  const controller = new AbortController();
  faux.setResponses([() => {
    controller.abort();
    return bash("echo one");
  }, fauxAssistantMessage("never")]);
  const result = await createPiAgent({ name: "pi-test" }, deps).invoke(invoke({ signal: controller.signal }));
  t.check({ success: result.success, error: !result.success && result.error, pending: faux.getPendingResponseCount() }, {
    success: false, error: "pi run was interrupted", pending: 1,
  });
});

void test("maxTurns lets the last allowed turn finish and starts no request after it", async (t) => {
  const { invoke } = await piBox(t);
  faux.setResponses([bash("echo 1"), bash("echo 2"), bash("echo 3"), fauxAssistantMessage("done")]);
  const result = await createPiAgent({ name: "pi-test" }, deps).invoke(invoke({ maxTurns: 2 }));
  t.check({ error: !result.success && result.error, pending: faux.getPendingResponseCount() }, {
    error: "pi run reached its turn limit (2)", pending: 2,
  });
});

void test("a budget refuses an unpriced model up front and stops once the estimate passes it", async (t) => {
  const { invoke } = await piBox(t);
  clearOpenRouterCatalogCache();
  t.teardown(clearOpenRouterCatalogCache);
  const refused = await createPiAgent({ name: "pi-test" }, deps).invoke(invoke({ model: "acme/unpriced", maxBudgetUsd: 1 }));
  t.check(refused, {
    success: false, exitCode: -1, sessionId: "", output: "", invocationFailure: true,
    error: "This run has a spending limit, but OpenRouter lists no price for the model acme/unpriced, so pi cannot "
      + "estimate its cost. Pick another model in Admin → OpenRouter models.",
  });

  costPerMessage = 0.6;
  faux.setResponses([bash("echo 1"), bash("echo 2"), fauxAssistantMessage("done")]);
  const stopped = await createPiAgent({ name: "pi-test" }, deps).invoke(invoke({ maxBudgetUsd: 1 }));
  t.check({ error: !stopped.success && stopped.error, pending: faux.getPendingResponseCount() }, {
    error: "pi run passed its budget: estimated $1.2000 of $1.0000", pending: 1,
  });
});

void test("a box with no chosen default refuses before opening a session", async (t) => {
  const { box, invoke } = await piBox(t, {});
  const result = await createPiAgent({ name: "pi-test" }, deps).invoke(invoke());
  t.check(result, {
    success: false, exitCode: -1, sessionId: "", output: "", invocationFailure: true,
    error: str`This box runs the pi engine, ${any(String)}`,
  });
  t.check(await box.list(".beebox/pi"), "");
});

// ## Structured results
const Verdict = z.object({ verdict: z.enum(["yes", "no"]) });
const submit = (args: { verdict: string }) => fauxAssistantMessage(fauxToolCall("submit_result", args));

void test("a structured run answers through submit_result, with one follow-up after prose", async (t) => {
  const { invoke } = await piBox(t);
  const structured = async () => {
    const result = await createPiAgent({ name: "pi-test" }, deps).invokeStructured(Verdict, invoke({ tools: [] }));
    return { data: result.data, error: result.success ? null : result.error };
  };
  faux.setResponses([submit({ verdict: "yes" })]);
  t.check(await structured(), { data: { verdict: "yes" }, error: null });

  faux.setResponses([fauxAssistantMessage("I think yes."), submit({ verdict: "no" })]);
  t.check(await structured(), { data: { verdict: "no" }, error: null });

  faux.setResponses([fauxAssistantMessage("I think yes."), fauxAssistantMessage("Still prose."), submit({ verdict: "no" })]);
  t.check(await structured(), { data: null, error: "model did not return a structured result" });
  t.check(faux.getPendingResponseCount(), 1);

  // No follow-up after a limit.
  faux.setResponses([bash("echo 1"), submit({ verdict: "no" })]);
  const limited = await createPiAgent({ name: "pi-test" }, deps).invokeStructured(Verdict, invoke({ maxTurns: 1 }));
  t.check({ error: limited.success ? null : limited.error, pending: faux.getPendingResponseCount() }, {
    error: "pi run reached its turn limit (1)", pending: 1,
  });
});

// ## Validation
void test("an invalid edit is steered back to the model, and fails the run if it still stands", async (t) => {
  const { box, invoke } = await piBox(t);
  let steered = "";
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("write", { path: "CLAUDE.md", content: "# Notes\n" })),
    (context) => {
      const last = context.messages.at(-1);
      if (last?.role === "user" && typeof last.content !== "string") {
        steered = last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      }
      return fauxAssistantMessage("Leaving it.");
    },
  ]);
  const result = await createPiAgent({ name: "pi-test" }, deps).invoke(invoke());
  const finding = "CLAUDE.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.";
  t.check(steered, `Bee Box validation failed for ${join(box.root, "CLAUDE.md")}:\n${finding}\n`
    + "Fix the file before you finish; the run fails if this still stands.");
  t.check({ success: result.success, error: !result.success && result.error, output: result.output }, {
    success: false, error: "pi edits failed Bee Box validation", output: str`${any(String)}Bee Box validation failed:\n${finding}\n${any(String)}`,
  });
});
