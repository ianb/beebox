/**
 * SQLite-backed event bus with in-memory real-time dispatch.
 *
 * Producers call emit() from anywhere — schedules, chat, CLI,
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
 * DB lives at .beebox/events.db (not git-tracked, ephemeral data).
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
 * Persisted rows are a reconnect bridge, not a source of truth. On bus open an
 * older stored {@link EVENT_SCHEMA_GENERATION} truncates the events table (a
 * newer one refuses to open — see `NewerEventSchemaError`), so
 * clients reconnecting across a deploy hit the existing full-resync path
 * instead of replaying stale-shaped rows — "everything persisted is valid
 * against current schemas" is an invariant, not a hope.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { openSqlite, type SqliteDb } from "../sqlite.js";
import { eventSchemas, isBusEventName, type BusEventName, type EventMap } from "./schemas.js";

export type { BusEventName, EventMap } from "./schemas.js";

/**
 * Bumped whenever ANY event payload shape in `event-bus-schemas.ts` changes.
 * Stored in the one-row `event_meta` table; on bus open an older stored
 * generation truncates the persisted events and a newer one refuses to open
 * (see `reconcileSchemaGeneration`). All processes of one deploy
 * share this constant, so a startup race converges regardless.
 */
export const EVENT_SCHEMA_GENERATION = 10;

/**
 * The box's events.db carries an event-schema generation newer than this
 * engine's: a newer engine (another checkout or deploy) wrote it. Opening it
 * here would truncate that engine's events, so the open refuses instead.
 */
class NewerEventSchemaError extends Error {
  constructor(dbPath: string, options: { onDiskGeneration: number; engineGeneration: number }) {
    super(
      "Refusing to open " + dbPath + ": it was written by a newer beebox engine (event-schema generation " +
        String(options.onDiskGeneration) + "), and this engine is older (generation " +
        String(options.engineGeneration) + "). Opening it here would delete the newer engine's events. " +
        "Use the newer engine for this box."
    );
    this.name = "NewerEventSchemaError";
  }
}

/**
 * Throw {@link NewerEventSchemaError} when the box's events.db was written by
 * a newer engine; a no-op when it is absent, unstamped, or not newer. Opens the
 * DB read-only and changes nothing, so `bbx serve` can run it before it stops
 * the box's previous server — an older engine must refuse before it kills the
 * newer engine's server, not after.
 */
export function assertEventSchemaNotNewer(boxRoot: string): void {
  const dbPath = path.join(boxRoot, ".beebox/events.db");
  if (!fs.existsSync(dbPath)) return;
  const db = openSqlite(dbPath, { readOnly: true });
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_meta'")
      .get(nameRow);
    if (table === undefined) return;
    const meta = db
      .prepare("SELECT schema_generation AS gen FROM event_meta WHERE id = 1")
      .get(generationRow);
    if (meta !== undefined) throwIfNewer(dbPath, meta.gen);
  } finally {
    db.close();
  }
}

function throwIfNewer(dbPath: string, onDiskGeneration: number): void {
  if (onDiskGeneration > EVENT_SCHEMA_GENERATION) {
    throw new NewerEventSchemaError(dbPath, { onDiskGeneration, engineGeneration: EVENT_SCHEMA_GENERATION });
  }
}

/**
 * An event whose payload matched its event's schema. A union over event names,
 * so narrowing on `event` types `data`.
 */
export type KnownBusEvent<K extends BusEventName = BusEventName> = BusEventByName[K];

type BusEventByName = {
  [P in BusEventName]: { id: number; event: P; data: EventMap[P]; createdAt: string };
};

/** One event, its name and payload paired by `K`. */
function knownBusEvent<K extends BusEventName>(
  fields: { id: number; event: K; data: EventMap[K]; createdAt: string },
): KnownBusEvent<K> {
  // eslint-disable-next-line no-restricted-syntax -- TypeScript cannot relate a generic { event: K; data: EventMap[K] } to the union over event names indexed by K (a correlated union); the parameter's type pairs the two.
  return fields as KnownBusEvent<K>;
}

/** Whether a value matches `event`'s payload schema. */
function isPayloadOf<K extends BusEventName>(event: K, value: unknown): value is EventMap[K] {
  return eventSchemas[event].safeParse(value).success;
}

/** A stored row that failed read validation (see `unknownEventRow`). */
export interface UnknownBusEvent {
  id: number;
  event: "unknown";
  data: { originalEvent: string; raw: unknown; error: string };
  createdAt: string;
}

/**
 * What subscribers receive. A bad row degrades to the `"unknown"` sentinel,
 * so consumers narrow on `event` before reading `data`.
 */
export type BusEvent = KnownBusEvent | UnknownBusEvent;

/** Count of persisted rows surfaced as `unknown` sentinels this process. */
let unknownEventCount = 0;

/** A row as read from SQLite. Only `id` (INTEGER PRIMARY KEY) is certain; SQLite
 * lets any column hold any type, so the rest is checked in `validateRow`. */
const storedEventRow = z.object({ id: z.number(), event: z.unknown(), data: z.unknown(), createdAt: z.unknown() });
type StoredEventRow = z.infer<typeof storedEventRow>;
/** A stored row whose columns are text (payload still a JSON string). */
interface EventRow {
  id: number;
  event: string;
  data: string;
  createdAt: string;
}
const nameRow = z.object({ name: z.string() });
const generationRow = z.object({ gen: z.number() });
const maxIdRow = z.object({ maxId: z.number().nullable() });

/**
 * Reconcile the persisted schema generation against {@link EVENT_SCHEMA_GENERATION}.
 * Persisted rows bridge reconnects only, so rows written by an older payload
 * shape are worthless — drop them wholesale rather than replaying stale-shaped
 * data into current consumers. A NEWER on-disk generation throws
 * {@link NewerEventSchemaError} and leaves the rows alone: an older engine
 * opening a box a newer engine serves must not wipe that engine's history.
 * Meta read + truncate + meta write run in one IMMEDIATE transaction so a
 * startup race between processes of one deploy is unambiguous (they share the
 * constant, so it converges anyway). A deferred one let two processes read
 * the old generation; the second write then failed with SQLITE_BUSY_SNAPSHOT,
 * which the busy timeout does not cure.
 */
function reconcileSchemaGeneration(db: SqliteDb, dbPath: string): void {
  // The common open: the generation already matches, and no write lock is
  // needed. Only a missing or different generation takes the lock and
  // re-reads under it.
  const current = db.prepare("SELECT schema_generation AS gen FROM event_meta WHERE id = 1").get(generationRow);
  if (current?.gen === EVENT_SCHEMA_GENERATION) return;
  db.transaction(() => {
    const meta = db
      .prepare("SELECT schema_generation AS gen FROM event_meta WHERE id = 1")
      .get(generationRow);
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
    // A newer engine wrote these rows. Truncating would wipe that engine's
    // live history, and the two would then take turns wiping each other on
    // every open. Refuse instead; the transaction rolls back untouched.
    throwIfNewer(dbPath, meta.gen);
    if (meta.gen !== EVENT_SCHEMA_GENERATION) {
      const deleted = db.prepare("DELETE FROM events").run().changes;
      db.prepare("UPDATE event_meta SET schema_generation = ? WHERE id = 1").run(
        EVENT_SCHEMA_GENERATION,
      );
      console.warn(
        `[EventBus] Event-schema generation changed (${meta.gen} → ${EVENT_SCHEMA_GENERATION}); truncated ${deleted} persisted event(s). Reconnecting clients resync via the bus's full-resync path.`,
      );
    }
  }, { immediate: true });
}

/**
 * Produce the read-boundary sentinel for a row that failed validation (bad
 * JSON, unknown event name, or a schema mismatch). Logs and counts every
 * occurrence — a schema/version drift can degrade the stream but can never do
 * so silently. Consumers narrowing on `event` ignore `"unknown"`, so one bad
 * row degrades visibly without breaking dispatch of its siblings.
 */
function unknownEventRow(row: EventRow, { reason, raw }: { reason: string; raw?: unknown }): UnknownBusEvent {
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
function validateRow(stored: StoredEventRow): BusEvent {
  const { id, event, data, createdAt } = stored;
  if (typeof event !== "string" || typeof data !== "string" || typeof createdAt !== "string") {
    const textRow = { id, event: String(event), data: "", createdAt: String(createdAt) };
    // Bytes are shown as SQLite hex text: the sentinel travels as JSON.
    const raw = data instanceof Uint8Array ? `x'${Buffer.from(data).toString("hex")}'` : data;
    return unknownEventRow(textRow, { reason: "a stored column is not text", raw });
  }
  const row: EventRow = { id, event, data, createdAt };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch (e) {
    return unknownEventRow(row, { reason: `JSON parse failed: ${String(e)}` });
  }
  if (!isBusEventName(row.event)) {
    return unknownEventRow(row, { reason: `unknown event name "${row.event}"`, raw: parsed });
  }
  if (!isPayloadOf(row.event, parsed)) {
    const reason = eventSchemas[row.event].safeParse(parsed).error?.message ?? "schema mismatch";
    return unknownEventRow(row, { reason, raw: parsed });
  }
  return knownBusEvent({ id: row.id, event: row.event, data: parsed, createdAt: row.createdAt });
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

  /**
   * The most recent persisted events of one type, oldest-first, at most
   * `limit` of them.
   *
   * `readSince` answers "what have I missed", which needs a cursor the caller
   * has been holding. A page load has no cursor — it is asking "what does the
   * box know right now", and the only bounded honest answer is a recent slice
   * of one event type. Used by `chat.bootstrap` to report the messages the box
   * has accepted but not yet written into a transcript.
   */
  readRecent<K extends BusEventName>(options: { event: K; limit: number }): Array<KnownBusEvent<K> | UnknownBusEvent>;

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
  const dbPath = path.join(boxRoot, ".beebox/events.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = openSqlite(dbPath);
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
    -- Backs readRecent's "newest N of one type". Without it that query walks
    -- backwards through every row of every other type until it has collected
    -- its limit, which on a busy box is most of the table for an answer about
    -- a handful of chat messages.
    CREATE INDEX IF NOT EXISTS idx_events_event_id ON events (event, id);
  `);

  try {
    reconcileSchemaGeneration(db, dbPath);
  } catch (e) {
    db.close();
    throw e;
  }

  const insertStmt = db.prepare(
    "INSERT INTO events (event, data) VALUES (?, ?)"
  );
  const readSinceStmt = db.prepare(
    "SELECT id, event, data, created_at as createdAt FROM events WHERE id > ? ORDER BY id"
  );
  const readRecentStmt = db.prepare(
    "SELECT id, event, data, created_at as createdAt FROM events WHERE event = ? ORDER BY id DESC LIMIT ?"
  );
  const pruneStmt = db.prepare(
    "DELETE FROM events WHERE created_at < ?"
  );
  const maxIdStmt = db.prepare(
    "SELECT MAX(id) as maxId FROM events"
  );

  // In-memory dispatch
  const listeners = new Set<BusListener>();
  let transientCounter = 0;

  // High-water mark: the highest event ID we've dispatched locally.
  // Used by the poll loop to detect events inserted by other processes.
  const initialRow = maxIdStmt.get(maxIdRow);
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

  function parseRows(rows: StoredEventRow[]): BusEvent[] {
    return rows.map(validateRow);
  }

  function emit<K extends BusEventName>(event: K, data: EventMap[K]): number {
    const payload = JSON.stringify(data);
    const result = insertStmt.run(event, payload);
    const id = Number(result.lastInsertRowid);

    const busEvent = knownBusEvent({
      id,
      event,
      data,
      createdAt: new Date().toISOString(),
    });

    // Update high-water mark so the poll loop doesn't re-dispatch this
    highWaterMark = id;
    notifyListeners(busEvent);
    return id;
  }

  function emitTransient<K extends BusEventName>(event: K, data: EventMap[K]): void {
    transientCounter--;
    const busEvent = knownBusEvent({
      id: transientCounter, // negative IDs for transient events
      event,
      data,
      createdAt: new Date().toISOString(),
    });
    notifyListeners(busEvent);
  }

  /**
   * A bounded tail of one event type, handed back oldest-first.
   *
   * The query takes the newest rows (so the bound bites on the recent end,
   * which is the end a caller asking "what just happened" means) and the order
   * is flipped afterwards, because every consumer reads a conversation
   * forwards. A row that fails validation is dropped by `parseRows`, same as
   * on every other read path.
   */
  function readRecent<K extends BusEventName>(request: { event: K; limit: number }): Array<KnownBusEvent<K> | UnknownBusEvent> {
    const rows = readRecentStmt.all(storedEventRow, request.event, request.limit);
    // The query selected only `request.event`; a row read back as another
    // event cannot occur, and dropping one keeps the type honest.
    const ofRequested = (event: BusEvent): event is KnownBusEvent<K> | UnknownBusEvent =>
      event.event === request.event || event.event === "unknown";
    return parseRows(rows.toReversed()).filter(ofRequested);
  }

  function readSince(afterId: number): BusEvent[] {
    const rows = readSinceStmt.all(storedEventRow, afterId);
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

      const rows = readSinceStmt.all(storedEventRow, highWaterMark);

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

  return { emit, emitTransient, readSince, readRecent, subscribe, prune, close };
}
