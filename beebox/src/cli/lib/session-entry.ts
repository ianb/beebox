/**
 * Session entry assembly for `parseSessionLog` - turns a raw JSONL record into
 * the displayable {@link SessionEntry} (or decides to drop it), including the
 * tool_result grafting, user-identity extraction, and plumbing/compaction/
 * interrupted classification. Split out of `session.ts` to keep it under the
 * line cap.
 */

import { type SessionContentBlock, transformContent } from "./session-content.js";
import { isRecord } from "../../lib/is-record.js";
import { isCompactionSummary, isPlumbingMessage } from "./session-text.js";

/**
 * Parsed session log entry.
 */
export interface SessionEntry {
  uuid: string;
  type: "user" | "assistant" | "compaction" | "interrupted";
  timestamp: string;
  content: SessionContentBlock[];
  /** Display name of the sender (for user messages in multi-user chat) */
  user?: string;
  /** Email of the sender (for identity matching across devices) */
  userEmail?: string;
}

/**
 * Harvest tool_result blocks from a user entry and graft each result's summary
 * onto its matching tool_use block in the prior assistant entries. The chat UI
 * treats tool calls as a single unit (call + response), so results need to ride
 * alongside their tool_use rather than appearing as standalone messages.
 *
 * `recent` is the scan's bounded graft window (`session-retention.ts`), not the
 * whole transcript: only the trailing run of assistant entries is ever walked,
 * and a result follows its call within a couple of entries in practice.
 */
function graftToolResults(content: SessionContentBlock[], recent: SessionEntry[]): void {
  const resultsById = new Map<string, string>();
  for (const block of content) {
    if (block.type === "tool_result" && block.toolUseId) {
      resultsById.set(block.toolUseId, block.resultSummary || "");
    }
  }
  if (resultsById.size === 0) return;
  for (let i = recent.length - 1; i >= 0; i--) {
    const prev = recent[i];
    if (!prev || prev.type !== "assistant") break;
    for (const b of prev.content) {
      if (b.type === "tool_use" && b.toolId) {
        const r = resultsById.get(b.toolId);
        if (r !== undefined) b.resultSummary = r;
      }
    }
  }
}

/** Pull a user-message identity attribute (user / user-email) from leading tag text. */
export function userIdentity(content: SessionContentBlock[], attr: "user" | "user-email"): string | undefined {
  const firstText = content.find((b) => b.type === "text")?.text || "";
  const re =
    attr === "user"
      ? /<(?:typed|speech)\b[^>]*\buser="([^"]*)"/
      : /<(?:typed|speech)\b[^>]*\buser-email="([^"]*)"/;
  const match = firstText.match(re);
  if (match && match[1]) {
    return match[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  }
  return undefined;
}

/**
 * Classify a user entry. Returns the entry to push, "skip" to drop it
 * (plumbing), or "keep" to let the caller build a normal user entry.
 */
function classifyUserEntry(
  raw: Record<string, unknown>,
  content: SessionContentBlock[]
): SessionEntry | "skip" | "keep" {
  const textBlocks = content.filter(
    (block) => block.type === "text" && block.text?.trim()
  );
  // User entries that are pure API plumbing (tool_result blocks, "Tool loaded.")
  if (textBlocks.length === 0) return "skip";
  if (textBlocks.every((block) => isPlumbingMessage(block.text || ""))) return "skip";

  const firstText = textBlocks[0]?.text || "";
  // Compaction summary messages injected after context compaction.
  if (isCompactionSummary(firstText)) {
    return {
      uuid: String(raw.uuid || ""),
      type: "compaction",
      timestamp: String(raw.timestamp || ""),
      content,
    };
  }
  // Interrupted-turn markers.
  if (firstText.trim() === "[Request interrupted by user]") {
    return {
      uuid: String(raw.uuid || ""),
      type: "interrupted",
      timestamp: String(raw.timestamp || ""),
      content: [],
    };
  }
  return "keep";
}

/** What `buildEntry` needs beyond the record itself. */
export interface BuildEntryOptions {
  /**
   * The scan's bounded graft window — read, and written into, for user entries
   * carrying tool_result blocks (see {@link graftToolResults}).
   */
  recent: SessionEntry[];
  /**
   * The session this line belongs to, when its image payloads were stripped on
   * the way in — the other half of the coordinates a stripped image is served
   * by (`shared/session-media.ts`). Null when nothing was stripped, which is
   * every ordinary line: an image block with no bytes is then a genuinely
   * empty one, and still renders as the placeholder.
   */
  mediaSessionId: string | null;
}

/**
 * Decide what (if anything) a single raw entry contributes to the scan.
 * Returns a SessionEntry to record, or null to skip.
 */
export function buildEntry(
  raw: Record<string, unknown>,
  options: BuildEntryOptions
): SessionEntry | null {
  const { recent, mediaSessionId } = options;
  // Skip compact_boundary system messages — the compaction summary user
  // message that follows is the one we display.
  if (raw.type === "system" && raw.subtype === "compact_boundary") return null;
  if (raw.type !== "user" && raw.type !== "assistant") return null;

  const message = isRecord(raw["message"]) ? raw["message"] : undefined;
  if (!message) return null;

  const uuid = String(raw.uuid || "");
  const content = transformContent(message["content"], {
    mediaRef: mediaSessionId !== null && uuid !== "" ? { sessionId: mediaSessionId, entryUuid: uuid } : null,
  });

  // Skip SDK meta prompts ("Continue from where you left off.") — wakeup plumbing.
  if (raw.isMeta === true) return null;
  // Skip synthetic assistant responses — generated locally, not by the LLM.
  if (raw.type === "assistant" && message.model === "<synthetic>") return null;

  if (raw.type === "user") {
    graftToolResults(content, recent);
    const classified = classifyUserEntry(raw, content);
    if (classified === "skip") return null;
    if (classified !== "keep") return classified;

    const user = userIdentity(content, "user");
    const userEmail = userIdentity(content, "user-email");
    return {
      uuid,
      type: "user",
      timestamp: String(raw.timestamp || ""),
      content,
      ...(user ? { user } : {}),
      ...(userEmail ? { userEmail } : {}),
    };
  }

  // Assistant entry — skip if it has no visible content.
  if (content.length === 0) return null;
  return {
    uuid,
    type: "assistant",
    timestamp: String(raw.timestamp || ""),
    content,
  };
}
