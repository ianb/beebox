// # Activity row wording (`activity-wording.ts`)
//
// The chat's activity row tells a non-technical person what the box agent did,
// without the agent's tool vocabulary. The raw input stays one click away in the
// expanded line; only the label is lay language.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import {
  describeToolCall,
  describeToolDetail,
  summarizeActivity,
  type Excerpt,
} from "../../src/components/chat/ChatMessages/activity-wording.js";
import type { SessionContentBlock } from "../../src/api-chat.js";
import type { ActivityPart } from "../../src/components/chat/assistant-parts.js";

function tool(toolName: string, input: Record<string, unknown>): SessionContentBlock {
  return { type: "tool_use", toolName, input };
}
function tools(...blocks: SessionContentBlock[]): ActivityPart {
  return { type: "tools", tools: blocks };
}
// Narrows an excerpt to the change form, failing the test if there is none.
function change(excerpt: Excerpt | null): Extract<Excerpt, { kind: "change" }> {
  assert.ok(excerpt && excerpt.kind === "change");
  return excerpt;
}
function say(toolName: string, input: Record<string, unknown>) {
  return describeToolCall(tool(toolName, input));
}
// A finished call: the result is grafted onto it, as the history read does.
function detail(toolName: string, input: Record<string, unknown>) {
  return describeToolDetail({ ...tool(toolName, input), resultSummary: "The file has been updated." });
}

// ## Collapsed summary
//
// Tools fall into groups, and TodoWrite is not counted. Lookups say where they
// looked: the person's box, or the web.
void test("Tools fall into groups, and TodoWrite is not counted.", async (t) => {
  t.check(summarizeActivity([{ type: "thinking" }, tools(tool("Read", {}), tool("Grep", {}), tool("Bash", {}))]), "thought it over, checked 2 things in your box, took a step");

  t.check(summarizeActivity([tools(tool("Edit", {}), tool("Write", {}), tool("Bash", {}), tool("mcp__x__y", {}))]), "made 2 changes, took 2 steps");

  t.check(summarizeActivity([tools(tool("Task", {}), tool("Agent", {}), tool("WebFetch", {}))]), "handed off 2 tasks, read a web page");

  t.check(summarizeActivity([tools(tool("WebSearch", {}), tool("WebSearch", {}), tool("WebFetch", {}), tool("WebFetch", {}), tool("Read", {}))]), "searched the web 2 times, read 2 web pages, checked something in your box");

  t.check(summarizeActivity([tools(tool("TodoWrite", {}), tool("TodoWrite", {}))]), "working");
});

// Folded notes are not steps: they name the row only when it holds nothing else.
void test("Folded notes are not steps.", async (t) => {
  t.check(summarizeActivity([{ type: "note", text: "Checking." }, tools(tool("Edit", {}))]), "made a change");
  t.check(summarizeActivity([{ type: "note", text: "Checking." }]), "noted progress");
});

// ## Card paths
//
// The title is the file name without `.card` and the type suffix, with spaces:
void test("The title is the file name without .card and the type suffix, with spaces:", async (t) => {
  const card = "_content/people/Ana_Reyes.person.card";
  t.check([say("Read", { file_path: card }), say("Edit", { file_path: card }), say("Write", { file_path: card })], [
    "Looked at Ana Reyes",
    "Updated Ana Reyes",
    "Saved Ana Reyes",
  ]);
});

// ## Schema files
//
// A schema is a new kind of thing the person can keep, so the line names the
// place it makes, not the file or the word "schema":
void test("A schema is a new kind of thing the person can keep, so the line names the pl...", async (t) => {
  t.check(
    [
      say("Write", { file_path: "_config/schemas/loan.ts" }),
      say("Edit", { file_path: "schemas/lending-item.ts" }),
      say("Read", { file_path: "schemas/lending-item.ts" }),
    ],
    [
    "Set up a place for your loans",
    "Changed how your lending items are kept",
    "Checked something in your box",
  ],
  );
});

// The plural follows ordinary English endings:
void test("The plural follows ordinary English endings:", async (t) => {
  t.check([say("Write", { file_path: "schemas/inventory.ts" }), say("Write", { file_path: "schemas/box.ts" })], [
    "Set up a place for your inventories",
    "Set up a place for your boxes",
  ]);
});

// ## Documents
//
// A file in the person's content folder that is not a card is named by its
// file name, without the extension. Paths arrive absolute or box-relative; the
// `_content` folder itself is never named.
void test("A file in the person's content folder that is not a card is named by its file...", async (t) => {
  const doc = "/srv/box/_content/lists/Errands.md";
  t.check([say("Read", { file_path: doc }), say("Edit", { file_path: doc }), say("Write", { file_path: doc })], [
    "Looked at Errands",
    "Made a change to Errands",
    "Saved Errands",
  ]);
});

// A Codex file change that touched several files names the first and counts
// the rest:
void test("A Codex file change that touched several files names the first and counts the...", async (t) => {
  t.check(say("Edit", { file_path: "_content/lists/Errands.md", file_paths: ["_content/lists/Errands.md", "_content/a.md", "_content/b.md"] }), "Made a change to Errands and 2 more");
});

// ## Other paths
//
// Agent machinery and paths outside the content folder keep the generic line:
void test("Agent machinery and paths outside the content folder keep the generic line:", async (t) => {
  t.check(
    [
      say("Read", { file_path: "notes/todo.txt" }),
      say("Edit", { file_path: "/box/_config/settings.yaml" }),
      say("Write", {}),
      say("Edit", { file_path: "/box/_content/" }),
    ],
    [
    "Checked something in your box",
    "Made a change",
    "Made a change",
    "Made a change",
  ],
  );
});

// ## Bash
//
// The description is shown, capitalized; the command text never is:
void test("The description is shown, capitalized; the command text never is:", async (t) => {
  t.check(
    [
      say("Bash", { description: "check the loan dates", command: "rm -rf x" }),
      say("Bash", { command: "rm -rf x" }),
    ],
    [
    "Check the loan dates",
    "Took a step",
  ],
  );
});

// ## Everything else
void test("Everything else", async (t) => {
  t.check(
    [
      say("Grep", {}),
      say("Glob", { pattern: "*.ts" }),
      say("WebSearch", { query: "library loan rules" }),
      say("WebFetch", { url: "https://example.com/a/b?c=1" }),
      say("WebFetch", { url: "nonsense" }),
      say("TodoWrite", {}),
      say("Agent", { description: "Sort the shelf" }),
      say("Task", {}),
    ],
    [
    "Searched your box",
    "Looked through your box",
    "Searched the web for \"library loan rules\"",
    "Read a page on example.com",
    "Read a web page",
    "Updated the plan",
    "Sort the shelf",
    "Handed off a task",
  ],
  );
});

// An unknown tool (an MCP tool, a future built-in) gets the neutral label: its
// name and its input summary, raw JSON for most, are plumbing and stay in the
// expanded detail.
void test("An unknown tool (an MCP tool, a future built-in) gets the neutral label:", async (t) => {
  t.check(describeToolCall({ type: "tool_use", toolName: "mcp__x__lookup", inputSummary: "{\"q\":\"drill\"}" }), "Took a step");
});

// ## Searches in the box
//
// A search for plain words says what it looked for. A Glob's `**/` and outer
// `*` are trimmed first. A pattern for every card of one type names the type.
// A `.` is plain in a Glob but a wildcard in a Grep regex.
// A regex or other file pattern keeps the plain line, and the expanded line
// shows the pattern under it.
void test("A search for plain words says what it looked for.", async (t) => {
  t.check(
    [
      say("Grep", { pattern: "lease" }),
      say("Grep", { pattern: "Lemon Chicken" }),
      say("Glob", { pattern: "**/*recipe*" }),
      say("Glob", { pattern: "**/*.lending-item.card" }),
      say("Grep", { pattern: "due:\\s*2026" }),
      say("Grep", { pattern: "lease.*" }),
      say("Glob", { pattern: "**/*.card" }),
      say("Glob", { pattern: "Errands.md" }),
    ],
    [
    "Searched your box for \"lease\"",
    "Searched your box for \"Lemon Chicken\"",
    "Looked through your box for \"recipe\"",
    "Looked through your box for lending item cards",
    "Searched your box",
    "Searched your box",
    "Looked through your box",
    "Looked through your box for \"Errands.md\"",
  ],
  );

  t.check([detail("Grep", { pattern: "lease" }).excerpt, detail("Grep", { pattern: "due:\\s*2026" }).excerpt], [
    null,
    {
      kind: "text",
      label: "Looked for",
      text: "due:\\s*2026",
    },
  ]);
});

// ## Detail on an expanded line
//
// The place is the folder a content file sits in. A file in a card's
// `.attach/` folder sits in that card. The top of the content folder and
// anything outside it have no place.
void test("The place is the folder a content file sits in.", async (t) => {
  t.check(
    [
      detail("Edit", { file_path: "/box/_content/recipes/Lemon_Chicken.recipe.card" }).place,
      detail("Read", { file_path: "_content/recipes/Lemon_Chicken.attach/oven_photo.jpg" }).place,
      detail("Read", { file_path: "_content/briefing.md" }).place,
      detail("Read", { file_path: "_config/schemas/loan.ts" }).place,
      detail("Grep", { pattern: "lease", path: "_content/people" }).place,
    ],
    [
    "in recipes",
    "in Lemon Chicken",
    null,
    null,
    null,
  ],
  );
});

// A finished edit or new file in the content folder names the file the line
// links to, by the name the sentence uses. A read, an edit still running, and a
// file outside the content folder link nothing. A Codex change has no result;
// its `completed` status marks it finished, and one across several files links
// the first.
void test("A finished edit or new file in the content folder names the file the line lin...", async (t) => {
  t.check(
    [
      detail("Edit", { file_path: "/box/_content/recipes/Lemon_Chicken.recipe.card" }).opens,
      detail("Write", { file_path: "_content/Errands.md" }).opens,
      describeToolDetail(tool("Edit", { file_path: "_content/a.md", file_paths: ["_content/a.md", "_content/b.md"], status: "completed" })).opens,
      describeToolDetail(tool("Edit", { file_path: "_content/a.md", status: "inProgress" })).opens,
      detail("Read", { file_path: "_content/Errands.md" }).opens,
      describeToolDetail(tool("Edit", { file_path: "_content/Errands.md" })).opens,
      detail("Edit", { file_path: "_config/schemas/loan.ts" }).opens,
    ],
    [
    {
      path: "_content/recipes/Lemon_Chicken.recipe.card",
      name: "Lemon Chicken",
    },
    {
      path: "_content/Errands.md",
      name: "Errands",
    },
    {
      path: "_content/a.md",
      name: "a",
    },
    null,
    null,
    null,
    null,
  ],
  );
});

// An edit shows what it replaced and with what, trimmed. An edit that
// replaces every match says so.
void test("An edit shows what it replaced and with what, trimmed.", async (t) => {
  t.check(detail("Edit", { file_path: "_content/recipes/Lemon_Chicken.recipe.card", old_string: "Bake at 350°\n", new_string: "Bake at 375°\n" }).excerpt, {
    kind: "change",
    before: "Bake at 350°",
    after: "Bake at 375°",
    everywhere: false,
  });

  t.check(change(detail("Edit", { old_string: "Marta", new_string: "Martha", replace_all: true }).excerpt).everywhere, true);
});

// Lines the edit kept at its start and end are dropped, so an added line
// reads as an addition:
void test("Lines the edit kept at its start and end are dropped, so an added line reads...", async (t) => {
  t.check(detail("Edit", { old_string: "- pick up chicken", new_string: "- pick up chicken\n- lemons (3)" }).excerpt, {
    kind: "change",
    before: "",
    after: "- lemons (3)",
    everywhere: false,
  });

  t.check(detail("Edit", { old_string: "# Errands\n- milk\n- eggs", new_string: "# Errands\n- oat milk\n- eggs" }).excerpt, {
    kind: "change",
    before: "- milk",
    after: "- oat milk",
    everywhere: false,
  });
});

// Indentation is kept, since it can be the whole change:
void test("Indentation is kept, since it can be the whole change:", async (t) => {
  t.check(detail("Edit", { old_string: "due:\n  - today", new_string: "due:\n    - today" }).excerpt, {
    kind: "change",
    before: "  - today",
    after: "    - today",
    everywhere: false,
  });
});

// An edit with no result yet (still running, or interrupted) is only what the
// agent asked for, so it has no excerpt:
void test("An edit with no result yet (still running, or interrupted) is only what the a...", async (t) => {
  t.check(describeToolDetail(tool("Edit", { old_string: "350°", new_string: "375°" })), {
    place: null,
    failed: false,
    excerpt: null,
    opens: null,
  });
});

// Deleting text leaves an empty after side; an edit with no text on either
// side, or with the fields missing (a Codex change, a block still streaming),
// has no excerpt and opens straight to the raw input.
void test("Deleting text leaves an empty after side; an edit with no text on either side...", async (t) => {
  t.check(
    [
      detail("Edit", { old_string: "- buy milk", new_string: "" }).excerpt,
      detail("Edit", { old_string: " ", new_string: "\n" }).excerpt,
      detail("Edit", { file_path: "_content/a.md", status: "completed" }).excerpt,
      detail("Edit", { old_string: 3, new_string: "x" }).excerpt,
    ],
    [
    {
      kind: "change",
      before: "- buy milk",
      after: "",
      everywhere: false,
    },
    null,
    null,
    null,
  ],
  );
});

// Long text is cut to three lines and 200 characters, marked with "…":
void test("Long text is cut to three lines and 200 characters, marked with \"…\":", async (t) => {
  const long = change(detail("Edit", { old_string: "a\nb\nc\nd\ne", new_string: "x".repeat(300) }).excerpt);
  t.check([long.before, long.after.length, long.after.endsWith("…")], [
    `a
b
c…`,
    201,
    true,
  ]);
});

// A step whose result is an error did not change anything. It is marked, and
// its excerpt is dropped so the asked-for text does not read as done:
void test("A step whose result is an error did not change anything.", async (t) => {
  const failed = { ...tool("Edit", { file_path: "_content/recipes/Lemon_Chicken.recipe.card", old_string: "350°", new_string: "375°" }), resultSummary: "<tool_use_error>String to replace not found in file." };
  t.check(describeToolDetail(failed), {
    place: "in recipes",
    failed: true,
    excerpt: null,
    opens: null,
  });

  t.check(describeToolDetail({ ...tool("Edit", { old_string: "350°", new_string: "375°" }), resultSummary: "The file has been updated." }).failed, false);
});

// A step with nothing plain to add has no excerpt: a command, an unknown
// tool, a read, and a new file (its text is the whole file, not a change):
void test("A step with nothing plain to add has no excerpt:", async (t) => {
  t.check(
    [
      detail("Bash", { description: "check dates", command: "ls" }).excerpt,
      detail("mcp__x__y", {}).excerpt,
      detail("Read", { file_path: "_content/a.md" }).excerpt,
      detail("Write", { file_path: "_content/lists/Errands.md", content: "# Errands\n\n- post office\n" }).excerpt,
    ],
    [
    null,
    null,
    null,
    null,
  ],
  );
});

// ## Card paths with hyphens, dots and no name
//
// The title reads like the card's name everywhere else: `-` runs become spaces
// too, a dotted name keeps its dots, and a positional card reads as its type.
void test("Card titles read hyphens as spaces, keep dotted names, and name a positional card by its type", async (t) => {
  t.check(
    [
      say("Read", { file_path: "_content/Lemon-Chicken.recipe.card" }),
      say("Read", { file_path: "_content/Foo.v2.doc.card" }),
      say("Read", { file_path: "_content/nav.card" }),
    ],
    ["Looked at Lemon Chicken", "Looked at Foo.v2", "Looked at nav"],
  );
});
