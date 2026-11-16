import * as fs from "node:fs";
import * as path from "node:path";

import { frontmatterFence } from "../beebox/src/cards/frontmatter.js";
import { moveDoc, type DocMoveNotice, type StagePaths } from "./lib/doc-move.js";

export interface ConfirmResult {
  content: string;
  close: boolean;
  workstream: string;
}

/** A refusal to confirm: the issue is not in a confirmable shape. */
export class ConfirmTestedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmTestedError";
  }
}

/** The issue file does not open with a `---` YAML frontmatter block. */
class MissingFrontmatterError extends ConfirmTestedError {
  constructor() {
    super("issue has no YAML frontmatter");
    this.name = "MissingFrontmatterError";
  }
}

/** The frontmatter carries no `workstream:` field. */
class MissingWorkstreamError extends ConfirmTestedError {
  constructor() {
    super("issue has no workstream");
    this.name = "MissingWorkstreamError";
  }
}

/** The issue is not awaiting manual testing (no `needs:`, or no `manual-testing` in it). */
class NotAwaitingManualTestingError extends ConfirmTestedError {
  constructor() {
    super("issue does not need manual testing");
    this.name = "NotAwaitingManualTestingError";
  }
}

/** The `needs:` field is neither an inline `[a, b]` list nor a block list. */
class NeedsNotAListError extends ConfirmTestedError {
  constructor() {
    super("needs must be a list");
    this.name = "NeedsNotAListError";
  }
}

/** The issue body has no `## Manual testing` heading to record the verification under. */
class MissingManualTestingSectionError extends ConfirmTestedError {
  constructor() {
    super("issue has no Manual testing section");
    this.name = "MissingManualTestingSectionError";
  }
}

export function confirmTestedContent(
  source: string,
  date: string,
): ConfirmResult {
  const lines = source.split("\n");
  const fence = frontmatterFence(source);
  if (fence === null) throw new MissingFrontmatterError();
  const end = fence.closingLine;
  const workstream = /^workstream:\s*([\w-]+)\s*$/m.exec(
    lines.slice(1, end).join("\n"),
  )?.[1];
  if (!workstream) throw new MissingWorkstreamError();
  const needsIndex = lines
    .slice(1, end)
    .findIndex((line) => /^needs:/.test(line));
  if (needsIndex === -1) throw new NotAwaitingManualTestingError();
  const actualIndex = needsIndex + 1;
  const match = /^needs:\s*\[([^\]]*)]\s*$/.exec(lines[actualIndex] ?? "");
  let needs: string[];
  let needsEnd = actualIndex + 1;
  let block = false;
  if (match) {
    needs = (match[1] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (/^needs:\s*$/.test(lines[actualIndex] ?? "")) {
    block = true;
    needs = [];
    while (needsEnd < end) {
      const item = /^\s+-\s+(.+?)\s*$/.exec(lines[needsEnd] ?? "");
      if (!item) break;
      needs.push(item[1] ?? "");
      needsEnd++;
    }
  } else {
    throw new NeedsNotAListError();
  }
  const remaining = needs.filter((item) => item !== "manual-testing");
  if (remaining.length === needs.length)
    throw new NotAwaitingManualTestingError();
  if (remaining.length > 0) {
    const replacement = block
      ? ["needs:", ...remaining.map((item) => `  - ${item}`)]
      : [`needs: [${remaining.join(", ")}]`];
    lines.splice(actualIndex, needsEnd - actualIndex, ...replacement);
  } else {
    lines.splice(actualIndex, needsEnd - actualIndex);
  }
  let frontmatterEnd = frontmatterFence(lines.join("\n"))?.closingLine ?? -1;
  if (
    remaining.length === 0 &&
    !lines.slice(1, frontmatterEnd).some((line) => /^resolution:/.test(line))
  ) {
    lines.splice(frontmatterEnd, 0, "resolution: implemented");
    frontmatterEnd++;
  }
  const heading = lines.findIndex(
    (line, index) => index > frontmatterEnd && line === "## Manual testing",
  );
  if (heading === -1) throw new MissingManualTestingSectionError();
  lines.splice(heading + 1, 0, "", `> Verified by boxholder ${date}`);
  return {
    content: lines.join("\n"),
    close: remaining.length === 0,
    workstream,
  };
}

export interface AppliedConfirmation {
  close: boolean;
  workstream: string;
  /** Paths to stage and commit, by repository, in that repository's terms. */
  stage: StagePaths;
  notices: DocMoveNotice[];
}

/**
 * Confirm manual testing for the open issue at `issue` (repo-relative) in the
 * checkout at `repoRoot`. When the last need goes, the issue moves into
 * `issues/closed/` through the shared move (`bin/lib/doc-move.ts`), which
 * rewrites every inbound reference and stages nothing. Every refusal (the
 * content checks, an unsafe reference, a dirty file in either repository)
 * happens before any write.
 */
export function applyConfirmTested({ repoRoot, issue, date }: { repoRoot: string; issue: string; date: string }): AppliedConfirmation {
  const confirmed = confirmTestedContent(fs.readFileSync(path.join(repoRoot, issue), "utf8"), date);
  if (!confirmed.close) {
    fs.writeFileSync(path.join(repoRoot, issue), confirmed.content, "utf8");
    return { close: false, workstream: confirmed.workstream, stage: { public: [issue], private: [] }, notices: [] };
  }
  const result = moveDoc({
    repoRoot,
    from: issue,
    to: path.posix.join("issues/closed", path.posix.relative("issues", issue)),
    dryRun: false,
    refuseDirty: true,
    // The same edit, applied after the moved file's own links are re-expressed.
    editMoved: (content) => confirmTestedContent(content, date).content,
  });
  return { close: true, workstream: confirmed.workstream, stage: result.stage, notices: result.notices };
}
