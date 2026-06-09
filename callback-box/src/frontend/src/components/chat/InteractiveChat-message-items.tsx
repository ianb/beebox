/**
 * The per-item building blocks for InteractiveChat's virtualized list: the
 * streaming-tail presentational pieces (live text, throbber, processing
 * placeholder, pending-HQ bubble), the `DataItem` union and the pure
 * helpers that assemble and key the data array, plus the per-group
 * renderer. Split out of InteractiveChat-messages.tsx so the list shell
 * stays focused on virtualization/scroll mechanics.
 */

import { type ReactNode } from "react";
import { Grid } from "ldrs/react";
import "ldrs/react/Grid.css";
import { MessageErrorBoundary } from "./MessageErrorBoundary";
import { UserMessage, AssistantMessage, AssistantSpeechText, CompactionMessage, InterruptedMessage, SelfNoteMessage, ToolList, UserMessageText, type MessageGroup, type OnZoomView, type ReplaySpeechOptions } from "../ChatMessages";
import { isNoResponseOnly, parseAcks, type AckIndication } from "../../lib/structured-output-parsing";
import type { SessionContentBlock } from "../../api";
import type { ModelMarker } from "./InteractiveChat-helpers";

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

/**
 * In-flight user message during narration's HQ transcription pass. Shows
 * the realtime transcript as a faded user bubble with a "finalizing
 * transcript…" caption, so the user sees that the system is working on
 * their message rather than nothing happening.
 */
function PendingHqMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <div className="flex flex-col items-end gap-1">
        <div
          className="rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words opacity-60"
          title="Finalizing high-quality transcription…"
        >
          <div className="text-sm whitespace-pre-wrap">
            <UserMessageText text={text} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-warm-500 pr-2">
          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
          finalizing transcript…
        </div>
      </div>
    </div>
  );
}

/**
 * Streaming content being built up during a turn. `chunkOnParagraphs` only
 * ever exposes text up to a paragraph break or a closed `</speech>` tag, so
 * any speech tag inside `visible` is complete — we can run it through the same
 * speech-aware renderer the finalized message uses, giving spoken chunks their
 * styling and speaker name as they stream in. The now-playing highlight stays
 * off here (`activeIndex={null}`); it only applies once the turn is finalized.
 */
function StreamingMessage({ text, onZoomView }: { text: string; onZoomView?: OnZoomView }) {
  const visible = chunkOnParagraphs(text);
  if (!visible) return null;
  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2">
      <AssistantSpeechText text={visible} indexOffset={0} activeIndex={null} onZoomView={onZoomView} />
    </div>
  );
}

/**
 * The agent-working throbber. Shown both below the live streaming text/tools
 * (during an active SSE turn) and on its own when a reloaded page learns the
 * agent is mid-turn but has no live stream attached — so the indicator looks
 * the same whether the turn is being streamed or just resumed after reload.
 * The optional caption labels the standalone (reload) case, where there's no
 * surrounding streamed text to give it context.
 */
function StreamingThrobber({ caption }: { caption?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 my-6">
      <Grid size={40} color="#D4845A" speed={1.5} /> {/* coral */}
      {caption ? <div className="text-sm text-warm-500 italic">{caption}</div> : null}
    </div>
  );
}

export type DataItem =
  | { kind: "group"; group: MessageGroup; groupIndex: number; acks?: AckIndication[] }
  | { kind: "marker"; marker: ModelMarker }
  | { kind: "stream" }
  | { kind: "processing" }
  | { kind: "pendingHq"; text: string };

function assistantGroupText(group: MessageGroup): string {
  if (group.type !== "assistant") return "";
  return group.entries.flatMap((e) =>
    e.content.filter((b) => b.type === "text").map((b) => b.text ?? "")
  ).join("\n");
}

export function dataItemKey(d: DataItem): string {
  switch (d.kind) {
    case "marker": return `marker-${d.marker.id}`;
    case "stream": return "stream";
    case "processing": return "processing";
    case "pendingHq": return "pendingHq";
    case "group": return d.group.entries[0].uuid;
  }
}

export interface SpeechPlaybackState {
  isPlaying: boolean;
  playingMessageId: string | null;
  playingSegmentIndex: number | null;
  remainingCount: number;
}

/**
 * Build the interleaved data array: groups + chronological markers, with
 * `<ack>` tags hung off the preceding user message and no-response-only
 * assistant groups suppressed. Pure given its inputs.
 *
 * When `debugView` is on the suppression is skipped: a no-response-only turn
 * (e.g. the model replying `<ack kind="no-response"/>` to a trivial message)
 * is otherwise invisible except for a faint badge, which reads as "the chat
 * didn't respond." Debug view should show exactly what the model emitted.
 */
export function buildDataItems(opts: {
  groups: MessageGroup[];
  modelMarkers: ModelMarker[];
  streamingShown: boolean;
  processingShown: boolean;
  pendingHqDraft: string | null;
  debugView: boolean;
}): DataItem[] {
  const { groups, modelMarkers, streamingShown, processingShown, pendingHqDraft, debugView } = opts;
  const items: DataItem[] = [];
  for (const m of modelMarkers) {
    if (m.afterGroupCount === 0) items.push({ kind: "marker", marker: m });
  }
  for (const [i, group] of groups.entries()) {
    if (group.type === "assistant") {
      const allText = assistantGroupText(group);
      const groupAcks = parseAcks(allText);
      if (groupAcks.length > 0) {
        const last = items[items.length - 1];
        if (last && last.kind === "group" && last.group.type === "user") {
          last.acks = [...(last.acks ?? []), ...groupAcks];
        }
      }
      if (isNoResponseOnly(allText) && !debugView) {
        // Suppress the empty bubble but still emit markers anchored here
        // so chronological order is preserved. Skipped in debug view so the
        // raw no-response ack stays visible.
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
  if (pendingHqDraft !== null) items.push({ kind: "pendingHq", text: pendingHqDraft });
  if (streamingShown) items.push({ kind: "stream" });
  else if (processingShown) items.push({ kind: "processing" });
  return items;
}

export interface RenderItemContext {
  streamText: string;
  streamTools: SessionContentBlock[];
  debugView: boolean;
  currentUserEmail: string | undefined;
  speechPlayback: SpeechPlaybackState;
  handleStopSpeech: () => void;
  handleSkipSpeech: () => void;
  handleReplaySpeech: (options: ReplaySpeechOptions) => void;
  onZoomView: OnZoomView;
  proseEnabled: boolean;
  lastAssistantGroupIndex: number;
}

/**
 * Render one message group (compaction / interrupted / self-note / user /
 * assistant), wrapped in an error boundary keyed by group identity.
 */
function GroupItem({
  group, groupIndex, acks, ctx,
}: {
  group: MessageGroup;
  groupIndex: number;
  acks?: AckIndication[];
  ctx: RenderItemContext;
}) {
  const { debugView, currentUserEmail, speechPlayback, lastAssistantGroupIndex, onZoomView, handleStopSpeech, handleSkipSpeech, handleReplaySpeech, proseEnabled } = ctx;
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
    body = <div className="py-0.5"><UserMessage entries={group.entries} debugView={debugView} currentUserEmail={currentUserEmail} acks={acks} onZoomView={onZoomView} /></div>;
  } else {
    // "This message is playing" matches either an explicit replay
    // (playingMessageId is this group's uuid) or auto-played speech
    // from the latest turn (playingMessageId is a synthetic stream-*
    // id — uuids never start with "stream", so this can't collide).
    const groupUuid = group.entries[0]?.uuid ?? "";
    const pid = speechPlayback.playingMessageId;
    const isStreamId = typeof pid === "string" && pid.startsWith("stream");
    const playingThis = speechPlayback.isPlaying &&
      (pid === groupUuid || (isStreamId && groupIndex === lastAssistantGroupIndex));
    body = (
      <div className="py-0.5">
        <AssistantMessage
          entries={group.entries}
          debugView={debugView}
          speechPlaying={playingThis}
          speechActiveIndex={playingThis ? speechPlayback.playingSegmentIndex : null}
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

/**
 * Map a single `DataItem` to its rendered node. The streaming-tail and
 * marker variants render inline; group variants delegate to `GroupItem`.
 */
export function renderDataItem(item: DataItem, ctx: RenderItemContext): ReactNode {
  if (item.kind === "marker") {
    return (
      <div className="flex justify-center py-1">
        <div className="text-[11px] text-warm-500 px-2.5 py-0.5 bg-warm-50 border border-warm-200 rounded-full">
          {item.marker.label}
        </div>
      </div>
    );
  }
  if (item.kind === "stream") {
    const { streamText, onZoomView } = ctx;
    return (
      <MessageErrorBoundary label="stream">
        <div className="py-0.5">
          <StreamingMessage text={streamText} onZoomView={onZoomView} />
          {ctx.streamTools.length > 0 ? (
            <div className="pl-3 sm:pl-6 pr-4 sm:pr-24 pb-2">
              <ToolList blocks={ctx.streamTools} />
            </div>
          ) : null}
          <StreamingThrobber />
        </div>
      </MessageErrorBoundary>
    );
  }
  if (item.kind === "processing") {
    return <StreamingThrobber caption="Agent is processing…" />;
  }
  if (item.kind === "pendingHq") {
    return <PendingHqMessage text={item.text} />;
  }
  return <GroupItem group={item.group} groupIndex={item.groupIndex} acks={item.acks} ctx={ctx} />;
}
