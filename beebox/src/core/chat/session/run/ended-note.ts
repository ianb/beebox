/**
 * The run-ended note: when box maintenance ends a chat's run while background
 * tasks are live (a deployment or development reload that cannot wait), the
 * chat's next turn is told why. The CLI already tells that turn the tasks did
 * not finish; this note adds the cause. One small file per session under
 * `.beebox/`, read into the next turn's `<chat-app>` snapshot (hidden from the
 * person's message) and removed once that turn is dispatched
 * (docs/plans/maintenance-live-tasks.md, Track 3).
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomicSync } from "../../../../lib/atomic-write.js";
import { escapeXmlAttr } from "../../../../shared/self-note.js";
import { errnoCode, errorMessage } from "../../../../shared/error-guards.js";

const noteSchema = z.object({ at: z.string(), reason: z.string(), tasks: z.array(z.string()) });
type RunEndedNote = z.infer<typeof noteSchema>;

function notePath(boxRoot: string, sessionId: string): string {
  return path.join(boxRoot, ".beebox", "chat-run-ended", `${encodeURIComponent(sessionId)}.json`);
}

/** Record why a run with live tasks ended. Synchronous: the process may be about to stop. */
export function recordRunEnded(boxRoot: string, { sessionId, reason, tasks, now }: { sessionId: string; reason: string; tasks: string[]; now: Date }): void {
  const note: RunEndedNote = { at: now.toISOString(), reason, tasks };
  try { writeFileAtomicSync(notePath(boxRoot, sessionId), { content: JSON.stringify(note) }); }
  catch (error) { console.error(`[ChatSession] Run-ended note for ${sessionId} was not written: ${errorMessage(error)}`); }
}

function render(note: RunEndedNote): string {
  const count = note.tasks.length === 1 ? "1 background task was" : `${String(note.tasks.length)} background tasks were`;
  const listed = note.tasks.map((task) => `- ${escapeXmlAttr(task)}`).join("\n");
  return `<run-ended at="${escapeXmlAttr(note.at)}" reason="${escapeXmlAttr(note.reason)}">\nBox maintenance (${escapeXmlAttr(note.reason)}) ended your previous run while ${count} still running. They did not finish; restart any that are still needed.\n${listed}\n</run-ended>`;
}

export interface PendingRunEndedNote {
  /** The `<run-ended>` element for the snapshot, or undefined when there is none. */
  readonly element: string | undefined;
  /** Remove the note; call once the turn carrying it is dispatched. */
  clear(): void;
}

/** Read without removing: a turn that fails before dispatch leaves the note for the next one. */
export function pendingRunEndedNote(boxRoot: string, sessionId: string | null): PendingRunEndedNote {
  const none = { element: undefined, clear: () => {} };
  if (sessionId === null) return none;
  const file = notePath(boxRoot, sessionId);
  // Never throws: a note that cannot be removed must not undo a dispatched turn.
  const remove = (): void => {
    try { fs.rmSync(file, { force: true }); }
    catch (error) { console.error(`[ChatSession] Run-ended note for ${sessionId} was not removed: ${errorMessage(error)}`); }
  };
  let parsed: ReturnType<typeof noteSchema.safeParse>;
  try { parsed = noteSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) {
    if (errnoCode(error) === "ENOENT") return none;
    // An unreadable note must not block the chat's turn; say so and drop it.
    console.error(`[ChatSession] Run-ended note for ${sessionId} is unreadable: ${errorMessage(error)}`);
    remove();
    return none;
  }
  if (!parsed.success) {
    console.error(`[ChatSession] Run-ended note for ${sessionId} is malformed; dropped`);
    remove();
    return none;
  }
  return { element: render(parsed.data), clear: remove };
}
