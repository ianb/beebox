# Activity row wording (`activity-wording.ts`)

The chat's activity row tells a non-technical person what the box agent did,
without the agent's tool vocabulary. The raw input stays one click away in the
expanded line; only the label is lay language.

```ts setup
import {
  describeToolCall,
  summarizeActivity,
} from "../../src/components/chat/ChatMessages/activity-wording.js";

function tool(toolName, input) {
  return { type: "tool_use", toolName, input };
}
function tools(...blocks) {
  return { type: "tools", tools: blocks };
}
function say(toolName, input) {
  return describeToolCall(tool(toolName, input));
}
```

## Collapsed summary

Tools fall into four groups, and TodoWrite is not counted:

```ts
summarizeActivity([{ type: "thinking" }, tools(tool("Read", {}), tool("Grep", {}), tool("Bash", {}))])
=> thought it over, looked up 2 things, took a step

summarizeActivity([tools(tool("Edit", {}), tool("Write", {}), tool("Bash", {}), tool("mcp__x__y", {}))])
=> made 2 changes, took 2 steps

summarizeActivity([tools(tool("Task", {}), tool("Agent", {}), tool("WebFetch", {}))])
=> handed off 2 tasks, looked something up

summarizeActivity([tools(tool("TodoWrite", {}), tool("TodoWrite", {}))])
=> working
```

## Card paths

The title is the file name without `.card` and the type suffix, with spaces:

```ts
const card = "_content/people/Ana_Reyes.person.card";
[say("Read", { file_path: card }), say("Edit", { file_path: card }), say("Write", { file_path: card })]
=> ["Looked at Ana Reyes", "Updated Ana Reyes", "Saved Ana Reyes"]
```

## Schema files

A schema is a new kind of thing the person can keep, so the line names the
place it makes, not the file or the word "schema":

```ts
[
  say("Write", { file_path: "_config/schemas/loan.ts" }),
  say("Edit", { file_path: "schemas/lending-item.ts" }),
  say("Read", { file_path: "schemas/lending-item.ts" }),
]
=> ["Set up a place for your loans", "Changed how your lending items are kept", "Looked something up"]
```

The plural follows ordinary English endings:

```ts
[say("Write", { file_path: "schemas/inventory.ts" }), say("Write", { file_path: "schemas/box.ts" })]
=> ["Set up a place for your inventories", "Set up a place for your boxes"]
```

## Other paths

```ts
[say("Read", { file_path: "notes/todo.txt" }), say("Edit", { file_path: "notes/todo.txt" }), say("Write", {})]
=> ["Looked something up", "Made a change", "Made a change"]
```

## Bash

The description is shown, capitalized; the command text never is:

```ts
[
  say("Bash", { description: "check the loan dates", command: "rm -rf x" }),
  say("Bash", { command: "rm -rf x" }),
]
=> ["Check the loan dates", "Took a step"]
```

## Everything else

```ts
[
  say("Grep", { pattern: "x" }),
  say("Glob", { pattern: "*.ts" }),
  say("WebSearch", { query: "library loan rules" }),
  say("WebFetch", { url: "https://example.com/a/b?c=1" }),
  say("WebFetch", { url: "nonsense" }),
  say("TodoWrite", {}),
  say("Agent", { description: "Sort the shelf" }),
  say("Task", {}),
]
=> [
  "Searched the box",
  "Looked through the box",
  "Searched the web for \"library loan rules\"",
  "Read a page on example.com",
  "Read a web page",
  "Updated the plan",
  "Sort the shelf",
  "Handed off a task"
]
```

An unknown tool (an MCP tool, a future built-in) gets the neutral label: its
name and its input summary, raw JSON for most, are plumbing and stay in the
expanded detail.

```ts
describeToolCall({ type: "tool_use", toolName: "mcp__x__lookup", inputSummary: "{\"q\":\"drill\"}" })
=> Took a step
```
