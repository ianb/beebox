import type { ZodError, ZodIssue } from "zod";

/**
 * Format a ZodError from element validation into a human-readable message.
 *
 * The key problem: when a `z.union([A, B, C])` fails for children,
 * Zod dumps ALL branch failures — producing hundreds of lines.
 *
 * Our fix: element schemas always have `tagName: z.literal(tagName)`,
 * so we can match the actual node's tagName to find the relevant branch
 * and only show that branch's errors. If no branch matches, we report
 * "unexpected tag <foo>, expected one of: a, b, c".
 */
export function formatValidationError(error: ZodError, node?: unknown): string {
  const lines: string[] = [];
  formatIssues(error.issues, lines, node);
  return lines.join("\n");
}

function formatIssues(issues: ZodIssue[], lines: string[], node?: unknown): void {
  for (const issue of issues) {
    if (issue.code === "invalid_union") {
      formatUnionError(issue, lines, node);
    } else {
      formatSimpleIssue(issue, lines, node);
    }
  }
}

function formatSimpleIssue(issue: ZodIssue, lines: string[], rootNode?: unknown): void {
  const pathStr = issue.path.length > 0 ? formatPath(issue.path, rootNode) : "(root)";
  lines.push(formatErrorLine(pathStr, issue.message, rootNode, issue.path));
}

/**
 * Format a union validation error by matching against tagName.
 *
 * When a child element fails a z.union(), we:
 * 1. Look at the actual node's tagName
 * 2. Find the union branch that expects that tagName
 * 3. Show only that branch's errors (the relevant ones)
 * 4. If no branch matches: "unexpected tag <foo>, expected one of: ..."
 */
function formatUnionError(issue: ZodIssue & { code: "invalid_union" }, lines: string[], rootNode?: unknown): void {
  const unionErrors = issue.unionErrors;
  if (unionErrors.length === 0) {
    formatSimpleIssue(issue, lines);
    return;
  }

  // Try to find the actual node at this path
  const actualNode = resolveNodeAtPath(rootNode, issue.path);
  const actualTagName = getTagName(actualNode);

  if (!actualTagName) {
    // Can't determine the tag name — fall back to showing what's expected
    const expectedTags = collectExpectedTagNames(unionErrors);
    if (expectedTags.length > 0) {
      const path = issue.path.length > 0 ? formatPath(issue.path, rootNode) : "(root)";
      lines.push(formatErrorLine(path, `Invalid value, expected one of: <${expectedTags.join(">, <")}>`, rootNode, issue.path));
    } else {
      formatSimpleIssue(issue, lines);
    }
    return;
  }

  // Find which union branch(es) expect this tagName
  const matchingBranchIndex = findMatchingBranch(unionErrors, actualTagName);

  if (matchingBranchIndex === -1) {
    // No branch matches this tag name — it's an unexpected element
    const expectedTags = collectExpectedTagNames(unionErrors);
    const path = formatPath(issue.path, rootNode);
    if (expectedTags.length > 0) {
      lines.push(formatErrorLine(path, `Unexpected element <${actualTagName}>, expected one of: <${expectedTags.join(">, <")}>`, rootNode, issue.path));
    } else {
      lines.push(formatErrorLine(path, `Unexpected element <${actualTagName}>`, rootNode, issue.path));
    }
    return;
  }

  // We found the matching branch — show only its errors (excluding the tagName match)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index validated by findMatchingBranch
  const matchingErrors = unionErrors[matchingBranchIndex]!;
  const relevantIssues = matchingErrors.issues.filter(
    (i) => !isTagNameIssue(i)
  );

  if (relevantIssues.length === 0) {
    // The matching branch succeeded on everything except... shouldn't happen,
    // but if it does, show the raw issue
    formatSimpleIssue(issue, lines, rootNode);
    return;
  }

  // Format the relevant issues, preserving the parent path context
  for (const subIssue of relevantIssues) {
    if (subIssue.code === "invalid_union") {
      // Nested unions (e.g., children of children) — recurse
      formatUnionError(subIssue, lines, rootNode);
    } else {
      const fullPath = [...issue.path, ...subIssue.path];
      const pathStr = formatPath(fullPath, rootNode);
      lines.push(formatErrorLine(pathStr, subIssue.message, rootNode, fullPath));
    }
  }
}

/**
 * Navigate into a node following a Zod path like ["children", 2, "children", 0].
 */
function resolveNodeAtPath(node: unknown, path: (string | number)[]): unknown {
  let current = node;
  for (const segment of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function getTagName(node: unknown): string | undefined {
  if (node != null && typeof node === "object" && "tagName" in node) {
    const tn = (node as { tagName: unknown }).tagName;
    if (typeof tn === "string") return tn;
  }
  return undefined;
}

/**
 * Get the line number of the deepest node in the path that has location info.
 */
function getLineNumber(rootNode: unknown, path: (string | number)[]): number | undefined {
  if (rootNode == null) return undefined;
  let lastLine: number | undefined;
  for (let i = 0; i <= path.length; i++) {
    const node = resolveNodeAtPath(rootNode, path.slice(0, i));
    if (node != null && typeof node === "object" && "location" in node) {
      const loc = (node as { location: { startLine?: number } }).location;
      if (loc.startLine && loc.startLine > 0) {
        lastLine = loc.startLine;
      }
    }
  }
  return lastLine;
}

/**
 * Format an error line with optional line number prefix.
 */
function formatErrorLine(pathStr: string, message: string, rootNode?: unknown, path?: (string | number)[]): string {
  const line = rootNode && path ? getLineNumber(rootNode, path) : undefined;
  const prefix = line ? `line ${String(line)}: ` : "";
  return `  ${prefix}${pathStr}: ${message}`;
}

/**
 * Find which union branch expects a given tagName.
 * Returns the index, or -1 if none match.
 */
function findMatchingBranch(unionErrors: ZodError[], tagName: string): number {
  for (let i = 0; i < unionErrors.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- loop bounded by array length
    const err = unionErrors[i]!;
    // A branch matches if it does NOT have a tagName literal error for this tag.
    // i.e., the tagName was accepted by this branch.
    const hasTagNameError = err.issues.some(
      (issue) => isTagNameIssue(issue) && !tagNameMatches(issue, tagName)
    );
    const hasTagNameSuccess = !err.issues.some((issue) => isTagNameIssue(issue));

    if (hasTagNameSuccess) {
      // This branch didn't complain about tagName — it's a match
      return i;
    }

    // Check if the branch's tagName literal matches
    if (!hasTagNameError) {
      return i;
    }
  }
  return -1;
}

/**
 * Check if an issue is about the tagName field.
 */
function isTagNameIssue(issue: ZodIssue): boolean {
  return (
    issue.path.length > 0 &&
    issue.path[issue.path.length - 1] === "tagName"
  );
}

/**
 * Check if a tagName issue's expected value matches.
 */
function tagNameMatches(issue: ZodIssue, tagName: string): boolean {
  if (issue.code === "invalid_literal") {
    return (issue as { expected: unknown }).expected === tagName;
  }
  return false;
}

/**
 * Collect the expected tagNames from all union branches.
 * Looks for z.literal() errors on the "tagName" path.
 */
function collectExpectedTagNames(unionErrors: ZodError[]): string[] {
  const tags: string[] = [];
  for (const err of unionErrors) {
    for (const issue of err.issues) {
      if (isTagNameIssue(issue) && issue.code === "invalid_literal") {
        const expected = (issue as { expected: unknown }).expected;
        if (typeof expected === "string" && !tags.includes(expected)) {
          tags.push(expected);
        }
      }
    }
  }
  return tags;
}

/**
 * Format a Zod path for display, annotating children indices with tag names.
 *
 * Without node: children[4].children[2].children[1].text
 * With node:    <content>.<section>.<expando>.text
 */
function formatPath(path: (string | number)[], rootNode?: unknown): string {
  if (path.length === 0) return "(root)";
  let result = "";
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    if (typeof segment === "number") {
      // Look up the actual node to get its tagName
      const nodeAtPath = rootNode
        ? resolveNodeAtPath(rootNode, path.slice(0, i + 1))
        : undefined;
      const tag = getTagName(nodeAtPath);
      if (tag) {
        if (result !== "") {
          result += ".";
        }
        result += `<${tag}>`;
      } else {
        result += `[${String(segment)}]`;
      }
    } else if (segment === "children" && rootNode) {
      // Skip "children" when we have a root node — tag names are more readable
      continue;
    } else if (result === "") {
      result = String(segment);
    } else {
      result += `.${String(segment)}`;
    }
  }
  return result;
}
