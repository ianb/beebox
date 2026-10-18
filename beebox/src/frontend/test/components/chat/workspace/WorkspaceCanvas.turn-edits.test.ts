// # Which open documents a running turn is editing
//
// The companion panel says "Updating…" on a document the chat turn is editing.
// Before the write lands, the only evidence is the edit tool call itself, so
// `toolEditsPath` decides whether one names the open tab's path. Tool inputs
// carry absolute paths; tabs hold box-relative ones.

import { test } from "tap";
import "agent-doctest/tap";
import { toolEditsPath } from "../../../../src/components/chat/workspace/WorkspaceCanvas/turn-edits.js";
import type { SessionContentBlock } from "../../../../src/api.js";

const tab = "_content/lending/lent.card";
const tool = (toolName: string, input: Record<string, unknown>): SessionContentBlock => ({ type: "tool_use", toolName, input });

void test("an edit tool naming the open document counts", async (t) => {
  t.check(toolEditsPath(tool("Edit", { file_path: `/Users/me/boxes/home/${tab}` }), tab), true);
  t.check(toolEditsPath(tool("Write", { file_path: tab }), `/${tab}`), true);
  t.check(toolEditsPath(tool("NotebookEdit", { notebook_path: `/box/${tab}` }), tab), true);
  // Codex reports one change to several files as `file_paths`.
  t.check(toolEditsPath(tool("file_change", { file_paths: ["/box/a.md", `/box/${tab}`] }), tab), true);
});

void test("a read, another file, or a path that only shares a suffix does not", async (t) => {
  t.check(toolEditsPath(tool("Read", { file_path: `/box/${tab}` }), tab), false);
  t.check(toolEditsPath(tool("Edit", { file_path: "/box/_content/lending/other.card" }), tab), false);
  t.check(toolEditsPath(tool("Edit", { file_path: "/box/_content/lending/overlent.card" }), "lent.card"), false);
  // A shell command names no path the UI can trust; file-change events cover it.
  t.check(toolEditsPath(tool("Bash", { command: `bbx edit ${tab}` }), tab), false);
  t.check(toolEditsPath({ type: "text", text: tab }, tab), false);
});
