// # Transcript rendering: entries, elision, and the composed form
//
// `src/core/chat/transcript-render.ts` renders a transcript for a model. Rendering
// and elision are separate functions because the two consumers need different
// things: the retrospective observer wants the capped one-shot form, while chat
// review must measure how much *new* material a span holds — which the capped form
// cannot express, since its length stops growing at the cap.

import { test } from "tap";
import "agent-doctest/tap";
import { any, not } from "agent-doctest/check";
import {
  elideMiddle,
  MAX_RENDERED_CHARS,
  renderEntries,
  renderSessionCompact,
} from "../../../src/core/chat/transcript-render.js";
import { MAX_SESSION_ENTRIES } from "../../../src/cli/lib/session.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { getSessionLogPath } from "../../../src/core/chat/session/transcript-paths.js";

function userEntry(uuid: string, text: string) {
  return {
    uuid,
    type: "user" as const,
    timestamp: "2026-07-28T03:00:00Z",
    content: [{ type: "text" as const, text }],
  };
}

function agentEntry(uuid: string, text: string) {
  return {
    uuid,
    type: "assistant" as const,
    timestamp: "2026-07-28T03:00:01Z",
    content: [{ type: "text" as const, text }],
  };
}

async function captureWarnings(action: () => Promise<void>): Promise<string[]> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    await action();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

// ## Dialogue renders with role headers, joined by a rule
void test("Dialogue renders with role headers, joined by a rule", async (t) => {
  // doctest:L56
  await t.checkText(renderEntries([userEntry("u1", "Can you check the invoice?"), agentEntry("a1", "Checked — it's paid.")]), `**User** (2026-07-28T03:00:00Z)
Can you check the invoice?
«blankline»
---
«blankline»
**Agent** (2026-07-28T03:00:01Z)
Checked — it's paid.`);

  // Speech wrappers are stripped from user text so a reader quotes clean words, and
  // an entry whose visible content is only its role header drops out entirely.

  // doctest:L71
  await t.checkText(renderEntries([userEntry("u2", "<typed user=\"Ian\">plain words</typed>"), userEntry("u3", "")]), `**User** (2026-07-28T03:00:00Z)
plain words`);

  // `<unsure>` low-confidence marks (Track 4, docs/plans/transcript-confidence.md)
  // unwrap to their plain word too — this reader wants clean human text, not the
  // agent-facing marker.

  // doctest:L82
  await t.checkText(renderEntries([userEntry("u4", "<speech stt=\"deepgram\">they're all <unsure>cloud</unsure> code</speech>")]), `**User** (2026-07-28T03:00:00Z)
they're all cloud code`);
});

// ## `renderEntries` is uncapped — that is the point
//
// `spanSize` gates on this, so it must keep growing past the elision cap.
void test("spanSize gates on this, so it must keep growing past the elision cap.", async (t) => {
  // doctest:L93
  const many = Array.from({ length: 400 }, (_, i) => userEntry(`u${i}`, "y".repeat(200)));
  const rendered = renderEntries(many);
  // A 400 x 200-char transcript is far too large to write out; text past twice the cap exists.
  t.check(rendered.slice(MAX_RENDERED_CHARS * 2), not(""));

  // doctest:L98
  // No elision marker — nothing was dropped.
  t.check(rendered, not(any(String).includes("chars of conversation elided")));
});

// ## `elideMiddle` keeps both ends
//
// Corrections and decisions show up at the start and end of long conversations, so
// the middle is what goes.
void test("Corrections and decisions show up at the start and end of long conversations,...", async (t) => {
  // doctest:L109
  t.check(elideMiddle("abcdefghij", 100), "abcdefghij");

  // doctest:L112
  const elided = elideMiddle("x".repeat(50) + "MIDDLE" + "y".repeat(50), 20);
  t.check(elided, "xxxxxxxxxx\n\n… (86 chars of conversation elided) …\n\nyyyyyyyyyy");
});

// ## `renderSessionCompact` is exactly the composition of the two
//
// This is the regression anchor for the retrospective observer, whose behaviour
// must not have changed when the module was split. Under the cap, the composed
// form equals the raw render; over it, it equals the elided render.
void test("This is the regression anchor for the retrospective observer, whose behaviour...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L133
  const box = await makeTmpBox();
  process.env["BBX_CLAUDE_PROJECTS_DIR"] = box.path("claude-projects");

  // doctest:L136
  async function seed(sessionId: string, entries: object[]) {
    const logPath = getSessionLogPath(box.root, sessionId);
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return logPath;
  }

  // doctest:L143
  function raw(uuid: string, text: string) {
    return { type: "user", uuid, timestamp: "2026-07-28T03:00:00Z", message: { role: "user", content: [{ type: "text", text }] } };
  }

  // doctest:L147
  const shortPath = await seed("short", [raw("u1", "hello"), raw("u2", "again")]);
  let shortOut = "";
  const shortWarnings = await captureWarnings(async () => { shortOut = await renderSessionCompact(shortPath); });
  t.checkText(shortOut, `**User** (2026-07-28T03:00:00Z)
hello
«blankline»
---
«blankline»
**User** (2026-07-28T03:00:00Z)
again`);

  // doctest:L156
  t.check(shortWarnings, []);

  // doctest:L161
  const bigPath = await seed("big", Array.from({ length: 400 }, (_, i) => raw(`u${i}`, "z".repeat(200))));
  const bigOut = await renderSessionCompact(bigPath);

  // Clamped — this is why the size gate cannot use it.
  t.check(bigOut.slice(MAX_RENDERED_CHARS + 101), "");

  t.check(bigOut, any(String).includes("chars of conversation elided"));

  // An entry-count cap is a separate limit from character elision. A transcript
  // past that cap still renders the same first page, but it now announces the
  // degradation instead of silently hiding the later entries.

  // doctest:L177
  const overCapPath = await seed(
    "over-cap",
    Array.from({ length: MAX_SESSION_ENTRIES + 1 }, (_, i) => raw(`cap-${i}`, "x")),
  );
  const capWarnings = await captureWarnings(async () => { await renderSessionCompact(overCapPath); });
  t.check(capWarnings, [
    `renderSessionCompact: transcript ${overCapPath} has ${String(MAX_SESSION_ENTRIES + 1)} entries; rendering the first ${String(MAX_SESSION_ENTRIES)}.`,
  ]);

});
