/**
 * The per-item building blocks for InteractiveChat's message list: the
 * streaming-tail presentational pieces (live text, pending-HQ bubble), the
 * `DataItem` union and the pure helpers that assemble and key the data
 * array, plus the per-group renderer. Split out of
 * InteractiveChat-messages.tsx so the list shell stays focused on scroll
 * mechanics.
 */

import { memo, useMemo, type ReactNode } from "react";
import { MessageErrorBoundary } from "./MessageErrorBoundary";
import { UserMessage, AssistantMessage, CompactionMessage, InterruptedMessage, SelfNoteMessage, type MessageGroup, type OnZoomView, type ReplaySpeechOptions } from "../../ChatMessages/view";
import { isNoResponseOnly, parseAcks, parseCallouts, type AckIndication } from "../../../../lib/structured-output-parsing";
import { hasAssistantSpeech } from "../../../../lib/audio/speech-parsing/parse";
import type { SessionContentBlock, SessionEntry } from "../../../../api";
import { buildStreamEntry } from "../../../../lib/stream-entry";
import { hasProgressUpdate, hasRenderableAssistantContent } from "../../assistant-parts";
import type { ModelMarker } from "../../InteractiveChat-helpers";
import { CaptureBubbleView, type CaptureBubbleModel, type CaptureVerbs } from "../../capture-bubble";
import { invariant } from "@shared/invariant";
import type { SpeechSegmentState } from "../../../../machines/speech-segment-states";
import type { AudioOverlayStore } from "../../audio-overlay-store";
import type { PendingHq } from "../../../../machines/composerMachine";
import { PendingHqMessage } from "./pending-hq-message";

/**
 * Trim a streaming text buffer to the last safe boundary. Either a
 * paragraph break ("\n\n") or the end of a completed structured tag
 * (`</speech>`, `</ack>`, `</callout>`, or a self-closing `<ack/>` /
 * `<chat-app/>`) counts as safe. Without the tag boundary, a turn
 * that begins with `<speech>…</speech>` plays its audio (the speech
 * dispatcher runs off closed `</speech>` tags directly) before any
 * visible text appears — the trailing fragment sits in the
 * in-progress region until the first `\n\n` arrives.
 *
 * Trailing in-progress plain text is still hidden so mid-sentence
 * fragments don't twitch as the model types.
 */
function chunkOnParagraphs(text: string): string {
  const para = text.lastIndexOf("\n\n");
  const closeRe = /<\/(?:speech|ack|callout)\s*>|<(?:ack|chat-app)\b[^>]*?\/\s*>/gi;
  let lastTagEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = closeRe.exec(text)) !== null) {
    lastTagEnd = m.index + m[0].length;
  }
  const cut = Math.max(para, lastTagEnd);
  if (cut < 0) return "";
  return text.slice(0, cut);
}


export type DataItem =
  | { kind: "group"; group: MessageGroup; groupIndex: number; acks?: AckIndication[] }
  | { kind: "marker"; marker: ModelMarker }
  | { kind: "pendingHq"; pending: PendingHq }
  | { kind: "captureBubble"; model: CaptureBubbleModel };

function assistantGroupText(group: MessageGroup): string {
  if (group.type !== "assistant") return "";
  return group.entries.flatMap((e) =>
    e.content.filter((b) => b.type === "text").map((b) => b.text ?? "")
  ).join("\n");
}

function hasAssistantSurface(entries: SessionEntry[], opts: { debugView: boolean; proseEnabled: boolean }): boolean {
  const { debugView, proseEnabled } = opts;
  if (proseEnabled) return hasRenderableAssistantContent(entries, debugView);
  if (debugView) return false;
  const text = entries.flatMap((entry) =>
    entry.content.filter((block) => block.type === "text").map((block) => block.text ?? "")
  ).join("\n");
  return hasAssistantSpeech(text) || parseCallouts(text).length > 0;
}

export function dataItemKey(d: DataItem): string {
  switch (d.kind) {
    case "marker": return `marker-${d.marker.id}`;
    case "pendingHq": return `pendingHq-${d.pending.id}`;
    case "captureBubble": return `capture-${d.model.id}`;
    case "group": {
      const first = d.group.entries[0];
      invariant(first !== undefined, "message group has no entries");
      return first.uuid;
    }
  }
}

export interface SpeechPlaybackState {
  isPlaying: boolean;
  playingMessageId: string | null;
  statusMessageId: string | null;
  segmentStates: Record<number, SpeechSegmentState>;
  segmentFailures: Record<number, string>;
  playingSegmentIndex: number | null;
  remainingCount: number;
}

interface SettledItemsInput {
  groups: MessageGroup[];
  modelMarkers: ModelMarker[];
  debugView: boolean;
  proseEnabled: boolean;
}

interface TailItemsInput {
  groupCount: number;
  streamingShown: boolean;
  streamText: string;
  streamTools: SessionContentBlock[];
  liveTurnId: string | null;
  pendingHq: readonly PendingHq[];
  captureBubbles: CaptureBubbleModel[];
  debugView: boolean;
  proseEnabled: boolean;
}

/**
 * Build the interleaved data array: settled items, then the tail (pending
 * voice messages, capture bubbles, the streaming turn). Pure given its inputs.
 */
export function buildDataItems(opts: SettledItemsInput & Omit<TailItemsInput, "groupCount">): DataItem[] {
  return [...buildSettledItems(opts), ...buildTailItems({ ...opts, groupCount: opts.groups.length })];
}

/**
 * The settled items: groups + chronological markers, with `<ack>` tags hung
 * off the preceding user message and assistant groups with no visible content
 * (or a no-response-only ack) suppressed. Built apart from the tail so a
 * streamed token leaves these items, and their `acks` arrays, unchanged.
 *
 * Debug view keeps raw text that normal rendering strips (such as an ack),
 * but an entry with no text or visible activity still has no message body.
 */
export function buildSettledItems(opts: SettledItemsInput): DataItem[] {
  const { groups, modelMarkers, debugView, proseEnabled } = opts;
  const items: DataItem[] = [];
  for (const m of modelMarkers) {
    if (m.afterGroupCount === 0) items.push({ kind: "marker", marker: m });
  }
  for (const [i, group] of groups.entries()) {
    if (group.type === "assistant") {
      const allText = assistantGroupText(group);
      const groupAcks = parseAcks(allText);
      if (groupAcks.length > 0) {
        // `.at(-1)` (not `items[items.length - 1]`): its return type is
        // honestly `T | undefined` regardless of `noUncheckedIndexedAccess`
        // (which the frontend tsconfig lacks) — a plain index read would
        // type as always-defined even though `items` can be empty here.
        const last = items.at(-1);
        if (last && last.kind === "group" && last.group.type === "user") {
          last.acks = [...(last.acks ?? []), ...groupAcks];
        }
      }
      if ((isNoResponseOnly(allText) && !debugView && !hasProgressUpdate(group.entries))
        || !hasAssistantSurface(group.entries, { debugView, proseEnabled })) {
        // Keep markers anchored here so chronological order is preserved.
        for (const m of modelMarkers) {
          if (m.afterGroupCount === i + 1) items.push({ kind: "marker", marker: m });
        }
        continue;
      }
    }
    items.push({ kind: "group", group, groupIndex: i });
    for (const m of modelMarkers) {
      if (m.afterGroupCount === i + 1) items.push({ kind: "marker", marker: m });
    }
  }
  return items;
}

/** The items after the settled ones; the streaming turn changes on every token. */
export function buildTailItems(opts: TailItemsInput): DataItem[] {
  const { groupCount, streamingShown, streamText, streamTools, liveTurnId, pendingHq, captureBubbles, debugView, proseEnabled } = opts;
  const items: DataItem[] = [];
  for (const pending of pendingHq) items.push({ kind: "pendingHq", pending });
  for (const model of captureBubbles) items.push({ kind: "captureBubble", model });
  if (streamingShown) {
    // The live turn renders as a *provisional* assistant group through the same
    // GroupItem/AssistantMessage path as the finalized turn, keyed by liveTurnId
    // so finalize is an in-place update (no remount/flash). chunkOnParagraphs
    // trims to the last safe boundary so half-typed structured tags don't leak.
    const entry = buildStreamEntry({
      uuid: `live-${liveTurnId ?? "tail"}`,
      streamText: chunkOnParagraphs(streamText),
      streamTools,
    });
    if (hasAssistantSurface([entry], { debugView, proseEnabled })) {
      items.push({ kind: "group", group: { type: "assistant", entries: [entry] }, groupIndex: groupCount });
    }
  }
  return items;
}

/**
 * What every row reads besides its own item. Keep it free of per-token values:
 * a new context re-renders every row (`GroupItem` is memoized on it).
 */
export interface RenderItemContext {
  debugView: boolean;
  currentUserEmail: string | undefined;
  currentUserName: string | undefined;
  speechPlayback: SpeechPlaybackState;
  handleStopSpeech: () => void;
  handleSkipSpeech: () => void;
  handleReplaySpeech: (options: ReplaySpeechOptions) => void;
  onZoomView: OnZoomView;
  proseEnabled: boolean;
  /** Retry a failed pending capture (re-seals the staging session). */
  captureVerbs: CaptureVerbs;
  /** Written by the two audio-review events; read by `UserMessage`'s badges. */
  audioOverlayStore: AudioOverlayStore;
  /** A pending voice message's "Send live text now" control. */
  onHqSendLive: (id: string) => void;
}

/**
 * The row context, memoized on its fields. Every row is memoized on this
 * object's identity, so it must keep identity across streamed tokens. A hook
 * with its own `useMemo`: built inline in `MessageListInner`, the compiler
 * memoized it together with the row list, which changes per token, and every
 * row re-rendered per token (`test/…/messages.streaming-renders.test.ts`).
 */
export function useRenderItemContext(fields: RenderItemContext): RenderItemContext {
  const { debugView, currentUserEmail, currentUserName, speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, onZoomView, proseEnabled, captureVerbs, audioOverlayStore, onHqSendLive } = fields;
  return useMemo(
    () => ({ debugView, currentUserEmail, currentUserName, speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, onZoomView, proseEnabled, captureVerbs, audioOverlayStore, onHqSendLive }),
    [debugView, currentUserEmail, currentUserName, speechPlayback, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, onZoomView, proseEnabled, captureVerbs, audioOverlayStore, onHqSendLive],
  );
}

/**
 * Render one message group (compaction / interrupted / self-note / user /
 * assistant), wrapped in an error boundary keyed by group identity. Memoized:
 * the list rebuilds every row element per streamed token, and a settled row's
 * props (group, acks, ctx) keep identity across tokens.
 */
function GroupItemInner({
  group, groupIndex, acks, ctx, latestAssistant,
}: {
  group: MessageGroup;
  groupIndex: number;
  acks?: AckIndication[];
  ctx: RenderItemContext;
  /** This is the newest assistant group, which auto-played speech highlights. */
  latestAssistant: boolean;
}) {
  const { debugView, currentUserEmail, currentUserName, speechPlayback, onZoomView, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, proseEnabled, audioOverlayStore } = ctx;
  const boundaryLabel = `${group.type}#${groupIndex}:${group.entries[0]?.uuid ?? ""}`;
  let body: ReactNode;
  if (group.type === "compaction") {
    body = <div className="py-0.5"><CompactionMessage entries={group.entries} /></div>;
  } else if (group.type === "interrupted") {
    body = <div className="py-0.5"><InterruptedMessage /></div>;
  } else if (group.type === "self-note") {
    body = (
      <div className="py-0.5">
        {group.notes.map((note, i) => (
          <SelfNoteMessage key={i} note={note} />
        ))}
      </div>
    );
  } else if (group.type === "user") {
    body = <div className="py-0.5"><UserMessage entries={group.entries} debugView={debugView} currentUserEmail={currentUserEmail} currentUserName={currentUserName} acks={acks} onZoomView={onZoomView} audioOverlayStore={audioOverlayStore} /></div>;
  } else {
    // "This message is playing" matches either an explicit replay
    // (playingMessageId is this group's uuid) or auto-played speech
    // from the latest turn (playingMessageId is a synthetic stream-*
    // id — uuids never start with "stream", so this can't collide).
    const groupUuid = group.entries[0]?.uuid ?? "";
    const pid = speechPlayback.playingMessageId;
    const isStreamId = typeof pid === "string" && pid.startsWith("stream");
    const playingThis = speechPlayback.isPlaying &&
      (pid === groupUuid || (isStreamId && latestAssistant));
    const statusId = speechPlayback.statusMessageId;
    const statusIsStream = typeof statusId === "string" && statusId.startsWith("stream");
    const statusThis = statusId === groupUuid
      || (statusIsStream && latestAssistant);
    body = (
      <div className="py-0.5">
        <AssistantMessage
          entries={group.entries}
          debugView={debugView}
          speechPlaying={playingThis}
          speechActiveIndex={playingThis ? speechPlayback.playingSegmentIndex : null}
          speechSegmentStates={statusThis ? speechPlayback.segmentStates : {}}
          speechSegmentFailures={statusThis ? speechPlayback.segmentFailures : {}}
          anySpeechPlaying={speechPlayback.isPlaying}
          speechCanSkip={Boolean(speechPlayback.isPlaying && speechPlayback.remainingCount > 1)}
          onStopSpeech={handleStopSpeech}
          onSkipSpeech={handleSkipSpeech}
          onReplaySpeech={handleReplaySpeech}
          onZoomView={onZoomView}
          proseEnabled={proseEnabled}
        />
      </div>
    );
  }
  return <MessageErrorBoundary label={boundaryLabel}>{body}</MessageErrorBoundary>;
}
const GroupItem = memo(GroupItemInner);

/**
 * Map a single `DataItem` to its rendered node. The streaming-tail and
 * marker variants render inline; group variants delegate to `GroupItem`.
 * `lastAssistantGroupIndex` stays out of `ctx`: it changes when a reply first
 * shows, and only the two rows it moves between should render then.
 */
export function renderDataItem(item: DataItem, row: { ctx: RenderItemContext; lastAssistantGroupIndex: number }): ReactNode {
  const { ctx, lastAssistantGroupIndex } = row;
  if (item.kind === "marker") {
    return (
      <div className="flex justify-center py-1">
        <div className="bbx-chat-meta-material text-[11px] text-card-soft px-2.5 py-0.5 bg-warm-50 border border-warm-200 rounded-full">
          {item.marker.label}
        </div>
      </div>
    );
  }
  if (item.kind === "pendingHq") {
    const { onHqSendLive: handleHqSendLive } = ctx;
    return <PendingHqMessage pending={item.pending} onSendLive={handleHqSendLive} />;
  }
  if (item.kind === "captureBubble") {
    const { retry: handleCaptureRetry, discard: handleCaptureDiscard } = ctx.captureVerbs;
    return <CaptureBubbleView model={item.model} onRetry={handleCaptureRetry} onDiscard={handleCaptureDiscard} />;
  }
  return <GroupItem group={item.group} groupIndex={item.groupIndex} acks={item.acks} ctx={ctx} latestAssistant={item.groupIndex === lastAssistantGroupIndex} />;
}
