/**
 * SDK steering-behavior probe. Run after every `@anthropic-ai/claude-agent-sdk`
 * bump (`pnpm update-agent-sdk` reminds you):
 *
 *   node --import tsx callback-box/scripts/sdk-steering-probe.ts
 *
 * The chat mid-turn steering design (see docs/chat-session-lifecycle.md) leans
 * on CLI behavior that is observable but NOT a documented SDK contract:
 *
 *   1. A user message pushed onto the streaming input while a turn is running
 *      is injected at the next model step of the SAME turn (steering).
 *   2. A message that races the turn boundary (arrives with no model step left)
 *      auto-starts a fresh turn — it is never lost.
 *   3. `priority: "now"` soft-interrupts (ends the turn at the next step
 *      boundary, answers in a fresh turn); `priority: "later"` waits for the
 *      turn to finish. Both deliver.
 *
 * Each scenario makes real API calls (a couple of short agent turns each,
 * ~30-60s total). Exit 0 = behavior holds; exit 1 = a scenario failed, meaning
 * an SDK bump changed the semantics chat steering depends on — investigate
 * before shipping the bump.
 */

import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAsyncIterableQueue } from "../src/services/claude-chat-queue.js";
import { resolveClaudeCodeBinary } from "../src/core/sdk-binary-path.js";

interface Scenario {
  name: string;
  firstMessage: string;
  steerMessage: string;
  /** When to push the steer message into the running turn. */
  pushOn: "tool-running" | "text-delta";
  priority?: "now" | "later";
  /** Require the steer answer inside the first turn (the steering contract). */
  expectSameTurn?: boolean;
}

const SLEEP_TASK =
  "Run the Bash command `sleep 8` (a single 8-second sleep). When it completes, reply with exactly: FIRST-DONE";
const STEER = "Also include the single word STEERED in your reply.";

const SCENARIOS: Scenario[] = [
  { name: "steer (mid-tool push → same-turn injection)", firstMessage: SLEEP_TASK, steerMessage: STEER, pushOn: "tool-running", expectSameTurn: true },
  { name: "boundary race (push mid-final-generation → own turn, not lost)", firstMessage: "Without using any tools, write a ~120-word story about a lighthouse.", steerMessage: "Reply with the single word STEERED.", pushOn: "text-delta" },
  { name: "priority now (soft interrupt, not lost)", firstMessage: SLEEP_TASK, steerMessage: STEER, pushOn: "tool-running", priority: "now" },
  { name: "priority later (queued to own turn, not lost)", firstMessage: SLEEP_TASK, steerMessage: STEER, pushOn: "tool-running", priority: "later" },
];

const SCENARIO_TIMEOUT_MS = 120_000;

function userMsg(scenario: Scenario, text: string): SDKUserMessage {
  const msg = {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    session_id: "",
    parent_tool_use_id: null,
    ...(scenario.priority !== undefined ? { priority: scenario.priority } : {}),
  };
  // eslint-disable-next-line no-restricted-syntax -- sound: SDKUserMessage declares fields (uuid) the SDK fills in itself — same construction as services/claude-chat.ts run.send()
  return msg as SDKUserMessage;
}

interface Observation {
  /** Number of `result` messages before the steer answer (0 = same turn). */
  turnsBeforeSteerAnswer: number | null;
  resultCount: number;
  timedOut: boolean;
}

async function runScenario(scenario: Scenario): Promise<Observation> {
  const input = createAsyncIterableQueue<SDKUserMessage>();
  const options: Options = {
    cwd: mkdtempSync(join(tmpdir(), "sdk-steering-probe-")),
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
  };
  const binary = resolveClaudeCodeBinary();
  if (binary !== null) options.pathToClaudeCodeExecutable = binary;

  const q = query({ prompt: input.iterable, options });
  input.push(userMsg(scenario, scenario.firstMessage));

  let pushed = false;
  const pushSteer = (): void => {
    if (pushed) return;
    pushed = true;
    // Small delay so the push lands squarely inside the tool run / generation.
    setTimeout(() => input.push(userMsg(scenario, scenario.steerMessage)), 1500);
  };

  const obs: Observation = { turnsBeforeSteerAnswer: null, resultCount: 0, timedOut: false };
  let deltas = 0;
  const deadline = setTimeout(() => {
    obs.timedOut = true;
    input.end();
  }, SCENARIO_TIMEOUT_MS);

  // After the steer answer (or a post-steer settle window), end the input so
  // the query drains. The settle timer covers the not-lost failure mode: two
  // results seen, STEERED never arrived.
  let settle: NodeJS.Timeout | null = null;
  const scheduleSettle = (): void => {
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => input.end(), 30_000);
  };

  for await (const msg of q) {
    if (msg.type === "stream_event") {
      deltas++;
      if (scenario.pushOn === "text-delta" && deltas >= 5) pushSteer();
      continue;
    }
    if (msg.type === "assistant") {
      const blocks = msg.message.content;
      if (scenario.pushOn === "tool-running" && blocks.some((b) => b.type === "tool_use")) pushSteer();
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      if (text.includes("STEERED") && obs.turnsBeforeSteerAnswer === null) {
        obs.turnsBeforeSteerAnswer = obs.resultCount;
        input.end();
      }
    }
    if (msg.type === "result") {
      obs.resultCount++;
      if (pushed) scheduleSettle();
    }
  }
  clearTimeout(deadline);
  if (settle !== null) clearTimeout(settle);
  return obs;
}

function evaluate(scenario: Scenario, obs: Observation): string | null {
  if (obs.turnsBeforeSteerAnswer === null) {
    return obs.timedOut ? "timed out before the steer answer arrived" : "steer message was LOST (never answered)";
  }
  if (scenario.expectSameTurn === true && obs.turnsBeforeSteerAnswer !== 0) {
    return `expected same-turn injection, but the answer came ${obs.turnsBeforeSteerAnswer} turn(s) later`;
  }
  return null;
}

let failed = false;
for (const scenario of SCENARIOS) {
  process.stdout.write(`${scenario.name} ... `);
  const obs = await runScenario(scenario);
  const failure = evaluate(scenario, obs);
  const shape = obs.turnsBeforeSteerAnswer === 0 ? "same turn" : `after ${obs.turnsBeforeSteerAnswer ?? "∞"} result(s)`;
  if (failure === null) {
    console.log(`PASS (answered ${shape}; ${obs.resultCount} result(s) total)`);
  } else {
    failed = true;
    console.log(`FAIL — ${failure}`);
  }
}

if (failed) {
  console.error("\nSteering behavior changed under this SDK version. Do not ship the bump until docs/chat-session-lifecycle.md and the chat steering design are reconciled.");
  process.exit(1);
}
console.log("\nAll steering behaviors hold on this SDK version.");
