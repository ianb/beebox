export interface ConfirmResult {
  content: string;
  close: boolean;
  workstream: string;
}

/** The issue file does not open with a `---` YAML frontmatter block. */
class MissingFrontmatterError extends Error {
  constructor() {
    super("issue has no YAML frontmatter");
    this.name = "MissingFrontmatterError";
  }
}

/** The frontmatter carries no `workstream:` field. */
class MissingWorkstreamError extends Error {
  constructor() {
    super("issue has no workstream");
    this.name = "MissingWorkstreamError";
  }
}

/** The issue is not awaiting manual testing (no `needs:`, or no `manual-testing` in it). */
class NotAwaitingManualTestingError extends Error {
  constructor() {
    super("issue does not need manual testing");
    this.name = "NotAwaitingManualTestingError";
  }
}

/** The `needs:` field is neither an inline `[a, b]` list nor a block list. */
class NeedsNotAListError extends Error {
  constructor() {
    super("needs must be a list");
    this.name = "NeedsNotAListError";
  }
}

/** The issue body has no `## Manual testing` heading to record the verification under. */
class MissingManualTestingSectionError extends Error {
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
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) throw new MissingFrontmatterError();
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
  let frontmatterEnd = lines.indexOf("---", 1);
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
