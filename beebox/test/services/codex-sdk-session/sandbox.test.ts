// # Codex box-agent sandbox policy
//
// A box agent must be able to commit because Git is the box's state history.
// Codex force-mounts `.git` read-only under workspace-write even when the package
// root is explicitly writable, so official SDK threads use full access.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { CODEX_BOX_SANDBOX } from "../../../src/services/codex-sdk-session/sandbox.js";
import { codexSdkThreadOptions } from "../../../src/services/codex-sdk-session/core.js";

// The shared SDK adapter composes one policy for batch and interactive sessions.
// It preserves model, cwd, and additional-directory settings.
void test("The shared SDK adapter composes one policy for batch and interactive sessions.", async (t) => {
  t.check(CODEX_BOX_SANDBOX, "danger-full-access");

  t.check(
    codexSdkThreadOptions({
      cwd: "/box/content",
      systemPrompt: "system",
      model: "test-model",
      additionalDirectories: ["/box/package"],
      analytics: false,
    }),
    {
    workingDirectory: "/box/content",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    model: "test-model",
    additionalDirectories: [
      "/box/package",
    ],
  },
  );
});
