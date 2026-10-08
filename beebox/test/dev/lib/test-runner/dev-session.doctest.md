# Dev-guidance knowledge-audit sessions

A `surface: dev` audit runs `claude -p` in the monorepo checkout and reads its
`stream-json` output. Read calls become repo-relative reads, a Skill call
counts as a read of that skill's `SKILL.md`, and usage repeated across one
message's content blocks counts once.

```ts setup
import { devBehaviorFromStreamJson, devClaudeArgs } from "../../../../src/dev/lib/test-runner/dev-session.js";
import { auditTestSchema } from "../../../../src/dev/lib/test-suite-schema.js";

const usage = { input_tokens: 9, cache_creation_input_tokens: 36550, cache_read_input_tokens: 0 };
const later = { input_tokens: 10, cache_creation_input_tokens: 9220, cache_read_input_tokens: 36550 };
const lines = [
  { type: "system", subtype: "init", session_id: "s-1" },
  { type: "assistant", message: { id: "m1", usage, content: [{ type: "thinking", thinking: "" }] } },
  { type: "assistant", message: { id: "m1", usage, content: [{ type: "tool_use", name: "Skill", input: { skill: "box-work" } }] } },
  { type: "user", message: { content: [{ type: "tool_result" }] } },
  { type: "assistant", message: { id: "m2", usage: later, content: [{ type: "tool_use", name: "Read", input: { file_path: "/repo/beebox/docs/box-work.md" } }] } },
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
and drops user MCP servers:

```ts
const args = devClaudeArgs({ model: "claude-sonnet-4-6", maxTurns: 10 });
JSON.stringify([args.includes("--strict-mcp-config"), args[args.indexOf("--tools") + 1], args[args.indexOf("--setting-sources") + 1], args[args.indexOf("--settings") + 1]])
=> [true,"Read,Grep,Glob,Skill","project","{\"disableAllHooks\":true}"]
```

Box-only fields are refused on a dev audit at load time:

```ts
const parsed = auditTestSchema.safeParse({
  id: "x", surface: "dev", prompt: "?", expected_level: "knows_about", watch_for: "-", cards_contain: ["a"],
});
parsed.success ? "accepted" : parsed.error.issues.map((issue) => issue.path.join(".")).join(",")
=> cards_contain
```
