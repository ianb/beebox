/**
 * Persisted Tailscale exposure intent (Track B chunk 2 of
 * `docs/implemented-plans/tailscale-expose-and-protect.md`).
 *
 * `cb tailscale setup` records which loopback ports it has fronted with
 * `tailscale serve`; `cb tailscale stop` clears them. The record is durable and
 * machine-level (like the hub's config home) — serve-lifecycle bookkeeping so
 * `cb tailscale stop`/`status` can detect and reconcile drift between the
 * recorded intent and what `tailscale serve` actually fronts.
 *
 * The file lives at `~/.config/cb/tailscale-exposure.json` in the HOME OF THE
 * ACCOUNT THAT RUNS `cb` (override `CB_TAILSCALE_EXPOSURE_FILE` for tests / a
 * shared location). This is a per-user, machine-local record: `cb tailscale
 * setup`/`stop` MUST run as the same account the server runs as — the service
 * account in prod, not root / an admin — or the intent it records lands in a
 * home the reconciliation never reads. See `docs/docker-install.md`.
 *
 * It carries no secret — only a port, the tailnet DNS name, and a timestamp — so
 * it is a normal-mode file, not the 0600 credential store. Writes are crash-safe
 * (temp sibling + fsync + atomic rename + parent-dir fsync) and serialized
 * across processes through the project file lock (`recordExposure`/
 * `clearExposure`), so concurrent setup/stop runs can't lose an entry. Reads are
 * validated through zod at the boundary: a corrupt/unparseable file is a
 * DISTINCT failure, never a silent empty store (principle #4, fail closed).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";

import { errnoCode, errorMessage } from "../lib/error-guards.js";
import { acquireLock, releaseLock } from "../lib/file-lock.js";

const exposureTargetSchema = z.object({
  port: z.number().int().positive(),
  dnsName: z.string(),
  configuredAt: z.string(),
});
export type ExposureTarget = z.infer<typeof exposureTargetSchema>;

const exposureFileSchema = z.object({
  version: z.literal(1),
  targets: z.array(exposureTargetSchema),
});
export type ExposureFile = z.infer<typeof exposureFileSchema>;

/** Thrown by the CLI-facing loader when the exposure file exists but can't be
 *  read or doesn't match the schema — a fail-closed distinct failure. */
class ExposureFileCorruptError extends Error {
  constructor(readonly detail: string) {
    super(`Tailscale exposure file at ${exposureFilePath()} is unreadable: ${detail}`);
    this.name = "ExposureFileCorruptError";
  }
}

export function exposureFilePath(): string {
  return process.env.CB_TAILSCALE_EXPOSURE_FILE ?? path.join(os.homedir(), ".config", "cb", "tailscale-exposure.json");
}

export type ExposureReadResult =
  /** `file: null` means the file does not exist yet (the empty-store case). */
  | { ok: true; file: ExposureFile | null }
  | { ok: false; message: string };

/**
 * Read and validate the exposure file WITHOUT throwing — the non-throwing core
 * `loadExposureFile` wraps. Missing file is `{ ok: true, file: null }`; a
 * read/parse/schema failure is `{ ok: false }`. Synchronous.
 */
function readExposureFileSafe(): ExposureReadResult {
  const file = exposureFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return { ok: true, file: null };
    return { ok: false, message: `cannot read ${file}: ${errorMessage(e)}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, message: `not valid JSON: ${errorMessage(e)}` };
  }
  const parsed = exposureFileSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, file: parsed.data };
}

/**
 * CLI-facing loader: the validated file, or an empty store when it doesn't
 * exist. Throws {@link ExposureFileCorruptError} on a corrupt file — `setup`
 * and `stop` must not silently overwrite a file they couldn't parse.
 */
export function loadExposureFile(): ExposureFile {
  const result = readExposureFileSafe();
  if (!result.ok) throw new ExposureFileCorruptError(result.message);
  return result.file ?? { version: 1, targets: [] };
}

function serialize(file: ExposureFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** fsync a directory so a preceding `rename` into it is durable across power
 *  loss. Best-effort: some platforms (Windows) reject a directory fsync — the
 *  rename+file-fsync already gives us atomicity there, so ignore those errnos. */
function fsyncDir(dir: string): void {
  let fd: number;
  try {
    fd = fs.openSync(dir, "r");
  } catch (_e) {
    return;
  }
  try {
    fs.fsyncSync(fd);
  } catch (_e) {
    /* ignore: directory fsync is unsupported on some platforms — the atomic
       rename already bounds the crash window there. */
  } finally {
    fs.closeSync(fd);
  }
}

/** Crash-safe replace: write a temp sibling, fsync the file, atomically rename
 *  over the target, then fsync the parent directory so the rename itself is
 *  power-loss durable (the file-fsync alone does not persist the dir entry). */
function writeExposureFile(file: ExposureFile): void {
  const target = exposureFilePath();
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, serialize(file));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  fsyncDir(dir);
}

/**
 * Serialize the read-modify-write of the exposure file across processes through
 * the project file lock — two concurrent `setup`/`stop` runs would otherwise
 * lose an entry (an unlocked RMW, the repo's required-locking policy forbids).
 */
async function withExposureLock<T>(fn: () => T): Promise<T> {
  const lockPath = `${exposureFilePath()}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  await acquireLock(lockPath, { op: "tailscale-exposure" });
  try {
    return fn();
  } finally {
    await releaseLock(lockPath);
  }
}

/**
 * Record (or refresh) the exposure entry for `port`. Idempotent: a second call
 * for the same port replaces the existing entry rather than appending a
 * duplicate, so re-running `setup` never grows the file. Locked (cross-process).
 */
export async function recordExposure({ port, dnsName }: { port: number; dnsName: string }): Promise<void> {
  await withExposureLock(() => {
    const file = loadExposureFile();
    const targets = file.targets.filter((t) => t.port !== port);
    targets.push({ port, dnsName, configuredAt: new Date().toISOString() });
    targets.sort((a, b) => a.port - b.port);
    writeExposureFile({ version: 1, targets });
  });
}

/** Remove the exposure entry for `port` (a no-op if none is recorded). Locked. */
export async function clearExposure(port: number): Promise<void> {
  await withExposureLock(() => {
    const file = loadExposureFile();
    const targets = file.targets.filter((t) => t.port !== port);
    if (targets.length === file.targets.length) return;
    writeExposureFile({ version: 1, targets });
  });
}

