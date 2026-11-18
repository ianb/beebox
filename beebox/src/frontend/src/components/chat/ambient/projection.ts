/** Bounded transcript projection; bus completion signals never supply reply text. */
import type { SessionEntry } from "../../../api";
import { groupMessages } from "../message-parsing";
import { parseCallouts } from "../../../lib/structured-output-parsing";

export function projectAmbientReply(sessionId: string, { entries, total, running }: { entries: SessionEntry[]; total: number; running: boolean }) {
  const groups = groupMessages(entries);
  const last = groups.at(-1);
  const assistant = last?.type === "assistant" ? last : undefined;
  const text = assistant?.entries.flatMap((entry) => entry.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")).join("\n") ?? "";
  const complete = !running && text.trim().length > 0;
  const first = assistant?.entries.at(0);
  const truncated = total > entries.length;
  const unsafe = !first?.uuid || (truncated && groups.length === 1);
  const identity = complete && !unsafe ? `${sessionId}:${first.uuid}` : null;
  return { identity, callouts: identity ? parseCallouts(text) : [] };
}

export interface AmbientAttention {
  initialized: boolean;
  lastCompletion: string | null;
  lastReply: string | null;
  attention: boolean;
  dismissedReply: string | null;
}

export const EMPTY_ATTENTION: AmbientAttention = {
  initialized: false, lastCompletion: null, lastReply: null, attention: false, dismissedReply: null,
};

/** Initial history is a baseline; refreshes preserve unacknowledged attention. */
export function observeAmbientReply(previous: AmbientAttention, identity: string | null): AmbientAttention {
  return {
    ...previous,
    initialized: true,
    lastReply: identity ?? previous.lastReply,
    attention: previous.attention || (previous.initialized && identity !== null && identity !== previous.lastReply),
  };
}

/** Replayed completion events do not undo an explicit dismissal. */
export function recordAmbientCompletion(previous: AmbientAttention, token: string): AmbientAttention {
  return previous.lastCompletion === token ? previous : { ...previous, lastCompletion: token, attention: true };
}

/** A retained old transcript during target resolution has not been inspected. */
export function canAcknowledgeAmbientReply(transcriptVisible: boolean, selectionKind: string): boolean {
  return transcriptVisible && selectionKind === "ready";
}

/**
 * Whether a conversation's new callouts stay out of the way. The selected
 * conversation shows them in its transcript when `transcriptVisible`; with the
 * transcript off screen (focus layout, cards in both panes) they show above the
 * composer like any other conversation's.
 */
export function ambientCalloutsHidden({ selected, transcriptVisible, attention }: {
  selected: boolean; transcriptVisible: boolean; attention: boolean;
}): boolean {
  return (selected && transcriptVisible) || !attention;
}
