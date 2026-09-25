/** Filesystem-only boundaries for preparing disposable journey boxes. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { claudeProjectsRoot, encodeProjectDir } from "../../src/core/chat/session/transcript-paths.ts";

class UnreportedJourneyError extends Error {
  constructor({ name, notes, report }: { name: string; notes: string; report: string }) {
    super(`${name} has notes but no after-action report. Read ${notes} and write ${report} before another run. Evidence has been preserved.`);
    this.name = "UnreportedJourneyError";
  }
}

class InvalidJourneyIdError extends Error {
  constructor(id: string) {
    super(`Invalid journey id: ${id}`);
    this.name = "InvalidJourneyIdError";
  }
}

export function assertPreviousRunsReported({ work, journeyDir, id }: { work: string; journeyDir: string; id: string }): void {
  if (!existsSync(work)) return;
  for (const name of readdirSync(work).filter((entry) => entry.startsWith(`${id}-`))) {
    const notes = join(work, name, "notes.md");
    if (!existsSync(notes) || readFileSync(notes, "utf8").trim() === "") continue;
    const report = join(journeyDir, "reports", `${name.slice(id.length + 1)}.md`);
    if (!existsSync(report) || readFileSync(report, "utf8").trim() === "") {
      throw new UnreportedJourneyError({ name, notes, report });
    }
  }
}

/** Avoid both run and box collisions, including transcripts left outside a box. */
export function allocateRun({ work, boxes, id, date }: { work: string; boxes: string; id: string; date?: string }): {
  runDir: string; boxDir: string; boxSlug: string;
} {
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(id)) throw new InvalidJourneyIdError(id);
  const projects = claudeProjectsRoot();
  for (let n = 1; ; n++) {
    const name = `${id}-${date ?? new Date().toISOString().slice(0, 10)}${n === 1 ? "" : `-${n}`}`;
    const runDir = join(work, name);
    const boxSlug = name.toLowerCase();
    const boxDir = join(boxes, boxSlug);
    const transcripts = join(projects, encodeProjectDir(boxDir));
    if (!existsSync(runDir) && !existsSync(boxDir) && !existsSync(transcripts)) return { runDir, boxDir, boxSlug };
  }
}
