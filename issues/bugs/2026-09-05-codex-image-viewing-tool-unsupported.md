---
title: "Codex sometimes calls an image-viewing tool that beebox chat does not support"
workstream: unattached
area: beebox
priority: normal
labels: [chat, codex]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "codex will sometimes call a show-image tool of some sort, but we don't support that"
---

In a Codex chat the model sometimes calls a tool to show or view an image,
and beebox does not support it: the call is not rendered as an activity and
whatever it was meant to do (show the boxholder an image, or look at one
itself) does not happen.

What is known and what is not:

- The tool's exact name has not been captured. Codex CLI has a built-in
  `view_image` tool (the model reads a local image file into context); the
  SDK may surface it as a thread item type beebox's mapper has never seen.
  `src/services/codex-tool-activity.ts` maps the known item kinds
  (`command_execution`, `file_change`, `web_search`, `mcp_tool_call`,
  `todo_list`) and logs once per unknown type:
  `[codex-tool-activity] unknown Codex item type "…" — not rendered as
  activity`. The box's `.beebox/hub-child.log` for the session where it
  happened should carry that line with the real type name; start there.
- Two different asks may hide under "show image": the model viewing an
  image (a Read-like tool that should render as a tool_use with the path),
  and the model presenting an image to the boxholder (which beebox does via
  markdown image links in the reply, not a tool). If Codex is reaching for a
  tool for the second one, the box's Codex guidance (`plugins/beebox-codex`,
  the generated agent guide) should say how images are shown here.

Reproduce: ask a Codex chat to look at a photo in the box, or to show one;
watch the activity strip and the hub-child log.
