// # Diagnostic session provider resolution
//
// `bbx session` uses native session identities without guessing from opaque ID
// syntax. Explicit selection wins, the current Codex thread is recognized,
// and registered web chats retain their pinned engine.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  parseDiagnosticEngine,
  resolveDiagnosticEngine,
  validateCodexSessionMode,
} from "../../../src/cli/lib/diagnostic-session.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("line 18", async (t) => {
  // doctest:L19
  t.check(parseDiagnosticEngine("codex"), "codex");

  // doctest:L22
  await t.checkThrows(async () => (parseDiagnosticEngine("other")), "InvalidDiagnosticEngineError: Unknown session engine \"other\". Expected claude or codex.");

  // doctest:L25
  await t.checkThrows(async () => (validateCodexSessionMode({ raw: true, toolReport: false, full: false })), "UnsupportedCodexSessionModeError: Codex sessions support readable dialogue only; --raw, --tool-report, and --full require native rollout detail that app-server does not expose.");

  // doctest:L28
  t.check(validateCodexSessionMode({ raw: false, toolReport: false, full: false }), undefined);
});

// ## Resolution precedence
void test("Resolution precedence", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L35
  const box = await makeTmpBox();
  await fs.mkdir(path.join(box.root, ".beebox"), { recursive: true });
  await fs.writeFile(
    path.join(box.root, ".beebox", "chat-session-history.json"),
    JSON.stringify({
      migrated: true,
      sessions: [
        { id: "pinned-codex", engine: "codex" },
        { id: "pinned-claude", engine: "claude" },
      ],
    }),
  );

  // doctest:L48
  t.check(
    await resolveDiagnosticEngine({
      boxRoot: box.root,
      sessionId: "pinned-codex",
      requestedEngine: undefined,
      codexThreadId: undefined,
    }),
    "codex",
  );

  // doctest:L56
  t.check(
    await resolveDiagnosticEngine({
      boxRoot: box.root,
      sessionId: "current-native",
      requestedEngine: undefined,
      codexThreadId: "current-native",
    }),
    "codex",
  );

  // doctest:L64
  t.check(
    await resolveDiagnosticEngine({
      boxRoot: box.root,
      sessionId: "unknown-id",
      requestedEngine: undefined,
      codexThreadId: undefined,
    }),
    "claude",
  );

  // doctest:L72
  t.check(
    await resolveDiagnosticEngine({
      boxRoot: box.root,
      sessionId: "pinned-codex",
      requestedEngine: "claude",
      codexThreadId: "pinned-codex",
    }),
    "claude",
  );
});
