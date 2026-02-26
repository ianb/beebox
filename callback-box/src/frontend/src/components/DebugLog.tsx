/**
 * On-screen debug log overlay + server-side log forwarding.
 * Captures console.log/warn/error messages and displays them
 * in a small scrollable panel. Also forwards them to /api/debug-log
 * so they can be read server-side (e.g., by an agent).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getApiBase } from "../api";

interface LogEntry {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

const MAX_ENTRIES = 100;
const logEntries: LogEntry[] = [];
const listeners: Set<() => void> = new Set();
let patched = false;
let sendBuffer: Array<{ level: string; message: string }> = [];
let sendTimer: ReturnType<typeof setTimeout> | null = null;

function flushToServer() {
  if (sendBuffer.length === 0) return;
  const batch = sendBuffer;
  sendBuffer = [];
  sendTimer = null;
  fetch(`${getApiBase()}/debug-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries: batch }),
  }).catch(() => {});
}

function queueForServer(level: string, message: string) {
  sendBuffer.push({ level, message });
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
      const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      logEntries.push({ level, message, timestamp: Date.now() });
      if (logEntries.length > MAX_ENTRIES) logEntries.shift();
      queueForServer(level, message);
      for (const fn of listeners) fn();
    };
  }
}

/** Call early (e.g., at app init) to start capturing logs even before the panel opens. */
export function enableDebugLogCapture() {
  patchConsole();
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
  error: "text-rose-600",
  warn: "text-amber-600",
  info: "text-blue-500",
  log: "text-warm-700",
};

export function DebugLogPanel({ onClose }: { onClose: () => void }) {
  const entries = useLogEntries();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");

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
        <button onClick={onClose} className="text-warm-500 hover:text-warm-700 font-bold">✕</button>
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
