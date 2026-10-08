# Dev-guidance knowledge-audit sessions

A `surface: dev` audit runs `claude -p` in the monorepo checkout and reads its
`stream-json` output. Read calls become repo-relative reads, a Skill call
counts as a read of that skill's `SKILL.md`, a call whose tool result is an
error (a missing file) counts as no read, and usage repeated across one
message's content blocks counts once.

```ts setup
import { devBehaviorFromStreamJson, devClaudeArgs } from "../../../../src/dev/lib/test-runner/dev-session.js";
import { auditTestSchema } from "../../../../src/dev/lib/test-suite-schema.js";

const usage = { input_tokens: 9, cache_creation_input_tokens: 36550, cache_read_input_tokens: 0 };
const later = { input_tokens: 10, cache_creation_input_tokens: 9220, cache_read_input_tokens: 36550 };
const lines = [
  { type: "system", subtype: "init", session_id: "s-1" },
  { type: "assistant", message: { id: "m1", usage, content: [{ type: "thinking", thinking: "" }] } },
  { type: "assistant", message: { id: "m1", usage, content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "box-work" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } },
  { type: "assistant", message: { id: "m2", usage: later, content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "/repo/beebox/docs/box-work.md" } }] } },
  { type: "assistant", message: { id: "m2", usage: later, content: [{ type: "tool_use", id: "t3", name: "Read", input: { file_path: "/repo/beebox/docs/missing.md" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2" }, { type: "tool_result", tool_use_id: "t3", is_error: true }] } },
  { type: "assistant", message: { id: "m2", usage: later, content: [{ type: "tool_use", name: "Grep", input: { pattern: "spirit", path: "beebox/docs" } }] } },
  { type: "assistant", message: { id: "m3", usage: later, content: [{ type: "text", text: "  Outside every repo.  " }] } },
  { type: "result", subtype: "success", session_id: "s-1" },
].map((line) => JSON.stringify(line));
const trace = devBehaviorFromStreamJson([...lines, ""], "/repo");
```

```ts
JSON.stringify({
  reads: trace.behavior.filesRead,
  searches: trace.behavior.searches,
  response: trace.behavior.responseText,
  words: trace.behavior.responseLength,
  context: trace.behavior.context,
  sessionId: trace.sessionId,
  result: trace.resultSubtype,
})
=> {"reads":[".claude/skills/box-work/SKILL.md","beebox/docs/box-work.md"],"searches":[{"tool":"Grep","summary":"spirit in beebox/docs"}],"response":"Outside every repo.","words":3,"context":{"initialTokens":36559,"peakTokens":45780,"addedTokens":9221,"turnCount":3},"sessionId":"s-1","result":"success"}
```

A session stopped at the turn limit reports its result subtype, which the
runner turns into an error instead of grading a partial answer:

```ts
devBehaviorFromStreamJson([JSON.stringify({ type: "result", subtype: "error_max_turns" })], "/repo").resultSubtype
=> error_max_turns
```

The session is read-only, loads project settings and skills with hooks off,
drops user MCP servers, and cannot read the audit answer key:

```ts
const args = devClaudeArgs({ model: "claude-sonnet-4-6", maxTurns: 10 });
const settings: unknown = JSON.parse(args[args.indexOf("--settings") + 1]);
JSON.stringify([args.includes("--strict-mcp-config"), args[args.indexOf("--tools") + 1], args[args.indexOf("--setting-sources") + 1], settings])
=> [true,"Read,Grep,Glob,Skill","project",{"disableAllHooks":true,"permissions":{"deny":["Read(./beebox/src/dev/knowledge-audits.yaml)","Read(./beebox/src/dev/context-history.yaml)","Read(./beebox/src/dev/reports/**)","Read(./scratch/**)"]}}]
```

Box-only fields are refused on a dev audit at load time:

```ts
const parsed = auditTestSchema.safeParse({
  id: "x", surface: "dev", prompt: "?", expected_level: "knows_about", watch_for: "-", cards_contain: ["a"],
});
parsed.success ? "accepted" : parsed.error.issues.map((issue) => issue.path.join(".")).join(",")
=> cards_contain
```
