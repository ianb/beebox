// The driver rejects a batch whose worker ran a forbidden command, read from
// either CLI's JSON transcript.

import { test } from "tap";
import "agent-doctest/tap";
import { commandsIn } from "../../doctest-convert/dispatch.ts";

void test("commands from Claude and Codex transcripts", async (t) => {
  const transcript = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm install" } }] } }),
    "a plain-text line",
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "/bin/zsh -lc 'node --import tsx bin/doctest-convert.ts check x'" } }),
    JSON.stringify({ msg: { type: "exec_command_begin", command: ["bash", "-lc", "git status"] } }),
  ].join("\n");
  t.check(commandsIn(transcript), ["pnpm install", "/bin/zsh -lc 'node --import tsx bin/doctest-convert.ts check x'", "bash -lc git status"]);
});
