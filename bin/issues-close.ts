/**
 * `bin/issues close` — the "Closed items" procedure in `issues/AGENTS.md` as
 * one command: move the issue into `closed/<category>/`, set `resolution:`
 * and `workstream:`, add the closing note, and rewrite every reference to the
 * moved file (`bin/lib/doc-move.ts`), printing each one.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { REPO_ROOT, loadIssueEntries } from "../workstreams-app/src/server/main/issue-search-model.js";
import { frontmatterFence } from "../beebox/src/cards/frontmatter.js";
import { relocateLinks } from "../beebox/src/dev/doc-check/link-repair.js";
import { formatDocMove, moveDoc } from "./lib/doc-move.js";
import { assignIssueWorkstream } from "./assign-issue-workstream.js";
import { workstreamFromBranch } from "./commit-provenance.js";
import { localDate } from "./deferred-issues.js";
import { oneOf, type ParsedValues } from "./issues-args.js";
import { resolveEntry } from "./issues-context.js";
import {
  AlreadyClosedIssueError, BrokenNoteLinkError, ManualTestingCloseError, MissingClosePathError,
  MissingIssueFrontmatterError, MissingNoteError, MissingResolutionError, MultipleWorkstreamsError,
} from "./issues-errors.js";
import { emitJson } from "./issues-output.js";

export const RESOLUTIONS = ["implemented", "wontfix", "superseded"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * The closed issue's source: `resolution:` set (replaced, or added as the
 * last frontmatter line), `workstream:` set when one is given, and the note
 * as the first body paragraph.
 */
export function closedSource(source: string, close: {
  resolution: Resolution; workstream: string | null; note: string; date: string;
}): string {
  const withWorkstream = close.workstream === null ? source : assignIssueWorkstream(source, close.workstream);
  const fence = frontmatterFence(withWorkstream);
  if (fence === null) throw new MissingIssueFrontmatterError();
  const lines = withWorkstream.split("\n");
  const frontmatter = lines.slice(0, fence.closingLine);
  const existing = frontmatter.findIndex((line) => /^resolution:/u.test(line));
  if (existing === -1) frontmatter.push(`resolution: ${close.resolution}`);
  else frontmatter[existing] = `resolution: ${close.resolution}`;
  const body = lines.slice(fence.closingLine + 1);
  while (body[0]?.trim() === "") body.shift();
  const note = `**Closed (${close.resolution}, ${close.date}):** ${close.note.trim()}`;
  return [...frontmatter, lines[fence.closingLine] ?? "---", "", note, "", ...body].join("\n");
}

function currentBranch(): string | null {
  try {
    return execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch (_e) {
    /* ignore: detached HEAD — symbolic-ref exits 1, and no branch means no workstream */
    return null;
  }
}

// Relative links in the note are written from the closed location; one that
// resolves nowhere from there is refused before anything moves.
function assertNoteLinksResolve(note: string, closedRel: string): void {
  const broken: string[] = [];
  relocateLinks({
    resolveFrom: closedRel,
    writeFrom: closedRel,
    content: note,
    relocate: (target) => {
      if (!fs.existsSync(path.join(REPO_ROOT, target))) broken.push(target);
      return target; // same path from the same file: the link is left as written
    },
  });
  if (broken.length > 0) throw new BrokenNoteLinkError(closedRel, broken);
}

export async function commandClose(values: ParsedValues, positionals: string[]): Promise<void> {
  const needle = positionals[0];
  if (needle === undefined) throw new MissingClosePathError();
  if (values.resolution === undefined) throw new MissingResolutionError();
  const resolution = oneOf({ value: values.resolution, allowed: RESOLUTIONS, flag: "--resolution" });
  const note = values.note?.trim() ?? "";
  if (note === "") throw new MissingNoteError();
  const flagged = values.workstream ?? [];
  if (flagged.length > 1) throw new MultipleWorkstreamsError();
  const workstream = flagged[0] ?? workstreamFromBranch(currentBranch() ?? "");

  const entry = resolveEntry(await loadIssueEntries({ repoRoot: REPO_ROOT }), needle);
  if (entry.closed) throw new AlreadyClosedIssueError(entry.path);
  if (entry.needs.includes("manual-testing")) throw new ManualTestingCloseError(entry.path);
  const root = entry.visibility === "private" ? "private-issues" : "issues";
  const to = `${root}/closed/${entry.category}/${path.posix.basename(entry.path)}`;
  assertNoteLinksResolve(note, to);

  const dryRun = values["dry-run"] === true;
  const plan = moveDoc({
    repoRoot: REPO_ROOT,
    from: entry.path,
    to,
    dryRun,
    editMoved: (content) => closedSource(content, { resolution, workstream, note, date: localDate(new Date()) }),
  });
  if (values.json === true) {
    emitJson({ ...plan, moved: { ...plan.moved, content: undefined }, files: plan.files.map((f) => ({ ...f, content: undefined })), workstream });
    return;
  }
  const report = formatDocMove(plan, { dryRun });
  process.stdout.write(report.stdout);
  process.stdout.write(workstream === null ? `workstream: kept ${entry.workstream} (no --workstream and not on a worktree branch)\n` : `workstream: ${workstream}\n`);
  process.stderr.write(report.stderr);
}
