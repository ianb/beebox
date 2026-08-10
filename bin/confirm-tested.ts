export interface ConfirmResult {
  content: string;
  close: boolean;
  workstream: string;
}

export function confirmTestedContent(source: string, date: string): ConfirmResult {
  const lines = source.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) throw new Error("issue has no YAML frontmatter");
  const workstream = /^workstream:\s*([\w-]+)\s*$/m.exec(lines.slice(1, end).join("\n"))?.[1];
  if (!workstream) throw new Error("issue has no workstream");
  const needsIndex = lines.slice(1, end).findIndex((line) => /^needs:/.test(line));
  if (needsIndex === -1) throw new Error("issue does not need manual testing");
  const actualIndex = needsIndex + 1;
  const match = /^needs:\s*\[([^\]]*)\]\s*$/.exec(lines[actualIndex] ?? "");
  if (!match) throw new Error("needs must use a flow list");
  const remaining = (match[1] ?? "").split(",").map((item) => item.trim()).filter((item) => item && item !== "manual-testing");
  if (remaining.length === (match[1] ?? "").split(",").filter((item) => item.trim()).length) throw new Error("issue does not need manual testing");
  if (remaining.length) lines[actualIndex] = `needs: [${remaining.join(", ")}]`;
  else lines.splice(actualIndex, 1);
  let frontmatterEnd = lines.indexOf("---", 1);
  if (remaining.length === 0 && !lines.slice(1, frontmatterEnd).some((line) => /^resolution:/.test(line))) {
    lines.splice(frontmatterEnd, 0, "resolution: implemented");
    frontmatterEnd++;
  }
  const heading = lines.findIndex((line, index) => index > frontmatterEnd && line === "## Manual testing");
  if (heading === -1) throw new Error("issue has no Manual testing section");
  lines.splice(heading + 1, 0, "", `> Verified by boxholder ${date}`);
  return { content: lines.join("\n"), close: remaining.length === 0, workstream };
}
