import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { router, publicProcedure } from "../trpc.js";

const MAX_CLIENT_LOGS = 200;
const MAX_LOG_FILE_BYTES = 100_000;

/**
 * Per-box in-memory ring buffer of forwarded client console logs, keyed by
 * boxRoot. Mirrors the raw route's per-box closure state so one box never sees
 * another's logs (the previous module-global array leaked across boxes).
 */
const logsByBox = new Map<string, Array<{ ts: string; level: string; message: string }>>();

function boxLogs(boxRoot: string): Array<{ ts: string; level: string; message: string }> {
  let logs = logsByBox.get(boxRoot);
  if (!logs) {
    logs = [];
    logsByBox.set(boxRoot, logs);
  }
  return logs;
}

/** Append lines to the box's rolling client-debug.log, truncating when large. */
async function appendToLogFile(boxRoot: string, lines: string[]): Promise<void> {
  const logFile = path.join(boxRoot, ".callback-box", "client-debug.log");
  try {
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    await fs.appendFile(logFile, lines.join(""));
    const stat = await fs.stat(logFile);
    if (stat.size > MAX_LOG_FILE_BYTES) {
      // Keep the last half, trimmed to the next line boundary.
      const content = await fs.readFile(logFile, "utf-8");
      const half = content.slice(content.length / 2);
      const firstNewline = half.indexOf("\n");
      await fs.writeFile(logFile, firstNewline !== -1 ? half.slice(firstNewline + 1) : half);
    }
  } catch (_e) {
    // Don't let log-file failures break the API.
  }
}

export const debugLogRouter = router({
  get: publicProcedure.query(({ ctx }) => {
    return { entries: boxLogs(ctx.boxRoot) };
  }),

  submit: publicProcedure
    .input(
      z.object({
        entries: z.array(
          z.object({
            level: z.string(),
            message: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const logs = boxLogs(ctx.boxRoot);
      const lines: string[] = [];
      for (const entry of input.entries) {
        const ts = new Date().toISOString();
        logs.push({ ts, level: entry.level, message: entry.message });
        lines.push(`${ts} [${entry.level}] ${entry.message}\n`);
      }
      while (logs.length > MAX_CLIENT_LOGS) logs.shift();
      await appendToLogFile(ctx.boxRoot, lines);
      return { ok: true };
    }),

  clear: publicProcedure.mutation(({ ctx }) => {
    boxLogs(ctx.boxRoot).length = 0;
    return { ok: true };
  }),
});
