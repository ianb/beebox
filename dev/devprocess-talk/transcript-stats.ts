// Weekly counts from the local Claude Code transcripts of this repository and
// its worktrees: how many tool calls drove a browser, in how many sessions, and
// how many shell calls there were in all. Counts only; no transcript content is
// kept. Also counts the screenshots agents published to the exhibit store, by
// file date. Writes data/transcript-stats.json for the explorer. Transcripts
// are kept locally for a limited time, so that series starts where retention
// does; the exhibit store starts in mid-August.
import { createReadStream, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const PROJECTS = join(homedir(), ".claude", "projects");
// Claude Code names a project directory after its path with every "/" turned
// into "-"; the main checkout and its worktrees share this prefix.
const PREFIX = join(homedir(), "src", "beebox").replace(/\//g, "-");
const BROWSER = /bin\/browse|agent-browser|claude-in-chrome/;

// Exhibits: `bin/exhibits` keeps them beside the main checkout, one directory per workstream.
const EXHIBITS = join(homedir(), "src", "workstream-exhibits");

type Week = { date: string; browserCalls: number; browserSessions: number; bashCalls: number; sessions: number; exhibitScreenshots: number };

function* filesUnder(dir: string, ext: string): Generator<string> {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; } // dangling links are left behind by removed worktrees
  for (const e of entries) {
    if (e.isDirectory()) yield* filesUnder(join(dir, e.name), ext);
    else if (e.isFile() && e.name.endsWith(ext)) yield join(dir, e.name);
  }
}

const monday = (ts: string): string => {
  const d = new Date(`${ts.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

type Block = { type?: string; name?: string; input?: { command?: string } };
type Line = { type?: string; timestamp?: string; message?: { content?: Block[] } };

async function main(): Promise<void> {
  const weeks = new Map<string, { browserCalls: number; bashCalls: number; browserSessions: Set<string>; sessions: Set<string>; exhibitScreenshots: number }>();
  const week = (date: string) => {
    let w = weeks.get(date);
    if (!w) { w = { browserCalls: 0, bashCalls: 0, browserSessions: new Set(), sessions: new Set(), exhibitScreenshots: 0 }; weeks.set(date, w); }
    return w;
  };
  for (const png of filesUnder(EXHIBITS, ".png")) week(monday(statSync(png).mtime.toISOString())).exhibitScreenshots++;
  const dirs = readdirSync(PROJECTS).filter((n) => n.startsWith(PREFIX));
  for (const dir of dirs) for (const file of filesUnder(join(PROJECTS, dir), ".jsonl")) {
    const session = basename(file, ".jsonl");
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const raw of rl) {
      if (!raw.includes('"tool_use"')) continue;
      let o: Line;
      try { o = JSON.parse(raw) as Line; } catch { continue; }
      if (o.type !== "assistant" || !o.timestamp) continue;
      for (const b of o.message?.content ?? []) {
        if (b.type !== "tool_use") continue;
        const w = week(monday(o.timestamp));
        let hit = false;
        if (b.name === "Bash") {
          w.bashCalls++; w.sessions.add(session);
          hit = BROWSER.test(b.input?.command ?? "");
        } else if (b.name?.startsWith("mcp__claude-in-chrome")) hit = true;
        if (hit) { w.browserCalls++; w.browserSessions.add(session); }
      }
    }
  }
  const out: Week[] = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, w]) => ({ date, browserCalls: w.browserCalls, browserSessions: w.browserSessions.size, bashCalls: w.bashCalls, sessions: w.sessions.size, exhibitScreenshots: w.exhibitScreenshots }));
  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, "data", "transcript-stats.json"), `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), weeks: out }, null, 1)}\n`);
  for (const w of out) console.log(w.date, w.browserCalls, w.browserSessions, w.bashCalls, w.sessions, w.exhibitScreenshots);
}
await main();
