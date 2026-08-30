/**
 * Dev-only stream stub, split out of chat-actors.ts to keep that file under
 * the line budget. When a user message begins with `/fakestream`, the
 * machine plays a timed script of STREAM_TEXT events instead of hitting the
 * backend. Used to reproduce streaming-UI bugs (scroll, layout) deterministically.
 *
 * Syntax: `/fakestream [chunks] [intervalMs] [chunkLen]`
 *   chunks     — total STREAM_TEXT events to emit (default 200)
 *   intervalMs — delay between events (default 40)
 *   chunkLen   — approx chars per chunk (default 25)
 *
 * Emits a STREAM_TOOL event partway through so the live tool-list layout
 * (e.g. ordering relative to the throbber) is exercised too.
 */

import type { ChatEvent } from "./chat-types";
import { scrollTraceToggle } from "../lib/scroll-diagnostics";

/**
 * `/scrolldebug` — toggle the scroll-controller trace (lib/scroll-diagnostics.ts)
 * and confirm the new state as a synthetic streamed reply. Frontend-only, like
 * /fakestream; exists so the trace can be flipped on a phone with no devtools.
 */
export function runScrollDebugToggle(
  { sendBack, terminal }: {
    sendBack: (event: ChatEvent) => void;
    terminal: (event: ChatEvent) => void;
  },
): () => void {
  const on = scrollTraceToggle();
  sendBack({
    type: "STREAM_TEXT",
    text: on
      ? "Scroll trace **on** — reproduce the scroll problem now, then send `/scrolldebug` again to stop and flush it to the client debug log."
      : "Scroll trace **off** — flushed to the client debug log.",
  });
  terminal({ type: "STREAM_RESULT" });
  return () => {
    /* nothing to cancel — the toggle is synchronous */
  };
}

export function runFakeStream(
  message: string,
  { sendBack, terminal }: {
    sendBack: (event: ChatEvent) => void;
    terminal: (event: ChatEvent) => void;
  },
): () => void {
  const parts = message.trim().split(/\s+/);
  const chunks = Number.parseInt(parts[1] ?? "", 10) || 200;
  const intervalMs = Number.parseInt(parts[2] ?? "", 10) || 40;
  const chunkLen = Number.parseInt(parts[3] ?? "", 10) || 25;
  const toolAt = Math.floor(chunks / 3);

  const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. ";
  let body = "# Fakestream\n\n";
  for (let i = 0; i < 12; i++) body += para + "\n\n";

  let pos = 0;
  let emitted = 0;
  const handle = window.setInterval(() => {
    if (emitted >= chunks) {
      window.clearInterval(handle);
      terminal({ type: "STREAM_RESULT" });
      return;
    }
    if (emitted === toolAt) {
      sendBack({
        type: "STREAM_TOOL",
        tool: {
          type: "tool_use",
          toolName: "Read",
          toolId: "fakestream-tool-1",
          input: { file_path: "/tmp/fakestream.txt" },
          inputSummary: "Read",
        },
      });
    }
    const next = body.slice(pos, pos + chunkLen);
    pos = (pos + chunkLen) % body.length;
    sendBack({ type: "STREAM_TEXT", text: next });
    emitted++;
  }, intervalMs);

  return () => window.clearInterval(handle);
}
