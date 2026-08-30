/**
 * Flag-gated trace for the chat scroll controller (`chat-scroll.ts`),
 * for diagnosing feel bugs on devices where no devtools exist (iOS). Toggled by
 * typing `/scrolldebug` in the composer; while on, the controller records every
 * scroll event, reconcile cycle, and programmatic write into a bounded buffer
 * that flushes through console.warn — which the ordinary closed-debug-panel
 * client forwards to the box's client-debug.log (same pipeline as
 * chat-send-diagnostics.ts). Numbers and enum-ish strings only — never message
 * text or paths.
 *
 * Reading a trace: each flush line is `[scroll-trace] [...]` holding an array
 * of events `{ t: ms-since-page-load, k: kind, ...detail }`. Kinds come from
 * the controller: "scroll" (one per scroll event, with its geometry),
 * "reconcile" (one per ResizeObserver cycle, with the decideReconcile action
 * and measured anchor delta), and "write" (every programmatic scrollTop write —
 * rare under the write-on-user-action model, and each one should be explainable
 * by a user action or a resize compensation).
 */

const MAX_EVENTS = 600;
const FLUSH_INTERVAL_MS = 2000;
const MAX_PAYLOAD_CHARS = 3600;

type TraceValue = string | number | boolean;

/** Receives every trace event as it is recorded, regardless of the flag. */
export type TraceSubscriber = (event: Record<string, TraceValue>) => void;

/**
 * The flag survives a reload — the load itself is what the trace most often
 * needs to see — but not a new tab: sessionStorage, read once at module load.
 */
const STORAGE_KEY = "bbx-scroll-trace";
function readPersisted(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch (e: unknown) {
    void e; // storage unavailable (private mode, blocked): the flag is off
    return false;
  }
}
function writePersisted(on: boolean): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch (e: unknown) {
    void e; // storage unavailable: the flag lives for this load only
  }
}

let enabled = false;
let subscriber: TraceSubscriber | null = null;
let events: Record<string, TraceValue>[] = [];
let dropped = 0;
let timer: number | null = null;

function flush(): void {
  if (dropped > 0) {
    events.push({ t: Math.round(performance.now()), k: "dropped", n: dropped });
    dropped = 0;
  }
  while (events.length > 0) {
    // Emit in payload-bounded batches so a long repro doesn't produce one
    // enormous log line the forwarder might truncate.
    let count = events.length;
    while (count > 1 && JSON.stringify(events.slice(0, count)).length > MAX_PAYLOAD_CHARS) {
      count = Math.ceil(count / 2);
    }
    const batch = events.slice(0, count);
    events = events.slice(count);
    console.warn(`[scroll-trace] ${JSON.stringify(batch)}`);
  }
}

/** Toggle the trace; returns the new state. Disabling flushes the remainder. */
export function scrollTraceToggle(): boolean {
  return setScrollTrace(!enabled);
}

function setScrollTrace(on: boolean): boolean {
  enabled = on;
  writePersisted(on);
  if (enabled) {
    events = [];
    dropped = 0;
    console.warn(`[scroll-trace] enabled at ${Math.round(performance.now())}ms`);
    timer = window.setInterval(flush, FLUSH_INTERVAL_MS);
  } else {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    flush();
    console.warn("[scroll-trace] disabled");
  }
  return enabled;
}

/**
 * Watch every trace event live, independent of the `/scrolldebug` flag — the
 * dev scroll harness (`pages/dev/components/ChatScrollHarness.tsx`) reads the
 * controller's decisions this way instead of scraping console.warn. Pass null
 * to detach. One subscriber at a time; this is a dev-tool seam, not a bus.
 */
export function scrollTraceSubscribe(fn: TraceSubscriber | null): void {
  subscriber = fn;
}

/** Record one trace event; near-free no-op while the trace is off. */
export function recordScrollTrace(k: string, detail: Record<string, TraceValue>): void {
  if (subscriber) subscriber({ t: Math.round(performance.now()), k, ...detail });
  if (!enabled) return;
  if (events.length >= MAX_EVENTS) {
    // Between flushes the buffer is bounded; count what fell off instead of
    // silently losing it, so a starved flush timer is visible in the trace.
    dropped++;
    return;
  }
  events.push({ t: Math.round(performance.now()), k, ...detail });
}

if (readPersisted()) setScrollTrace(true);
