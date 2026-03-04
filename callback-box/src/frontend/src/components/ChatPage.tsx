/**
 * ChatPage - Full-page chat interface for the box's conversational assistant.
 *
 * Streams messages from the backend ChatSession via SSE.
 * User input is wrapped in <typed> tags before sending.
 * User messages are right-aligned dark bubbles; assistant uses markdown.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSSRMachine } from "../hooks/useSSRMachine";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TextareaAutosize from "react-textarea-autosize";
import { getApiBase, type SessionEntry, type SessionContentBlock } from "../api";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import { useSpeechPlayback } from "../hooks/useSpeechPlayback";
import { hasAssistantSpeech, parseAllSpeechTags, VALID_VOICES } from "../lib/speech-parsing";
import { getTTSClient } from "../lib/tts-client";
import { unlockAudioContext } from "../lib/audio-context";
import { Grid } from "ldrs/react";
import "ldrs/react/Grid.css";
import { sendSound, tick, recordingStart } from "../lib/earcons";
import { MicrophoneIcon, RecordingIndicator } from "./VoiceRecorder";
import { DebugLogPanel, enableDebugLogCapture } from "./DebugLog";
import { chatMachine } from "../machines/chatMachine.js";

// Start capturing console logs immediately so we don't miss early messages
enableDebugLogCapture();

/**
 * Format the current local time as HH:MM for the typed tag.
 */
function localTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/**
 * Render user message text with keyword pills (e.g. send-message).
 */
function UserMessageText({ text }: { text: string }) {
  const stripped = text
    .replace(/<typed[^>]*>/gi, "")
    .replace(/<\/typed>/gi, "")
    .replace(/<speech[^>]*>/gi, "")
    .replace(/<\/speech>/gi, "");

  const parts: Array<{ type: "text"; value: string } | { type: "send"; phrase: string }> = [];
  const tagRe = /<send-message\s+phrase="([^"]*?)"\s*\/>/gi;
  let lastIndex = 0;
  let match;
  while ((match = tagRe.exec(stripped)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: stripped.slice(lastIndex, match.index) });
    }
    parts.push({ type: "send", phrase: match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < stripped.length) {
    parts.push({ type: "text", value: stripped.slice(lastIndex) });
  }

  const hasPill = parts.some((p) => p.type === "send");
  if (!hasPill) {
    return <>{stripped.trim()}</>;
  }

  return (
    <>
      {parts.map((p, i) =>
        p.type === "text" ? (
          <span key={i}>{p.value}</span>
        ) : (
          <span key={i} className="inline-flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5 text-xs font-medium">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            {p.phrase}
          </span>
        )
      )}
    </>
  );
}

/**
 * Strip speech tags and instructions from assistant content for markdown rendering.
 */
function stripSpeechTags(content: string): string {
  let result = content.replace(/<instructions>[\S\s]*?<\/instructions>/gi, "");
  result = result.replace(/<speech[^>]*>/gi, "");
  result = result.replace(/<\/speech>/gi, "");
  return result.trim();
}

/**
 * Render a tool use block (collapsed by default).
 */
function ToolList({ blocks }: { blocks: SessionContentBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="text-xs text-warm-600 leading-tight my-1 ml-2 pl-2 border-l border-warm-400">
      {blocks.map((block, i) => (
        <details key={i} className="group">
          <summary className="cursor-pointer list-none flex items-center gap-1 hover:text-warm-700">
            <span className="text-warm-500 group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
            <span className="font-medium text-warm-700">{block.toolName}</span>
            {block.inputSummary && block.inputSummary !== block.toolName ? (
              <span className="ml-0.5">{block.inputSummary}</span>
            ) : null}
          </summary>
          {block.input ? (
            <pre className="mt-1 mb-1 ml-3 text-[11px] text-warm-500 bg-warm-50 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          ) : null}
        </details>
      ))}
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  if (!text) return null;
  return (
    <details className="group my-1 ml-2 pl-2 border-l border-plum-100">
      <summary className="cursor-pointer list-none flex items-center gap-1 text-xs text-plum hover:text-plum-dark">
        <span className="group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
        thinking
      </summary>
      <div className="mt-1 text-xs text-warm-600 whitespace-pre-wrap max-h-60 overflow-auto">
        {text}
      </div>
    </details>
  );
}

/**
 * Render markdown content with prose styling.
 */
function MarkdownContent({ text }: { text: string }) {
  const cleaned = useMemo(() => stripSpeechTags(text), [text]);

  if (!cleaned) return null;

  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
    </div>
  );
}

/**
 * Group consecutive messages by role for merged display.
 */
function groupMessages(entries: SessionEntry[]): Array<{ type: "user" | "assistant"; entries: SessionEntry[] }> {
  const groups: Array<{ type: "user" | "assistant"; entries: SessionEntry[] }> = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.type === entry.type) {
      last.entries.push(entry);
    } else {
      groups.push({ type: entry.type, entries: [entry] });
    }
  }
  return groups;
}

/**
 * Render a user message bubble.
 */
function UserMessage({ entries, debugView }: { entries: SessionEntry[]; debugView?: boolean }) {
  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <div className="rounded-l-2xl bg-iris text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px]">
        {entries.map((entry) =>
          entry.content
            .filter((b) => b.type === "text")
            .map((block, i) =>
              debugView ? (
                <pre key={`${entry.uuid}-${i}`} className="font-mono text-xs whitespace-pre-wrap">
                  {block.text ?? ""}
                </pre>
              ) : (
                <div key={`${entry.uuid}-${i}`} className="text-sm whitespace-pre-wrap">
                  <UserMessageText text={block.text ?? ""} />
                </div>
              )
            )
        )}
      </div>
    </div>
  );
}

/**
 * Render a group of consecutive assistant messages merged together.
 */
function AssistantMessage({ entries, debugView }: { entries: SessionEntry[]; debugView?: boolean }) {
  // Collect all content blocks across the group, interleaved
  const parts: Array<{ type: "text" | "tools" | "thinking"; text?: string; tools?: SessionContentBlock[] }> = [];

  for (const entry of entries) {
    for (const block of entry.content) {
      if (block.type === "thinking") {
        parts.push({ type: "thinking", text: block.text });
      } else if (block.type === "text" && block.text?.trim()) {
        parts.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        // Merge consecutive tool_use into one tools group
        const last = parts[parts.length - 1];
        if (last && last.type === "tools") {
          last.tools!.push(block);
        } else {
          parts.push({ type: "tools", tools: [block] });
        }
      }
    }
  }

  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2">
      {parts.map((part, i) =>
        part.type === "thinking" ? (
          <ThinkingBlock key={i} text={part.text ?? ""} />
        ) : part.type === "text" ? (
          debugView ? (
            <pre key={i} className="font-mono text-xs whitespace-pre-wrap bg-warm-50 text-warm-800 p-2 rounded">
              {part.text ?? ""}
            </pre>
          ) : (
            <MarkdownContent key={i} text={part.text ?? ""} />
          )
        ) : (
          <ToolList key={i} blocks={part.tools ?? []} />
        )
      )}
    </div>
  );
}

function NewSessionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
      title="New Session"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  );
}

/**
 * Debug dropdown menu for chat controls.
 */
function ChatDebugMenu({
  onStopProcess,
  sessionId,
  running,
  busy,
  debugView,
  onToggleDebugView,
  showDebugLog,
  onToggleDebugLog,
}: {
  onStopProcess: () => void;
  sessionId: string | null;
  running: boolean;
  busy: boolean;
  debugView: boolean;
  onToggleDebugView: () => void;
  showDebugLog: boolean;
  onToggleDebugLog: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded hover:bg-white/20 text-white/80 hover:text-white"
        title="Debug controls"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-warm-300 rounded-lg shadow-lg z-50 py-1">
          <button
            onClick={() => { onStopProcess(); setOpen(false); }}
            disabled={!running}
            className="w-full text-left px-3 py-2 text-sm hover:bg-warm-100 text-warm-700 disabled:text-warm-500 disabled:hover:bg-warm-50"
          >
            Stop Process
          </button>
          <div className="border-t border-warm-200 my-1" />
          <button
            onClick={() => { onToggleDebugView(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-warm-100 text-warm-700"
          >
            {debugView ? "\u2713 " : ""}Debug View
          </button>
          <button
            onClick={() => { onToggleDebugLog(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-warm-100 text-warm-700"
          >
            {showDebugLog ? "\u2713 " : ""}Debug Log
          </button>
          <div className="border-t border-warm-200 my-1" />
          <div className="px-3 py-1.5 text-xs text-warm-500">
            <div>Session: {sessionId ? sessionId.slice(0, 12) + "..." : "none"}</div>
            <div>Process: {running ? (busy ? "busy" : "idle") : "stopped"}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Streaming content being built up during a turn.
 */
function StreamingMessage({ text }: { text: string }) {
  return (
    <div className="pr-4 sm:pr-24 pl-3 sm:pl-6 py-2">
      {text ? (
        <MarkdownContent text={text} />
      ) : null}
      <div className="flex justify-center mt-6">
        <Grid size={40} color="#D4845A" speed={1.5} /> {/* coral */}
      </div>
    </div>
  );
}

export function ChatPage() {
  const [snapshot, send] = useSSRMachine(chatMachine);
  const { messages, streamText, streamTools, error, sessionId, processRunning } = snapshot.context;
  const isStreaming = snapshot.matches("streaming") || snapshot.matches("refreshing");
  const isLoading = snapshot.matches("loading");

  const [input, setInput] = useState("");
  const [debugView, setDebugView] = useState(false);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const turnTakingRef = useRef(false);
  const transcriptionRef = useRef<{ start: () => void } | null>(null);
  const stopTickRef = useRef<(() => void) | null>(null);
  const prevStateRef = useRef<string>("loading");
  const speechPlayedRef = useRef(false);

  // Track machine state for use in stable callbacks
  const machineStateRef = useRef(snapshot.value);
  useEffect(() => {
    machineStateRef.current = snapshot.value;
  });

  const speechPlayback = useSpeechPlayback({
    onComplete: () => {
      if (turnTakingRef.current && machineStateRef.current !== "streaming") {
        recordingStart.play();
        transcriptionRef.current?.start();
      }
    },
  });

  // Load voice config from personality on mount
  useEffect(() => {
    fetch(`${getApiBase()}/chat/voice-config`)
      .then((r) => r.json())
      .then((config: { model?: string; instructions?: string[] }) => {
        const tts = getTTSClient();
        if (config.model && (VALID_VOICES as readonly string[]).includes(config.model as typeof VALID_VOICES[number])) {
          tts.setVoiceConfig({ voice: config.model as typeof VALID_VOICES[number] });
        }
        if (config.instructions?.length) {
          tts.setVoiceConfig({ baseInstructions: config.instructions.join(" ") });
        }
      })
      .catch(() => {});
  }, []);

  // Handle state transitions: speech playback on result, mic restart after refresh
  useEffect(() => {
    const current = snapshot.value as string;
    const prev = prevStateRef.current;
    prevStateRef.current = current;

    // streaming → refreshing: play speech, stop tick
    if (current === "refreshing" && prev === "streaming") {
      if (stopTickRef.current) {
        stopTickRef.current();
        stopTickRef.current = null;
      }
      const hasSpeech = hasAssistantSpeech(snapshot.context.streamText);
      speechPlayedRef.current = hasSpeech;
      if (hasSpeech) {
        const segments = parseAllSpeechTags(snapshot.context.streamText);
        speechPlayback.playSegments({
          messageId: `stream-${Date.now()}`,
          segments,
        });
      }
    }

    // refreshing → idle: restart mic for non-speech responses
    if (current === "idle" && prev === "refreshing") {
      if (!speechPlayedRef.current && turnTakingRef.current) {
        recordingStart.play();
        transcriptionRef.current?.start();
      }
    }
  }, [snapshot.value, snapshot.context.streamText, speechPlayback]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const doSend = useCallback(
    (wrapped: string) => {
      send({ type: "SEND", message: wrapped });
    },
    [send]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    unlockAudioContext();
    setInput("");
    doSend(`<typed local-time="${localTime()}">${text}</typed>`);
  }, [input, isStreaming, doSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInterrupt = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  const handleNewSession = useCallback(() => {
    send({ type: "NEW_SESSION" });
  }, [send]);

  const handleStopProcess = useCallback(() => {
    send({ type: "INTERRUPT" });
  }, [send]);

  // Realtime transcription with voice keyword spotting
  const transcription = useRealtimeTranscription({
    onKeywordSend: (text) => {
      transcription.cancel();
      if (text.trim()) {
        sendSound.play();
        stopTickRef.current = tick.repeatPlay(1000, 30000);
        doSend(`<speech local-time="${localTime()}">${text}</speech>`);
      }
    },
    onKeywordCancel: () => {
      transcription.cancel();
    },
    onKeywordMicOff: () => {
      turnTakingRef.current = false;
    },
    onKeywordErase: () => {
      // Transcript is already cleared by the hook; nothing else needed
    },
  });
  useEffect(() => {
    transcriptionRef.current = transcription;
  });
  const isTranscribing =
    transcription.state === "connecting" ||
    transcription.state === "recording" ||
    transcription.state === "finalizing";

  const handleCancelTranscription = useCallback(() => {
    turnTakingRef.current = false;
    transcription.cancel();
  }, [transcription]);

  const handleStopSpeech = useCallback(() => {
    speechPlayback.stop();
  }, [speechPlayback]);

  // Keep textarea focused whenever it's available for input
  useEffect(() => {
    if (!isStreaming && !isTranscribing) {
      textareaRef.current?.focus();
    }
  }, [isStreaming, isTranscribing]);

  // Escape key cancels transcription
  useEffect(() => {
    if (!isTranscribing) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        transcription.cancel();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isTranscribing, transcription]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-warm-500">
        Loading chat...
      </div>
    );
  }

  return (
    <>
    <div className="h-full flex flex-col bg-gradient-to-b from-warm-50 to-warm-200">
      {/* Header with debug controls */}
      <div className="flex items-center px-4 py-2 bg-gradient-to-r from-gold via-coral to-plum">
        <h2 className="flex-1 text-sm font-semibold text-white tracking-wide">Chat</h2>
        <NewSessionButton onClick={handleNewSession} />
        <ChatDebugMenu
          onStopProcess={handleStopProcess}
          sessionId={sessionId}
          running={processRunning}
          busy={isStreaming}
          debugView={debugView}
          onToggleDebugView={() => setDebugView((v) => !v)}
          showDebugLog={showDebugLog}
          onToggleDebugLog={() => setShowDebugLog((v) => !v)}
        />
      </div>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-4 pl-2 sm:pl-4 space-y-1">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex items-center justify-center h-full text-warm-500 text-sm">
            Start a conversation with your box assistant.
          </div>
        ) : null}
        {groupMessages(messages).map((group) =>
          group.type === "user" ? (
            <UserMessage key={group.entries[0].uuid} entries={group.entries} debugView={debugView} />
          ) : (
            <AssistantMessage key={group.entries[0].uuid} entries={group.entries} debugView={debugView} />
          )
        )}
        {snapshot.matches("streaming") ? (
          <div>
            <StreamingMessage text={streamText} />
            {streamTools.length > 0 ? (
              <div className="pl-3 sm:pl-6 pr-4 sm:pr-24 pb-2">
                <ToolList blocks={streamTools} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>

      {/* Error display */}
      {error || transcription.error ? (
        <div className="px-4 py-2 bg-rose-50 border-t border-rose-light text-rose-dark text-sm">
          {error || transcription.error}
          <button
            onClick={() => send({ type: "DISMISS_ERROR" })}
            className="ml-2 text-rose hover:text-rose-dark"
          >
            dismiss
          </button>
        </div>
      ) : null}

      {/* Input area */}
      <div className="border-t border-warm-300 px-2 sm:px-4 py-3 sm:py-4 bg-gradient-to-r from-warm-100 via-warm-100 to-warm-200">
        <div className="max-w-3xl mx-auto flex gap-1.5 sm:gap-2 items-center">
          {isTranscribing ? (
            <div className="flex-shrink-0 self-center">
              <RecordingIndicator />
            </div>
          ) : null}
          <TextareaAutosize
            ref={textareaRef}
            value={isTranscribing ? transcription.transcript : input}
            onChange={(e) => {
              if (!isTranscribing) {
                setInput(e.target.value);
              }
            }}
            onKeyDown={handleKeyDown}
            disabled={isStreaming || isTranscribing}
            readOnly={isTranscribing}
            placeholder={
              isStreaming
                ? "Working..."
                : isTranscribing
                  ? "Listening..."
                  : "Type a message..."
            }
            className="flex-1 resize-none rounded-lg border border-warm-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent disabled:bg-warm-200 disabled:text-warm-600"
            minRows={1}
            maxRows={8}
          />
          {speechPlayback.isPlaying ? (
            <button
              onClick={handleStopSpeech}
              className="p-2 text-rose hover:text-rose-dark rounded-lg hover:bg-rose-50"
              title="Stop speaking (Esc)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            </button>
          ) : null}
          {isStreaming ? (
            <button
              onClick={handleInterrupt}
              className="flex-shrink-0 px-4 py-2 bg-rose text-white rounded-lg hover:bg-rose-dark text-sm font-medium"
            >
              Stop
            </button>
          ) : isTranscribing ? (
            <>
              <button
                onClick={handleCancelTranscription}
                className="p-2 text-rose hover:text-rose-dark rounded-lg hover:bg-rose-50"
                title="Cancel (Esc)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <button
                onClick={() => {
                  const text = transcription.transcript;
                  if (text) {
                    setInput((existing) => (existing ? existing + " " + text : text));
                  }
                  transcription.stop();
                }}
                className="p-2 text-coral hover:text-coral-dark rounded-lg hover:bg-coral-50"
                title="Edit before sending"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <button
                onClick={async () => {
                  const finalText = await transcription.stop();
                  const text = finalText.trim();
                  if (text) {
                    doSend(`<speech local-time="${localTime()}">${text}</speech>`);
                  }
                }}
                className="flex-shrink-0 px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold-dark text-sm font-medium"
              >
                Send
              </button>
            </>
          ) : (
            <>
              <button
                onClick={async () => { turnTakingRef.current = true; unlockAudioContext(); await recordingStart.play().started; transcription.start(); }}
                disabled={isStreaming}
                className="p-2 text-plum hover:text-plum-dark rounded-lg hover:bg-plum-50 disabled:text-warm-400 disabled:hover:bg-transparent"
                title="Voice input"
              >
                <MicrophoneIcon className="w-5 h-5" />
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="flex-shrink-0 px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold-dark disabled:bg-iris-muted disabled:text-white/70 disabled:cursor-not-allowed text-sm font-medium"
              >
                Send
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    {showDebugLog ? <DebugLogPanel onClose={() => setShowDebugLog(false)} /> : null}
    </>
  );
}
