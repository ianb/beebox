// # `run()`'s wall-clock ceiling
//
// agent-browser 0.27.0's `wait --fn` polls forever unless
// `AGENT_BROWSER_DEFAULT_TIMEOUT` is set, and an unbounded child hung
// `screenshot`, `snapshot`, and `open`. `timeoutMs` is the backstop under the
// settle wait: whatever the upstream binary does about timeouts, the wrapper
// cannot hang forever.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { AgentBrowserError, run } from "../src/runner.js";

async function refused(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "(no error)";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ## A child that ignores its own timeout is still killed
void test("A child that ignores its own timeout is still killed", async (t) => {
  const killed = await refused(async () => run(["--version"], { timeoutMs: 1 }));
  t.check(killed, "agent-browser exited -1: killed after 1ms");
});

// ## A client ended by a signal says which signal and how long it ran
//
// A signal leaves no exit code and no output; the old report was an empty exit 1
// (2026-10-22 journey walks: every `snapshot` for a whole walk).
void test("A client ended by a signal says which signal and how long it ran", async (t) => {
  const killed = new AgentBrowserError({ code: -1, stderr: "", stdout: "", args: ["snapshot", "-i"], signal: "SIGTERM", elapsedMs: 62_400 });
  t.check(killed.message, "snapshot killed by SIGTERM after 62 s");
  t.check(killed.signal, "SIGTERM");
  t.check(killed.report, "snapshot killed by SIGTERM after 62 s");
});

// ## An exit with no output says upstream gave none
void test("An exit with no output says upstream gave none", async (t) => {
  const silent = new AgentBrowserError({ code: 1, stderr: "", stdout: "  ", args: ["snapshot"] });
  t.check(silent.report, "agent-browser exited 1: upstream gave no output");
});
