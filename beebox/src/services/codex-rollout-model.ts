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

/** The Codex home a session with this environment uses. */
export function codexHomeDir(env: Record<string, string | undefined> | undefined): string {
  return env?.CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
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
 * The last complete line holding a `turn_context` record, read backward in
 * chunks so a long thread's rollout is not read whole.
 */
async function lastTurnContextLine(file: string): Promise<string | null> {
  const handle = await fs.open(file, "r");
  try {
    let position = (await handle.stat()).size;
    let tail = "";
    while (position > 0) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      await handle.read(chunk, 0, length, position);
      // Joining at a byte offset can split a multibyte character; the marker
      // and the JSON structure around it are ASCII, so only free text suffers.
      tail = chunk.toString("utf8") + tail;
      const at = tail.lastIndexOf(TURN_CONTEXT_MARKER);
      if (at === -1) continue;
      const start = tail.lastIndexOf("\n", at) + 1;
      if (start === 0 && position > 0) continue;
      const end = tail.indexOf("\n", at);
      return tail.slice(start, end === -1 ? undefined : end);
    }
    return null;
  } finally {
    await handle.close();
  }
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
