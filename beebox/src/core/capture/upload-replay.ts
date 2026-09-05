import * as fs from "node:fs/promises";
import { errnoCode } from "../../lib/error-guards.js";
import { StagingUploadReplayConflictError } from "./staging-errors.js";

interface StagedMediaReferences {
  segments: Array<{ chunks: string[] }>;
  photos: Array<{ filename: string }>;
  files: Array<{ filename: string }>;
}

/** Return true when an already-manifested upload was verified or repaired. */
export async function handleStagingUploadReplay(opts: {
  session: StagedMediaReferences;
  mediaPath: string;
  filename: string;
  buffer: Buffer;
}): Promise<boolean> {
  const { session, mediaPath, filename, buffer } = opts;
  const referenced = session.segments.some((segment) => segment.chunks.includes(filename))
    || session.photos.some((photo) => photo.filename === filename)
    || session.files.some((file) => file.filename === filename);
  if (!referenced) return false;

  try {
    const existing = await fs.readFile(mediaPath);
    if (!existing.equals(buffer)) throw new StagingUploadReplayConflictError(filename);
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error;
    await fs.writeFile(mediaPath, buffer);
  }
  return true;
}
