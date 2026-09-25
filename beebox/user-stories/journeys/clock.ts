/**
 * The only clock a simulated user is allowed to read.
 *
 * Not the wall clock, which for them is meaningless: most of a walk's elapsed time is
 * the walker writing notes, and a person who consults `date` concludes an evening has
 * passed when the app has kept them waiting four minutes. One did exactly that —
 * recorded "it answered (after about 20 minutes)" during a session that had run six,
 * having stamped every entry by feel.
 *
 * This reports Claude root-chat time until first assistant text only. It excludes
 * scoped chats, other engines, and the wait after a preamble until completion.
 * It is a partial latency observation, not the person's total waiting time.
 *
 * Usage: pnpm exec tsx beebox/user-stories/journeys/clock.ts <box-root>
 */
import { agentTiming } from "./agent-time.ts";

const boxContent = process.argv[2];
if (boxContent === undefined) {
  console.error("usage: clock.ts <box-root>");
  process.exit(1);
}

const t = agentTiming(boxContent);

if (t.turns.length === 0) {
  console.log("No completed first-response intervals found in Claude root-chat transcripts; waiting time is unavailable.");
} else {
  const total = Math.round(t.totalSeconds);
  const spent = total < 90 ? `${total} seconds` : `${(total / 60).toFixed(1)} minutes`;
  console.log(`Claude root-chat time to first text: ${spent}, across ${t.turns.length} question(s).`);
  console.log(`Its last first response took ${Math.round(t.turns.at(-1) ?? 0)}s. Typical: ${Math.round(t.medianSeconds)}s. Slowest: ${Math.round(t.slowestSeconds)}s.`);
}

console.log("Timing excludes scoped chats, other engines, and full answer completion.");
