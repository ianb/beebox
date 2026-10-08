/**
 * Gives the perf box one synthetic conversation, so a first load takes the
 * "resume the last conversation" path a returning user's box takes:
 * `chat.bootstrap` returns its history, instead of an empty box reserving a
 * fresh chat.
 *
 * The transcript goes where Claude Code keeps it for the box
 * (`~/.claude/projects/<encoded box path>/`, `getSessionLogPath`), and the
 * session is registered in the box's session history and made its most active
 * session, which is what `chat.bootstrap` resumes. The
 * text is generic filler; the size (turns) is what the measurement needs. On
 * its next start, `bbx serve` creates the conversation's chat card in the box,
 * as for any conversation.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { appendHistory, setMostActive } from "../../../core/chat/session/history.js";
import { getSessionLogPath } from "../../../core/chat/session/transcript-paths.js";

const PARAGRAPH = "The storage shelves in the garage hold the camping gear, the spare tiles from the kitchen, and two boxes of paperwork that still need sorting. "
  + "A list of what is where helps when something is needed in a hurry. **Next step:** label each shelf and note the contents in the inventory.";

function line(entry: object): string {
  return `${JSON.stringify(entry)}\n`;
}

function transcript(params: { sessionId: string; cwd: string; turns: number }): string {
  const start = Date.parse("2026-01-05T09:00:00Z");
  let parentUuid: string | null = null;
  let out = "";
  for (let i = 0; i < params.turns; i++) {
    const common = { isSidechain: false, userType: "external", cwd: params.cwd, sessionId: params.sessionId, version: "2.0.0" };
    const userUuid = crypto.randomUUID();
    out += line({ ...common, parentUuid, type: "user", uuid: userUuid, timestamp: new Date(start + i * 120_000).toISOString(),
      message: { role: "user", content: `Question ${i + 1}: where should the item from shelf ${i + 1} go, and what should the label say?` } });
    const assistantUuid = crypto.randomUUID();
    out += line({ ...common, parentUuid: userUuid, type: "assistant", uuid: assistantUuid, timestamp: new Date(start + i * 120_000 + 30_000).toISOString(),
      message: { id: `msg_perf_${i}`, type: "message", role: "assistant", model: "claude-perf-fixture", stop_reason: "end_turn",
        content: [{ type: "text", text: `${PARAGRAPH}\n\n- Shelf ${i + 1}: camping gear\n- Shelf ${i + 2}: tiles\n\n${PARAGRAPH}` }],
        usage: { input_tokens: 10, output_tokens: 100 } } });
    parentUuid = assistantUuid;
  }
  return out;
}

/** Writes the conversation and makes it the box's most recent session. Returns its id. */
export async function seedChat(box: string, turns: number): Promise<string> {
  const sessionId = crypto.randomUUID();
  const logPath = getSessionLogPath(box, sessionId);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, transcript({ sessionId, cwd: box, turns }));
  await appendHistory(box, { sessionId, contextDir: "", engine: "claude" });
  await setMostActive(box, sessionId);
  return sessionId;
}
