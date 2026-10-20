// # Codex honors a prompt-only pass
//
// The chat title and review passes ask for `loadBoxContext: false` and
// `tools: []`. On a Codex box the session itself enforces both: the run skips
// Bee Box's `AGENTS.md` expansion and Codex's own project-doc load, and it runs
// in the `read-only` sandbox with web search off. A run that asks for neither
// keeps the box sandbox and its guidance.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  codexSdkConfig,
  codexSdkThreadOptions,
  type CodexSdkSessionOptions,
} from "../../../src/services/codex-sdk-session/core.js";
import * as auth from "../../../src/core/agent/auth-preflight.js";
import { instructionFilePath } from "../../../src/core/agent-instruction-files.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const fakeTurn = { sessionId: "s", output: "done", resultText: "done", durationMs: 1, status: "completed", error: null, usage: null, items: [] };

// ## The session options become Codex settings
void test("The session options become Codex settings", async (t) => {
  const base = { cwd: "/box", systemPrompt: "", analytics: false };
  t.check(codexSdkThreadOptions({ ...base, readOnly: true }), {
    workingDirectory: "/box",
    sandboxMode: "read-only",
    approvalPolicy: "never",
    webSearchMode: "disabled",
  });
  t.check(codexSdkThreadOptions(base), {
    workingDirectory: "/box",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
  });
  t.check(codexSdkConfig({ ...base, loadProjectDocs: false }), {
    developer_instructions: "",
    analytics: {
      enabled: false,
    },
    project_doc_max_bytes: 0,
    feedback: {
      enabled: false,
    },
    check_for_update_on_startup: false,
  });
  t.check(codexSdkConfig(base), {
    developer_instructions: "",
    analytics: {
      enabled: false,
    },
    feedback: {
      enabled: false,
    },
    check_for_update_on_startup: false,
  });
});

// ## The batch agent passes the request through
//
// The box's instruction file includes a guide with a marker line. Codex does
// not follow `@` includes, so Bee Box expands them into the system prompt: a
// pass with box context sees the marker, a prompt-only pass does not.
void test("The batch agent passes the request through", async (t) => {
  const box = await makeTmpBox();
  t.teardown(() => box.cleanup());
  await writeFile(join(box.root, await instructionFilePath(box.root, "")), "@guide.md\n");
  await writeFile(join(box.root, "guide.md"), "BOX-GUIDANCE-MARKER\n");
  const { createCodexAgent } = await t.mockImport("../../../src/core/agent/codex-agent.ts", {
    "../../../src/core/agent/codex-run/core.ts": await t.mockImport("../../../src/core/agent/codex-run/core.ts", {
      "../../../src/core/agent/auth-preflight.ts": { ...auth, checkCodexAuth: async () => {} },
      "../../../src/core/agent/ensure-codex-plugin.ts": { ensureCodexPluginInstalled: async () => {} },
      "../../../src/services/codex-sdk-session/core.ts": {
        ...(await import("../../../src/services/codex-sdk-session/core.js")),
        createCodexSdkSession: (options: CodexSdkSessionOptions) => {
          seen.push({
            guidance: options.systemPrompt.includes("BOX-GUIDANCE-MARKER"),
            loadProjectDocs: options.loadProjectDocs,
            readOnly: options.readOnly,
          });
          return { id: null, run: async () => fakeTurn };
        },
      },
    }),
  });
  const seen: Array<{ guidance: boolean; loadProjectDocs: boolean | undefined; readOnly: boolean | undefined }> = [];
  const agent = createCodexAgent({ name: "chat-title:test" });
  await agent.invoke({ boxRoot: box.root, prompt: "name it", systemPrompt: "title", loadBoxContext: false, tools: [] });
  await agent.invoke({ boxRoot: box.root, prompt: "do work", systemPrompt: "work" });
  t.check(seen, [
    {
      guidance: false,
      loadProjectDocs: false,
      readOnly: true,
    },
    {
      guidance: true,
      loadProjectDocs: true,
      readOnly: false,
    },
  ]);
});
