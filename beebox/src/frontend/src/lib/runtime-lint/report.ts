/**
 * Runtime lint: the frontend's record of a broken runtime invariant (content
 * replaced while its view is open, a request storm, an open card that could
 * not refresh). Plan: `docs/implemented-plans/runtime-lint.md`.
 *
 * A record carries only check names, numbers, closed enums, and page-local
 * opaque ids (`c1`, `c2`, …) for content and request inputs. Card paths, text,
 * URLs and raw error strings never reach a record: the payload types take an
 * `OpaqueId`, which only {@link opaqueId} makes.
 *
 * Each record goes three places: the page buffer (`window.__bbxRuntimeLint`,
 * read by `bin/browse`), the box's client-debug.log (as `debugLog.submit`
 * entries with source `runtime-lint`; the server keeps them only on a dev box
 * or with `BBX_RUNTIME_LINT=1`), and, in the development build, the console.
 * A budget keeps one noisy check from filling the 100 KB log.
 */

declare const opaqueBrand: unique symbol;
/** A page-local stand-in for a content key or request input. */
export type OpaqueId = string & { readonly [opaqueBrand]: true };
declare const procedureBrand: unique symbol;
/** A tRPC procedure path (`card.get`), or `raw-file`, or `other`. */
export type ProcedureName = string & { readonly [procedureBrand]: true };

export type Surface = "card-body" | "card-embed" | "file";
export type RefreshFailureKind = "not-found" | "unreachable" | "other";

export type RuntimeLintPayload =
  | { check: "content-replaced"; surface: Surface; content: OpaqueId; gapMs: number }
  | { check: "fetch-storm"; procedure: ProcedureName; input: OpaqueId; starts: number; windowMs: number }
  | { check: "refresh-failed"; phase: "failed"; surface: Surface; content: OpaqueId; kind: RefreshFailureKind }
  | { check: "refresh-failed"; phase: "recovered"; surface: Surface; content: OpaqueId; durationMs: number };

interface SuppressedPayload { check: "suppressed"; n: number }

/** What the page buffer holds and `bin/browse` prints. */
export type RuntimeLintRecord = (RuntimeLintPayload | SuppressedPayload) & { seq: number; suppressed?: number };

export interface RuntimeLintBuffer {
  /** Returns the unread records and clears them: one consumer, `bin/browse`. */
  take(): { records: RuntimeLintRecord[]; dropped: number };
}

const PER_KEY_MS = 60_000;
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_LIMIT = 20;
const MAX_KEYS = 200;
const MAX_IDS = 5000;
const MAX_BUFFER = 200;
const MAX_PENDING = 50;
const MAX_LINE = 300;
const PROCEDURE = /^[A-Za-z][\w.-]{0,60}$/;
const TAG = "[runtime-lint]";

interface BufferState { records: RuntimeLintRecord[]; dropped: number; seq: number }

declare global {
  interface Window {
    __bbxRuntimeLint?: RuntimeLintBuffer & { state: BufferState };
  }
}

const ids = new Map<string, OpaqueId>();
const lastByKey = new Map<string, number>();
let globalTimes: number[] = [];
let suppressed = 0;
let suppressedTimer: ReturnType<typeof setTimeout> | null = null;
let pending: string[] = [];
let sink: ((lines: string[]) => void) | null = null;
let clock: () => number = () => performance.now();
let localState: BufferState = { records: [], dropped: 0, seq: 0 };

/** The page-local id for `raw`. The same raw value gets the same id for the page's life. */
export function opaqueId(raw: string): OpaqueId {
  const known = ids.get(raw);
  if (known !== undefined) return known;
  // eslint-disable-next-line no-restricted-syntax -- minting a branded id: the one place an OpaqueId is made
  const id = (ids.size < MAX_IDS ? `c${ids.size + 1}` : "c-overflow") as OpaqueId;
  if (ids.size < MAX_IDS) ids.set(raw, id);
  return id;
}

/** A tRPC path as logged: a code name, or `other` for anything that does not look like one. */
export function procedureName(path: string): ProcedureName {
  // eslint-disable-next-line no-restricted-syntax -- minting a branded name after the pattern check: the one place a ProcedureName is made
  return (PROCEDURE.test(path) ? path : "other") as ProcedureName;
}

/** The page buffer, shared across module re-evaluation (HMR) through the window. */
function bufferState(): BufferState {
  if (typeof window === "undefined") return localState;
  if (window.__bbxRuntimeLint === undefined) {
    const state: BufferState = { records: [], dropped: 0, seq: 0 };
    window.__bbxRuntimeLint = {
      state,
      take() {
        const out = { records: state.records, dropped: state.dropped };
        state.records = [];
        state.dropped = 0;
        return out;
      },
    };
  }
  return window.__bbxRuntimeLint.state;
}

function budgetKey(payload: RuntimeLintPayload): string {
  switch (payload.check) {
    case "content-replaced": return `${payload.check}|${payload.surface}|${payload.content}`;
    case "fetch-storm": return `${payload.check}|${payload.procedure}|${payload.input}`;
    case "refresh-failed": return `${payload.check}|${payload.surface}|${payload.content}|${payload.phase}`;
  }
}

/** The log line: tag, check, then each field as `k=v`, in order. */
export function formatRecord(record: RuntimeLintRecord): string {
  const fields = Object.entries(record)
    .filter(([key]) => key !== "check" && key !== "seq")
    .map(([key, value]) => `${key}=${String(value)}`);
  return [TAG, record.check, ...fields].join(" ").slice(0, MAX_LINE);
}

function emit(payload: RuntimeLintPayload | SuppressedPayload, carried: number): void {
  const state = bufferState();
  state.seq += 1;
  const record: RuntimeLintRecord = carried > 0 ? { ...payload, seq: state.seq, suppressed: carried } : { ...payload, seq: state.seq };
  state.records.push(record);
  if (state.records.length > MAX_BUFFER) {
    state.records.shift();
    state.dropped += 1;
  }
  const line = formatRecord(record);
  if (import.meta.env.DEV) console.warn(line);
  // The server tags the batch with its source, so the line goes without the tag.
  pending.push(line.slice(TAG.length + 1));
  if (pending.length > MAX_PENDING) pending.shift();
  flush();
}

function flush(): void {
  if (sink === null || pending.length === 0) return;
  const lines = pending;
  pending = [];
  sink(lines);
}

function scheduleSuppressedReport(): void {
  if (suppressedTimer !== null) return;
  suppressedTimer = setTimeout(() => {
    suppressedTimer = null;
    if (suppressed === 0) return;
    const n = suppressed;
    suppressed = 0;
    emit({ check: "suppressed", n }, 0);
  }, PER_KEY_MS);
}

/**
 * Report a broken invariant. At most one record per check and subject a
 * minute, and 20 a minute in all; `refresh-failed` is outside the overall cap
 * (its failure and recovery have their own keys). What the budget drops is
 * counted and carried on the next record, or reported alone after a minute.
 */
export function reportRuntimeLint(payload: RuntimeLintPayload): void {
  const now = clock();
  const key = budgetKey(payload);
  const last = lastByKey.get(key);
  globalTimes = globalTimes.filter((t) => now - t < GLOBAL_WINDOW_MS);
  const overCap = payload.check !== "refresh-failed" && globalTimes.length >= GLOBAL_LIMIT;
  if ((last !== undefined && now - last < PER_KEY_MS) || overCap) {
    suppressed += 1;
    scheduleSuppressedReport();
    return;
  }
  lastByKey.delete(key);
  lastByKey.set(key, now);
  if (lastByKey.size > MAX_KEYS) {
    const oldest = lastByKey.keys().next().value;
    if (oldest !== undefined) lastByKey.delete(oldest);
  }
  if (payload.check !== "refresh-failed") globalTimes.push(now);
  const carried = suppressed;
  suppressed = 0;
  emit(payload, carried);
}

/** Where log lines go (without the tag): `DebugLog` installs the `debugLog.submit` sender at startup. */
export function setRuntimeLintSink(send: (lines: string[]) => void): void {
  sink = send;
  flush();
}

/** Whether a console message is a runtime-lint line, which has its own route to the server. */
export function isRuntimeLintLine(message: string): boolean {
  return message.startsWith(TAG);
}

/** Tests only: a fresh reporter with a controlled clock. */
export function resetRuntimeLintForTest(now: () => number): void {
  ids.clear();
  lastByKey.clear();
  globalTimes = [];
  suppressed = 0;
  if (suppressedTimer !== null) clearTimeout(suppressedTimer);
  suppressedTimer = null;
  pending = [];
  sink = null;
  clock = now;
  localState = { records: [], dropped: 0, seq: 0 };
  if (typeof window !== "undefined") window.__bbxRuntimeLint = undefined;
}
