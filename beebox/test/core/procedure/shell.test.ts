// # A procedure shell step gets the agent profile plus its run's context
//
// The step runs box-authored script text, so its environment is the agent
// allowlist (`buildScriptEnv`), never the caller's whole env. The per-run
// context a caller sets in its own env for the step (the triage bucket, the
// chat that started the run) is passed by name. What the step sees of each
// credential is pinned in `test/credential-visibility/every-consumer.test.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { runShell } from "../../../src/core/procedure/shell.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const NAMES = ["TRIAGE_ITEMS", "BBX_CHAT_SESSION_ID", "BBX_CHAT_SESSION_ID_FILE", "CODEX_THREAD_ID", "BBX_HUB_SECRET", "SOME_UNLISTED_VARIABLE"];

void test("A procedure shell step gets the agent profile plus its run's context", async (t) => {
  const box = await makeTmpBox();
  const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  t.teardown(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
    await box.cleanup();
  });
  for (const name of NAMES) process.env[name] = `set-${name}`;

  const script = NAMES.map((name) => `printf '%s=%s\\n' ${name} "\${${name}:-absent}"`).join("\n");
  const result = await runShell(box.root, script);

  t.check(result.stdout.split("\n"), [
    "TRIAGE_ITEMS=set-TRIAGE_ITEMS",
    "BBX_CHAT_SESSION_ID=set-BBX_CHAT_SESSION_ID",
    "BBX_CHAT_SESSION_ID_FILE=set-BBX_CHAT_SESSION_ID_FILE",
    "CODEX_THREAD_ID=set-CODEX_THREAD_ID",
    "BBX_HUB_SECRET=absent",
    "SOME_UNLISTED_VARIABLE=absent",
  ]);
});
