/**
 * Shared message rendering components for chat UI.
 */

import { useMemo } from "react";
import { Grid } from "ldrs/react";
import "ldrs/react/Grid.css";
import { Pre } from "../ui/Pre";
import type { SessionEntry } from "../../api";
import { hasAssistantSpeech, parseAllSpeechTags, splitSpeechParts, type SpeechSegment } from "../../lib/audio/speech-parsing";
import { SpeechMenu } from "./SpeechMenu";
import { SpeechChunk } from "./SpeechChunk";
import { parseCallouts } from "../../lib/structured-output-parsing";
import { CalloutStack } from "./CalloutBlock";
import { ActivityGroup, ThinkingCornerMark } from "./activity-rendering";
import { MarkdownContent, type OnZoomView } from "./markdown-rendering";
import { countSpeech, groupIntoParts, type SelfNoteInfo } from "./message-parsing";
import type { SpeechSegmentState } from "../../machines/speechPlaybackMachine";

export interface ReplaySpeechOptions {
  messageId: string;
  segments: SpeechSegment[];
  fromIndex: number;
}

/**
 * Render an assistant text group, wrapping each `<speech>` chunk in a
 * SpeechChunk so it can show the now-playing highlight and an optional name
 * label. Non-spoken text renders as ordinary markdown. `indexOffset` makes
 * each chunk's index absolute across the whole message (groups may be split
 * by tool activity); `activeIndex` is the segment currently playing.
 */
export function AssistantSpeechText({
  text,
  indexOffset,
  activeIndex,
  segmentStates,
  onZoomView,
}: {
  text: string;
  indexOffset: number;
  activeIndex: number | null;
  segmentStates: Record<number, SpeechSegmentState>;
  onZoomView?: OnZoomView;
}) {
  const parts = useMemo(() => splitSpeechParts(text), [text]);
  return (
    <>
      {parts.map((part, i) =>
        part.type === "text" ? (
          <MarkdownContent key={i} text={part.text} onZoomView={onZoomView} />
        ) : (
          <SpeechChunk
            key={i}
            name={part.segment.name}
            state={
              segmentStates[indexOffset + part.index]
                ?? (activeIndex !== null && indexOffset + part.index === activeIndex
                  ? "playing"
                  : undefined)
            }
          >
            <MarkdownContent text={part.segment.displayText} onZoomView={onZoomView} />
          </SpeechChunk>
        )
      )}
    </>
  );
}

export function AssistantMessage({
  entries,
  debugView,
  speechPlaying,
  speechActiveIndex,
  speechSegmentStates,
  anySpeechPlaying,
  speechCanSkip,
  onStopSpeech,
  onSkipSpeech,
  onReplaySpeech,
  onZoomView,
  proseEnabled,
  isStreaming,
}: {
  entries: SessionEntry[];
  debugView?: boolean;
  /** This message's speech is the one currently playing. */
  speechPlaying?: boolean;
  /** Absolute index of the segment currently playing in this message, or null. */
  speechActiveIndex?: number | null;
  /** Per-segment progress, including failures that remain after playback advances. */
  speechSegmentStates?: Record<number, SpeechSegmentState>;
  /** Some speech (this message or another) is currently playing. */
  anySpeechPlaying?: boolean;
  /** A next segment exists in the currently-playing queue. */
  speechCanSkip?: boolean;
  onStopSpeech?: () => void;
  onSkipSpeech?: () => void;
  onReplaySpeech?: (options: ReplaySpeechOptions) => void;
  onZoomView?: OnZoomView;
  /** When false, untagged prose hides; only callouts and acks render. Default true. */
  proseEnabled?: boolean;
  /** This group is the live, still-streaming turn — show a cursor/working state. */
  isStreaming?: boolean;
}) {
  const grouped = groupIntoParts(entries);
  const allText = entries.flatMap((e) =>
    e.content.filter((b) => b.type === "text").map((b) => b.text ?? "")
  ).join("\n");
  const hasSpeech = hasAssistantSpeech(allText);
  const isPlaying = speechPlaying === true;
  const segments = useMemo(() => (hasSpeech ? parseAllSpeechTags(allText) : []), [hasSpeech, allText]);
  const messageId = entries[0]?.uuid ?? "";
  const hasSilentThinking = entries.some((e) =>
    e.content.some((b) => b.type === "thinking" && !b.text?.trim()),
  );
  // Pulled out of the message body so prose rendering doesn't show raw XML;
  // rendered in their own surfaces below/after the markdown groups. Acks
  // are rendered as badges on the preceding user message — see InteractiveChat.
  const callouts = useMemo(() => parseCallouts(allText), [allText]);
  const showProse = proseEnabled !== false;
  const activeIndex = speechActiveIndex === undefined ? null : speechActiveIndex;
  const segmentStates = speechSegmentStates ?? {};

  // Absolute speech-segment index at the start of each group, so a chunk's
  // highlight index stays correct even when tool activity splits the message
  // into multiple text groups.
  const groupSpeechOffsets = useMemo(() => {
    const offsets: number[] = [];
    let count = 0;
    for (const group of grouped) {
      offsets.push(count);
      if (group.kind === "text") count += countSpeech(group.text);
    }
    return offsets;
  }, [grouped]);

  return (
    <div className="px-3 sm:px-6 py-2">
      {/* Zero-height sticky bar pinned to the top-right of the message. It
          takes no vertical space (h-0, so prose doesn't shift) and sticks
          within this message's bounds as the list scrolls: the speaker icon
          stays visible while a tall message is read, then releases when the
          message's bottom scrolls past. Lives OUTSIDE the overflow-hidden
          content wrapper below — a sticky child of an overflow:hidden box
          would stick within that short non-scrolling box, not the message
          list. pointer-events-none keeps the empty bar from blocking text
          selection; the icon itself re-enables pointer events. */}
      {!debugView && (hasSpeech || hasSilentThinking) ? (
        <div className="sticky top-2 z-10 h-0 flex justify-end items-start pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            {hasSilentThinking ? <ThinkingCornerMark /> : null}
            {hasSpeech ? (
              <SpeechMenu
                segments={segments}
                playing={isPlaying}
                anyPlaying={anySpeechPlaying === true}
                canSkip={speechCanSkip === true}
                onStop={() => onStopSpeech?.()}
                onSkip={() => onSkipSpeech?.()}
                onReplay={(fromIndex) => onReplaySpeech?.({ messageId, segments, fromIndex })}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      {/* min-w-0 overflow-hidden clips wide/unbreakable content (long code,
          tables, URLs) so it can't stretch the message width. Kept here as a
          sibling of the sticky bar, not an ancestor, so it doesn't capture the
          icon's sticky positioning. */}
      <div className="min-w-0 overflow-hidden">
        {showProse ? grouped.map((group, i) =>
          group.kind === "text" ? (
            debugView ? (
              <Pre key={i} size="xs" boxed>{group.text}</Pre>
            ) : (
              <AssistantSpeechText
                key={i}
                text={group.text}
                indexOffset={groupSpeechOffsets[i] ?? 0}
                activeIndex={activeIndex}
                segmentStates={segmentStates}
                onZoomView={onZoomView}
              />
            )
          ) : (
            <ActivityGroup key={i} parts={group.parts} />
          )
        ) : null}
        {!debugView ? <CalloutStack callouts={callouts} onZoomView={onZoomView} /> : null}
        {isStreaming ? (
          // The "agent is working" progress animation, shown below the streamed
          // content for the whole turn (matches the pre-unification throbber).
          <div className="flex flex-col items-center gap-2 my-6">
            <Grid size={40} color="#D4845A" speed={1.5} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Render a compaction notification as a collapsed details element.
 */
export function CompactionMessage({ entries }: { entries: SessionEntry[] }) {
  const text = entries
    .flatMap((e) => e.content.filter((b) => b.type === "text").map((b) => b.text ?? ""))
    .join("\n")
    .trim();

  return (
    <div className="flex justify-center py-2">
      <details className="text-xs text-warm-500 max-w-[80%]">
        <summary className="cursor-pointer text-center hover:text-warm-600">
          Context compacted
        </summary>
        {text && text !== "Conversation compacted" ? (
          <div className="mt-2 text-left bg-warm-50 rounded p-3 text-warm-600 whitespace-pre-wrap max-h-60 overflow-auto">
            {text}
          </div>
        ) : null}
      </details>
    </div>
  );
}

/**
 * Render an interrupted-turn marker — shown where a response was cancelled.
 */
export function InterruptedMessage() {
  return (
    <div className="flex justify-center py-2">
      <span className="text-xs text-warm-500">Request interrupted</span>
    </div>
  );
}

/**
 * Render an agent-authored self-note. Distinct from user bubbles — it's
 * not conversational content; it's a background activity record.
 */
export function SelfNoteMessage({ note }: { note: SelfNoteInfo }) {
  const commitShort = note.commit ? note.commit.substring(0, 7) : null;
  return (
    <div className="py-2 px-3 sm:px-6">
      <div className="mx-auto max-w-2xl border-l-2 border-warm-300 bg-warm-50/60 rounded-r px-3 py-2 text-sm text-warm-700">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-warm-500 mb-1">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M9 12h6M9 16h6M9 8h6M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-3-7 3z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>self-note</span>
          {note.ref ? (
            <span className="normal-case tracking-normal text-warm-500 truncate">· {note.ref}</span>
          ) : null}
          {commitShort ? (
            <span className="normal-case tracking-normal text-warm-500 font-mono">· {commitShort}</span>
          ) : null}
        </div>
        <div className="whitespace-pre-wrap break-words">{note.body}</div>
      </div>
    </div>
  );
}

export { UserMessage } from "./user-message";
export { UserMessageText } from "./user-message-text";
export { MarkdownContent } from "./markdown-rendering";
export { ToolList } from "./activity-rendering";
export { groupMessages, extractChatImages, type MessageGroup } from "./message-parsing";
export type { OnZoomView } from "./markdown-rendering";
