/** Bounded transcript projection; bus completion signals never supply reply text. */
import type { SessionEntry } from "../../../api";
import { groupMessages } from "../message-parsing";
import { parseAcks, parseCallouts } from "../../../lib/structured-output-parsing";

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
  const callouts = identity ? parseCallouts(text) : [];
  const acks = identity ? parseAcks(text) : [];
  // A reply without callouts or acks shows its own persisted text.
  const preview = identity && callouts.length === 0 && acks.length === 0 ? text.trim() : "";
  return { identity, complete, earlier: truncated || (complete && unsafe), callouts, acks, preview };
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
 * Whether a conversation's ambient panel stays out of the way. The selected
 * conversation shows its transcript when `transcriptVisible`; with the
 * transcript off screen (focus layout, cards in both panes) its panel shows the
 * reply like any other conversation's.
 */
export function ambientPanelHidden({ selected, transcriptVisible, attention, busy, error }: {
  selected: boolean; transcriptVisible: boolean; attention: boolean; busy: boolean; error: boolean;
}): boolean {
  return (selected && transcriptVisible) || (!attention && !busy && !error);
}
