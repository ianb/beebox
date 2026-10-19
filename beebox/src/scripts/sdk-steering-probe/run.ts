/**
 * SDK steering-behavior probe. Run after every `@anthropic-ai/claude-agent-sdk`
 * bump (`pnpm update-agent-sdk` reminds you):
 *
 *   node --import tsx beebox/src/scripts/sdk-steering-probe/run.ts
 *
 * The chat mid-turn steering design (see docs/chat/sessions.md) leans
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
 * ~30-60s total). A scenario that times out runs once more; two timeouts in a
 * row are INCONCLUSIVE, since a slow turn says nothing about steering.
 *
 * Exit 0 = behavior holds. Exit 1 = a steer message was lost or answered in
 * the wrong turn: an SDK bump changed the semantics chat steering depends on —
 * investigate before shipping the bump. Exit 2 = inconclusive (a scenario timed
 * out twice, nothing contradicted): re-run before deciding.
 */

import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAsyncIterableQueue } from "../../services/claude-chat-queue.js";
import { resolveClaudeCodeBinary } from "../../core/sdk-binary-path.js";
import { removeTempCwdTranscripts } from "../../core/chat/session/transcript-paths.js";
import { classify, exitStatus, EXIT_BEHAVIOR_CHANGED, EXIT_INCONCLUSIVE, type Observation, type Outcome } from "./verdict.js";

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

async function runScenario(scenario: Scenario): Promise<Observation> {
  const cwd = await mkdtemp(join(tmpdir(), "sdk-steering-probe-"));
  try {
    return await observe(scenario, cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await removeTempCwdTranscripts(cwd);
  }
}

async function observe(scenario: Scenario, cwd: string): Promise<Observation> {
  const input = createAsyncIterableQueue<SDKUserMessage>();
  const options: Options = {
    cwd,
    permissionMode: "bypassPermissions",
    includePartialMessages: true,
  };
  const binary = resolveClaudeCodeBinary();
  if (binary !== null) options.pathToClaudeCodeExecutable = binary;

  const q = query({ prompt: input.iterable, options });
  input.push(userMsg(scenario, scenario.firstMessage));

  // A plain object rather than a bare `let`: across `for await` iterations
  // TypeScript's narrowing otherwise treats a closure-mutated `let` as never
  // reassigned by a prior iteration, over-narrowing it to its initial value
  // at every later read (verified against the checker directly, 2026-09-27).
  const push = { done: false };
  const pushSteer = (): void => {
    if (push.done) return;
    push.done = true;
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
  // Same object-wrapping reason as `push` above.
  const settle: { timer: NodeJS.Timeout | null } = { timer: null };
  const scheduleSettle = (): void => {
    if (settle.timer !== null) clearTimeout(settle.timer);
    settle.timer = setTimeout(() => input.end(), 30_000);
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
      if (push.done) scheduleSettle();
    }
  }
  clearTimeout(deadline);
  if (settle.timer !== null) clearTimeout(settle.timer);
  return obs;
}

async function runWithRetry(scenario: Scenario): Promise<{ obs: Observation; outcome: Outcome }> {
  const obs = await runScenario(scenario);
  const outcome = classify(scenario.expectSameTurn === true, obs);
  if (outcome.kind !== "inconclusive") return { obs, outcome };
  process.stdout.write("timed out, retrying once ... ");
  const retryObs = await runScenario(scenario);
  return { obs: retryObs, outcome: classify(scenario.expectSameTurn === true, retryObs) };
}

const outcomes: Outcome[] = [];
for (const scenario of SCENARIOS) {
  process.stdout.write(`${scenario.name} ... `);
  const { obs, outcome } = await runWithRetry(scenario);
  outcomes.push(outcome);
  const shape = obs.turnsBeforeSteerAnswer === 0 ? "same turn" : `after ${obs.turnsBeforeSteerAnswer ?? "∞"} result(s)`;
  if (outcome.kind === "pass") console.log(`PASS (answered ${shape}; ${obs.resultCount} result(s) total)`);
  else if (outcome.kind === "fail") console.log(`FAIL — ${outcome.reason}`);
  else console.log(`INCONCLUSIVE — ${outcome.reason} (twice)`);
}

const status = exitStatus(outcomes);
if (status === EXIT_BEHAVIOR_CHANGED) {
  console.error("\nSteering behavior changed under this SDK version. Do not ship the bump until docs/chat/sessions.md and the chat steering design are reconciled.");
} else if (status === EXIT_INCONCLUSIVE) {
  console.error("\nINCONCLUSIVE: a scenario timed out twice, so the probe could not verify steering. Nothing contradicted it. Re-run the probe before deciding.");
} else {
  console.log("\nAll steering behaviors hold on this SDK version.");
}
// exitCode, not exit(): on macOS a piped stdout is async and exit() can cut the summary.
process.exitCode = status;
