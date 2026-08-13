/**
 * Flag-gated trace for the chat scroll controller (`InteractiveChat-scroll.ts`),
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
 * the controller: "scroll" (one per scroll event, with the decideScroll action),
 * "reconcile" (one per ResizeObserver cycle, with the decideReconcile action
 * and measured anchor delta), "write" (every programmatic scrollTop write),
 * "intent" (wheel/touchmove/scroll-key input marks — gaps in these during
 * scroll events are momentum).
 */

const MAX_EVENTS = 600;
const FLUSH_INTERVAL_MS = 2000;
const MAX_PAYLOAD_CHARS = 3600;

type TraceValue = string | number | boolean;

let enabled = false;
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
  enabled = !enabled;
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

/** Record one trace event; near-free no-op while the trace is off. */
export function recordScrollTrace(k: string, detail: Record<string, TraceValue>): void {
  if (!enabled) return;
  if (events.length >= MAX_EVENTS) {
    // Between flushes the buffer is bounded; count what fell off instead of
    // silently losing it, so a starved flush timer is visible in the trace.
    dropped++;
    return;
  }
  events.push({ t: Math.round(performance.now()), k, ...detail });
}
