/**
 * Client debug-log collector routes for the REST API.
 *
 * Split out of `api.ts`. The frontend always captures console.error/warn and
 * forwards them here. When the debug panel is open, all console levels are
 * forwarded. Logs are kept in-memory (for GET) and appended to a rolling log
 * file.
 *
 *   GET    /api/debug-log — read in-memory logs
 *   POST   /api/debug-log — { entries: [{ level, message }] }
 *   DELETE /api/debug-log — clear in-memory logs
 *
 * Read from CLI:  curl http://localhost:3210/<box>/api/debug-log | python3 -m json.tool
 * Log file:  .callback-box/client-debug.log (rolling, max ~100KB)
 */

import type { FastifyInstance } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const MAX_CLIENT_LOGS = 200;
const MAX_LOG_FILE_BYTES = 100_000;

interface RegisterApiDebugLogRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

/**
 * Register the `/api/debug-log` read/append/clear routes on the Fastify server.
 */
export function registerApiDebugLogRoutes(options: RegisterApiDebugLogRoutesOptions): void {
  const { server, boxRoot } = options;

  const clientLogs: Array<{ ts: string; level: string; message: string }> = [];
  const logFile = path.join(boxRoot, ".callback-box", "client-debug.log");

  async function appendToLogFile(lines: string[]) {
    try {
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      await fs.appendFile(logFile, lines.join("") );
      // Truncate if too large: keep the last half
      const stat = await fs.stat(logFile);
      if (stat.size > MAX_LOG_FILE_BYTES) {
        const content = await fs.readFile(logFile, "utf-8");
        const half = content.slice(content.length / 2);
        const firstNewline = half.indexOf("\n");
        await fs.writeFile(logFile, firstNewline !== -1 ? half.slice(firstNewline + 1) : half);
      }
    } catch (_e) {
      // Don't let log file failures break the API
    }
  }

  server.post<{ Body: { entries: Array<{ level: string; message: string }> } }>(
    "/api/debug-log",
    async (request) => {
      const { entries } = request.body;
      if (Array.isArray(entries)) {
        const lines: string[] = [];
        for (const entry of entries) {
          const ts = new Date().toISOString();
          const level = String(entry.level);
          const message = String(entry.message);
          clientLogs.push({ ts, level, message });
          lines.push(`${ts} [${level}] ${message}\n`);
        }
        while (clientLogs.length > MAX_CLIENT_LOGS) clientLogs.shift();
        await appendToLogFile(lines);
      }
      return { ok: true };
    }
  );

  server.get("/api/debug-log", async () => {
    return { entries: clientLogs };
  });

  server.delete("/api/debug-log", async () => {
    clientLogs.length = 0;
    return { ok: true };
  });
}
