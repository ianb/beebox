export interface ConfirmResult {
  content: string;
  close: boolean;
  workstream: string;
}

export function confirmTestedContent(
  source: string,
  date: string,
): ConfirmResult {
  const lines = source.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1)
    throw new Error("issue has no YAML frontmatter");
  const workstream = /^workstream:\s*([\w-]+)\s*$/m.exec(
    lines.slice(1, end).join("\n"),
  )?.[1];
  if (!workstream) throw new Error("issue has no workstream");
  const needsIndex = lines
    .slice(1, end)
    .findIndex((line) => /^needs:/.test(line));
  if (needsIndex === -1) throw new Error("issue does not need manual testing");
  const actualIndex = needsIndex + 1;
  const match = /^needs:\s*\[([^\]]*)\]\s*$/.exec(lines[actualIndex] ?? "");
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
    throw new Error("needs must be a list");
  }
  const remaining = needs.filter((item) => item !== "manual-testing");
  if (remaining.length === needs.length)
    throw new Error("issue does not need manual testing");
  if (remaining.length) {
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
  if (heading === -1) throw new Error("issue has no Manual testing section");
  lines.splice(heading + 1, 0, "", `> Verified by boxholder ${date}`);
  return {
    content: lines.join("\n"),
    close: remaining.length === 0,
    workstream,
  };
}
