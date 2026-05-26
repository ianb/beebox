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
 */

import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

export interface BusEvent {
  id: number;
  event: string;
  data: unknown;
  createdAt: string;
}

type BusListener = (event: BusEvent) => void;

export interface Subscription {
  unsubscribe(): void;
}

export interface EventBus {
  /** Persist an event and notify live subscribers. Returns the event ID. */
  emit(event: string, data: unknown): number;

  /** Emit without persisting to SQLite. For high-frequency ephemeral events (file-change). */
  emitTransient(event: string, data: unknown): void;

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
  `);

  const insertStmt = db.prepare(
    "INSERT INTO events (event, data) VALUES (?, ?)"
  );
  const readSinceStmt = db.prepare(
    "SELECT id, event, data, created_at as createdAt FROM events WHERE id > ? ORDER BY id"
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
  const initialRow = maxIdStmt.get() as { maxId: number | null };
  let highWaterMark = initialRow.maxId ?? 0;

  function notifyListeners(busEvent: BusEvent): void {
    for (const fn of listeners) {
      try {
        fn(busEvent);
      } catch (e) {
        console.error("[EventBus] Listener error:", e);
      }
    }
  }

  function parseRows(rows: Array<{ id: number; event: string; data: string; createdAt: string }>): BusEvent[] {
    return rows.map((r) => ({
      ...r,
      data: JSON.parse(r.data),
    }));
  }

  function emit(event: string, data: unknown): number {
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

  function emitTransient(event: string, data: unknown): void {
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
    const rows = readSinceStmt.all(afterId) as Array<{
      id: number;
      event: string;
      data: string;
      createdAt: string;
    }>;
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

      const rows = readSinceStmt.all(highWaterMark) as Array<{
        id: number;
        event: string;
        data: string;
        createdAt: string;
      }>;

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
