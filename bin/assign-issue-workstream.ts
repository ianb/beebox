import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function assignIssueWorkstream(
  source: string,
  workstream: string,
): string {
  const end = source.indexOf("\n---", 4);
  if (!source.startsWith("---\n") || end === -1)
    throw new Error("issue has no frontmatter");
  const frontmatter = source.slice(0, end);
  if (!/^workstream:[^\n]*$/m.test(frontmatter))
    throw new Error("issue frontmatter has no workstream field");
  const updated = frontmatter.replace(
    /^workstream:[^\n]*$/m,
    `workstream: ${workstream}`,
  );
  return updated + source.slice(end);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args[0] === "--check";
  const [issuePath, workstream] = checkOnly ? args.slice(1) : args;
  if (!issuePath || !workstream || !/^[a-zA-Z0-9_-]+$/.test(workstream))
    throw new Error(
      "usage: assign-issue-workstream.ts <issue-path> <workstream>",
    );
  const resolved = path.resolve(issuePath);
  const source = await fs.readFile(resolved, "utf8");
  const updated = assignIssueWorkstream(source, workstream);
  if (!checkOnly) await fs.writeFile(resolved, updated);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
