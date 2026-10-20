// # The usage ledger names the model that ran
//
// A Codex usage row records the model Codex's rollout names for the thread's
// latest turn. When the rollout is missing or unreadable, the row is still
// written: with the requested model if there was one, else `codex-default`.
// The lookup warns and never fails the run
// (issues/code-quality/2026-09-05-codex-usage-records-sentinel-not-model.md).

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { any, str } from "@ianbicking/tap-check/check";
import { codexUsageModel, readCodexTurnUsage } from "../../src/core/codex-usage.js";
import { recordCodexAgentUsage } from "../../src/core/agent/codex-run/usage.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

const CREATED = Date.UTC(2026, 9, 19, 12, 41, 17);
const THREAD = `${CREATED.toString(16).padStart(12, "0").slice(0, 8)}-${CREATED.toString(16).padStart(12, "0").slice(8)}-7abc-8def-0123456789ab`;

async function codexHomeWithRollout(t: Test, lines: string[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "codex-usage-model-"));
  t.teardown(() => rm(home, { recursive: true, force: true }));
  const at = new Date(CREATED);
  const pad = (value: number) => String(value).padStart(2, "0");
  const dir = join(home, "sessions", String(at.getFullYear()), pad(at.getMonth() + 1), pad(at.getDate()));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `rollout-2026-10-19T07-41-17-${THREAD}.jsonl`), `${lines.join("\n")}\n`);
  return home;
}

const TURN = JSON.stringify({ type: "turn_context", payload: { model: "gpt-6-astra" } });

// ## A batch run's row carries the rollout's model
void test("A batch run's row carries the rollout's model", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  const home = await codexHomeWithRollout(t, [TURN]);
  await recordCodexAgentUsage({
    boxRoot: box.root,
    threadId: THREAD,
    invocationId: "inv-1",
    task: "chat-title:s",
    env: { CODEX_HOME: home },
    usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0 },
  });
  t.check((await readCodexTurnUsage(box.root)).map((row) => row.model), ["gpt-6-astra"]);
});

// ## The fallbacks
//
// The rollout beats the request. No rollout falls back to the request, then
// to the sentinel; an unreadable rollout says why.
void test("The fallbacks", async (t) => {
  const warnings: string[] = [];
  const warn = (text: string) => { warnings.push(text); };
  const withRollout = await codexHomeWithRollout(t, [TURN]);
  const unreadable = await codexHomeWithRollout(t, ["{}"]);
  const empty = await mkdtemp(join(tmpdir(), "codex-usage-model-"));
  t.teardown(() => rm(empty, { recursive: true, force: true }));

  t.check(await codexUsageModel({ threadId: THREAD, requested: "gpt-asked", env: { CODEX_HOME: withRollout }, warn }), "gpt-6-astra");
  t.check(await codexUsageModel({ threadId: THREAD, requested: "gpt-asked", env: { CODEX_HOME: empty }, warn }), "gpt-asked");
  t.check(await codexUsageModel({ threadId: THREAD, requested: undefined, env: { CODEX_HOME: unreadable }, warn }), "codex-default");
  t.check(warnings, [
    `No Codex rollout found for thread ${THREAD}; its model is unknown.`,
    str`Could not read the model of Codex thread ${THREAD}: Codex rollout ${any(String)} has no readable turn_context model`,
  ]);
});
