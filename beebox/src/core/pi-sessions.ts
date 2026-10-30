/**
 * pi's files in a box, read without loading pi: where its state lives
 * (`.beebox/pi/`, gitignored and backed up with the rest of `.beebox/`), and
 * the token usage its session files record, for `syncUsage`.
 *
 * pi records usage on every assistant message and on `usage` entries
 * (`docs/session-format.md` in the pi package), so it is read in place, as
 * Claude's JSONL is, with no ledger of its own. The usage database has no
 * cost column; pi's dollar estimate stays in the run's output.
 */

import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { errnoCode } from "../shared/error-guards.js";
import { jsonlLines } from "../lib/jsonl-lines.js";

/** pi's `agentDir`. `auth.json` stays empty: the key is handed to pi in memory. */
export function piAgentDir(boxRoot: string): string {
  return join(boxRoot, ".beebox", "pi", "agent");
}

/** pi's session files, `<timestamp>_<session id>.jsonl`. */
export function piSessionsDir(boxRoot: string): string {
  return join(boxRoot, ".beebox", "pi", "sessions");
}

export interface PiUsageBucket {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  messageCount: number;
}

const usageSchema = z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() });

/** The two entry shapes that carry usage; anything else, and any malformed line, is skipped. */
const usageEntrySchema = z.union([
  z.object({
    type: z.literal("message"),
    timestamp: z.string(),
    message: z.object({ role: z.literal("assistant"), model: z.string(), usage: usageSchema }),
  }),
  z.object({ type: z.literal("usage"), timestamp: z.string(), model: z.string(), usage: usageSchema }),
]);

function parseUsageLine(line: string): z.infer<typeof usageEntrySchema> | null {
  try {
    const parsed = usageEntrySchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch (_error) {
    return null;
  }
}

/** One pi session file's usage, keyed `${date}\t${model}` as `syncUsage` keys Claude's. */
export async function readPiSessionUsage(sessionPath: string): Promise<Map<string, PiUsageBucket>> {
  const buckets = new Map<string, PiUsageBucket>();
  for await (const line of jsonlLines(createReadStream(sessionPath, { encoding: "utf-8" }))) {
    const entry = parseUsageLine(line);
    if (entry === null) continue;
    const { model, usage } = entry.type === "message" ? entry.message : entry;
    const key = `${entry.timestamp.slice(0, 10)}\t${model}`;
    const bucket = buckets.get(key) ?? { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, messageCount: 0 };
    bucket.inputTokens += usage.input;
    bucket.outputTokens += usage.output;
    bucket.cacheWriteTokens += usage.cacheWrite;
    bucket.cacheReadTokens += usage.cacheRead;
    bucket.messageCount += 1;
    buckets.set(key, bucket);
  }
  return buckets;
}

/** The box's pi session files. pi names them `<timestamp>_<session id>.jsonl`. */
export async function listPiSessionFiles(boxRoot: string): Promise<Array<{ sessionId: string; path: string }>> {
  const dir = piSessionsDir(boxRoot);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return [];
    throw error;
  }
  return names.flatMap((name) => {
    const match = /^[^_]+_(.+)\.jsonl$/.exec(name);
    return match?.[1] === undefined ? [] : [{ sessionId: match[1], path: join(dir, name) }];
  });
}
