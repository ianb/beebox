# Retrospective Walker

`src/core/retro/` discovers which of a box's Claude Code sessions are
ready for retrospective observation: chat sessions (those with real
`<typed>`/`<speech>` user messages), quiet past the quiescence window,
and not already settled in walker state. Transcripts live under the
Claude projects dir, overridable for tests via `CB_CLAUDE_PROJECTS_DIR`.

```ts setup
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { getSessionLogPath } from "../../../src/cli/lib/session.js";
import { discoverSessions } from "../../../src/core/retro/discovery.js";
import { renderSessionCompact } from "../../../src/core/retro/render.js";
import { renderRunReport } from "../../../src/core/retro/report.js";
import {
  emptyRetroState,
  isSessionSettled,
  loadRetroState,
  saveRetroState,
} from "../../../src/core/retro/state.js";

const NOW = new Date("2026-06-09T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const QUIET = 30 * 60 * 1000;

// Webapp chat input: <chat-app .../> snapshot tag, then the <typed> wrapper.
function typedEntry(text: string, ts: string) {
  return {
    type: "user",
    uuid: "u-" + ts,
    timestamp: ts,
    message: {
      role: "user",
      content: [
        { type: "text", text: `<chat-app narration="off" time="${ts}"/>\n<typed user="Ian">${text}</typed>` },
      ],
    },
  };
}

function plainUserEntry(text: string, ts: string) {
  return {
    type: "user",
    uuid: "u-" + ts,
    timestamp: ts,
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

function agentEntry(text: string, ts: string) {
  return {
    type: "assistant",
    uuid: "a-" + ts,
    timestamp: ts,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

/** Write a transcript fixture and backdate its mtime. */
async function seedSession(
  boxRoot: string,
  opts: { sessionId: string; entries: object[]; age: number }
) {
  const logPath = getSessionLogPath(boxRoot, opts.sessionId);
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, opts.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const when = new Date(NOW.getTime() - opts.age);
  await utimes(logPath, when, when);
}
```

## Discovery: chat vs job sessions, quiescence, watermark

A webapp chat session (typed user messages, quiet for hours) qualifies. A
telegram session sends raw text — no `<typed>` tags — so its chat
registry entry is what qualifies it (and contributes thread provenance).
A wakeup run (untagged, unregistered) is non-chat. A conversation still
active within the quiescence window is deferred. A session already
settled in state is skipped.

```ts
const box = await makeTmpBox();
process.env["CB_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

await seedSession(box.root, { sessionId: "chat-old", age: 5 * HOUR, entries: [
  typedEntry("Please stop using bullet lists in answers", "2026-06-09T07:00:00Z"),
  agentEntry("Got it — prose from here on.", "2026-06-09T07:00:10Z"),
] });
await seedSession(box.root, { sessionId: "chat-telegram", age: 3 * HOUR, entries: [
  plainUserEntry("What's on my calendar?", "2026-06-09T09:00:00Z"),
  agentEntry("Two meetings this afternoon.", "2026-06-09T09:00:05Z"),
] });
await seedSession(box.root, { sessionId: "job-wakeup", age: 2 * HOUR, entries: [
  plainUserEntry("Process the inbox items.", "2026-06-09T10:00:00Z"),
  agentEntry("Processed 3 items.", "2026-06-09T10:01:00Z"),
] });
await seedSession(box.root, { sessionId: "chat-live", age: 5 * 60 * 1000, entries: [
  typedEntry("Still talking…", "2026-06-09T11:55:00Z"),
] });
await box.write(".callback-box/chat-thread-sessions.json", JSON.stringify({
  "store/chat/telegram/Ian/thread.chat-thread.card": { sessionId: "chat-telegram" },
}));

const state = emptyRetroState();
state.sessions["chat-done-before"] = { status: "done", attempts: 1, at: "2026-06-01T00:00:00Z" };
await seedSession(box.root, { sessionId: "chat-done-before", age: 9 * HOUR, entries: [
  typedEntry("Older conversation", "2026-06-09T03:00:00Z"),
] });

const result = await discoverSessions(box.root, { now: NOW, quiescenceMs: QUIET, state });
result.qualified.map((s) => `${s.sessionId} (${s.userMessages} msg, thread: ${s.threadRef})`).join("\n")
=> chat-old (1 msg, thread: null)
chat-telegram (1 msg, thread: store/chat/telegram/Ian/thread.chat-thread.card)

[result.nonChat, result.alreadyProcessed, result.missingTranscripts].join(",")
=> 1,1,0

result.deferredActive.join(",")
=> chat-live

result.registriesFound.join(",")
=> .callback-box/chat-thread-sessions.json
```

State round-trips through `.callback-box/retro/state.json`, and a failed
session stays eligible until it exhausts its attempts.

```ts continue
state.sessions["chat-old"] = { status: "failed", attempts: 1, at: NOW.toISOString() };
await saveRetroState(box.root, state);
const reloaded = await loadRetroState(box.root);

isSessionSettled(reloaded, "chat-old")
=> false

reloaded.sessions["chat-old"]?.attempts
=> 1

isSessionSettled(reloaded, "chat-done-before")
=> true
```

## Compact rendering

The observer sees dialogue plus tool one-liners — `<typed>` wrappers
stripped, tool results omitted.

```ts continue
await seedSession(box.root, { sessionId: "chat-tools", age: 4 * HOUR, entries: [
  typedEntry("Add milk to the shopping list", "2026-06-09T08:00:00Z"),
  {
    type: "assistant",
    uuid: "a-tools",
    timestamp: "2026-06-09T08:00:05Z",
    message: { role: "assistant", content: [
      { type: "text", text: "Adding it now." },
      { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "store/todos/shopping.todo-list.card" } },
    ] },
  },
] });
await renderSessionCompact(getSessionLogPath(box.root, "chat-tools"))
=> **User** (2026-06-09T08:00:00Z)
Add milk to the shopping list
«blankline»
---
«blankline»
**Agent** (2026-06-09T08:00:05Z)
Adding it now.
→ Edit: store/todos/shopping.todo-list.card
```

## Run report skeleton

The report records what was examined and every category of skip — caps
and deferrals are named, never silent.

```ts continue
renderRunReport({
  runId: "2026-06-09T12-00-00",
  generatedAt: "2026-06-09T12:00:00Z",
  examined: [
    { sessionId: "chat-old", threadRef: null, userMessages: 1, mtime: "2026-06-09T07:00:10Z" },
    { sessionId: "chat-telegram", threadRef: "store/chat/telegram/Ian/thread.chat-thread.card", userMessages: 1, mtime: "2026-06-09T09:00:05Z" },
  ],
  deferredActive: ["chat-live"],
  alreadyProcessed: 1,
  nonChat: 1,
  missingTranscripts: 0,
  overflow: 2,
  registriesFound: [".callback-box/chat-thread-sessions.json"],
  observations: [],
  duplicatesSkipped: 0,
  observerFailures: 0,
})
=> # Retrospective run 2026-06-09T12-00-00
«blankline»
Generated 2026-06-09T12:00:00Z.
«blankline»
## What I learned
«blankline»
_Nothing new this run._
«blankline»
## Sessions examined
«blankline»
- `chat-old` (2026-06-09T07:00:10Z, 1 user message)
- `chat-telegram` (2026-06-09T09:00:05Z, 1 user message) — store/chat/telegram/Ian/thread.chat-thread.card
«blankline»
Skipped: 1 already processed; 1 non-chat (wakeup/job/procedure runs); 1 deferred (active within the quiescence window); 2 beyond the per-run cap (next run picks them up).
«blankline»
Chat registries: `.callback-box/chat-thread-sessions.json`.
«blankline»
## Observations
«blankline»
_None recorded._
«blankline»
## Actions taken
«blankline»
_None — no observations to integrate._
```

```ts cleanup
delete process.env["CB_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```
