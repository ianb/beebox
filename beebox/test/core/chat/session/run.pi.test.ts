// # A chat on pi
//
// A pi chat runs through the same `ChatSession` as Claude and Codex
// (docs/plans/pi-box-engine.md, Track 6). Each finished assistant message
// carries its pi session entry id, so the turn's end waits for it and an
// immediate history read through the pi store shows it; `<chat-app>` tags in
// the reply change the chat's features; pi's cost reaches the result. pi's
// `faux` provider stands in for OpenRouter: nothing here spends.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, eventually, str } from "@ianbicking/tap-check/check";
import { once } from "node:events";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ChatSession } from "../../../../src/core/chat/session/run/core.js";
import { adaptBackendMessage, type ChatMessage, type ChatSendInput } from "../../../../src/core/chat/session/messages.js";
import { appendHistory } from "../../../../src/core/chat/session/history.js";
import { loadSessionHistory } from "../../../../src/core/chat/session/load-history.js";
import { createPiChatBackend } from "../../../../src/services/claude-chat/pi-chat.js";
import { grantSecret, setSecret } from "../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import { isRecord } from "../../../../src/shared/is-record.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { plainTestPrompt } from "../../../helpers/chat-session-spawner-helpers.js";

const MODEL = "test/faux";
const faux = fauxProvider({ provider: "openrouter", models: [{ id: MODEL, input: ["text"] }] });
const backend = createPiChatBackend({
  createRuntime: async ({ authPath }) => {
    const runtime = await ModelRuntime.create({ authPath, modelsPath: null });
    runtime.registerNativeProvider(faux.provider);
    return runtime;
  },
});

async function piChat(t: Test, initialSessionId?: string) {
  const box = await makeTmpBox({ git: true });
  t.teardown(() => box.cleanup());
  await box.write("_config/box.json", JSON.stringify({ agentEngine: "pi", agentModel: MODEL, openrouterModels: [{ id: MODEL, label: "Faux" }] }));
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  return { box, open: (sessionId?: string) => chat(t, { boxRoot: box.root, sessionId: sessionId ?? initialSessionId }) };
}

function chat(t: Test, { boxRoot, sessionId }: { boxRoot: string; sessionId: string | undefined }) {
  const session = new ChatSession(boxRoot, {
    backend, systemPrompt: plainTestPrompt, skipBootstrap: true, includePartialMessages: true, engine: "pi",
    ...(sessionId === undefined ? {} : { initialSessionId: sessionId }),
    // The chat registry records the engine this way; history reads go by it.
    onSessionIdAssigned: (id) => appendHistory(boxRoot, { sessionId: id, engine: "pi" }),
  });
  t.teardown(() => session.stop());
  const turn = async (input: ChatSendInput, during?: () => void): Promise<ChatMessage[]> => {
    const seen: ChatMessage[] = [];
    const onMessage = (message: ChatMessage): void => {
      seen.push(message);
      if (message.type === "assistant" || message.type === "stream_event") during?.();
    };
    session.on("message", onMessage);
    const done = once(session, "done");
    await session.send(input);
    await done;
    session.off("message", onMessage);
    return seen;
  };
  return { session, turn };
}

/** A message without what varies between runs: snapshot text, deltas, durations. */
function shape(message: ChatMessage) {
  if (message.type === "assistant") return { type: message.type, uuid: message.uuid, content: message.message.content };
  if (message.type === "result") return { ...message, duration_ms: 0 };
  return { type: message.type };
}

/** The streamed text, in the Anthropic delta shape the chat UI reads. */
const streamed = (messages: ChatMessage[]): string => messages.map((message) => {
  const event = message.type === "stream_event" && isRecord(message.event) ? message.event : null;
  return isRecord(event?.delta) && typeof event.delta.text === "string" ? event.delta.text : "";
}).join("");

void test("a turn streams, ends with its entries in history, and applies its features", async (t) => {
  const { box, open } = await piChat(t);
  const { session, turn } = open();
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("bash", { command: "echo hi" }, { id: "call-1" })),
    fauxAssistantMessage("Done. <chat-app narration=\"on\"/>"),
  ]);
  const messages = await turn({ text: "hello" });
  const sessionId = session.getSessionId() ?? "";
  const uuid = any(String);
  t.check(messages.filter((m) => m.type !== "stream_event").map(shape), [
    { type: "system" },
    { type: "user" },
    { type: "assistant", uuid, content: [{ type: "tool_use", id: "call-1", name: "bash", input: { command: "echo hi" } }] },
    { type: "assistant", uuid, content: [{ type: "text", text: "Done. <chat-app narration=\"on\"/>" }] },
    { type: "result", subtype: "completed", session_id: sessionId, is_error: false, duration_ms: 0, num_turns: 1, total_cost_usd: 0 },
  ]);
  t.check(streamed(messages), "Done. <chat-app narration=\"on\"/>");

  // Read at once, as the chat UI does when a turn ends.
  const emitted = messages.flatMap((m) => (m.type === "assistant" && m.uuid !== undefined ? [m.uuid] : []));
  const history = await loadSessionHistory(box.root, { sessionId, slice: { mode: "tail", tail: 20 } });
  t.check(history.entries.filter((entry) => entry.type === "assistant").map((entry) => entry.uuid), emitted);

  await eventually(() => session.getFeatures().narration === "on", { label: "the reply's <chat-app> tag applied" });
});

// The image check uses the model's input modalities, before pi is called.
// A resumed chat reopens the same pi session and the model sees the earlier turn.
void test("an image to a text-only model refuses before any call; a resume continues the session", async (t) => {
  const { box, open } = await piChat(t);
  const first = open();
  faux.setResponses([fauxAssistantMessage("first answer")]);
  await first.turn({ text: "hello" });
  const sessionId = first.session.getSessionId() ?? "";
  const calls = faux.state.callCount;
  const refused = await first.turn({ text: "look [image1]", images: [{ id: 1, mimeType: "image/png", dataBase64: "iVBORw0KGgo=" }] });
  t.check(refused.filter((m) => m.type === "result").map(shape), [{
    type: "result", subtype: "failed", session_id: sessionId, is_error: true, phase: "turn", duration_ms: 0, num_turns: 0,
    result: `${MODEL} does not accept images`,
  }]);
  t.check(faux.state.callCount, calls);
  first.session.stop();

  let context: string[] = [];
  faux.setResponses([(transcript) => {
    context = transcript.messages.flatMap((m) => (m.role === "assistant" ? m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])) : []));
    return fauxAssistantMessage("second answer");
  }]);
  const resumed = open(sessionId);
  await resumed.turn({ text: "again" });
  t.check({ id: resumed.session.getSessionId(), context }, { id: sessionId, context: ["first answer"] });
  t.check((await loadSessionHistory(box.root, { sessionId, slice: { mode: "tail", tail: 20 } })).total, 4);
});

void test("an interrupt ends the turn as interrupted; an invalid edit fails the turn", async (t) => {
  const { box, open } = await piChat(t);
  const { session, turn } = open();
  const calls = faux.state.callCount;
  faux.setResponses([(_context, options) => new Promise((resolve) => {
    const aborted = () => resolve(fauxAssistantMessage("", { stopReason: "aborted" }));
    if (options?.signal?.aborted === true) aborted();
    options?.signal?.addEventListener("abort", aborted);
  })]);
  const stopped = turn({ text: "wait" });
  await eventually(() => faux.state.callCount > calls, { label: "the model call started" });
  void session.interrupt();
  t.check((await stopped).filter((m) => m.type === "result").map(shape), [{
    type: "result", subtype: "interrupted", session_id: any(String), is_error: true, duration_ms: 0, num_turns: 1, total_cost_usd: 0,
  }]);

  faux.setResponses([fauxAssistantMessage(fauxToolCall("write", { path: "CLAUDE.md", content: "# Notes\n" })), fauxAssistantMessage("Leaving it.")]);
  const finding = "CLAUDE.md: Name instruction files AGENTS.md. A CLAUDE.md here makes Claude Code ignore every AGENTS.md.";
  t.check((await turn({ text: "write it" })).filter((m) => m.type === "result").map(shape), [{
    type: "result", subtype: "failed", session_id: any(String), is_error: true, duration_ms: 0, num_turns: 1, total_cost_usd: 0,
    result: str`Bee Box validation failed:\n${finding}${any(String)}`,
  }]);
  t.check(await box.read("CLAUDE.md"), "# Notes\n");
});

// A Claude-engine result on a third-party model loses its cost, because the SDK
// prices it as Claude (test/core/provider-env/openrouter-chat.test.ts). pi's
// result is its own harness's estimate and keeps it.
void test("pi's cost survives the third-party cost strip", async (t) => {
  const result = { type: "result" as const, subtype: "completed", session_id: "s", is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0.0123 };
  t.check(adaptBackendMessage({ provider: "pi", message: result }, { model: MODEL }), result);
});

// `ChatSession` holds a send while a turn runs; the backend itself takes one
// as pi's follow-up, answered in the same run before its one result.
void test("a send while a turn runs is a follow-up in the same run", async (t) => {
  const { box } = await piChat(t);
  const run = backend.start({ engine: "pi", cwd: box.root, boxRoot: box.root, systemPrompt: "chat", env: {}, model: MODEL });
  t.teardown(() => run.close());
  let release = (): void => {};
  faux.setResponses([
    () => new Promise((resolve) => { release = () => resolve(fauxAssistantMessage("one")); }),
    (context) => fauxAssistantMessage(`after ${context.messages.filter((m) => m.role === "user").length} user messages`),
  ]);
  const seen: string[] = [];
  const reading = (async () => {
    for await (const item of run.messages) {
      if (!("provider" in item)) continue;
      const { message } = item;
      if (message.type === "user" || message.type === "assistant") seen.push(message.message.content.map((block) => block.text ?? "").join(""));
      if (message.type === "result") seen.push(`result ${message.subtype}`);
      if (message.type === "result") return;
    }
  })();
  run.send([{ type: "text", text: "first" }]);
  await eventually(() => faux.state.callCount > 0 && faux.getPendingResponseCount() === 1, { label: "the first call is waiting" });
  run.send([{ type: "text", text: "second" }]);
  await eventually(() => seen.includes("second"), { label: "the follow-up is queued" });
  release();
  await reading;
  t.check(seen, ["first", "second", "one", "after 2 user messages", "result completed"]);
});
