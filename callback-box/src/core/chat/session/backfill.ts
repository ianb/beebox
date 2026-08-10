/**
 * One-shot backfill of pre-existing web chat sessions into
 * `chat-session-history.json` (see history.ts for the file format).
 * Identifies "web chat" by scanning each JSONL for user messages carrying
 * `<speech>`/`<typed>` markers; the file's `migrated` flag gates re-runs.
 */

import { makeLog } from "./log.js";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { isRecord } from "../../card-io.js";
import { listSessionRoots, readHistoryFile, writeHistoryFile, withHistoryLock } from "./history.js";
import { listSessionFilesInDir } from "./transcript-paths.js";

const log = makeLog("chat-history");

/**
 * Detect whether a session log contains web-chat user input (`<speech>` or
 * `<typed>` tags). Streams the file and returns on first match.
 */
async function logHasWebChatMarkers(logPath: string): Promise<boolean> {
  const fileStream = createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let raw: { type?: string; message?: { content?: unknown } };
      try {
        raw = JSON.parse(line);
      } catch (e) {
        // Tolerate a malformed JSONL line (partial write, truncation) — skip
        // it and keep scanning the rest of the log for chat markers.
        console.warn(`[chat-history] Skipping unparseable line in ${logPath}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (raw.type !== "user") continue;
      const content = raw.message?.content;
      const blocks: Array<{ type?: string; text?: string }> =
        typeof content === "string"
          ? [{ type: "text", text: content }]
          : Array.isArray(content)
            ? content.filter(isRecord).map((item) => ({
                ...(typeof item.type === "string" ? { type: item.type } : {}),
                ...(typeof item.text === "string" ? { text: item.text } : {}),
              }))
            : [];
      for (const block of blocks) {
        if (block.type !== "text" || typeof block.text !== "string") continue;
        if (block.text.includes("<speech") || block.text.includes("<typed")) {
          return true;
        }
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }
  return false;
}

/**
 * One-shot scan that adds any pre-existing web chat sessions to the history
 * file, then sets `migrated: true` so it never runs again.
 */
export async function runBackfillIfNeeded(boxRoot: string): Promise<void> {
  await withHistoryLock(boxRoot, async () => {
    const file = (await readHistoryFile(boxRoot)) ?? {
      sessions: [],
      migrated: false,
    };
    if (file.migrated) return;

    log("backfill", "Scanning JSONLs for web chat sessions");
    // Scan every context root — a landmark-bound chat's transcript lives
    // under its own encoded dir, not the box root's.
    const roots = await listSessionRoots(boxRoot);
    const sessions = (
      await Promise.all(
        roots.map(async (root) => {
          const files = await listSessionFilesInDir(root.dir);
          return files.map((f) => ({ ...f, contextDir: root.contextDir }));
        }),
      )
    ).flat();
    const known = new Set(file.sessions.map((s) => s.id));
    let added = 0;
    for (const s of sessions) {
      if (known.has(s.sessionId)) continue;
      try {
        if (await logHasWebChatMarkers(s.path)) {
          // Keep the landmark binding the scan just discovered — appending a
          // bare id would make resolveSessionLogPath treat it as root-bound.
          // Box-root finds stay bare-id, matching pre-landmark entries.
          file.sessions.push(s.contextDir === "" ? { id: s.sessionId } : { id: s.sessionId, contextDir: s.contextDir });
          known.add(s.sessionId);
          added += 1;
        }
      } catch (e) {
        log("backfill", `Failed to scan ${s.path}: ${e instanceof Error ? e.message : e}`);
      }
    }
    file.migrated = true;
    await writeHistoryFile(boxRoot, file);
    log("backfill", `Done — added ${added} session(s)`);
  });
}
