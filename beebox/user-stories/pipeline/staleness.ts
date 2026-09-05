/**
 * Which catalogued capabilities has the code moved out from under?
 *
 * Every story records the files that implement it, so git already knows which claims are suspect —
 * no manual bookkeeping, and it catches drift from any change, not just ones somebody filed an
 * issue about. This turns "the catalog is 1,252 commits old" into "these 47 stories cite files that
 * changed since they were checked", which is a work list rather than a vague warning.
 *
 * It is a PRIORITIZER, not an oracle. Three honest limits:
 *
 *  - `files` is the handful of paths a reader cited, not the complete implementation. A story can
 *    break from a change to a file it never named, and this will not see it.
 *  - It over-reports. A comment edit, a rename, or a formatting pass touches a file without
 *    changing behaviour.
 *  - It cannot see capability that was ADDED. Nothing is stale about a story that does not exist
 *    yet; only a full regeneration finds those.
 *  - `git log --name-only` without `-m` does not list files for merge commits, and a cited file
 *    that was RENAMED reads as untouched under its old path. Both mean this under-reports; a
 *    regeneration is the backstop, not this.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Cited paths are monorepo-relative ("beebox/src/..."), so git has to run from the root
// regardless of where the caller invoked this from.
const MONO_ROOT = resolve(import.meta.dirname, "../../..");

export interface StaleInput {
  id: string
  title: string
  group: string
  files: string[]
  lastChecked?: string
}

export interface StaleStory {
  id: string
  title: string
  group: string
  touched: string[]
  commits: number
  since: string
}

/**
 * One git call, not one per story: file -> the dates it changed on, so each story can be compared
 * against its own `lastChecked` rather than a single global cutoff.
 */
function changesSince(since: string): Map<string, string[]> {
  const out = execFileSync(
    "git",
    ["log", `--since=${since}`, "--name-only", "--pretty=format:%x00%ad", "--date=short", "--", "beebox/"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: MONO_ROOT },
  );
  const byFile = new Map<string, string[]>();
  let current = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("\0")) {
      current = line.slice(1).trim();
      continue;
    }
    const file = line.trim();
    if (file === "" || current === "") continue;
    const dates = byFile.get(file);
    if (dates === undefined) byFile.set(file, [current]);
    else dates.push(current);
  }
  return byFile;
}

/** Stories whose cited files changed after the story was last checked, most-churned first. */
export function staleStories(records: StaleInput[], fallbackDate: string): StaleStory[] {
  const earliest = records.reduce<string>((acc, r) => {
    const checked = r.lastChecked === undefined ? fallbackDate : r.lastChecked;
    return checked < acc ? checked : acc;
  }, fallbackDate);

  const byFile = changesSince(earliest);
  const stale: StaleStory[] = [];

  for (const r of records) {
    const since = r.lastChecked === undefined ? fallbackDate : r.lastChecked;
    const touched: string[] = [];
    let commits = 0;
    for (const f of r.files) {
      const dates = byFile.get(f);
      if (dates === undefined) continue;
      // `>=`, not `>`: git dates are day-resolution, so a change made after a same-day recheck
      // would otherwise be invisible. Over-reporting on the day of a check is the safe direction.
      const after = dates.filter((d) => d >= since);
      if (after.length > 0) {
        touched.push(f);
        commits += after.length;
      }
    }
    if (touched.length > 0) stale.push({ id: r.id, title: r.title, group: r.group, touched, commits, since });
  }

  return stale.toSorted((a, b) => (b.commits - a.commits) || a.id.localeCompare(b.id));
}
