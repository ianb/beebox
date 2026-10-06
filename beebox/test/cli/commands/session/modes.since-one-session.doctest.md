# `bbx session <id> --since` windows one named session

`--since` alone shows every session with activity in the window. With a
session ID it shows only that session's new turns, which is how an agent
catches up on one long-running conversation without re-reading the whole
transcript. `--latest` with `--since` stays rejected.

```ts setup
import { mkdir, writeFile, utimes } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { resolveSince, runSinceMode } from "../../../../src/cli/commands/session/modes.js";
import { getSessionLogPath } from "../../../../src/core/chat/session/transcript-paths.js";

const box = await makeTmpBox();
process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("projects");

// One transcript: a user turn and an assistant reply per message, each with
// its own timestamp, so the window can split a session in the middle.
async function seed(id: string, turns: Array<{ at: string; text: string }>): Promise<void> {
  const logPath = getSessionLogPath(box.root, id);
  await mkdir(dirname(logPath), { recursive: true });
  const lines = turns.flatMap((turn, i) => [
    { type: "user", uuid: `${id}-u${String(i)}`, sessionId: id, timestamp: turn.at,
      message: { role: "user", content: turn.text } },
    { type: "assistant", uuid: `${id}-a${String(i)}`, sessionId: id, timestamp: turn.at,
      message: { role: "assistant", content: [{ type: "text", text: `reply to ${turn.text}` }] } },
  ]);
  await writeFile(logPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const last = new Date(turns[turns.length - 1]!.at);
  await utimes(logPath, last, last);
}

const alpha = "aaaa1111-0000-0000-0000-000000000001";
const beta = "bbbb2222-0000-0000-0000-000000000002";
await box.write(".beebox/chat-session-history.json", JSON.stringify({
  sessions: [{ id: alpha, contextDir: "" }, { id: beta, contextDir: "" }],
  migrated: true,
}));
await seed(alpha, [
  { at: "2026-07-01T10:00:00Z", text: "alpha old question" },
  { at: "2026-07-03T10:00:00Z", text: "alpha new question" },
]);
await seed(beta, [
  { at: "2026-07-01T11:00:00Z", text: "beta old question" },
  { at: "2026-07-03T11:00:00Z", text: "beta new question" },
]);

// Collect what a mode prints.
async function printed(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { await run(); } finally { console.log = original; }
  return lines.join("\n");
}

// The user questions a rendered window contains, in order.
function questions(output: string): string[] {
  return [...output.matchAll(/\b(?:alpha|beta) (?:old|new) question\b/g)]
    .map((m) => m[0])
    .filter((q, i, all) => all.indexOf(q) === i);
}

const since = resolveSince("2026-07-02T00:00:00Z");
const renderOptions = { full: false, dialogueOnly: true };
const common = { boxRoot: box.root, since, renderOptions, raw: false, toolReport: false, allowHuge: false };
```

## Without an ID, every session's new turns

```ts
questions(await printed(() => runSinceMode(common)))
=> ["alpha new question", "beta new question"]
```

## With an ID, only that session's new turns

```ts
questions(await printed(() => runSinceMode({ ...common, sessionId: alpha })))
=> ["alpha new question"]
```

## A named session with nothing new says so

```ts
const later = resolveSince("2026-07-04T00:00:00Z");
await printed(() => runSinceMode({ ...common, since: later, sessionId: beta }))
=> No activity in session bbbb2222-0000-0000-0000-000000000002 since 2026-07-04T00:00:00.000Z.
```

```ts teardown
delete process.env["BBX_CLAUDE_PROJECTS_DIR"];
await box.cleanup();
```
