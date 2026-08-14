/**
 * Usage tracking — aggregate token usage from Claude Code sessions into SQLite.
 *
 * Data flow:
 *   1. createAgent() appends to store/usage/session-manifest.jsonl (task attribution)
 *   2. Claude Code writes session logs to ~/.claude/projects/<encoded-path>/<sessionId>.jsonl
 *   3. syncUsage() reads both, aggregates per (session, date, model), writes to SQLite
 *
 * The SQLite DB lives at .callback-box/usage.db (not git-tracked, rebuildable).
 */

import Database from "better-sqlite3";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { listSessions } from "../cli/lib/session.js";
import { CODEX_USAGE_REL_PATH, readCodexTurnUsage } from "./codex-usage.js";

const DB_REL_PATH = ".callback-box/usage.db";
const MANIFEST_REL_PATH = "store/usage/session-manifest.jsonl";

export const USAGE_SCHEMA_DESCRIPTION = `
Tables:

  usage — one row per (session_id, date, model)
    session_id   TEXT     -- Claude Code session UUID
    task         TEXT     -- agent name (e.g. "reactor-batch", "intake-triage")
    date         TEXT     -- YYYY-MM-DD (from message timestamps, handles midnight crossings)
    model        TEXT     -- model ID (e.g. "claude-opus-4-6")
    input_tokens        INTEGER
    output_tokens       INTEGER
    cache_write_tokens  INTEGER
    cache_read_tokens   INTEGER
    message_count       INTEGER
    PRIMARY KEY (session_id, date, model)

  sync_state — tracks which sessions have been processed
    session_id   TEXT PRIMARY KEY
    file_size    INTEGER  -- size of JSONL file when last processed

Example queries:
  -- Total tokens by task
  SELECT task, SUM(input_tokens) as input, SUM(output_tokens) as output
  FROM usage GROUP BY task ORDER BY output DESC;

  -- Daily cost estimate (Opus pricing)
  SELECT date,
    SUM(input_tokens) as input,
    SUM(output_tokens) as output,
    ROUND(SUM(output_tokens) / 1000000.0 * 75 + SUM(input_tokens) / 1000000.0 * 15, 2) as est_usd
  FROM usage GROUP BY date ORDER BY date DESC LIMIT 14;

  -- Token usage by model
  SELECT model, SUM(input_tokens + output_tokens + cache_write_tokens + cache_read_tokens) as total
  FROM usage GROUP BY model;

  -- Which tasks use which models
  SELECT task, model, SUM(output_tokens) as output
  FROM usage GROUP BY task, model ORDER BY task, output DESC;
`.trim();

function openDb(boxRoot: string): Database.Database {
  const dbPath = path.join(boxRoot, DB_REL_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      session_id TEXT NOT NULL,
      task TEXT NOT NULL,
      date TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, date, model)
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      session_id TEXT PRIMARY KEY,
      file_size INTEGER NOT NULL
    );
  `);
  return db;
}

const manifestEntrySchema = z.object({
  sessionId: z.string(),
  task: z.string(),
  timestamp: z.string(),
});
type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/**
 * One assistant line of a Claude Code session JSONL — validated at the read
 * boundary so token counts flow typed rather than through an `as` cast. All
 * fields optional: a session file is external input and older/other line types
 * legitimately omit them.
 */
const sessionUsageLineSchema = z.object({
  type: z.string().optional(),
  timestamp: z.string().optional(),
  message: z
    .object({
      model: z.string().optional(),
      usage: z
        .object({
          input_tokens: z.number().optional(),
          output_tokens: z.number().optional(),
          cache_creation_input_tokens: z.number().optional(),
          cache_read_input_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

function readManifest(boxRoot: string): Map<string, ManifestEntry> {
  const manifestPath = path.join(boxRoot, MANIFEST_REL_PATH);
  const entries = new Map<string, ManifestEntry>();
  let content: string;
  try {
    content = fs.readFileSync(manifestPath, "utf-8");
  } catch (_e) {
    return entries;
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = manifestEntrySchema.parse(JSON.parse(line));
      entries.set(entry.sessionId, entry);
    } catch (_e) {
      // skip malformed lines
    }
  }
  return entries;
}

interface UsageBucket {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  messageCount: number;
}

/**
 * Parse a session JSONL file and aggregate tokens by (date, model).
 */
async function parseSessionUsage(
  logPath: string
): Promise<Map<string, UsageBucket>> {
  // Key: `${date}\t${model}`
  const buckets = new Map<string, UsageBucket>();

  const fileStream = fs.createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line);
    } catch (_e) {
      continue;
    }
    const parsed = sessionUsageLineSchema.safeParse(parsedLine);
    if (!parsed.success) continue;
    const raw = parsed.data;

    if (raw.type !== "assistant") continue;

    const message = raw.message;
    if (!message) continue;

    const usage = message.usage;
    if (!usage) continue;

    const model = String(message.model || "unknown");
    const timestamp = String(raw.timestamp || "");
    const date = timestamp.slice(0, 10) || "unknown";

    const key = `${date}\t${model}`;
    const bucket = buckets.get(key) || {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      messageCount: 0,
    };

    bucket.inputTokens += usage.input_tokens || 0;
    bucket.outputTokens += usage.output_tokens || 0;
    bucket.cacheWriteTokens += usage.cache_creation_input_tokens || 0;
    bucket.cacheReadTokens += usage.cache_read_input_tokens || 0;
    bucket.messageCount += 1;

    buckets.set(key, bucket);
  }

  return buckets;
}

export interface SyncResult {
  sessionsProcessed: number;
  sessionsSkipped: number;
  sessionsMissing: number;
}

/**
 * Sync session JSONL files into the usage SQLite database.
 *
 * Reads the manifest for task attribution, then processes any session
 * files that are new or have grown since last sync.
 */
export async function syncUsage(boxRoot: string): Promise<SyncResult> {
  const db = openDb(boxRoot);
  const manifest = readManifest(boxRoot);

  // Aggregate across every context root (box root + landmark subdirs) —
  // landmark-bound sessions live under their own encoded dir. listSessions
  // is newest-first; dedupe by id so an improbable same-id file in two
  // roots is only counted once (the fresher copy wins).
  const allSessions = await listSessions(boxRoot);
  const seenIds = new Set<string>();
  const sessionFiles: Array<{ sessionId: string; path: string }> = [];
  for (const s of allSessions) {
    if (seenIds.has(s.sessionId)) continue;
    seenIds.add(s.sessionId);
    sessionFiles.push({ sessionId: s.sessionId, path: s.path });
  }

  const getSyncState = db.prepare<[string], { file_size: number }>(
    "SELECT file_size FROM sync_state WHERE session_id = ?"
  );
  const upsertUsage = db.prepare(`
    INSERT INTO usage (session_id, task, date, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, message_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, date, model) DO UPDATE SET
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_write_tokens = excluded.cache_write_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      message_count = excluded.message_count
  `);
  const upsertSync = db.prepare(`
    INSERT INTO sync_state (session_id, file_size) VALUES (?, ?)
    ON CONFLICT(session_id) DO UPDATE SET file_size = excluded.file_size
  `);
  const deleteUsage = db.prepare("DELETE FROM usage WHERE session_id = ?");

  const result: SyncResult = { sessionsProcessed: 0, sessionsSkipped: 0, sessionsMissing: 0 };

  for (const { sessionId, path: filePath } of sessionFiles) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (_e) {
      continue;
    }

    // Check if already processed at this size
    const row = getSyncState.get(sessionId);
    if (row && row.file_size === stat.size) {
      result.sessionsSkipped++;
      continue;
    }

    // Look up task from manifest (fall back to "unknown" for pre-existing sessions)
    const manifestEntry = manifest.get(sessionId);
    const task = manifestEntry ? manifestEntry.task : "unknown";
    if (!manifestEntry) {
      result.sessionsMissing++;
    }

    // Parse and aggregate
    const buckets = await parseSessionUsage(filePath);

    // Upsert within a transaction
    const txn = db.transaction(() => {
      deleteUsage.run(sessionId);
      for (const [key, bucket] of buckets) {
        const [date, model] = key.split("\t");
        upsertUsage.run(
          sessionId, task, date, model,
          bucket.inputTokens, bucket.outputTokens,
          bucket.cacheWriteTokens, bucket.cacheReadTokens,
          bucket.messageCount
        );
      }
      upsertSync.run(sessionId, stat.size);
    });
    txn();

    result.sessionsProcessed++;
  }

  const codexPath = path.join(boxRoot, CODEX_USAGE_REL_PATH);
  let codexSize: number | null = null;
  try {
    codexSize = fs.statSync(codexPath).size;
  } catch (_error) {
    // A box that has never run Codex has no Codex ledger.
  }
  const codexSyncKey = "__callback_box_codex_turn_ledger__";
  if (codexSize !== null && getSyncState.get(codexSyncKey)?.file_size !== codexSize) {
    const codexEntries = await readCodexTurnUsage(boxRoot);
    const sessions = new Set(codexEntries.map((entry) => entry.sessionId));
    const buckets = new Map<string, UsageBucket & { sessionId: string; task: string; date: string; model: string }>();
    for (const entry of codexEntries) {
      const date = entry.timestamp.slice(0, 10) || "unknown";
      const key = `${entry.sessionId}\t${date}\t${entry.model}`;
      const bucket = buckets.get(key) ?? {
        sessionId: entry.sessionId,
        task: entry.task,
        date,
        model: entry.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        messageCount: 0,
      };
      bucket.inputTokens += entry.usage.inputTokens;
      bucket.outputTokens += entry.usage.outputTokens;
      bucket.cacheWriteTokens += entry.usage.cacheWriteInputTokens;
      bucket.cacheReadTokens += entry.usage.cachedInputTokens;
      bucket.messageCount += 1;
      buckets.set(key, bucket);
    }
    db.transaction(() => {
      for (const sessionId of sessions) deleteUsage.run(sessionId);
      for (const bucket of buckets.values()) {
        upsertUsage.run(
          bucket.sessionId,
          bucket.task,
          bucket.date,
          bucket.model,
          bucket.inputTokens,
          bucket.outputTokens,
          bucket.cacheWriteTokens,
          bucket.cacheReadTokens,
          bucket.messageCount,
        );
      }
      upsertSync.run(codexSyncKey, codexSize);
    })();
    result.sessionsProcessed += sessions.size;
  }

  db.close();
  return result;
}

/**
 * Run an arbitrary SQL query against the usage database.
 */
export function queryUsage(boxRoot: string, sql: string): unknown[] {
  const db = openDb(boxRoot);
  try {
    const stmt = db.prepare(sql);
    return stmt.all();
  } finally {
    db.close();
  }
}
