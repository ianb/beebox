/**
 * Child process for the bounded-parse regression doctest: parses a session log
 * under a small `--max-old-space-size` cap and reports what it retained.
 *
 * Runs in its own process on purpose — the point of the test is that a heap
 * ceiling the parse must respect is enforced by the OS/V8, not by an
 * in-process assertion the parse could pass while still allocating the world.
 *
 * argv: <logPath> <sliceJson>. Prints one JSON line on stdout.
 */

import { parseSessionLog, type SessionLogSlice } from "../../src/cli/lib/session.js";
import { errorMessage } from "../../src/lib/error-guards.js";

const [, , logPath, sliceJson] = process.argv;
if (logPath === undefined || sliceJson === undefined) {
  console.error("usage: parse-session-log-child.ts <logPath> <sliceJson>");
  process.exit(2);
}

// Parse boundary: the slice arrives as argv text from the test that spawned us.
// eslint-disable-next-line no-restricted-syntax -- parse boundary: argv JSON is untyped; the only producer is the doctest
const slice = JSON.parse(sliceJson) as SessionLogSlice;

try {
  const result = await parseSessionLog({ logPath, slice });
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
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
    })}\n`,
  );
} catch (e) {
  console.error(`parse failed: ${errorMessage(e)}`);
  process.exit(1);
}
