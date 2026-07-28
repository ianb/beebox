/**
 * Durable, fail-loud read/write of a staging session's `session.json`
 * manifest (Track 0 of `docs/plans/bulk-file-upload.md`).
 *
 * Writes go through a temp-file-then-rename so a crash mid-write can never
 * leave a truncated/corrupt manifest on disk. Reads never return `null`
 * silently for a corrupt manifest — only a genuinely absent one (ENOENT) is
 * silent; anything else is a loud `console.error` plus quarantine, since a
 * silently-dropped manifest would strand the staged bytes next to it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../../lib/error-guards.js";
import { StagingSessionSchema, stagingSessionDir, type StagingSession } from "./staging-schema.js";

function sessionJsonPath(boxRoot: string, id: string): string {
  return path.join(stagingSessionDir(boxRoot, id), "session.json");
}

/**
 * Read and validate `session.json`. ENOENT (missing file/dir) is a genuinely
 * absent session — silent `null`. Any other failure (unreadable file,
 * invalid JSON, schema mismatch) means the manifest is corrupt: logs a
 * `console.error`, quarantines the bad file to `session.json.corrupt` (so the
 * corruption survives for inspection and a repeat read doesn't re-log), then
 * returns `null` — never silent, so staged bytes are never silently stranded.
 */
export async function readStagingSession(opts: {
  boxRoot: string;
  id: string;
}): Promise<StagingSession | null> {
  const { boxRoot, id } = opts;
  const jsonPath = sessionJsonPath(boxRoot, id);
  try {
    const raw = await fs.readFile(jsonPath, "utf-8");
    return StagingSessionSchema.parse(JSON.parse(raw));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    console.error(`[capture] Corrupt staging manifest for session ${id} in box ${boxRoot}:`, e);
    await quarantineCorruptManifest({ jsonPath, sessionId: id });
    return null;
  }
}

/** Rename a corrupt manifest to `.corrupt` so it survives for inspection and
 * a repeat read doesn't re-log forever; logs (not throws) if renaming fails. */
async function quarantineCorruptManifest(opts: { jsonPath: string; sessionId: string }): Promise<void> {
  const { jsonPath, sessionId } = opts;
  try {
    await fs.rename(jsonPath, `${jsonPath}.corrupt`);
  } catch (e) {
    console.error(`[capture] Failed to quarantine corrupt staging manifest for session ${sessionId}:`, e);
  }
}

/** Writes via temp-file-then-rename so a crash mid-write can't leave a
 * truncated/corrupt manifest — `fs.rename` within one directory is atomic. */
export async function writeStagingSession(opts: {
  boxRoot: string;
  session: StagingSession;
}): Promise<void> {
  const { boxRoot, session } = opts;
  const jsonPath = sessionJsonPath(boxRoot, session.id);
  const tmpPath = path.join(path.dirname(jsonPath), `session.json.tmp-${process.pid}-${crypto.randomUUID()}`);
  await fs.writeFile(tmpPath, JSON.stringify(session, null, 2));
  await fs.rename(tmpPath, jsonPath);
}
