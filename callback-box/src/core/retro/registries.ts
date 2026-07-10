/**
 * Chat-session provenance for the retrospective walker.
 *
 * Chat transcripts share `~/.claude/projects/<encoded-box>/` with wakeup,
 * job, and procedure runs. The chat registries under `.callback-box/` map
 * session ids back to their chat surface (webapp history, telegram thread
 * cards) so observations can carry thread provenance. Note: the thread
 * registries record only each thread's *current* session — rotated-away
 * ids survive only in the webapp history file — so these are provenance
 * hints, not a gate. The walker's actual chat test is the presence of real
 * (`<typed>`/`<speech>`-tagged) user messages in the transcript.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { loadHistory } from "../chat/session/history.js";
import { errnoCode } from "../../lib/error-guards.js";

const HISTORY_FILE = ".callback-box/chat-session-history.json";

/** Thread-keyed registries: `{ "<thread ref>": { sessionId, ... }, ... }`. */
const THREAD_REGISTRY_FILES = [
  ".callback-box/chat-thread-sessions.json",
  ".callback-box/chat-sessions.json",
];

const ThreadRecordSchema = z.object({ sessionId: z.string() });

export interface ChatRegistryIndex {
  /** Session ids found in any chat registry. */
  ids: Set<string>;
  /** sessionId → thread card ref, for thread-keyed registries. */
  threadRefs: Map<string, string>;
  /** Registry files that existed, box-relative. */
  registriesFound: string[];
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      console.warn(`retro: could not read ${filePath}, skipping registry:`, e);
    }
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    console.warn(`retro: ${filePath} is not valid JSON, skipping registry:`, e);
    return null;
  }
}

export async function loadChatRegistryIndex(boxRoot: string): Promise<ChatRegistryIndex> {
  const ids = new Set<string>();
  const threadRefs = new Map<string, string>();
  const registriesFound: string[] = [];

  try {
    await fs.access(path.join(boxRoot, HISTORY_FILE));
    registriesFound.push(HISTORY_FILE);
    for (const id of await loadHistory(boxRoot)) ids.add(id);
  } catch (_e) {
    // Missing webapp history file — box never chatted via the webapp.
  }

  for (const relPath of THREAD_REGISTRY_FILES) {
    const raw = await readJsonFile(path.join(boxRoot, relPath));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    registriesFound.push(relPath);
    for (const [threadRef, record] of Object.entries(raw)) {
      const parsed = ThreadRecordSchema.safeParse(record);
      if (!parsed.success) continue;
      ids.add(parsed.data.sessionId);
      threadRefs.set(parsed.data.sessionId, threadRef);
    }
  }

  return { ids, threadRefs, registriesFound };
}
