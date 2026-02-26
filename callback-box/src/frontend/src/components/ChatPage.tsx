/**
 * ChatPage - Full-page chat interface for the box's conversational assistant.
 *
 * Streams messages from the backend ChatSession via SSE.
 * User input is wrapped in <typed> tags before sending.
 * User messages are right-aligned dark bubbles; assistant uses markdown.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TextareaAutosize from "react-textarea-autosize";
import {
  getChatHistory,
  getChatStatus,
  sendChatMessage,
  interruptChat,
  resetChatSession,
  type SessionEntry,
  type SessionContentBlock,
} from "../api";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import { useSpeechPlayback, type SpeechPlayback } from "../hooks/useSpeechPlayback";
import { hasAssistantSpeech, parseAllSpeechTags } from "../lib/speech-parsing";
import { Grid } from "ldrs/react";
import "ldrs/react/Grid.css";
import { sendSound, tick, recordingStart } from "../lib/earcons";
import { MicrophoneIcon, RecordingIndicator } from "./VoiceRecorder";

/**
 * Format the current local time as HH:MM for the typed tag.
 */
function localTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/**
 * Strip speech/typed XML wrappers from user message for display.
 */
function stripInputTags(text: string): string {
  return text
    .replace(/<typed[^>]*>/gi, "")
    .replace(/<\/typed>/gi, "")
    .replace(/<speech[^>]*>/gi, "")
    .replace(/<\/speech>/gi, "")
    .trim();
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
                  {stripInputTags(block.text ?? "")}
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

/**
 * Debug dropdown menu for chat controls.
 */
function ChatDebugMenu({
  onNewSession,
  onStopProcess,
  sessionId,
  running,
  busy,
  debugView,
  onToggleDebugView,
}: {
  onNewSession: () => void;
  onStopProcess: () => void;
  sessionId: string | null;
  running: boolean;
  busy: boolean;
  debugView: boolean;
  onToggleDebugView: () => void;
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
            onClick={() => { onNewSession(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-warm-100 text-warm-700"
          >
            New Session
          </button>
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
  const [messages, setMessages] = useState<SessionEntry[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamTools, setStreamTools] = useState<SessionContentBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [processRunning, setProcessRunning] = useState(false);
  const [debugView, setDebugView] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const turnTakingRef = useRef(false);
  const streamingRef = useRef(false);
  const transcriptionRef = useRef<{ start: () => void } | null>(null);
  const speechPlaybackRef = useRef<SpeechPlayback | null>(null);
  const stopTickRef = useRef<(() => void) | null>(null);

  const speechPlayback = useSpeechPlayback({
    onComplete: () => {
      if (turnTakingRef.current && !streamingRef.current) {
        recordingStart.play();
        transcriptionRef.current?.start();
      }
    },
  });

  const refreshStatus = useCallback(() => {
    getChatStatus()
      .then((s) => {
        setSessionId(s.sessionId);
        setProcessRunning(s.running);
      })
      .catch(() => {});
  }, []);

  // Load history and status on mount
  useEffect(() => {
    let cancelled = false;
    getChatHistory()
      .then((result) => {
        if (!cancelled) {
          setMessages(result.entries);
          setSessionId(result.sessionId);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    refreshStatus();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const doSend = useCallback(async (wrapped: string) => {
    streamingRef.current = true;
    setStreaming(true);
    setStreamText("");
    setStreamTools([]);
    setError(null);

    const userEntry: SessionEntry = {
      uuid: `user-${Date.now()}`,
      type: "user",
      timestamp: new Date().toISOString(),
      content: [{ type: "text", text: wrapped }],
    };
    setMessages((prev) => [...prev, userEntry]);

    try {
      let accumulatedText = "";

      await sendChatMessage({
        message: wrapped,
        onMessage: (msg) => {
          const type = msg.type as string;

          if (type === "busy") {
            setError("Agent is busy with another request");
            setStreaming(false);
            return;
          }

          if (type === "error") {
            setError((msg.error as string) || "Unknown error");
            setStreaming(false);
            return;
          }

          if (type === "assistant") {
            const message = msg.message as {
              content?: Array<{ type: string; text?: string; name?: string; id?: string }>;
            } | undefined;
            if (message?.content) {
              for (const block of message.content) {
                if (block.type === "text" && block.text) {
                  accumulatedText += block.text;
                  setStreamText(accumulatedText);
                } else if (block.type === "tool_use") {
                  setStreamTools((prev) => [
                    ...prev,
                    {
                      type: "tool_use",
                      toolName: block.name,
                      toolId: block.id,
                      inputSummary: block.name ?? "",
                    },
                  ]);
                }
              }
            }
          }

          if (type === "result") {
            // Stop waiting tick
            if (stopTickRef.current) {
              stopTickRef.current();
              stopTickRef.current = null;
            }
            // Auto-play speech before refreshing history
            if (hasAssistantSpeech(accumulatedText)) {
              const segments = parseAllSpeechTags(accumulatedText);
              speechPlaybackRef.current?.playSegments({
                messageId: `stream-${Date.now()}`,
                segments,
              });
            }
            const hasSpeech = hasAssistantSpeech(accumulatedText);
            getChatHistory()
              .then((result) => {
                setMessages(result.entries);
              })
              .catch(() => {})
              .finally(() => {
                streamingRef.current = false;
                setStreaming(false);
                setStreamText("");
                setStreamTools([]);
                // For non-speech responses, auto-restart mic now
                // (speech responses restart mic via onComplete callback)
                if (!hasSpeech && turnTakingRef.current) {
                  recordingStart.play();
                  transcriptionRef.current?.start();
                }
              });
          }
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
      setStreaming(false);
      setStreamText("");
      setStreamTools([]);
    }
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    doSend(`<typed local-time="${localTime()}">${text}</typed>`);
  }, [input, streaming, doSend]);

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
    interruptChat().catch(() => {});
  }, []);

  const handleNewSession = useCallback(() => {
    resetChatSession()
      .then(() => {
        setMessages([]);
        setSessionId(null);
        setProcessRunning(false);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to reset session");
      });
  }, []);

  const handleStopProcess = useCallback(() => {
    interruptChat()
      .then(() => refreshStatus())
      .catch(() => {});
  }, [refreshStatus]);

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
    speechPlaybackRef.current = speechPlayback;
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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-warm-500">
        Loading chat...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-warm-50 to-warm-200">
      {/* Header with debug controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-gold via-coral to-plum">
        <h2 className="text-sm font-semibold text-white tracking-wide">Chat</h2>
        <ChatDebugMenu
          onNewSession={handleNewSession}
          onStopProcess={handleStopProcess}
          sessionId={sessionId}
          running={processRunning}
          busy={streaming}
          debugView={debugView}
          onToggleDebugView={() => setDebugView((v) => !v)}
        />
      </div>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-4 pl-2 sm:pl-4 space-y-1">
        {messages.length === 0 && !streaming ? (
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
        {streaming ? (
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
            onClick={() => setError(null)}
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
            disabled={streaming || isTranscribing}
            readOnly={isTranscribing}
            placeholder={
              streaming
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
          {streaming ? (
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
                onClick={() => { turnTakingRef.current = true; recordingStart.play(); transcription.start(); }}
                disabled={streaming}
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
  );
}
