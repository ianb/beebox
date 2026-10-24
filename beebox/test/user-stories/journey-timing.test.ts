// # Journey turn timing
//
// A turn is timed from the hub's "Sending message" to its first answer text and to
// "Turn complete". A progress line (text the turn went on from) is marked interim and
// does not count as the answer.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinTurns, parseHubTurns, parseTranscriptTurns } from "./journeys/agent-time.ts";
import { liveRuns } from "./journeys/provisioning.ts";

const at = (s: number): string => new Date(Date.UTC(2026, 9, 22, 12, 0, s)).toISOString();
const ms = (s: number): number => Date.UTC(2026, 9, 22, 12, 0, s);
const jsonl = (...entries: object[]): string => entries.map((e) => JSON.stringify(e)).join("\n");
const user = (s: number): object => ({ type: "user", timestamp: at(s), message: { content: [{ type: "text", text: "hi" }] } });
const text = (s: number): object => ({ type: "assistant", timestamp: at(s), message: { content: [{ type: "text", text: "ok" }] } });
const tool = (s: number): object => ({ type: "assistant", timestamp: at(s), message: { content: [{ type: "tool_use" }] } });
const toolResult = (s: number): object => ({ type: "user", timestamp: at(s), message: { content: [{ type: "tool_result" }] } });
const reminder = (s: number): object => ({ type: "attachment", timestamp: at(s), attachment: { type: "silent_turn_reminder" } });

void test("hub log pairs each send with its completion", async (t) => {
  const log = [
    `${at(0)} [stdout] [ChatSession:send] Sending message (10 chars, 0 image(s), 1 block(s))`,
    `${at(30)} [stdout] [ChatSession:done] Turn complete, is_error: false`,
    `${at(40)} [stdout] [ChatSession:send] Sending message (10 chars, 0 image(s), 1 block(s))`,
    `${at(41)} [stdout] [ChatSession:init] Loaded session: x`,
  ].join("\n");
  t.check(parseHubTurns(log), [{ sendAt: ms(0), completeAt: ms(30) }, { sendAt: ms(40), completeAt: null }]);
});

void test("a text followed by tool work, or by the silent-turn reminder and more text, is interim", async (t) => {
  // Turn 1: preamble, tool, answer. Turn 2: reminder, progress line, tool, answer. Turn 3: plain answer.
  const turns = parseTranscriptTurns(jsonl(
    user(1), text(5), tool(6), toolResult(7), text(20),
    user(100), reminder(160), text(165), tool(166), toolResult(190), text(250),
    user(300), text(310),
  ));
  t.check(turns, [
    { openedAt: ms(1), texts: [{ at: ms(5), interim: true }, { at: ms(20), interim: false }] },
    { openedAt: ms(100), texts: [{ at: ms(165), interim: true }, { at: ms(250), interim: false }] },
    { openedAt: ms(300), texts: [{ at: ms(310), interim: false }] },
  ]);
});

void test("timing runs from the hub's send, reports the answer and completion, and tolerates a late user message", async (t) => {
  const raw = parseTranscriptTurns(jsonl(user(8), text(12), tool(13), toolResult(14), text(60)));
  const detail = joinTurns(raw, [{ sendAt: ms(0), completeAt: ms(61) }]);
  t.check(detail, [{
    openedAt: ms(8),
    startedAt: ms(0),
    startSource: "hub",
    sendLagSeconds: 8,
    firstTextSeconds: 12,
    firstTextInterim: true,
    answerSeconds: 60,
    completeSeconds: 61,
  }]);

  // No hub log: the transcript's own user message is the start and completion is unknown.
  t.check(joinTurns(raw, []), [{
    openedAt: ms(8),
    startedAt: ms(8),
    startSource: "transcript",
    sendLagSeconds: 0,
    firstTextSeconds: 4,
    firstTextInterim: true,
    answerSeconds: 52,
    completeSeconds: null,
  }]);
});

void test("only runs prepared in the last 12 hours and not yet collected are live", async (t) => {
  const work = mkdtempSync(join(tmpdir(), "journey-live-"));
  t.teardown(() => rmSync(work, { recursive: true, force: true }));
  const now = Date.UTC(2026, 9, 22, 12);
  const run = (name: string, spec: { startedIso: string, files: string[] }): void => {
    mkdirSync(join(work, name));
    writeFileSync(join(work, name, "before.json"), JSON.stringify({ startedIso: spec.startedIso }));
    for (const file of spec.files) writeFileSync(join(work, name, file), "{}");
  };
  run("A-2026-10-22", { startedIso: "2026-10-22T11:00:00Z", files: [] });
  run("B-2026-10-22", { startedIso: "2026-10-22T10:00:00Z", files: ["after.json"] });
  run("C-2026-10-20", { startedIso: "2026-10-20T10:00:00Z", files: [] });
  t.check(liveRuns({ work, now }), ["A-2026-10-22"]);
});
