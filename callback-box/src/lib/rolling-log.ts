/**
 * Append to a rolling log file, truncating to its last half (at the next
 * line boundary) once it exceeds a byte cap. Shared by every "durable,
 * restart-surviving diagnostic file" — the client-debug log and the hub's
 * per-box child-output log both want the same truncate-in-place behavior.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const MAX_LOG_FILE_BYTES = 100_000;

/** Serializes concurrent `appendRollingLog` calls per file path -- each call
 *  chains off the prior in-flight promise for the same path so mkdir/append/
 *  stat/truncate steps from overlapping calls can't interleave. Cleared once
 *  a path's chain drains so the map doesn't grow unbounded. */
const pendingAppends = new Map<string, Promise<void>>();

export function appendRollingLog(filePath: string, content: string): Promise<void> {
  return chainAppend(filePath, () => appendRollingLogUnserialized({ filePath, content, strict: false }));
}

/**
 * Strict variant: rejects on filesystem failure instead of swallowing it.
 * For callers whose contract depends on a 2xx meaning "durably written" —
 * a mutation that fails here must propagate the error so the caller (and, up
 * the chain, its own caller) knows the write did not happen.
 */
export function appendRollingLogStrict(filePath: string, content: string): Promise<void> {
  return chainAppend(filePath, () => appendRollingLogUnserialized({ filePath, content, strict: true }));
}

/** Thrown by {@link appendRollingLogStrict} when the underlying write fails. */
class RollingLogWriteError extends Error {
  constructor(readonly filePath: string, options: { cause: unknown }) {
    super(`Failed to append to rolling log ${filePath}`, options);
    this.name = "RollingLogWriteError";
  }
}

function chainAppend(filePath: string, run: () => Promise<void>): Promise<void> {
  const previous = pendingAppends.get(filePath) ?? Promise.resolve();
  const current = previous.then(run, run);
  const cleanedUp = current.finally(() => {
    if (pendingAppends.get(filePath) === current) {
      pendingAppends.delete(filePath);
    }
  });
  pendingAppends.set(filePath, current);
  return cleanedUp;
}

async function appendRollingLogUnserialized(
  { filePath, content, strict }: { filePath: string; content: string; strict: boolean },
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, content);
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_LOG_FILE_BYTES) {
      const text = await fs.readFile(filePath, "utf-8");
      const half = text.slice(text.length / 2);
      const firstNewline = half.indexOf("\n");
      await fs.writeFile(filePath, firstNewline !== -1 ? half.slice(firstNewline + 1) : half);
    }
  } catch (e) {
    if (strict) throw new RollingLogWriteError(filePath, { cause: e });
    // Don't let log-file failures break the caller.
  }
}
