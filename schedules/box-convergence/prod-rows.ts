/**
 * The shape of one drifted box, and the parse of the production probe's output.
 *
 * Its own module because `run.ts` is a script: importing it to reach the parse
 * would run the whole report, ssh included. A test needs the function, not the
 * schedule.
 */

export interface Drift {
  readonly box: string;
  readonly pending: string[];
  readonly dirty: boolean;
  readonly where: "local" | "prod";
}

/**
 * Parse the remote script's `name<TAB>dirtyCount<TAB>pending,names` lines.
 *
 * Separate and exported so a behind box can be tested without one existing: the
 * prod fleet is converged most days, so the only way this parse gets exercised
 * on real data is the day it matters.
 */
export function parseProdRows(stdout: string): Drift[] {
  const rows: Drift[] = [];
  for (const line of stdout.split("\n")) {
    const [box, dirty, names] = line.split("\t");
    if (box === undefined || box === "" || dirty === undefined) continue;
    // `(none — manifest is up to date)` is the up-to-date marker, not a name.
    const pending = (names ?? "").split(",").map((n) => n.trim()).filter((n) => n !== "" && !n.startsWith("("));
    if (pending.length === 0) continue;
    rows.push({ box, pending, dirty: dirty !== "0", where: "prod" });
  }
  return rows;
}
