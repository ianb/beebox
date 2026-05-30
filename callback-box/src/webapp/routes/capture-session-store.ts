/**
 * Capture session state — on-disk session.json store + per-session mutex.
 *
 * Sessions accumulate files in a temp directory. Session metadata is stored
 * as session.json inside the temp dir so it survives server restarts.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export interface CaptureSessionData {
  id: string;
  boxSlug: string;
  files: CaptureFile[];
  startedAt: string;
}

export interface CaptureFile {
  name: string;
  source: string;
  startedAt: string;
  size: number;
  originalName?: string;
  mimeType?: string;
}

const SESSION_BASE = path.join(os.tmpdir(), "callback-box-capture");

export function sessionDir(id: string): string {
  return path.join(SESSION_BASE, id);
}

function sessionJsonPath(id: string): string {
  return path.join(sessionDir(id), "session.json");
}

export async function readSession(id: string): Promise<CaptureSessionData | null> {
  try {
    const raw = await fs.readFile(sessionJsonPath(id), "utf-8");
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

export async function writeSession(session: CaptureSessionData): Promise<void> {
  await fs.writeFile(sessionJsonPath(session.id), JSON.stringify(session, null, 2));
}

/**
 * Per-session mutex. Concurrent uploads for the same session read-modify-write
 * session.json; without serialization they race and drop entries. The map
 * stores the tail of a promise chain for each session id; each new task
 * appends itself after the tail.
 */
const sessionLocks = new Map<string, Promise<void>>();

export async function withSessionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(id) ?? Promise.resolve();
  const done = previous.then(fn);
  // Store a version that always resolves, so one failure doesn't break the chain.
  sessionLocks.set(id, done.then(
    () => {},
    () => {},
  ));
  return done;
}

export function releaseSessionLock(id: string): void {
  sessionLocks.delete(id);
}

export async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
    console.error(`[capture] Failed to clean up dir ${dir}:`, e);
  }
}
