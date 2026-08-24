/**
 * The only clock a simulated user is allowed to read.
 *
 * Not the wall clock, which for them is meaningless: most of a walk's elapsed time is
 * the walker writing notes, and a person who consults `date` concludes an evening has
 * passed when the app has kept them waiting four minutes. One did exactly that —
 * recorded "it answered (after about 20 minutes)" during a session that had run six,
 * having stamped every entry by feel.
 *
 * This reports the time they have spent *waiting on the app*, which is the quantity a
 * real person actually experiences and the only one worth their judgement. Their own
 * reading, typing and deciding is theirs and costs them nothing they would resent.
 *
 * Usage: pnpm exec tsx callback-box/user-stories/journeys/clock.ts <box-content-path>
 */
import { agentTiming } from "./agent-time.ts";

const boxContent = process.argv[2];
if (boxContent === undefined) {
  console.error("usage: clock.ts <box-content-path>");
  process.exit(1);
}

const t = agentTiming(boxContent);

if (t.turns.length === 0) {
  console.log("You have not waited on it at all yet.");
} else {
  const total = Math.round(t.totalSeconds);
  const spent = total < 90 ? `${total} seconds` : `${(total / 60).toFixed(1)} minutes`;
  console.log(`Waiting on it so far: ${spent}, across ${t.turns.length} question(s).`);
  console.log(`Its last answer took ${Math.round(t.turns.at(-1) ?? 0)}s. Typical: ${Math.round(t.medianSeconds)}s. Slowest: ${Math.round(t.slowestSeconds)}s.`);
}
