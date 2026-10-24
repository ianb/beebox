// # third-person check: "the user" on a card the person reads
//
// The card-write hook (`cardValidatorHook`) points out "the user" and "the
// boxholder" in text the agent just wrote to a card under `_content/`, where the
// person reads it. The guide already forbids the third person; this puts the
// reminder at the moment of writing. It reads only the new text, so a card that
// already quotes "the user" from a web page stays quiet unless the agent writes
// the phrase itself.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { cardValidatorHook } from "../../src/core/sdk-hooks.js";
import { thirdPersonPhrases } from "../../src/core/card-lint/third-person.js";
import { writeBoxFiles } from "../helpers/test-helpers.js";

const box = await mkdtemp(join(tmpdir(), "third-person-"));
await writeBoxFiles(box);
await mkdir(join(box, "_content"), { recursive: true });
await mkdir(join(box, "_bookkeeping/jobs"), { recursive: true });
const { hooks } = cardValidatorHook();

// The `additionalContext` a hook injected, or undefined when it injected none.
function contextOf(out: HookJSONOutput | undefined): string | undefined {
  if (out === undefined || "async" in out) return undefined;
  const specific = out.hookSpecificOutput;
  return specific !== undefined && "additionalContext" in specific ? specific.additionalContext : undefined;
}

// Write a card, run the hook as if the agent had just written it, and return
// the injected context (null when the hook stays quiet).
async function afterWrite(rel: string, toolInput: { content?: string; old_string?: string; new_string?: string }) {
  const file_path = join(box, rel);
  const text = toolInput.content ?? `---\ntitle: Note\n---\n${toolInput.new_string ?? ""}\n`;
  await writeFile(file_path, text);
  const out = await hooks[0]?.({
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path, ...toolInput },
    tool_response: {},
    tool_use_id: "t",
    session_id: "s",
    transcript_path: "",
    cwd: box,
  }, undefined, { signal: new AbortController().signal });
  // The card linter may add its own notes for these bare test cards; keep
  // only the third-person reminder.
  const context = contextOf(out) ?? "";
  return context.split("\n\n").find((note: string) => note.includes("calls them")) ?? null;
}
const doc = (body: string) => `---\ntitle: Note\n---\n${body}\n`;

// A card in the person's area that says "the user confirmed" gets the reminder,
// naming the phrase and the fix:
void test("A card in the person's area that says \"the user confirmed\" gets the reminder,...", async (t) => {
  t.check(await afterWrite("_content/Drill.doc.card", { content: doc("The user confirmed the drill is with Sam.") }), "_content/Drill.doc.card is shown to the person whose box this is, and the text you just wrote calls them \"the user\". Write \"you\" (in a briefing, their own \"I\": \"I'm cataloguing my tools\"), unless the words quote someone else.");
});

// "The boxholder" and its possessive count too, and an Edit is checked by its
// new text:
void test("\"The boxholder\" and its possessive count too, and an Edit is checked by its n...", async (t) => {
  t.check(await afterWrite("_content/Tools.doc.card", { old_string: "x", new_string: "Listed from the boxholder's memory." }), "_content/Tools.doc.card is shown to the person whose box this is, and the text you just wrote calls them \"the boxholder's\". Write \"you\" (in a briefing, their own \"I\": \"I'm cataloguing my tools\"), unless the words quote someone else.");
});

// Text that says "you" gets no reminder, and neither does agent-facing text
// outside `_content/`, where "the user" is the right word:
void test("Text that says \"you\" gets no reminder, and neither does agent-facing text out...", async (t) => {
  t.check(await afterWrite("_content/Drill2.doc.card", { content: doc("You confirmed the drill is with Sam.") }), null);

  t.check(await afterWrite("_bookkeeping/jobs/Followup.doc.card", { content: doc("Ask the user about the drill.") }), null);
});

// The phrase finder lowercases and folds whitespace, and does not match words
// that merely contain "user":
void test("The phrase finder lowercases and folds whitespace, and does not match words t...", async (t) => {
  t.check(thirdPersonPhrases("The  User said so; the boxholders agreed; a username; reuser"), [
    "the user",
    "the boxholders",
  ]);
});
