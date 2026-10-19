/**
 * The model that ran a Codex thread's latest turn, read from Codex's rollout
 * JSONL. The SDK event stream does not report the model; the rollout's
 * `turn_context` record does, once per turn.
 *
 * Rollouts live at `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl`,
 * dated by the thread's creation in local time. Thread ids are UUIDv7, so the
 * id carries that time; the day before and after are searched too, for a
 * Codex process that ran in another timezone.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../shared/error-guards.js";

const turnContextSchema = z.looseObject({
  type: z.literal("turn_context"),
  payload: z.looseObject({ model: z.string().min(1) }),
});

const UUID_V7 = /^([\da-f]{8})-([\da-f]{4})-7[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/i;
const DAY_MS = 86_400_000;
const CHUNK_BYTES = 256 * 1024;
const TURN_CONTEXT_MARKER = '"type":"turn_context"';

class CodexRolloutParseError extends Error {
  constructor(file: string) {
    super(`Codex rollout ${file} has no readable turn_context model`);
    this.name = "CodexRolloutParseError";
  }
}

/**
 * The Codex home a session with this environment uses. A supplied environment
 * is the child's whole environment (the SDK does not merge it with ours), so
 * only an omitted one inherits this process's `CODEX_HOME`.
 */
export function codexHomeDir(env: Record<string, string | undefined> | undefined): string {
  const home = env === undefined ? process.env.CODEX_HOME : env.CODEX_HOME;
  return home ?? path.join(os.homedir(), ".codex");
}

function threadCreatedAt(threadId: string): Date | null {
  const match = UUID_V7.exec(threadId);
  if (match === null) return null;
  return new Date(Number.parseInt(`${match[1] ?? ""}${match[2] ?? ""}`, 16));
}

function dayDir(sessionsDir: string, at: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return path.join(sessionsDir, String(at.getFullYear()), pad(at.getMonth() + 1), pad(at.getDate()));
}

/** The rollout file for a thread, or null when none is found. */
export async function findCodexRollout(codexHome: string, threadId: string): Promise<string | null> {
  const created = threadCreatedAt(threadId);
  if (created === null) return null;
  const sessionsDir = path.join(codexHome, "sessions");
  const suffix = `-${threadId}.jsonl`;
  for (const offset of [0, -DAY_MS, DAY_MS]) {
    const dir = dayDir(sessionsDir, new Date(created.getTime() + offset));
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      if (errnoCode(error) === "ENOENT") continue;
      throw error;
    }
    const name = names.find((entry) => entry.startsWith("rollout-") && entry.endsWith(suffix));
    if (name !== undefined) return path.join(dir, name);
  }
  return null;
}

/**
 * The last line holding a `turn_context` record. The file is scanned backward
 * in chunks for the marker; the marker sits near the start of its line, so a
 * small overlap between chunks is enough to catch one split across them. Only
 * the matching line is then read whole, so each byte is read about once.
 */
async function lastTurnContextLine(file: string): Promise<string | null> {
  const handle = await fs.open(file, "r");
  try {
    const at = await lastMarkerOffset(handle, (await handle.stat()).size);
    if (at === null) return null;
    return await lineAround(handle, at);
  } finally {
    await handle.close();
  }
}

async function readAt(handle: fs.FileHandle, { position, length }: { position: number; length: number }): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

async function lastMarkerOffset(handle: fs.FileHandle, size: number): Promise<number | null> {
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - CHUNK_BYTES);
    // Read past `end` by the marker's length so a marker split at the chunk
    // boundary is found in this window.
    const window = await readAt(handle, { position: start, length: Math.min(size, end + TURN_CONTEXT_MARKER.length) - start });
    const index = window.lastIndexOf(TURN_CONTEXT_MARKER);
    if (index !== -1) return start + index;
    end = start;
  }
  return null;
}

/** The whole line containing byte `at`, without its newline. */
async function lineAround(handle: fs.FileHandle, at: number): Promise<string> {
  let lineStart = 0;
  for (let end = at; end > 0; ) {
    const start = Math.max(0, end - CHUNK_BYTES);
    const newline = (await readAt(handle, { position: start, length: end - start })).lastIndexOf(0x0a);
    if (newline !== -1) {
      lineStart = start + newline + 1;
      break;
    }
    end = start;
  }
  const parts: Buffer[] = [];
  for (let position = lineStart; ; position += CHUNK_BYTES) {
    const chunk = await readAt(handle, { position, length: CHUNK_BYTES });
    const newline = chunk.indexOf(0x0a);
    parts.push(newline === -1 ? chunk : chunk.subarray(0, newline));
    if (newline !== -1 || chunk.length < CHUNK_BYTES) break;
  }
  return Buffer.concat(parts).toString("utf8");
}

/**
 * The model of the thread's latest turn, or null when the rollout file is
 * missing. A rollout that exists but cannot be read or parsed throws.
 */
export async function readCodexRolloutModel(options: {
  codexHome: string;
  threadId: string;
}): Promise<string | null> {
  const file = await findCodexRollout(options.codexHome, options.threadId);
  if (file === null) return null;
  const line = await lastTurnContextLine(file);
  if (line === null) throw new CodexRolloutParseError(file);
  const parsed = turnContextSchema.safeParse(JSON.parse(line));
  if (!parsed.success) throw new CodexRolloutParseError(file);
  return parsed.data.payload.model;
}
