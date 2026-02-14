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
      formatSimpleIssue(issue, lines);
    }
  }
}

function formatSimpleIssue(issue: ZodIssue, lines: string[]): void {
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  lines.push(`  ${path}: ${issue.message}`);
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
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      lines.push(`  ${path}: Invalid value, expected one of: <${expectedTags.join(">, <")}>`);
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
    const path = formatPath(issue.path);
    if (expectedTags.length > 0) {
      lines.push(`  ${path}: Unexpected element <${actualTagName}>, expected one of: <${expectedTags.join(">, <")}>`);
    } else {
      lines.push(`  ${path}: Unexpected element <${actualTagName}>`);
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
    formatSimpleIssue(issue, lines);
    return;
  }

  // Format the relevant issues, preserving the parent path context
  for (const subIssue of relevantIssues) {
    if (subIssue.code === "invalid_union") {
      // Nested unions (e.g., children of children) — recurse
      formatUnionError(subIssue, lines, rootNode);
    } else {
      const fullPath = [...issue.path, ...subIssue.path];
      const pathStr = formatPath(fullPath);
      lines.push(`  ${pathStr}: ${subIssue.message}`);
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
 * Format a Zod path for display.
 * Converts ["children", 2, "attrs", "id"] to "children[2].attrs.id"
 */
function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "(root)";
  let result = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${String(segment)}]`;
    } else if (result === "") {
      result = segment;
    } else {
      result += `.${segment}`;
    }
  }
  return result;
}
