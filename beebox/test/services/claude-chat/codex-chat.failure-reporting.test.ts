// # Codex chat failure reporting
//
// A codex chat run has two places a promise can reject: the initialization chain
// that creates the session, and the per-turn chain that runs it. Both produce the
// same `num_turns=0 duration_ms=0` result frame, so the frame has to say which one
// threw. The log line for a failed turn reports the frame's own facts and names no
// cause.

import { test } from "tap";
import "agent-doctest/tap";
import { codexFailureEvent } from "../../../src/services/claude-chat/codex-chat.js";
import { warnErroredTurn } from "../../../src/core/chat/session/messages.js";
import type { ChatMessageResult } from "../../../src/core/chat/message-types.js";

function captured(stream: "warn" | "error", body: () => void): string[] {
  const lines: string[] = [];
  const original = console[stream];
  console[stream] = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    body();
  } finally {
    console[stream] = original;
  }
  return lines;
}

function silently(phase: "session-start" | "turn", error: unknown): ChatMessageResult {
  let message: ChatMessageResult | null = null;
  captured("error", () => {
    const frame = codexFailureEvent({ phase, sessionId: "thread-1", error });
    message = frame.message.type === "result" ? frame.message : null;
  });
  if (message === null) throw new Error("expected a result frame");
  return message;
}

// A failure before the session exists is named as one, and carries the phase:
void test("A failure before the session exists is named as one, and carries the phase:", async (t) => {
  // doctest:L42
  t.check(silently("session-start", new Error("codex exited with code 1")), {
    type: "result",
    subtype: "failed",
    session_id: "thread-1",
    is_error: true,
    phase: "session-start",
    duration_ms: 0,
    num_turns: 0,
    result: "Could not start codex session: codex exited with code 1",
  });
});

// A failure after the session exists says the turn threw rather than blaming the
// start:
void test("A failure after the session exists says the turn threw rather than blaming th...", async (t) => {
  // doctest:L50
  t.check(silently("turn", new TypeError("Cannot read properties of undefined (reading 'id')")).result, "Codex turn threw before completing: Cannot read properties of undefined (reading 'id')");

  // doctest:L53
  t.check(silently("turn", "a thrown string").result, "Codex turn threw before completing: a thrown string");

  // doctest:L56
  t.check(silently("turn", new Error("boom")).phase, "turn");
});

// The frame carries a message only, so the stack — the part that locates the throw
// — goes to the console:
void test("The frame carries a message only, so the stack — the part that locates the th...", async (t) => {
  // doctest:L64
  const logged = captured("error", () => {
    codexFailureEvent({ phase: "turn", sessionId: "thread-1", error: new TypeError("no id here") });
  });
  await t.checkText(logged.length, "1");

  // doctest:L70
  t.check(logged[0]?.startsWith("[codex-chat] turn failure: no id here"), true);

  // doctest:L73
  t.check(logged[0]?.includes("codex-chat.failure-reporting"), true);
});

// A non-`Error` throw has no stack to print, and says so instead of printing
// `undefined`:
void test("A non-Error throw has no stack to print, and says so instead of printing unde...", async (t) => {
  // doctest:L81
  const nonError = captured("error", () => {
    codexFailureEvent({ phase: "session-start", sessionId: "", error: { code: 7 } });
  });
  t.check(nonError[0]?.includes("non-Error throw:"), true);
});

// `warnErroredTurn` logs the phase and the result text. It offers no explanation:
// the previous line guessed "Likely an unavailable model, an unresumable session,
// or a server error", which was wrong for this failure and cost diagnosis time.
void test("warnErroredTurn logs the phase and the result text.", async (t) => {
  // doctest:L93
  const warned = captured("warn", () => {
    warnErroredTurn({
      sessionId: null,
      msg: silently("session-start", new Error("codex exited with code 1")),
    });
  });
  await t.checkText(warned[0], "[chat-session] Turn ended with is_error=true (session <unassigned>). phase=session-start subtype=failed num_turns=0 duration_ms=0 result=\"Could not start codex session: codex exited with code 1\"");
});

// A backend that reports no phase — every Claude result frame — is logged as
// unreported rather than assigned one:
void test("A backend that reports no phase — every Claude result frame — is logged as un...", async (t) => {
  // doctest:L107
  const unreported = captured("warn", () => {
    warnErroredTurn({
      sessionId: "abc",
      msg: { type: "result", subtype: "success", session_id: "abc", is_error: true, duration_ms: 512, num_turns: 1 },
    });
  });
  await t.checkText(unreported[0], "[chat-session] Turn ended with is_error=true (session abc). phase=<unreported> subtype=success num_turns=1 duration_ms=512");
});
