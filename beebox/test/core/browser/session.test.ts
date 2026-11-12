// # Reading `agent-browser session list`
//
// The browser page starts the box session only when the list parses and lacks
// it (docs/plans/shared-browser.md, Track C); output in any other shape must
// read as unknown, so a page the person was using is never replaced.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { ExecReply } from "../../../src/core/browser/command-socket.js";
import { ensureBoxSession, parseSessionList } from "../../../src/core/browser/session.js";

void test("Known shapes give the names; anything else is unknown", async (t) => {
  t.check(
    {
      none: parseSessionList("No active sessions\n"),
      // The shape agent-browser 0.39.2 prints.
      some: parseSessionList("Active sessions:\n→ box\n   agent1\n"),
      ascii: parseSessionList("Active sessions:\n-> box\n"),
      error: parseSessionList("Error: daemon not responding\n"),
      oddName: parseSessionList("Active sessions:\n-> box (stale)\n"),
    },
    { none: [], some: ["box", "agent1"], ascii: ["box"], error: null, oddName: null },
  );
});

/** A runner that answers from `replies` in order and records each command. */
function fakeRunner(replies: ExecReply[]): { run: (args: readonly string[]) => Promise<ExecReply>; commands: string[][] } {
  const commands: string[][] = [];
  return {
    commands,
    run: (args) => {
      commands.push([...args]);
      return Promise.resolve(replies.shift() ?? { exitCode: 99, stdout: "", stderr: "no reply" });
    },
  };
}

const OK: ExecReply = { exitCode: 0, stdout: "", stderr: "" };

// A missing session is started and given the box viewport (G2, 2026-10-30: headless Chrome's
// own page size was 1280x577, and the dashboard's clicks landed low).
void test("A missing session is opened and sized; a running one is left alone", async (t) => {
  const missing = fakeRunner([{ ...OK, stdout: "No active sessions\n" }, OK, OK]);
  t.check(await ensureBoxSession(missing.run), null);
  t.check(missing.commands, [["session", "list"], ["open", "about:blank"], ["set", "viewport", "1280", "720"]]);
  const running = fakeRunner([{ ...OK, stdout: "Active sessions:\n→ box\n" }]);
  t.check(await ensureBoxSession(running.run), null);
  t.check(running.commands, [["session", "list"]]);
});

void test("A list in an unknown shape opens nothing", async (t) => {
  const odd = fakeRunner([{ ...OK, stdout: "Sessions: box\n" }]);
  t.check(await ensureBoxSession(odd.run), "Could not read the browser's session list: Sessions: box");
  t.check(odd.commands, [["session", "list"]]);
});

void test("A failed viewport is reported", async (t) => {
  const failed = fakeRunner([{ ...OK, stdout: "No active sessions\n" }, OK, { exitCode: 1, stdout: "", stderr: "no page\n" }]);
  t.check(await ensureBoxSession(failed.run), "Could not set the box browser's viewport: no page");
});
