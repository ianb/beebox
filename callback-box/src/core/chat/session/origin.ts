/**
 * The machine a chat session ran on — the one fact about a transcript that
 * nothing can derive later.
 *
 * A transcript lives in one engine store on one machine and expires there, so
 * a husk whose transcript is absent is either expired or was never here. The
 * husk records which, by carrying the origin machine's id
 * (`docs/implemented-plans/chat-session-identity.md`, Track 2).
 *
 * The id is a UUID minted once at `~/.local/share/cb/origin-id`, because
 * `os.hostname()` is not stable on a laptop (a network location can rename
 * it). The hostname rides along as `name`, a display label only — it is never
 * compared, locked on, or joined into a path.
 *
 * Deleting the id file makes this machine a new origin: its old sessions then
 * read as "elsewhere" until the file is restored. That is visible rather than
 * silent, and is the accepted cost of not keying on the hostname.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode } from "../../../lib/error-guards.js";
import { CB_STATE_DIR } from "../../../lib/state-dir.js";

export interface LocalOrigin {
  /** Stable machine id — the value husks are stamped with. */
  id: string;
  /** `os.hostname()` at read time. A label; never a key. */
  name: string;
}

/** The file holds a UUID and nothing else; anything else is a hand-edit. */
class CorruptOriginIdError extends Error {
  constructor(filePath: string) {
    super(`${filePath} does not contain a UUID — restore it or delete it (deleting makes this machine a new origin)`);
    this.name = "CorruptOriginIdError";
  }
}

const originIdSchema = z.uuid();

/** Test/doctest override, so a run never mints or reads the real machine id. */
function originIdFile(): string {
  return process.env["CB_ORIGIN_ID_FILE"] ?? path.join(CB_STATE_DIR, "origin-id");
}

function parseOriginId(raw: string, filePath: string): string {
  const parsed = originIdSchema.safeParse(raw.trim());
  // A file we wrote is a UUID; one that isn't was edited or truncated by
  // something else, and silently replacing it would silently re-origin every
  // session this machine holds.
  if (!parsed.success) throw new CorruptOriginIdError(filePath);
  return parsed.data;
}

/**
 * The unmemoized read — mint on first run, otherwise read what is there.
 *
 * Create-exclusive (`wx`), not write-then-read: a rename over the target would
 * let two processes minting at the same moment each stamp their own UUID, and
 * whichever landed second would silently re-origin every husk the first had
 * already stamped. With `wx` exactly one creator wins and the loser reads the
 * winner's id, so concurrent first runs converge.
 *
 * Exported for the doctest that runs two first calls at once — `localOrigin`
 * memoizes per path, so there is no other way to reach the race.
 */
export async function readOrCreateOriginId(filePath: string): Promise<string> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw e;
    // Missing is the ordinary first-run case, not a corruption.
    raw = await mintOriginId(filePath);
  }
  return parseOriginId(raw, filePath);
}

/** Create the id file if nobody else has; return what the file ends up holding. */
async function mintOriginId(filePath: string): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "wx");
    await handle.writeFile(`${randomUUID()}\n`);
  } catch (e) {
    // Lost the race: another process created the file between our read and our
    // open. Its id is the one on disk, and the one on disk is the one that counts.
    if (errnoCode(e) !== "EEXIST") throw e;
  } finally {
    await handle?.close();
  }
  return fs.readFile(filePath, "utf-8");
}

/** Keyed by path so an override still takes effect within one process. */
const idCache = new Map<string, Promise<string>>();

/**
 * This machine's origin identity. Memoized per process — the id is a file read
 * on a hot path (every husk write), and it cannot change under a running
 * process without someone deleting the file.
 */
export async function localOrigin(): Promise<LocalOrigin> {
  const filePath = originIdFile();
  let pending = idCache.get(filePath);
  if (pending === undefined) {
    pending = readOrCreateOriginId(filePath);
    idCache.set(filePath, pending);
    // A failed read must not be cached: a corrupt file that gets repaired
    // should be picked up by the next call.
    pending.catch(() => { idCache.delete(filePath); });
  }
  return { id: await pending, name: os.hostname() };
}
