/**
 * Scheduler log routes — serves JSONL scheduler logs for the current box.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import { boxLogFile, type LogEntry } from "../../core/scheduler.js";

export async function registerSchedulerRoutes(
  server: FastifyInstance,
  boxRoot: string,
): Promise<void> {
  /**
   * GET /api/scheduler/log?limit=100&event=tick&status=ran
   *
   * Returns scheduler log entries for the current box.
   * - limit: max entries to return (default 100, newest first)
   * - event: filter by event type (e.g. "tick")
   * - status: filter ticks that have scripts with this status ("ran" or "error")
   */
  server.get<{
    Querystring: { limit?: string; event?: string; status?: string };
  }>("/api/scheduler/log", async (request) => {
    const limit = parseInt(request.query.limit ?? "100", 10);
    const eventFilter = request.query.event;
    const statusFilter = request.query.status;

    const logPath = boxLogFile(boxRoot);

    try {
      await fs.access(logPath);
    } catch {
      return { entries: [] };
    }

    let entries: LogEntry[] = [];

    // Read JSONL and filter
    const rl = readline.createInterface({
      input: createReadStream(logPath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as LogEntry;

        // Event filter
        if (eventFilter && entry.event !== eventFilter) continue;

        // Status filter — only include ticks where at least one script matches
        if (statusFilter && entry.result) {
          const hasMatch = entry.result.scripts.some(
            (s) => s.status === statusFilter,
          );
          if (!hasMatch) continue;
        }

        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    // Newest first, limited
    entries.reverse();
    if (entries.length > limit) {
      entries = entries.slice(0, limit);
    }

    return { entries };
  });
}
