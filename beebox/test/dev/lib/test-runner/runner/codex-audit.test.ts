// # Codex knowledge-audit behavior
//
// Codex audit evidence comes from the official SDK activity surface. Shell
// commands are retained both as Bash activity and as read evidence, allowing the
// existing path-oriented checks to work without inventing a Claude-style Read tool.

import { test } from "tap";
import "agent-doctest/tap";
import { codexBehaviorFromActivity } from "../../../../../src/dev/lib/test-runner/runner/codex-audit.js";
import { emitObservedActivity } from "../../../../../src/core/agent/codex-run/activity.js";
import type { CodexObservedActivity } from "../../../../../src/core/agent/codex-run/activity.js";

const behavior = codexBehaviorFromActivity([
  { type: "command", command: "sed -n '1,80p' node_modules/beebox/box-docs/card-image.md" },
  { type: "command", command: "/opt/homebrew/bin/bash -lc \"sed -n '1,80p' node_modules/beebox/box-docs/card-image.md && rg -n EXIF node_modules/beebox/box-docs\"" },
  { type: "command", command: "rg -n EXIF node_modules/beebox/box-docs" },
  { type: "search", tool: "WebSearch", summary: "EXIF DateTimeOriginal" },
], "  The date comes from EXIF.  ");

// The typed SDK item feeds the audit activity mapper directly:
void test("The typed SDK item feeds the audit activity mapper directly:", async (t) => {
  // doctest:L23
  const observed: CodexObservedActivity[] = [];
  const completed = {
    id: "command-1",
    type: "command_execution" as const,
    command: "/bin/bash -lc 'cat AGENTS.md'",
    aggregated_output: "instructions",
    exit_code: 0,
    status: "completed" as const,
  };
  emitObservedActivity(completed, (activity) => observed.push(activity));
  t.check(observed, [
    {
      type: "command",
      command: "/bin/bash -lc 'cat AGENTS.md'",
    },
  ]);
});

void test("line 37", async (t) => {
  // doctest:L38
  const summary = JSON.stringify({
    readCount: behavior.filesRead.length,
    wrappedReadDetected: behavior.filesRead.some((command) => command.includes("bash -lc")),
    bashCount: behavior.bashRawCommands.length,
    searchCount: behavior.searches.length,
    response: behavior.responseText,
    words: behavior.responseLength,
    context: behavior.context,
  });
  await t.checkText(summary, "{\"readCount\":3,\"wrappedReadDetected\":true,\"bashCount\":3,\"searchCount\":3,\"response\":\"The date comes from EXIF.\",\"words\":5,\"context\":null}");
});

// An `AGENTS.md` read keeps its own name; nothing rewrites it to `CLAUDE.md`:
void test("An AGENTS.md read keeps its own name; nothing rewrites it to CLAUDE.md:", async (t) => {
  // doctest:L54
  const agentsRead = codexBehaviorFromActivity([
    { type: "command", command: "cat people/AGENTS.md" },
  ], "ok");
  t.check(agentsRead.filesRead, [
    "cat people/AGENTS.md",
  ]);
});
