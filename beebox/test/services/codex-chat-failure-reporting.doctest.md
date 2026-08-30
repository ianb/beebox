# Codex chat failure reporting

A codex chat run has two places a promise can reject: the initialization chain
that creates the session, and the per-turn chain that runs it. Both produce the
same `num_turns=0 duration_ms=0` result frame, so the frame has to say which one
threw. The log line for a failed turn reports the frame's own facts and names no
cause.

```ts setup
import { codexFailureEvent } from "../../src/services/codex-chat.js";
import { warnErroredTurn } from "../../src/core/chat/session/messages.js";
import type { ChatMessageResult } from "../../src/core/chat/message-types.js";

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
```

A failure before the session exists is named as one, and carries the phase:

```ts
JSON.stringify(silently("session-start", new Error("codex exited with code 1")))
=> {"type":"result","subtype":"failed","session_id":"thread-1","is_error":true,"phase":"session-start","duration_ms":0,"num_turns":0,"result":"Could not start codex session: codex exited with code 1"}
```

A failure after the session exists says the turn threw rather than blaming the
start:

```ts
silently("turn", new TypeError("Cannot read properties of undefined (reading 'id')")).result
=> Codex turn threw before completing: Cannot read properties of undefined (reading 'id')

silently("turn", "a thrown string").result
=> Codex turn threw before completing: a thrown string

silently("turn", new Error("boom")).phase
=> turn
```

The frame carries a message only, so the stack — the part that locates the throw
— goes to the console:

```ts
const logged = captured("error", () => {
  codexFailureEvent({ phase: "turn", sessionId: "thread-1", error: new TypeError("no id here") });
});
logged.length
=> 1

logged[0].startsWith("[codex-chat] turn failure: no id here")
=> true

logged[0].includes("codex-chat-failure-reporting.doctest")
=> true
```

A non-`Error` throw has no stack to print, and says so instead of printing
`undefined`:

```ts
const nonError = captured("error", () => {
  codexFailureEvent({ phase: "session-start", sessionId: "", error: { code: 7 } });
});
nonError[0].includes("non-Error throw:")
=> true
```

`warnErroredTurn` logs the phase and the result text. It offers no explanation:
the previous line guessed "Likely an unavailable model, an unresumable session,
or a server error", which was wrong for this failure and cost diagnosis time.

```ts
const warned = captured("warn", () => {
  warnErroredTurn({
    sessionId: null,
    msg: silently("session-start", new Error("codex exited with code 1")),
  });
});
warned[0].includes("Likely")
=> false

warned[0]
=> [chat-session] Turn ended with is_error=true (session <unassigned>). phase=session-start subtype=failed num_turns=0 duration_ms=0 result="Could not start codex session: codex exited with code 1"
```

A backend that reports no phase — every Claude result frame — is logged as
unreported rather than assigned one:

```ts
const unreported = captured("warn", () => {
  warnErroredTurn({
    sessionId: "abc",
    msg: { type: "result", subtype: "success", session_id: "abc", is_error: true, duration_ms: 512, num_turns: 1 },
  });
});
unreported[0]
=> [chat-session] Turn ended with is_error=true (session abc). phase=<unreported> subtype=success num_turns=1 duration_ms=512
```
