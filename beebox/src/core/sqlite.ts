/**
 * The one place beebox opens SQLite (docs/plans/node-sqlite.md). It wraps
 * `node:sqlite` with what the event bus and usage accounting need:
 * better-sqlite3's 5 s busy timeout, WAL on writable opens, a synchronous
 * `transaction()`, and rows validated by a zod schema instead of cast.
 *
 * A Bun port replaces this file with `bun:sqlite`, whose API is close. It
 * must run `PRAGMA busy_timeout = 5000` (Bun's `Database` has no `timeout`
 * option), call `close(true)` (Bun's default close lets live statements keep
 * the file open), and read `Statement.columnNames` where this uses
 * `columns()`.
 */

import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { z } from "zod";

/** better-sqlite3's default; node:sqlite's is 0, which fails on first contention. */
const BUSY_TIMEOUT_MS = 5000;

export class SqliteNoRowsStatementError extends Error {
  override name = "SqliteNoRowsStatementError";
  constructor() {
    super("This statement does not return data");
  }
}

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqliteStatement {
  run(...params: SQLInputValue[]): SqliteRunResult;
  get<T>(schema: z.ZodType<T>, ...params: SQLInputValue[]): T | undefined;
  all<T>(schema: z.ZodType<T>, ...params: SQLInputValue[]): T[];
  /** Rows of user-chosen SQL, unvalidated. Throws before running a statement that returns no columns. */
  allUnchecked(...params: SQLInputValue[]): Record<string, unknown>[];
}

export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  /** Runs `fn` in one transaction: commit on return, rollback on throw. `immediate` takes the write lock up front. */
  transaction<T>(fn: () => T, options?: { immediate?: boolean }): T;
  close(): void;
}

function wrapStatement(stmt: StatementSync): SqliteStatement {
  return {
    run: (...params) => {
      const result = stmt.run(...params);
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    },
    get: (schema, ...params) => {
      const row = stmt.get(...params);
      return row === undefined ? undefined : schema.parse(row);
    },
    all: (schema, ...params) => stmt.all(...params).map((row) => schema.parse(row)),
    allUnchecked: (...params) => {
      if (stmt.columns().length === 0) throw new SqliteNoRowsStatementError();
      return stmt.all(...params);
    },
  };
}

/**
 * Opens a database file. A writable open creates the file if missing and
 * switches it to WAL; a `readOnly` open fails on a missing file and leaves
 * the journal mode alone.
 */
export function openSqlite(filePath: string, options?: { readOnly?: boolean }): SqliteDb {
  const readOnly = options?.readOnly === true;
  const db = new DatabaseSync(filePath, { readOnly, timeout: BUSY_TIMEOUT_MS });
  if (!readOnly) db.exec("PRAGMA journal_mode = WAL");
  return {
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: (sql) => wrapStatement(db.prepare(sql)),
    transaction: (fn, txOptions) => {
      db.exec(txOptions?.immediate === true ? "BEGIN IMMEDIATE" : "BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => {
      db.close();
    },
  };
}
