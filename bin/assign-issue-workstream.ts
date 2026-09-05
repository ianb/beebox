import fs from "node:fs/promises";
import path from "node:path";

/** The issue file does not open with a `---` YAML frontmatter block. */
class MissingFrontmatterError extends Error {
  constructor() {
    super("issue has no frontmatter");
    this.name = "MissingFrontmatterError";
  }
}

/** The frontmatter exists but carries no `workstream:` field to assign into. */
class MissingWorkstreamFieldError extends Error {
  constructor() {
    super("issue frontmatter has no workstream field");
    this.name = "MissingWorkstreamFieldError";
  }
}

/** The CLI was invoked without a usable issue path and workstream name. */
class UsageError extends Error {
  constructor() {
    super("usage: assign-issue-workstream.ts <issue-path> <workstream>");
    this.name = "UsageError";
  }
}

export function assignIssueWorkstream(
  source: string,
  workstream: string,
): string {
  const end = source.indexOf("\n---", 4);
  if (!source.startsWith("---\n") || end === -1)
    throw new MissingFrontmatterError();
  const frontmatter = source.slice(0, end);
  if (!/^workstream:[^\n]*$/m.test(frontmatter))
    throw new MissingWorkstreamFieldError();
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
  if (!issuePath || !workstream || !/^[\w-]+$/.test(workstream))
    throw new UsageError();
  const resolved = path.resolve(issuePath);
  const source = await fs.readFile(resolved, "utf8");
  const updated = assignIssueWorkstream(source, workstream);
  if (!checkOnly) await fs.writeFile(resolved, updated);
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1]))
  await main();
