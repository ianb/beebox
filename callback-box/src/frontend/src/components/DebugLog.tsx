/**
 * On-screen debug log overlay + server-side log forwarding.
 *
 * Console errors and warnings are always captured and forwarded to the server
 * (for persistent logging). The on-screen panel can be toggled independently.
 * All console levels (log, info) are captured locally but only forwarded to
 * the server when the debug panel is active.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { trpcClient } from "../lib/trpc";
import { describeArg } from "../lib/debug-log-format";
import { CloseButton } from "./ui/CloseButton";

interface LogEntry {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

const MAX_ENTRIES = 100;
const logEntries: LogEntry[] = [];
const listeners: Set<() => void> = new Set();
let patched = false;
let sendBuffer: Array<{ level: LogEntry["level"]; message: string }> = [];
let sendTimer: ReturnType<typeof setTimeout> | null = null;
let verboseForwarding = false;
let errorCount = 0;
const errorCountListeners: Set<() => void> = new Set();

/**
 * Mirrors `debugLog.submit`'s server caps (trpc/routers/debugLog.ts). The server
 * rejects an oversized message or an over-long batch outright — and this buffer
 * is already cleared by then, so an unenforced cap here is silent loss.
 */
const MAX_SERVER_MESSAGE_LENGTH = 4000;
const MAX_SERVER_BATCH = 100;

/** Zod's `.max()` counts UTF-16 units, which is exactly what `String.length` is. */
function truncateForServer(message: string): string {
  if (message.length <= MAX_SERVER_MESSAGE_LENGTH) return message;
  // codePointAt returns a >0xffff value only when this index is the lead half of
  // a pair, i.e. exactly when the cut would split one.
  const splitsSurrogatePair = (message.codePointAt(MAX_SERVER_MESSAGE_LENGTH - 1) ?? 0) > 0xffff;
  return message.slice(0, splitsSurrogatePair ? MAX_SERVER_MESSAGE_LENGTH - 1 : MAX_SERVER_MESSAGE_LENGTH);
}

function flushToServer() {
  if (sendBuffer.length === 0) return;
  const batch = sendBuffer;
  sendBuffer = [];
  sendTimer = null;
  for (let i = 0; i < batch.length; i += MAX_SERVER_BATCH) {
    trpcClient.debugLog.submit.mutate({ entries: batch.slice(i, i + MAX_SERVER_BATCH) }).catch(() => {});
  }
}

function isNetworkNoise(message: string): boolean {
  return /\bapi\/events\b/.test(message) ||
    /\bERR_QUIC_PROTOCOL_ERROR\b/.test(message) ||
    /\bapi\/debug-log\b/.test(message) ||
    /\b\[sse] Diagnostic fetch\b/.test(message);
}

function queueForServer(level: LogEntry["level"], message: string) {
  // Always forward errors and warnings; forward log/info only in verbose mode
  if (level !== "error" && level !== "warn" && !verboseForwarding) return;
  // Don't forward SSE/network errors — they're expected during deploys
  if (isNetworkNoise(message)) return;
  sendBuffer.push({ level, message: truncateForServer(message) });
  if (!sendTimer) {
    sendTimer = setTimeout(flushToServer, 500);
  }
}

function patchConsole() {
  if (patched) return;
  patched = true;

  const methods = ["log", "warn", "error", "info"] as const;
  for (const level of methods) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      original.apply(console, args);
      const message = args.map(describeArg).join(" ");
      logEntries.push({ level, message, timestamp: Date.now() });
      if (logEntries.length > MAX_ENTRIES) logEntries.shift();
      queueForServer(level, message);
      if (level === "error") {
        errorCount++;
        for (const fn of errorCountListeners) fn();
      }
      for (const fn of listeners) fn();
    };
  }

  // Capture unhandled errors and promise rejections
  window.addEventListener("error", (event) => {
    const message = `Uncaught: ${event.message} (${event.filename}:${event.lineno})`;
    logEntries.push({ level: "error", message, timestamp: Date.now() });
    if (logEntries.length > MAX_ENTRIES) logEntries.shift();
    queueForServer("error", message);
    errorCount++;
    for (const fn of errorCountListeners) fn();
    for (const fn of listeners) fn();
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
    const message = `Unhandled rejection: ${reason}`;
    logEntries.push({ level: "error", message, timestamp: Date.now() });
    if (logEntries.length > MAX_ENTRIES) logEntries.shift();
    queueForServer("error", message);
    errorCount++;
    for (const fn of errorCountListeners) fn();
    for (const fn of listeners) fn();
  });
}

/** Call at app init to start capturing logs. Always captures errors/warns to server. */
export function enableDebugLogCapture() {
  // No-op outside a browser: patchConsole adds window error listeners and its
  // patched console forwards to the debug endpoint — both browser-only, and
  // app-shell.tsx calls this at module top-level, so a non-browser evaluation
  // would hit it on import.
  if (typeof window === "undefined") return;
  patchConsole();
}

/** Enable forwarding of all log levels (not just errors/warns) to the server. */
export function setVerboseForwarding(enabled: boolean) {
  verboseForwarding = enabled;
}

/** Hook that returns the current error count (since page load). */
export function useErrorCount(): number {
  const [count, setCount] = useState(errorCount);
  useEffect(() => {
    const fn = () => setCount(errorCount);
    errorCountListeners.add(fn);
    fn();
    return () => { errorCountListeners.delete(fn); };
  }, []);
  return count;
}

/** Reset the error counter (e.g., when the user opens the debug panel). */
export function clearErrorCount() {
  errorCount = 0;
  for (const fn of errorCountListeners) fn();
}

function useLogEntries(): LogEntry[] {
  const [logSnapshot, setLogSnapshot] = useState<LogEntry[]>([]);

  useEffect(() => {
    patchConsole();
    const fn = () => setLogSnapshot([...logEntries]);
    listeners.add(fn);
    fn();
    return () => { listeners.delete(fn); };
  }, []);

  return logSnapshot;
}

const levelColors: Record<string, string> = {
  error: "text-danger-dark",
  warn: "text-warning",
  info: "text-blue-500",
  log: "text-warm-700",
};

export function DebugLogPanel({ onClose }: { onClose: () => void }) {
  const entries = useLogEntries();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setVerboseForwarding(true);
    return () => setVerboseForwarding(false);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [entries.length]);

  const filtered = filter
    ? entries.filter((e) => e.message.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  const clearLog = useCallback(() => {
    logEntries.length = 0;
    for (const fn of listeners) fn();
  }, []);

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] bg-white/95 border-t-2 border-warm-400 shadow-lg flex flex-col" style={{ maxHeight: "50vh" }}>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-warm-100 border-b border-warm-300 text-xs">
        <span className="font-bold text-warm-700">Debug Log</span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter..."
          className="flex-1 px-2 py-0.5 rounded border border-warm-300 text-xs"
        />
        <button onClick={clearLog} className="text-warm-500 hover:text-warm-700">Clear</button>
        <CloseButton onClick={onClose} size="sm" />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-1 font-mono text-[11px] leading-tight">
        {filtered.length === 0 ? (
          <div className="text-warm-400 py-2">No log entries{filter ? " matching filter" : ""}</div>
        ) : (
          filtered.map((entry, i) => {
            const time = new Date(entry.timestamp);
            const ts = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}:${String(time.getSeconds()).padStart(2, "0")}`;
            return (
              <div key={i} className={`py-0.5 ${levelColors[entry.level] || "text-warm-700"}`}>
                <span className="text-warm-400">{ts}</span>{" "}
                <span className="font-medium">{entry.level === "log" ? "" : `[${entry.level}] `}</span>
                {entry.message}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
