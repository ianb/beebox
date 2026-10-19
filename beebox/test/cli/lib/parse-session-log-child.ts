/**
 * Child process for the bounded-parse regression tests: parses a session log
 * and reports how much heap the parse kept alive.
 *
 * Runs in its own process so the measurement sees only tsx, the module graph,
 * and the parse — not the test runner's own heap.
 *
 * argv: <logPath> <sliceJson>. Prints one JSON line on stdout. Needs
 * `--expose-gc`; `parse-in-child.ts` spawns it.
 */

import { parseSessionLog, type SessionLogSlice } from "../../../src/cli/lib/session.js";
import { errorMessage } from "../../../src/shared/error-guards.js";

const [, , logPath, sliceJson] = process.argv;
if (logPath === undefined || sliceJson === undefined) {
  console.error("usage: parse-session-log-child.ts <logPath> <sliceJson>");
  process.exit(2);
}

// Parse boundary: the slice arrives as argv text from the test that spawned us.
// eslint-disable-next-line no-restricted-syntax -- parse boundary: argv JSON is untyped; the only producer is the test
const slice = JSON.parse(sliceJson) as SessionLogSlice;

const gc = globalThis.gc;
if (gc === undefined) {
  console.error("parse-session-log-child.ts needs --expose-gc");
  process.exit(2);
}
/** Live heap: what survives a full collection. GC timing cannot move it. */
const liveMb = (): number => {
  gc();
  return process.memoryUsage().heapUsed / (1024 * 1024);
};

/**
 * How often to sample the live heap while the parse runs. The file stream
 * yields to the event loop between chunks, so the timer fires mid-parse. Each
 * sample is a live-set measurement; scheduling only decides which moments get
 * sampled. A bounded parse is under its bound at every moment, so a late or
 * missed sample can only hide a regression, never fail a correct parse.
 */
const SAMPLE_GAP_MS = 50;

try {
  const before = liveMb();
  let peak = before;
  // A chain rather than an interval: the next sample waits a full gap after
  // the last collection finished, so sampling cannot crowd out the parse.
  let sampler: NodeJS.Timeout;
  const sample = (): void => {
    peak = Math.max(peak, liveMb());
    sampler = setTimeout(sample, SAMPLE_GAP_MS);
  };
  sampler = setTimeout(sample, SAMPLE_GAP_MS);
  let result;
  try {
    result = await parseSessionLog({ logPath, slice });
  } finally {
    clearTimeout(sampler);
  }
  // `result` is still referenced below, so this counts what the parse retained.
  const after = liveMb();
  peak = Math.max(peak, after);
  const stubs = result.entries.filter((e) =>
    e.content.some((b) => b.type === "text" && b.text?.startsWith("[message too large")),
  );
  process.stdout.write(
    `${JSON.stringify({
      entries: result.entries.length,
      total: result.total,
      hasMore: result.hasMore,
      stubs: stubs.length,
      stubSample: stubs[0]?.content[0]?.text ?? null,
      retainedMb: Math.round(after - before),
      peakLiveMb: Math.round(peak - before),
    })}\n`,
  );
} catch (e) {
  console.error(`parse failed: ${errorMessage(e)}`);
  process.exit(1);
}
