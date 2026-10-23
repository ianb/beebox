// # Lines between steps fold into the activity row
//
// Claude 5-family models can write a *progress update* before a tool call: a
// line meant for the user. The API returns it as a `thinking` block with text.
// Claude Code requests `thinking.display: "updates"` for these models, so their
// reasoning blocks come back empty. Any thinking text from them is an update,
// and the API hands back only a summary of it. A model can also write plain
// text before a tool call ("Let me read how schemas work here first").
//
// Both kinds describe the work, not the result, so they fold into the activity
// row as notes; the reply is the text after the last tool call. A model
// sometimes puts its whole answer in an update and ends the turn with a tool
// call and an `<ack>`, so a turn with no visible reply keeps its last line
// visible. While a turn streams, the same rule shows the newest line until the
// next step folds it. This holds on the history path (the session transcript)
// and on the live stream.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSessionLog, type SessionLogSlice } from "../../../cli/lib/session.js";
import { writesProgressUpdates } from "../../../shared/model-ids.js";
import { handleTurnMessage } from "../../src/machines/chatMachine/chat-actors.js";
import { groupIntoParts, hasProgressUpdate } from "../../src/components/chat/assistant-parts.js";
import { buildStreamEntry } from "../../src/lib/stream-entry.js";
import type { ChatMessage, ChatMessageContent } from "../../../core/chat/session/messages.js";
import type { ChatEvent } from "../../src/machines/chat-types.js";
import type { SessionContentBlock, SessionEntry } from "../../src/api-chat.js";

const ALL: SessionLogSlice = { mode: "page", offset: 0, limit: 5000 };
const dir = await mkdtemp(join(tmpdir(), "bbx-progress-updates-"));

// One transcript line per content block, as Claude Code writes them.
let n = 0;
function assistantLine(model: string, block: object): string {
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
const reasoning = { type: "thinking", thinking: "", signature: "sig" } as const;
const update = (text: string) => ({ type: "thinking", thinking: text, signature: "sig" } as const);
const bash = (id: string) => ({ type: "tool_use", id, name: "Bash", input: { command: "true" } } as const);
const text = (t: string) => ({ type: "text", text: t } as const);

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
// group shows its parts (notes, thinking rows that would render, tool counts).
function describe(entries: SessionEntry[]): string[] {
  return groupIntoParts(entries).map((g) => {
    if (g.kind === "text") return `${g.proseHidden ? "callouts only" : "text"}: ${g.text}`;
    if (g.kind === "update") return `update: ${g.text}`;
    const parts = g.parts.map((p) => {
      switch (p.type) {
        case "tools": return `tools(${p.tools.length})`;
        case "note": return `note(${p.text})`;
        case "thinking": return p.text?.trim() ? `thinking(${p.text})` : "thinking(empty)";
      }
    });
    return `activity: ${parts.join(", ")}`;
  });
}

async function historyOf(lines: string[]): Promise<SessionEntry[]> {
  const logPath = join(dir, `log-${n}.jsonl`);
  await writeFile(logPath, lines.join("\n"));
  const { entries } = await parseSessionLog({ logPath, slice: ALL });
  return entries.filter((e) => e.type === "assistant");
}

// Drive the live handler with one assistant frame per block and build the
// provisional entry the chat renders during the turn. The sink records each
// tool's text offset as the chat machine's STREAM_TOOL handler does.
function liveOf(model: string, blocks: ChatMessageContent[]): SessionEntry[] {
  const state = { sawTextPartial: false };
  let streamText = "";
  const streamTools: SessionContentBlock[] = [];
  const sink = (e: ChatEvent): void => {
    if (e.type === "STREAM_TEXT") streamText += e.text;
    if (e.type === "STREAM_TOOL") streamTools.push({ ...e.tool, streamTextOffset: streamText.length });
  };
  for (const block of blocks) {
    const msg: ChatMessage = { type: "assistant", session_id: "s", message: { role: "assistant", model, content: [block] } };
    handleTurnMessage(msg, { sessionInput: "s", sendBack: sink, terminal: sink, state });
  }
  return [buildStreamEntry({ uuid: "live", streamText, streamTools })];
}

// ## Which models write progress updates
//
// Claude 5 and later do. Claude 4 and earlier return summarized reasoning in the
// same field. Other providers' models and a missing model get no updates.
void test("Claude 5 and later do.", async (t) => {
  const models = ["claude-fable-5-1", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "glm-5.3", undefined];
  t.check(models.map((model) => ({ model, writes: writesProgressUpdates(model) })), [
    { model: "claude-fable-5-1", writes: true },
    { model: "claude-opus-5", writes: true },
    { model: "claude-opus-5-5", writes: true },
    { model: "claude-sonnet-4-6", writes: false },
    { model: "claude-haiku-4-5-20251001", writes: false },
    { model: "glm-5.3", writes: false },
    { model: undefined, writes: false },
  ]);
});

// ## History: a turn with no visible reply keeps its last update
//
// The bare ack is the only text; the chat hangs it on the user's message as a
// badge. So the last update stays a visible line, and the earlier one folds.
// The empty reasoning blocks do not enter activity groups.
void test("A turn with no visible reply keeps its last update.", async (t) => {
  t.check(describe(await historyOf(failingTurn("claude-fable-5-1"))), [
    "activity: note(I've laid out the setup.), tools(1)",
    "update: I've resent the summary.",
    "activity: tools(1)",
    'text: <ack kind="appended" ref="/_content/plan.doc.card"/>',
  ]);
});

// ## History: an older model's reasoning stays collapsed
//
// Sonnet 4.6 returns summarized reasoning in the same field. That is not written
// for the user, so it stays inside the collapsed activity group.
void test("Sonnet 4.6 returns summarized reasoning in the same field.", async (t) => {
  t.check(
    describe(await historyOf([
      assistantLine("claude-sonnet-4-6", update("Let me check the file first.")),
      assistantLine("claude-sonnet-4-6", bash("t3")),
      toolResultLine("t3"),
      assistantLine("claude-sonnet-4-6", text("Done.")),
    ])),
    ["activity: thinking(Let me check the file first.), tools(1)", "text: Done."],
  );
});

// ## History: text before a later tool call folds with the updates
//
// The opening text and the update describe the build; the reply is the text
// after the last tool call. Everything before it folds into one activity row.
void test("Text before a later tool call folds with the updates.", async (t) => {
  t.check(
    describe(await historyOf([
      assistantLine("claude-opus-5-5", text("I'll build a loan card type. Let me read how schemas work first.")),
      assistantLine("claude-opus-5-5", bash("t4")),
      toolResultLine("t4"),
      assistantLine("claude-opus-5-5", update("Logging the drill.")),
      assistantLine("claude-opus-5-5", bash("t5")),
      toolResultLine("t5"),
      assistantLine("claude-opus-5-5", text("You now have a Loans page.")),
    ])),
    [
      "activity: note(I'll build a loan card type. Let me read how schemas work first.), tools(1), note(Logging the drill.), tools(1)",
      "text: You now have a Loans page.",
    ],
  );
});

// ## Live stream: the newest line shows until the next step folds it
//
// The live turn gets the same groups as the reloaded history. An update rides
// the stream's tool list, and each tool records where the streamed text stood,
// so text written before a tool call keeps its place. Mid-turn, the newest line
// is the visible status line. An older model's reasoning is not surfaced live.
void test("The live turn gets the same groups as the reloaded history.", async (t) => {
  const opening = text("I'll check DNS first.");
  const blocks = [opening, bash("t0"), reasoning, update("Checking DNS."), bash("t1"), reasoning, update("Writing the plan."), bash("t2"), text("All set.")];
  t.check(describe(liveOf("claude-fable-5-1", blocks)), [
    "activity: note(I'll check DNS first.), tools(1), note(Checking DNS.), tools(1), note(Writing the plan.), tools(1)",
    "text: All set.",
  ]);
  t.check(describe(liveOf("claude-fable-5-1", blocks.slice(0, 5))), [
    "activity: note(I'll check DNS first.), tools(1)",
    "update: Checking DNS.",
    "activity: tools(1)",
  ]);
  t.check(describe(liveOf("claude-fable-5-1", blocks.slice(0, 1))), ["text: I'll check DNS first."]);
  t.check(describe(liveOf("claude-sonnet-4-6", blocks)), [
    "activity: note(I'll check DNS first.), tools(3)",
    "text: All set.",
  ]);
});

// ## What stays visible in folded text
//
// A callout is meant to reach the person, so a folded text's callouts still
// render in place. Text with a `<speech>` tag is read aloud, so it stays as
// written.
void test("A folded text keeps its callouts; spoken text does not fold.", async (t) => {
  const callout = '<callout context="/loans/drill.card">Your drill is due back Friday.</callout>';
  t.check(
    describe(await historyOf([
      assistantLine("claude-opus-5-5", text(`Checking the loans. ${callout}`)),
      assistantLine("claude-opus-5-5", bash("t6")),
      toolResultLine("t6"),
      assistantLine("claude-opus-5-5", text("<speech>One moment.</speech>")),
      assistantLine("claude-opus-5-5", bash("t7")),
      toolResultLine("t7"),
      assistantLine("claude-opus-5-5", text("Done.")),
    ])),
    [
      `callouts only: Checking the loans. ${callout}`,
      "activity: note(Checking the loans.), tools(1)",
      "text: <speech>One moment.</speech>",
      "activity: tools(1)",
      "text: Done.",
    ],
  );
});

// ## A no-response ack does not hide the updates
//
// A turn whose only text is a `no-response` ack is normally left out of the
// list. `buildDataItems` keeps it when `hasProgressUpdate` finds an update, so
// the update still renders. An older model's reasoning does not count.
void test("A turn whose only text is a no-response ack is normally left out of the list.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const quietTurn = (model: string) => [
    assistantLine(model, update("Nothing needed; the plan already covers it.")),
    assistantLine(model, text('<ack kind="no-response"/>')),
  ];
  t.check(
    {
      fable: hasProgressUpdate(await historyOf(quietTurn("claude-fable-5-1"))),
      sonnet: hasProgressUpdate(await historyOf(quietTurn("claude-sonnet-4-6"))),
    },
    { fable: true, sonnet: false },
  );
});
