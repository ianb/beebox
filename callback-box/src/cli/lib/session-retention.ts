/**
 * Bounded retention for the session-log scan.
 *
 * `parseSessionLog` streams a transcript forward line by line. It used to
 * retain a `SessionEntry` for *every* line and slice at the end — and a
 * retained entry holds the whole `tool_use.input` (a `Write` call carries the
 * entire file body) and the whole base64 image payload, so the live set was
 * the whole file. A big chat session took `cb serve` past its heap cap
 * (prod incident 2026-08-01).
 *
 * The scan still runs forward and still counts an exact `total`; what it
 * *retains* is now bounded by the request shape:
 *
 * - **tail**: a capped ring of the last N entries, evicting from the front.
 * - **page**: only the entries whose index falls in `[offset, offset+limit)`.
 *
 * Both are additionally clamped by {@link MAX_SESSION_ENTRIES} and
 * {@link MAX_RETAINED_BYTES}, so no parameter combination can ask for
 * unbounded retention.
 */

import { invariant } from "../../lib/invariant.js";
import { isRealUserMessage } from "./session-real-user.js";
import type { SessionEntry } from "./session-entry.js";

/**
 * Hard ceiling on how many entries a single parse may retain, whatever the
 * request asks for. 5 000 entries is far past any chat UI window; it exists so
 * a bad parameter (or a `minRealUserMessages` expansion over a transcript with
 * no real user messages in it) still cannot allocate the whole file.
 */
export const MAX_SESSION_ENTRIES = 5000;

/**
 * Serialized-payload co-limit for one scan's response window. 32 MiB is
 * generous for ordinary text and tool transcripts while preventing a window
 * full of near-line-limit payloads from exhausting the heap.
 */
export const MAX_RETAINED_BYTES = 32 * 1024 * 1024;

/**
 * How far back a `tool_result` may graft onto its `tool_use`.
 *
 * `graftToolResults` walks the *trailing run of assistant entries* and stops
 * at the first non-assistant, so the graft window holds exactly that run and
 * is emptied whenever a non-assistant entry lands — usually a handful of
 * entries, and zero right after any user turn. The run is unbounded in
 * principle (a long tool loop produces assistant entries with only dropped
 * plumbing turns between them), so it is capped here too. In real transcripts
 * a result follows its call within a couple of entries, so the cap never
 * truncates a graft that would have landed.
 */
const GRAFT_LOOKBACK = 256;

/**
 * How long a dead prefix may sit in front of the retained window before it is
 * compacted away. Bounds the over-retention the amortized head pointer buys:
 * live window + at most this many already-evicted references.
 */
const MAX_DEAD_PREFIX = 512;

/** How much of a session log a scan retains. Every caller must state one. */
export type SessionLogSlice =
  | {
      mode: "tail";
      /** Retain the last N entries. */
      tail: number;
      /**
       * Widen the tail so it covers at least this many real (typed/spoken)
       * user messages — still clamped by {@link MAX_SESSION_ENTRIES}.
       */
      minRealUserMessages?: number | undefined;
    }
  | { mode: "page"; offset: number; limit: number };

/** Result shape of a bounded scan. */
export interface SessionLogResult {
  entries: SessionEntry[];
  /** Exact count of displayable entries in the whole file, retained or not. */
  total: number;
  /** True when entries outside the returned window exist. */
  hasMore: boolean;
}

interface Retained {
  entry: SessionEntry;
  /** Precomputed so eviction doesn't re-scan the entry's blocks. */
  realUser: boolean;
  /** Serialized UTF-8 size, computed once when the entry is retained. */
  bytes: number;
}

/**
 * The mutable state of one bounded scan: an exact counter, a small
 * graft-adjacency window, and the retained set.
 *
 * Held as a class because the scan is a fold with three interacting pieces of
 * state that the caller drives one line at a time.
 */
export class SessionScan {
  private readonly slice: SessionLogSlice;
  private readonly graftWindow: SessionEntry[] = [];
  private readonly graftWindowBytes: number[] = [];
  private graftBytes = 0;
  /** Retained entries, front-trimmed lazily via `head` (see `evictFront`). */
  private retained: Array<Retained | undefined> = [];
  private head = 0;
  private realUsers = 0;
  private retainedBytes = 0;
  /** Page mode stops at the first entry that would cross the byte budget. */
  private pageClipped = false;
  private count = 0;

  constructor(slice: SessionLogSlice) {
    if (slice.mode === "tail") {
      invariant(
        Number.isInteger(slice.tail) && slice.tail > 0 && slice.tail <= MAX_SESSION_ENTRIES,
        `session scan: tail must be an integer in 1..${String(MAX_SESSION_ENTRIES)}, got ${String(slice.tail)}`,
      );
    } else {
      invariant(
        Number.isInteger(slice.offset) && slice.offset >= 0,
        `session scan: offset must be a non-negative integer, got ${String(slice.offset)}`,
      );
      invariant(
        Number.isInteger(slice.limit) && slice.limit > 0 && slice.limit <= MAX_SESSION_ENTRIES,
        `session scan: limit must be an integer in 1..${String(MAX_SESSION_ENTRIES)}, got ${String(slice.limit)}`,
      );
    }
    this.slice = slice;
  }

  /**
   * The entries a new entry may graft its tool results onto: the current
   * trailing assistant run, capped at {@link GRAFT_LOOKBACK}. Holds
   * references, so a graft reaches retained and non-retained entries alike.
   */
  recent(): SessionEntry[] {
    return this.graftWindow;
  }

  /** Fold one displayable entry into the scan. */
  record(entry: SessionEntry): void {
    const index = this.count;
    this.count += 1;
    let measuredBytes: number | undefined;
    const entryBytes = (): number => {
      measuredBytes ??= Buffer.byteLength(JSON.stringify(entry), "utf8");
      return measuredBytes;
    };

    // The graft window is the trailing assistant run and nothing else: a
    // non-assistant entry is where `graftToolResults` stops looking, so
    // everything before it is dead weight we would otherwise keep alive.
    if (entry.type === "assistant") {
      this.graftWindow.push(entry);
      const bytes = entryBytes();
      this.graftWindowBytes.push(bytes);
      this.graftBytes += bytes;
      while (this.graftWindow.length > GRAFT_LOOKBACK || this.graftBytes > MAX_RETAINED_BYTES) {
        this.graftWindow.shift();
        const droppedBytes = this.graftWindowBytes.shift();
        if (droppedBytes !== undefined) this.graftBytes -= droppedBytes;
      }
    } else if (this.graftWindow.length > 0) {
      this.graftWindow.length = 0;
      this.graftWindowBytes.length = 0;
      this.graftBytes = 0;
    }

    if (this.slice.mode === "page") {
      const { offset, limit } = this.slice;
      if (!this.pageClipped && index >= offset && index < offset + limit) {
        const bytes = entryBytes();
        if (this.retainedBytes + bytes > MAX_RETAINED_BYTES) {
          this.pageClipped = true;
        } else {
          this.retained.push({ entry, realUser: false, bytes });
          this.retainedBytes += bytes;
        }
      }
      return;
    }

    const realUser = isRealUserMessage(entry);
    const bytes = entryBytes();
    this.retained.push({ entry, realUser, bytes });
    this.retainedBytes += bytes;
    if (realUser) this.realUsers += 1;
    while (this.shouldEvict()) this.evictFront();
  }

  /** Finish the scan. */
  result(): SessionLogResult {
    const entries = this.retained.slice(this.head).map((retained) => {
      invariant(retained !== undefined, "live retained window contains no empty slots");
      return retained.entry;
    });
    const total = this.count;
    const hasMore =
      this.slice.mode === "page"
        ? this.pageClipped || this.slice.offset + this.slice.limit < total
        : entries.length < total;
    return { entries, total, hasMore };
  }

  private size(): number {
    return this.retained.length - this.head;
  }

  /**
   * May the oldest retained entry go? Only if what remains still satisfies the
   * requested tail AND the real-user-message floor — or if the hard ceiling
   * says it must go regardless.
   */
  private shouldEvict(): boolean {
    invariant(this.slice.mode === "tail", "shouldEvict is tail-mode only");
    const size = this.size();
    if (size > MAX_SESSION_ENTRIES || this.retainedBytes > MAX_RETAINED_BYTES) return true;
    if (size <= this.slice.tail) return false;
    const minUsers = this.slice.minRealUserMessages ?? 0;
    if (minUsers <= 0) return true;
    const front = this.retained[this.head];
    invariant(front !== undefined, "retained window is non-empty when size > tail >= 1");
    return this.realUsers - (front.realUser ? 1 : 0) >= minUsers;
  }

  /**
   * Drop the oldest retained entry. Clears its slot immediately so a large
   * payload becomes collectible, then advances a head pointer and compacts once
   * the dead prefix reaches half the array (or {@link MAX_DEAD_PREFIX}) —
   * amortized O(1) per entry, versus an `Array#shift` that memmoves the whole
   * window on every line.
   */
  private evictFront(): void {
    const front = this.retained[this.head];
    invariant(front !== undefined, "evictFront called on an empty window");
    if (front.realUser) this.realUsers -= 1;
    this.retainedBytes -= front.bytes;
    this.retained[this.head] = undefined;
    this.head += 1;
    if (this.head >= MAX_DEAD_PREFIX || this.head * 2 >= this.retained.length) {
      this.retained = this.retained.slice(this.head);
      this.head = 0;
    }
  }
}
