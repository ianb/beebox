/**
 * The chat-search index manifest: per-session cursor records that let the
 * lazy refresh chunk only what changed. Keyed by session id (the husk's
 * identity key — survives renames). Lives next to the index in `.beebox/`
 * and is written after it, under the same `IndexPersisted` receipt ordering
 * as the card manifest (`search/refresh/manifest.ts`).
 */

import { promises as fs } from "node:fs";
import { z } from "zod";
import { AGENT_ENGINES } from "../../shared/agent-models.js";
import { errorMessage } from "../../shared/error-guards.js";
import { invariant } from "../../shared/invariant.js";
import { writeJsonAtomic, type IndexPersisted } from "../search/store/index-store.js";
import { CHAT_SEARCH_SCHEMA_VERSION } from "./schema.js";
import { chatSearchStore } from "./store.js";

const chatManifestSessionSchema = z.object({
  engine: z.enum(AGENT_ENGINES),
  /** Box-relative husk path as of the last refresh (display bookkeeping only). */
  huskPath: z.string(),
  /**
   * Transcript mtime (Claude: file stat; Codex: thread `updatedAt`) as of the
   * last refresh. Unchanged ⇒ nothing new to chunk.
   */
  mtimeMs: z.number(),
  /**
   * Cursor: how many displayable entries the whole transcript held when it
   * was last chunked. The next refresh chunks from here. A transcript whose
   * entry count DROPPED below this was rewritten — rebuild its docs.
   */
  entryCount: z.number().int().nonnegative(),
  /** Document ids this session contributed — exact removal on rewrite/delete. */
  docIds: z.array(z.string()),
});
export type ChatManifestSession = z.infer<typeof chatManifestSessionSchema>;

const chatManifestSchema = z.object({
  schemaVersion: z.number(),
  sessions: z.record(z.string(), chatManifestSessionSchema),
});
export type ChatManifest = z.infer<typeof chatManifestSchema>;

export function emptyChatManifest(): ChatManifest {
  return { schemaVersion: CHAT_SEARCH_SCHEMA_VERSION, sessions: {} };
}

/**
 * Load the manifest; absent, unreadable, or version-mismatched manifests
 * come back empty, which makes the next refresh a full rebuild.
 */
export async function loadChatManifest(boxRoot: string): Promise<ChatManifest> {
  let raw: string;
  try {
    raw = await fs.readFile(chatSearchStore.manifestPath(boxRoot), "utf8");
  } catch (_e) {
    return emptyChatManifest();
  }
  try {
    // Parse boundary: disk JSON is untrusted — validate the full shape with
    // zod so a corrupt or foreign-shaped manifest falls back to a full
    // rebuild instead of flowing unchecked data downstream.
    const parsed: unknown = JSON.parse(raw);
    const result = chatManifestSchema.safeParse(parsed);
    if (!result.success || result.data.schemaVersion !== CHAT_SEARCH_SCHEMA_VERSION) {
      return emptyChatManifest();
    }
    return result.data;
  } catch (e) {
    console.warn(`chat-search: manifest unreadable (${errorMessage(e)}); rebuilding`);
    return emptyChatManifest();
  }
}

/**
 * Persist the manifest. Requires an {@link IndexPersisted} receipt proving
 * the on-disk index is already current — the index-before-manifest
 * crash-safety ordering, enforced by types exactly as the card manifest
 * enforces it (`search/refresh/manifest.ts`).
 */
export async function saveChatManifest(
  boxRoot: string,
  { manifest, indexProof }: { manifest: ChatManifest; indexProof: IndexPersisted },
): Promise<void> {
  invariant(
    indexProof.boxRoot === boxRoot,
    `chat-search: manifest save for ${boxRoot} with an index receipt for ${indexProof.boxRoot}`,
  );
  await writeJsonAtomic(chatSearchStore.manifestPath(boxRoot), manifest);
}
