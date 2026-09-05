/**
 * Per-slug recency persistence for a lazy `bbx hub` running with
 * `keepRecent > 0` (see `hub-config.ts`). The supervisor records each box's
 * last-activity time here; on the next hub boot (every deploy restarts it)
 * `Supervisor.startAll()` reads it back to decide which boxes to pre-start
 * rather than starting everything or nothing.
 *
 * This lives outside `supervisor.ts` deliberately — that file is already at
 * the module's size budget, and recency persistence is a self-contained
 * concern (a debounced, best-effort JSON write) with its own error policy.
 *
 * On-disk shape (`hub-state.json`, a sibling of the loaded config file):
 *
 *   { "version": 1, "lastActivity": { "<slug>": <epochMs>, ... } }
 *
 * Everything here is best-effort: a missing file is normal (first boot), a
 * corrupt one is warned-about-and-ignored, and a write failure is warned once
 * and then swallowed. Recency is a hint for which boxes to keep warm, never
 * correctness-critical — a hub that can't read or write it just falls back to
 * pure idle-stop.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { errnoCode, errorMessage } from "../lib/error-guards.js";

const STATE_VERSION = 1;
/** At most one persisted write per this interval — recency is a coarse hint,
 *  not worth an fs write on every single request. Shutdown bypasses it via
 *  `flush()`. */
const WRITE_DEBOUNCE_MS = 30_000;

const stateFileSchema = z.strictObject({
  version: z.literal(STATE_VERSION),
  lastActivity: z.record(z.string(), z.number()),
});

type PersistedState = z.infer<typeof stateFileSchema>;

export interface HubStateOptions {
  /** The loaded hub config's path — `hub-state.json` is written beside it. */
  configPath: string;
  /** Injectable clock (defaults to `Date.now`) so a lazy hub and its doctests
   *  share one time source. */
  now?: () => number;
}

/** `hub-state.json`, a sibling of the loaded config file. */
function hubStatePath(configPath: string): string {
  return path.join(path.dirname(configPath), "hub-state.json");
}

/**
 * In-memory per-slug last-activity times, backed by a debounced best-effort
 * write to `hub-state.json`. Construct it (cheap, touches no disk), call
 * `load()` once at boot to read persisted values, `record()` on each
 * activity, and `flush()` on shutdown.
 */
export class HubState {
  private readonly statePath: string;
  private readonly now: () => number;
  private readonly lastActivityBySlug = new Map<string, number>();
  private writeTimer: NodeJS.Timeout | undefined;
  private warnedWriteFailure = false;
  /** Serializes writes so a debounced write still in flight when `flush()`
   *  runs can't finish AFTER the flush and clobber it with a stale snapshot.
   *  `write()` never rejects, so the chain never breaks. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: HubStateOptions) {
    this.statePath = hubStatePath(options.configPath);
    this.now = options.now ?? Date.now;
  }

  /** Read persisted activity from disk into memory. Missing file → silent
   *  no-op (normal first boot); corrupt/unreadable → `console.warn` and
   *  no-op. Never throws. */
  async load(): Promise<void> {
    const persisted = await readState(this.statePath);
    for (const [slug, ts] of persisted) this.lastActivityBySlug.set(slug, ts);
  }

  /** Record `slug`'s activity as "now" in memory and schedule a debounced
   *  write. */
  record(slug: string): void {
    this.lastActivityBySlug.set(slug, this.now());
    this.scheduleWrite();
  }

  /** Persisted last-activity time for `slug`, or `undefined` if unknown. */
  lastActivity(slug: string): number | undefined {
    return this.lastActivityBySlug.get(slug);
  }

  /** Known slugs, most-recently-active first. */
  slugsByRecency(): string[] {
    return Array.from(this.lastActivityBySlug.entries())
      .toSorted(([, a], [, b]) => b - a)
      .map(([slug]) => slug);
  }

  /** Write pending activity to disk immediately (shutdown path), cancelling
   *  any debounced write. Best-effort — never throws. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    await this.enqueueWrite();
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void this.enqueueWrite();
    }, WRITE_DEBOUNCE_MS);
    this.writeTimer.unref();
  }

  /** Append a write to the chain; each write snapshots the map when IT runs,
   *  so the last-enqueued write always lands with the freshest state. */
  private enqueueWrite(): Promise<void> {
    this.writeChain = this.writeChain.then(() => this.write());
    return this.writeChain;
  }

  private async write(): Promise<void> {
    const payload: PersistedState = {
      version: STATE_VERSION,
      lastActivity: Object.fromEntries(this.lastActivityBySlug),
    };
    try {
      // Temp-file + rename so a reader (or a crash mid-write) never sees a
      // half-written JSON file. rename() is atomic within the directory.
      const tmpPath = `${this.statePath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2));
      await fs.rename(tmpPath, this.statePath);
    } catch (e) {
      // Best-effort: recency is a warm-start hint, not correctness-critical, so
      // a failed write must not crash the hub. Warn once so a persistently
      // unwritable state dir is visible without spamming the log every 30s.
      if (!this.warnedWriteFailure) {
        this.warnedWriteFailure = true;
        console.warn(
          `Could not persist hub state to ${this.statePath}: ${errorMessage(e)} ` +
            "(recency-based keep-alive will not survive a restart; further write " +
            "failures suppressed)"
        );
      }
    }
  }
}

/** Read and validate `hub-state.json` into a slug→epochMs map. Any failure
 *  (missing/unreadable/corrupt/wrong-shape) degrades to an empty map;
 *  everything but a missing file also warns. */
async function readState(statePath: string): Promise<Map<string, number>> {
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return new Map(); // normal first boot
    console.warn(`Could not read hub state at ${statePath}: ${errorMessage(e)} (ignoring)`);
    return new Map();
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.warn(`Hub state at ${statePath} is not valid JSON (ignoring): ${errorMessage(e)}`);
    return new Map();
  }

  const parsed = stateFileSchema.safeParse(json);
  if (!parsed.success) {
    console.warn(`Hub state at ${statePath} has an unexpected shape (ignoring): ${parsed.error.message}`);
    return new Map();
  }
  return new Map(Object.entries(parsed.data.lastActivity));
}
