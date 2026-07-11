/**
 * SQLite-backed event bus with in-memory real-time dispatch.
 *
 * Producers call emit() from anywhere — schedules, chat, Telegram, CLI,
 * background agents, even separate processes. All they need is boxRoot.
 *
 * Consumers subscribe() with an optional cursor to replay missed events.
 *
 * Events are persisted in SQLite (survives restarts) and dispatched
 * in-memory to live subscribers (instant delivery). The combination
 * gives reliable at-least-once delivery regardless of connection state.
 *
 * Cross-process: any process can open the same SQLite DB and emit().
 * When pollInterval is set, the bus periodically checks for events
 * inserted by other processes and dispatches them to local listeners.
 *
 * DB lives at .callback-box/events.db (not git-tracked, ephemeral data).
 *
 * ## Typing scope — producer AND read boundary
 *
 * {@link EventMap} names every event and types its payload, so `emit`/
 * `emitTransient` reject an unknown event name (typo drift) and a mistyped
 * payload at the CALL site. `EventMap` is DERIVED from the per-event zod
 * schemas in `event-bus-schemas.ts` (the single source of truth), and those
 * same schemas run at the READ boundary: `parseRows` validates every row read
 * back from SQLite (or replayed from another process). A row that fails —
 * malformed JSON, an unknown event name, or a schema mismatch — becomes the
 * logged, counted `unknown` sentinel rather than corrupting the stream (see
 * `unknownEventRow`, mirroring `unknownChatMessage`), so one bad row degrades
 * visibly without breaking dispatch of its siblings.
 *
 * Persisted rows are a reconnect bridge, not a source of truth. On bus open a
 * {@link EVENT_SCHEMA_GENERATION} mismatch truncates the events table, so
 * clients reconnecting across a deploy hit the existing full-resync path
 * instead of replaying stale-shaped rows — "everything persisted is valid
 * against current schemas" is an invariant, not a hope.
 */

import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { eventSchemas, isBusEventName, type BusEventName, type EventMap } from "./event-bus-schemas.js";

export type { BusEventName, EventMap } from "./event-bus-schemas.js";

/**
 * Bumped whenever ANY event payload shape in `event-bus-schemas.ts` changes.
 * Stored in the one-row `event_meta` table; on bus open a mismatch truncates
 * the persisted events (see `createEventBus`). All processes of one deploy
 * share this constant, so a startup race converges regardless.
 */
export const EVENT_SCHEMA_GENERATION = 4;

export interface BusEvent {
  id: number;
  event: string;
  /**
   * Read-side payload, validated against the per-event schema in `parseRows`.
   * Typed `unknown` because a bad row degrades to the `event: "unknown"`
   * sentinel — consumers narrow on `event` before reading `data`.
   */
  data: unknown;
  createdAt: string;
}

/** Count of persisted rows surfaced as `unknown` sentinels this process. */
let unknownEventCount = 0;

/** A raw row as stored in SQLite (payload still a JSON string). */
interface EventRow {
  id: number;
  event: string;
  data: string;
  createdAt: string;
}

/**
 * Reconcile the persisted schema generation against {@link EVENT_SCHEMA_GENERATION}.
 * Persisted rows bridge reconnects only, so rows written by an older payload
 * shape are worthless — drop them wholesale rather than replaying stale-shaped
 * data into current consumers. Meta read + truncate + meta write run in one
 * transaction so a startup race between processes of one deploy is unambiguous
 * (they share the constant, so it converges anyway — the transaction just
 * removes the interleaving).
 */
function reconcileSchemaGeneration(db: Database.Database): void {
  const reconcile = db.transaction(() => {
    const meta = db
      .prepare<[], { gen: number }>("SELECT schema_generation AS gen FROM event_meta WHERE id = 1")
      .get();
    if (meta === undefined) {
      // No meta row: either a fresh DB (0 events — the DELETE is a harmless
      // no-op) or a legacy DB written before generation stamping existed. A
      // legacy DB's rows are of an UNKNOWN generation, so treat them as stale
      // and drop them — the same invariant a real mismatch enforces. Silent on
      // a fresh DB; loud when it actually discards pre-generation rows.
      const deleted = db.prepare("DELETE FROM events").run().changes;
      db.prepare("INSERT INTO event_meta (id, schema_generation) VALUES (1, ?)").run(
        EVENT_SCHEMA_GENERATION,
      );
      if (deleted > 0) {
        console.warn(
          `[EventBus] Initialized event-schema generation ${EVENT_SCHEMA_GENERATION}; truncated ${deleted} pre-generation event(s) of unknown shape. Reconnecting clients resync via the bus's full-resync path.`,
        );
      }
      return;
    }
    if (meta.gen !== EVENT_SCHEMA_GENERATION) {
      const deleted = db.prepare("DELETE FROM events").run().changes;
      db.prepare("UPDATE event_meta SET schema_generation = ? WHERE id = 1").run(
        EVENT_SCHEMA_GENERATION,
      );
      console.warn(
        `[EventBus] Event-schema generation changed (${meta.gen} → ${EVENT_SCHEMA_GENERATION}); truncated ${deleted} persisted event(s). Reconnecting clients resync via the bus's full-resync path.`,
      );
    }
  });
  reconcile();
}

/**
 * Produce the read-boundary sentinel for a row that failed validation (bad
 * JSON, unknown event name, or a schema mismatch). Logs and counts every
 * occurrence — a schema/version drift can degrade the stream but can never do
 * so silently. Consumers narrowing on `event` ignore `"unknown"`, so one bad
 * row degrades visibly without breaking dispatch of its siblings.
 */
function unknownEventRow(row: EventRow, { reason, raw }: { reason: string; raw?: unknown }): BusEvent {
  unknownEventCount++;
  console.warn(
    `[EventBus] Row id=${row.id} event="${row.event}" failed read validation: ${reason} (count=${unknownEventCount}). Surfaced as an "unknown" sentinel; downstream consumers ignore it.`,
  );
  return {
    id: row.id,
    event: "unknown",
    data: { originalEvent: row.event, raw: raw ?? row.data, error: reason },
    createdAt: row.createdAt,
  };
}

/**
 * Validate one stored row against its per-event schema. A syntax-level parse
 * failure, an unknown event name, or a schema mismatch each degrades to the
 * `unknown` sentinel rather than throwing — the poll tick's other rows must
 * still dispatch. On success the ORIGINAL parsed value is returned (validation
 * gates, it never transforms), so valid rows reach consumers byte-identical to
 * before.
 */
function validateRow(row: EventRow): BusEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch (e) {
    return unknownEventRow(row, { reason: `JSON parse failed: ${String(e)}` });
  }
  if (!isBusEventName(row.event)) {
    return unknownEventRow(row, { reason: `unknown event name "${row.event}"`, raw: parsed });
  }
  const schema = eventSchemas[row.event];
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return unknownEventRow(row, { reason: result.error.message, raw: parsed });
  }
  return { id: row.id, event: row.event, data: parsed, createdAt: row.createdAt };
}

type BusListener = (event: BusEvent) => void;

export interface Subscription {
  unsubscribe(): void;
}

export interface EventBus {
  /** Persist an event and notify live subscribers. Returns the event ID. */
  emit<K extends BusEventName>(event: K, data: EventMap[K]): number;

  /** Emit without persisting to SQLite. For high-frequency ephemeral events (file-change). */
  emitTransient<K extends BusEventName>(event: K, data: EventMap[K]): void;

  /** Read all persisted events after the given ID. */
  readSince(afterId: number): BusEvent[];

  /** Replay missed events then stream live ones. */
  subscribe(options: { afterId?: number; listener: BusListener }): Subscription;

  /** Delete events older than the given date. Returns count deleted. */
  prune(olderThan: Date): number;

  /** Close the database and stop polling. */
  close(): void;
}

interface CreateEventBusOptions {
  /**
   * Poll interval in ms for detecting events from other processes.
   * When set, a timer periodically checks SQLite for new rows and
   * dispatches them to local listeners. Use in the server process.
   * Omit for fire-and-forget producers (CLI, agents).
   */
  pollInterval?: number;
}

/**
 * Create an EventBus backed by a SQLite database.
 * One EventBus per box, shared across all route handlers.
 *
 * Pass { pollInterval: 1000 } in the server to detect events
 * emitted by external processes (CLI, background agents).
 */
export function createEventBus(boxRoot: string, options?: CreateEventBusOptions): EventBus {
  const pollInterval = options ? options.pollInterval : undefined;
  const dbPath = path.join(boxRoot, ".callback-box/events.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS event_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_generation INTEGER NOT NULL
    );
  `);

  reconcileSchemaGeneration(db);

  const insertStmt = db.prepare(
    "INSERT INTO events (event, data) VALUES (?, ?)"
  );
  const readSinceStmt = db.prepare<[number], EventRow>(
    "SELECT id, event, data, created_at as createdAt FROM events WHERE id > ? ORDER BY id"
  );
  const pruneStmt = db.prepare(
    "DELETE FROM events WHERE created_at < ?"
  );
  const maxIdStmt = db.prepare<[], { maxId: number | null }>(
    "SELECT MAX(id) as maxId FROM events"
  );

  // In-memory dispatch
  const listeners = new Set<BusListener>();
  let transientCounter = 0;

  // High-water mark: the highest event ID we've dispatched locally.
  // Used by the poll loop to detect events inserted by other processes.
  const initialRow = maxIdStmt.get();
  let highWaterMark = initialRow?.maxId ?? 0;

  function notifyListeners(busEvent: BusEvent): void {
    for (const fn of listeners) {
      try {
        fn(busEvent);
      } catch (e) {
        console.error("[EventBus] Listener error:", e);
      }
    }
  }

  function parseRows(rows: EventRow[]): BusEvent[] {
    return rows.map(validateRow);
  }

  function emit<K extends BusEventName>(event: K, data: EventMap[K]): number {
    const payload = JSON.stringify(data);
    const result = insertStmt.run(event, payload);
    const id = Number(result.lastInsertRowid);

    const busEvent: BusEvent = {
      id,
      event,
      data,
      createdAt: new Date().toISOString(),
    };

    // Update high-water mark so the poll loop doesn't re-dispatch this
    highWaterMark = id;
    notifyListeners(busEvent);
    return id;
  }

  function emitTransient<K extends BusEventName>(event: K, data: EventMap[K]): void {
    transientCounter--;
    const busEvent: BusEvent = {
      id: transientCounter, // negative IDs for transient events
      event,
      data,
      createdAt: new Date().toISOString(),
    };
    notifyListeners(busEvent);
  }

  function readSince(afterId: number): BusEvent[] {
    const rows = readSinceStmt.all(afterId);
    return parseRows(rows);
  }

  function subscribe(opts: { afterId?: number; listener: BusListener }): Subscription {
    const { listener } = opts;
    const afterId = opts.afterId ?? 0;

    // Replay missed persisted events
    if (afterId > 0) {
      const missed = readSince(afterId);
      for (const event of missed) {
        try {
          listener(event);
        } catch (e) {
          console.error("[EventBus] Replay listener error:", e);
        }
      }
    }

    // Attach for live events
    listeners.add(listener);

    return {
      unsubscribe() {
        listeners.delete(listener);
      },
    };
  }

  function prune(olderThan: Date): number {
    const result = pruneStmt.run(olderThan.toISOString());
    return result.changes;
  }

  // Poll loop: detect events inserted by other processes.
  // Checks SQLite for rows beyond highWaterMark and dispatches them.
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  if (pollInterval && pollInterval > 0) {
    pollTimer = setInterval(() => {
      if (listeners.size === 0) return; // no one listening, skip

      const rows = readSinceStmt.all(highWaterMark);

      if (rows.length === 0) return;

      const events = parseRows(rows);
      for (const busEvent of events) {
        if (busEvent.id > highWaterMark) {
          highWaterMark = busEvent.id;
          notifyListeners(busEvent);
        }
      }
    }, pollInterval);

    pollTimer.unref(); // don't prevent process exit
  }

  function close(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    db.close();
    listeners.clear();
  }

  return { emit, emitTransient, readSince, subscribe, prune, close };
}
