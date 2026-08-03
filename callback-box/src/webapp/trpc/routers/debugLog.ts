import { z } from "zod";
import * as path from "node:path";
import { router, publicProcedure } from "../trpc.js";
import { appendRollingLogStrict } from "../../../lib/rolling-log.js";

const MAX_CLIENT_LOGS = 200;
const MAX_ENTRIES_PER_BATCH = 100;
const MAX_MESSAGE_LENGTH = 4000;
/** A line's `at` is only called out separately once it drifts this far from receipt time. */
const AT_DRIFT_DISPLAY_THRESHOLD_MS = 5_000;

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

/**
 * Replace control characters (including CR/LF) with a single space each, so a
 * crafted or multiline message can't forge additional `ts [level] ...` lines
 * in the rolling log file. Applies to every source, including web.
 */
function normalizeControlChars(message: string): string {
  let result = "";
  for (const ch of message) {
    const code = ch.codePointAt(0) ?? 0;
    result += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return result;
}

/**
 * The bracketed tag inserted between `[level]` and the message: absent when
 * there's no `source` (today's web-only shape); `[source]` when there's a
 * source but no meaningfully-drifted `at`; `[source@<at>]` once `at` differs
 * from the receipt timestamp by more than the display threshold — a queued
 * entry flushed long after the incident it describes should carry the
 * incident's own time, not the flush time.
 */
function renderTag(opts: { source: string | undefined; at: string | undefined; receivedAt: string }): string {
  const { source, at, receivedAt } = opts;
  if (source === undefined) return "";
  if (at !== undefined) {
    const driftMs = Math.abs(new Date(at).getTime() - new Date(receivedAt).getTime());
    if (driftMs > AT_DRIFT_DISPLAY_THRESHOLD_MS) {
      return `[${source}@${at}] `;
    }
  }
  return `[${source}] `;
}

/** Append lines to the box's rolling client-debug.log, truncating when large. */
async function appendToLogFile(boxRoot: string, lines: string[]): Promise<void> {
  const logFile = path.join(boxRoot, ".callback-box", "client-debug.log");
  // Strict: a mobile forwarder deletes its queued entries once it sees a 2xx,
  // so a swallowed filesystem failure here would silently drop the only copy.
  // The mutation must reject so the client keeps retrying.
  await appendRollingLogStrict(logFile, lines.join(""));
}

export const debugLogRouter = router({
  get: publicProcedure.query(({ ctx }) => {
    return { entries: boxLogs(ctx.boxRoot) };
  }),

  submit: publicProcedure
    .input(
      z.object({
        source: z
          .string()
          .regex(/^[a-z][\da-z-]{0,15}$/)
          .optional(),
        entries: z
          .array(
            z.object({
              level: z.enum(["error", "warn", "log", "info"]),
              message: z.string().max(MAX_MESSAGE_LENGTH),
              at: z.string().datetime({ offset: true }).optional(),
            }),
          )
          .max(MAX_ENTRIES_PER_BATCH),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const logs = boxLogs(ctx.boxRoot);
      const lines: string[] = [];
      for (const entry of input.entries) {
        const receivedAt = new Date().toISOString();
        const message = normalizeControlChars(entry.message);
        const tag = renderTag({ source: input.source, at: entry.at, receivedAt });
        logs.push({ ts: receivedAt, level: entry.level, message: `${tag}${message}` });
        lines.push(`${receivedAt} [${entry.level}] ${tag}${message}\n`);
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
