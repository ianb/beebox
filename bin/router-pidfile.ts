// Per-worktree PID files, with per-name in-process serialization.
//
// Each worktree's pidfile (`<PID_DIR>/<name>.json`) is single-slot: it holds
// only the *current* generation's PIDs, no history (invariant #1 of
// bin/docs/router-protocol.md). `remove`'s generation guard reads the on-disk
// record and skips the unlink unless the PIDs match what the caller thinks it's
// tearing down — but that read-compare-then-unlink is three separate awaits, so
// on its own it is TOCTOU: generation N+1's `write` can land between N's read
// and N's unlink and still lose its record (invariant #6). The fix is here, not
// at the call sites: every `write`/`remove` for a given name runs through a
// per-name promise chain, so a `remove`'s read+unlink is atomic relative to any
// `write` for the same name. bin/ can't import callback-box internals, so this
// is a local, minimal restatement of the `withCardLock` in-process-serialization
// pattern (callback-box/src/lib/card-lock.ts).

import path from "node:path";
import fs from "node:fs/promises";

export interface PidRecord {
  name: string;
  vitePid: number | undefined;
  fastifyPid: number | undefined;
  frontendPort: number;
  backendPort: number;
  dashboardPort: number | null;
  socketDir: string;
  profileDir: string;
  routerPid: number;
  startedAt: number;
}

/** The generation identity a `remove` verifies against the on-disk record. */
export interface PidExpectation {
  vitePid: number | undefined;
  fastifyPid: number | undefined;
}

export interface PidStore {
  write(name: string, data: PidRecord): Promise<void>;
  /** Remove `<name>.json`. With `expect`, skip the unlink unless the on-disk
   *  record's PIDs match (a newer generation owns the slot — leave it alone).
   *  Without `expect`, always unlink (generation-agnostic, e.g. full shutdown). */
  remove(name: string, expect?: PidExpectation): Promise<void>;
}

/**
 * The filesystem operations the store performs, injectable so the invariant-#6
 * serialization test can gate reads/writes/unlinks on test-controlled barriers
 * (the real per-name promise chain is the thing under test; a synchronous fake
 * couldn't force the read-then-unlink interleaving the serialization prevents).
 * Defaults to real `node:fs/promises`.
 */
export interface PidStoreFs {
  mkdir(dir: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const realFs: PidStoreFs = {
  mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => {}),
  readFile: (p) => fs.readFile(p, "utf8"),
  writeFile: (p, content) => fs.writeFile(p, content),
  unlink: (p) => fs.unlink(p),
};

export function createPidStore(pidDir: string, backendFs?: PidStoreFs): PidStore {
  const backend = backendFs ?? realFs;
  // One serialization chain per worktree name. The stored tail swallows
  // outcomes so a failed op neither wedges the chain nor surfaces as an
  // unhandled rejection; the promise handed back to the caller still carries
  // the real result/rejection.
  const chains = new Map<string, Promise<void>>();

  function serialize<T>(name: string, op: () => Promise<T>): Promise<T> {
    const prev = chains.get(name) ?? Promise.resolve();
    const result = prev.then(op, op);
    const tail = result.then(
      () => {},
      () => {},
    );
    chains.set(name, tail);
    // Prune once settled so the map doesn't retain one promise per name forever
    // — but only if no newer op has since chained on and replaced the tail.
    void tail.then(() => {
      if (chains.get(name) === tail) chains.delete(name);
    });
    return result;
  }

  async function writeImpl(name: string, data: PidRecord): Promise<void> {
    await backend.mkdir(pidDir);
    await backend.writeFile(path.join(pidDir, `${name}.json`), JSON.stringify(data, null, 2));
  }

  async function removeImpl(name: string, expect: PidExpectation | undefined): Promise<void> {
    const fullPath = path.join(pidDir, `${name}.json`);
    if (expect) {
      try {
        // JSON.parse returns `any`; the annotation narrows it at this parse
        // boundary without an `as` cast (matching sweepStaleChildren's shape).
        const data: Partial<PidRecord> = JSON.parse(await backend.readFile(fullPath));
        if (data.vitePid !== expect.vitePid || data.fastifyPid !== expect.fastifyPid) {
          // A newer generation owns the slot now — leave it alone.
          return;
        }
      } catch (_e) {
        // Missing or unreadable — fall through to the unlink (a no-op if gone).
      }
    }
    try {
      await backend.unlink(fullPath);
    } catch (_e) {
      // Already gone — fine.
    }
  }

  return {
    write: (name, data) => serialize(name, () => writeImpl(name, data)),
    remove: (name, expect) => serialize(name, () => removeImpl(name, expect)),
  };
}
