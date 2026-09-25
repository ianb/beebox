# Progress updates render as visible lines

Claude 5-family models can write a *progress update* before a tool call: a
line meant for the user. The API returns it as a `thinking` block with text.
Claude Code requests `thinking.display: "updates"` for these models, so their
reasoning blocks come back empty. Any thinking text from them is an update,
and the API hands back only a summary of it.

A model sometimes puts its whole answer in an update and ends the turn with a
tool call and an `<ack>`. When the chat UI filed updates under the collapsed
"thinking" row, the user saw nothing at all. Now an update renders as its own
visible line, in order between the tool groups. This holds on the history
path (the session transcript) and on the live stream.

```ts setup
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSessionLog } from "../../src/cli/lib/session.js";
import { writesProgressUpdates } from "../../src/shared/model-ids.js";
import { handleTurnMessage } from "../../src/frontend/src/machines/chat-actors.js";
import { groupIntoParts, hasProgressUpdate } from "../../src/frontend/src/components/chat/message-parsing.js";
import { buildStreamEntry } from "../../src/frontend/src/lib/stream-entry.js";
import type { ChatMessage } from "../../src/core/chat/session/messages.js";
import type { ChatEvent } from "../../src/frontend/src/machines/chat-types.js";
import type { SessionContentBlock, SessionEntry } from "../../src/frontend/src/api-chat.js";

const ALL = { mode: "page", offset: 0, limit: 5000 };
const dir = await mkdtemp(join(tmpdir(), "bbx-progress-updates-"));

// One transcript line per content block, as Claude Code writes them.
let n = 0;
function assistantLine(model: string, block: Record<string, unknown>): string {
  n += 1;
  return JSON.stringify({
    type: "assistant", uuid: `a${n}`, timestamp: "2026-09-25T00:00:00Z",
    message: { role: "assistant", model, content: [block] },
  });
}
function toolResultLine(id: string): string {
  n += 1;
  return JSON.stringify({
    type: "user", uuid: `r${n}`, timestamp: "2026-09-25T00:00:00Z",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
  });
}
const reasoning = { type: "thinking", thinking: "", signature: "sig" };
const update = (text: string) => ({ type: "thinking", thinking: text, signature: "sig" });
const bash = (id: string) => ({ type: "tool_use", id, name: "Bash", input: { command: "true" } });
const text = (t: string) => ({ type: "text", text: t });

// The shape of the failing turn: reasoning, update, tool; reasoning, update,
// tool; then a bare ack as the only text.
function failingTurn(model: string): string[] {
  return [
    assistantLine(model, reasoning),
    assistantLine(model, update("I've laid out the setup.")),
    assistantLine(model, bash("t1")),
    toolResultLine("t1"),
    assistantLine(model, reasoning),
    assistantLine(model, update("I've resent the summary.")),
    assistantLine(model, bash("t2")),
    toolResultLine("t2"),
    assistantLine(model, text('<ack kind="appended" ref="/_content/plan.doc.card"/>')),
  ];
}

// One line per rendered group: text and updates show their text, an activity
// group shows its parts (thinking rows that would render, and tool counts).
function describe(entries: SessionEntry[]): string {
  return groupIntoParts(entries).map((g) => {
    if (g.kind !== "activity") return `${g.kind}: ${g.text}`;
    const parts = g.parts.map((p) => p.type === "tools" ? `tools(${p.tools.length})` : p.text?.trim() ? `thinking(${p.text})` : "thinking(empty)");
    return `activity: ${parts.join(", ")}`;
  }).join("\n");
}

async function historyOf(lines: string[]): Promise<SessionEntry[]> {
  const logPath = join(dir, `log-${n}.jsonl`);
  await writeFile(logPath, lines.join("\n"));
  const { entries } = await parseSessionLog({ logPath, slice: ALL });
  return entries.filter((e) => e.type === "assistant");
}

// Drive the live handler with one assistant frame per block and build the
// provisional entry the chat renders during the turn.
function liveOf(model: string, blocks: Record<string, unknown>[]): SessionEntry[] {
  const state = { sawTextPartial: false };
  let streamText = "";
  const streamTools: SessionContentBlock[] = [];
  const sink = (e: ChatEvent): void => {
    if (e.type === "STREAM_TEXT") streamText += e.text;
    if (e.type === "STREAM_TOOL") streamTools.push(e.tool);
  };
  for (const block of blocks) {
    const msg = { type: "assistant", session_id: "s", message: { role: "assistant", model, content: [block] } } as ChatMessage;
    handleTurnMessage(msg, { sessionInput: "s", sendBack: sink, terminal: sink, state });
  }
  return [buildStreamEntry({ uuid: "live", streamText, streamTools })];
}
```

## Which models write progress updates

Claude 5 and later do. Claude 4 and earlier return summarized reasoning in the
same field. Other providers' models and a missing model get no updates.

```ts
["claude-fable-5-1", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "glm-5.3", undefined]
  .map((model) => `${String(model)}: ${writesProgressUpdates(model)}`).join("\n");
=>
claude-fable-5-1: true
claude-opus-5: true
claude-opus-5-5: true
claude-sonnet-5: true
claude-sonnet-4-6: false
claude-haiku-4-5-20251001: false
glm-5.3: false
undefined: false
```

## History: the failing turn now shows both updates

Each update is a visible line before the tool call it introduces. The empty
reasoning blocks stay in activity groups and render nothing. The bare ack is
the only text; the chat hangs it on the user's message as a badge.

```ts
describe(await historyOf(failingTurn("claude-fable-5-1")));
=>
activity: thinking(empty)
update: I've laid out the setup.
activity: tools(1), thinking(empty)
update: I've resent the summary.
activity: tools(1)
text: <ack kind="appended" ref="/_content/plan.doc.card"/>
```

## History: an older model's reasoning stays collapsed

Sonnet 4.6 returns summarized reasoning in the same field. That is not written
for the user, so it stays inside the collapsed activity group.

```ts
describe(await historyOf([
  assistantLine("claude-sonnet-4-6", update("Let me check the file first.")),
  assistantLine("claude-sonnet-4-6", bash("t3")),
  toolResultLine("t3"),
  assistantLine("claude-sonnet-4-6", text("Done.")),
]));
=>
activity: thinking(Let me check the file first.), tools(1)
text: Done.
```

## Live stream: updates keep their place between tool calls

The live turn gets the same groups as the reloaded history. An update rides
the stream's tool list, so it keeps its position between tool calls. An older
model's reasoning is not surfaced live at all.

```ts
const blocks = [reasoning, update("Checking DNS."), bash("t1"), reasoning, update("Writing the plan."), bash("t2"), text("All set.")];
print(describe(liveOf("claude-fable-5-1", blocks)));
print("--");
print(describe(liveOf("claude-sonnet-4-6", blocks)));
=>
update: Checking DNS.
activity: tools(1)
update: Writing the plan.
activity: tools(1)
text: All set.
--
activity: tools(2)
text: All set.
```

## A no-response ack does not hide the updates

A turn whose only text is a `no-response` ack is normally left out of the
list. `buildDataItems` keeps it when `hasProgressUpdate` finds an update, so
the update still renders. An older model's reasoning does not count.

```ts
const quietTurn = (model: string) => [
  assistantLine(model, update("Nothing needed; the plan already covers it.")),
  assistantLine(model, text('<ack kind="no-response"/>')),
];
print(`claude-fable-5-1: ${hasProgressUpdate(await historyOf(quietTurn("claude-fable-5-1")))}`);
print(`claude-sonnet-4-6: ${hasProgressUpdate(await historyOf(quietTurn("claude-sonnet-4-6")))}`);
=>
claude-fable-5-1: true
claude-sonnet-4-6: false
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
