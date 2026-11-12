// # Per-invocation agent environment
//
// Research allowance IDs reach the real runner setup for both model engines.
// Every run, with or without explicit additions, uses an agent-safe environment
// without server secrets. Only the external SDK/CLI boundaries are replaced here.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { buildScriptEnv } from "../../../../src/core/script-env/core.js";
import type { ConsumeStreamOptions } from "../../../../src/core/agent/invoke/stream.js";
import type { CodexSdkSessionOptions } from "../../../../src/services/codex-sdk-session/core.js";
import * as auth from "../../../../src/core/agent/auth-preflight.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

void test("line 20", async (t) => {
  t.teardown(async () => {
    try {
      if (originalSecret === undefined) delete process.env.BBX_HUB_SECRET; else process.env.BBX_HUB_SECRET = originalSecret;
      if (originalId === undefined) delete process.env.BBX_TRIAGE_RUN_ID; else process.env.BBX_TRIAGE_RUN_ID = originalId;
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  const originalSecret = process.env.BBX_HUB_SECRET;
  const originalId = process.env.BBX_TRIAGE_RUN_ID;
  process.env.BBX_HUB_SECRET = "synthetic-server-secret";
  process.env.BBX_TRIAGE_RUN_ID = "inherited-run";
  let claudeEnv: Record<string, unknown> = {};
  const { runAgent } = await t.mockImport("../../../../src/core/agent/invoke/run.ts", {
    "../../../../src/core/agent/auth-preflight.ts": { ...auth, checkClaudeAuth: async () => {} },
    "../../../../src/core/agent/invoke/stream.ts": { consumeAgentStream: async ({ queryOptions }: ConsumeStreamOptions) => {
      claudeEnv = isRecord(queryOptions.env) ? queryOptions.env : {};
      return { outputBuf: "", resultMessage: null, assignedSessionId: null, errorText: "synthetic stop", hadAssistantActivity: false };
    } },
  });
  await runAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "", env: { BBX_TRIAGE_RUN_ID: "claude-run", BBX_TRIAGE_RESEARCH: "1" } });
  t.check([claudeEnv.BBX_TRIAGE_RUN_ID, claudeEnv.BBX_TRIAGE_RESEARCH, claudeEnv.BBX_SPAWN_PROFILE, claudeEnv.BBX_HUB_SECRET ?? null, process.env.BBX_TRIAGE_RUN_ID], [
    "claude-run",
    "1",
    "agent",
    null,
    "inherited-run",
  ]);

  let codexEnv: Record<string, string | undefined> = {};
  const { runCodexAgent } = await t.mockImport("../../../../src/core/agent/codex-run/core.ts", {
    "../../../../src/core/agent/auth-preflight.ts": { ...auth, checkCodexAuth: async () => {} },
    "../../../../src/core/agent/ensure-codex-plugin.ts": { ensureCodexPluginInstalled: async () => {} },
  });
  const result = await runCodexAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "", env: { BBX_TRIAGE_RUN_ID: "codex-run", BBX_TRIAGE_RESEARCH: "1" } }, (options: CodexSdkSessionOptions) => {
    codexEnv = options.env ?? {};
    return { id: null, run: async () => ({ sessionId: "fake-session", output: "done", resultText: "done", durationMs: 1, status: "completed", error: null, usage: null, items: [] }) };
  });
  t.check(result, { output: "done", resultText: "done", exitCode: 0, sessionId: "fake-session", structuredOutput: undefined, success: true });

  t.check([codexEnv.BBX_TRIAGE_RUN_ID, codexEnv.BBX_TRIAGE_RESEARCH, codexEnv.BBX_SPAWN_PROFILE, codexEnv.BBX_HUB_SECRET ?? null, process.env.BBX_TRIAGE_RUN_ID], [
    "codex-run",
    "1",
    "agent",
    null,
    "inherited-run",
  ]);

  t.check(codexEnv.CODEX_HOME, process.env.CODEX_HOME);

  // A Codex call without additions gets the same agent profile, never the SDK's
  // default of the whole server environment.
  let defaultEnv: Record<string, string | undefined> = {};
  await runCodexAgent({ boxRoot: box.root, prompt: "test", systemPrompt: "" }, (options: CodexSdkSessionOptions) => {
    defaultEnv = options.env ?? {};
    return { id: null, run: async () => ({ sessionId: "fake-default", output: "done", resultText: "done", durationMs: 1, status: "completed", error: null, usage: null, items: [] }) };
  });
  t.check([defaultEnv.BBX_SPAWN_PROFILE, defaultEnv.BBX_HUB_SECRET ?? null, defaultEnv.BBX_TRIAGE_RUN_ID], ["agent", null, "inherited-run"]);

  const next = await buildScriptEnv(box.root);
  t.check([next.BBX_TRIAGE_RUN_ID, next.BBX_TRIAGE_RESEARCH ?? null, next.BBX_HUB_SECRET ?? null], [
    "inherited-run",
    null,
    null,
  ]);
});
