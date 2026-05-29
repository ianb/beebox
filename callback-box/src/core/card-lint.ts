/**
 * Lint dispatcher for mixed XML / markdown-frontmatter cards.
 *
 * For each card path, peeks at the frontmatter to decide which path to
 * take: cards declaring a `type:` that matches a registered CardSchema
 * are validated through parseCardText (Zod schema check); everything
 * else falls through to cardworks' existing XML lintCard. Results are
 * merged into a single LintSummary so callers (e.g. cb validate) can
 * format them uniformly.
 *
 * Ref-checking walks two sides: cardworks' `extractRefs` over parsed
 * frontmatter fields, and `extractBodyRefs` over the Markdoc body. Both
 * yield `{path, ref}` entries with the same shape; both are surfaced as
 * warnings (not errors) so legitimate moves don't block commits.
 */

import { readFile } from "node:fs/promises";
import {
  lintCard,
  splitCardContent,
  extractRefs,
  type LintResult,
  type LintSummary,
  type LintIssue,
  type ICardLoader,
} from "cardworks";
import { parseCardText, type LoadCardContext } from "./card-io.js";
import { extractBodyRefs } from "./body-refs.js";

export interface LintDispatchOptions {
  loader: ICardLoader;
  ctx: LoadCardContext;
}

/**
 * Lint a list of card paths, dispatching each to the appropriate
 * validator based on file shape.
 */
export async function lintCardsDispatch(
  paths: string[],
  options: LintDispatchOptions
): Promise<LintSummary> {
  const results: LintResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;

  for (const path of paths) {
    const result = await lintOne(path, options);
    results.push(result);
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
    if (result.errors.length > 0) {
      filesWithErrors++;
    }
  }

  return {
    results,
    filesChecked: paths.length,
    filesWithErrors,
    totalErrors,
    totalWarnings,
  };
}

async function lintOne(path: string, options: LintDispatchOptions): Promise<LintResult> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (e) {
    return errorResult(path, (e as Error).message);
  }

  const split = splitCardContent(content);
  if (split.hasFrontmatter) {
    const type = typeFromFilename(path);
    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
      return lintFrontmatterCard({ path, content, options, type });
    }
  }
  return lintCard(options.loader, path);
}

async function lintFrontmatterCard(input: {
  path: string;
  content: string;
  options: LintDispatchOptions;
  type: string;
}): Promise<LintResult> {
  const { path, content, options, type } = input;
  let parsed;
  try {
    parsed = parseCardText(content, { source: path, schemas: options.ctx.cardSchemas, type });
  } catch (e) {
    return errorResult(path, (e as Error).message);
  }
  // Broken refs are surfaced as WARNINGS, not errors. Refs commonly go
  // stale via legitimate operations (the referent got moved, archived,
  // trashed, or hand-deleted), and treating each one as a hard error
  // would have the pre-commit hook blocking every commit on any box
  // with accumulated data drift. Schema validation failures (which come
  // out of parseCardText as a thrown CardIOError → errorResult above)
  // remain errors and do block.
  const frontmatterRefs = extractRefs(parsed.fields);
  const bodyField = parsed.fields["body"];
  const bodyRefs = typeof bodyField === "string" ? extractBodyRefs(bodyField) : [];
  const warnings: LintIssue[] = [];
  for (const { path: refPath, ref } of [...frontmatterRefs, ...bodyRefs]) {
    try {
      const resolved = await options.loader.resolveRef(ref, path);
      if (!resolved.exists) {
        warnings.push({
          type: "reference",
          severity: "warning",
          message: `Broken reference at ${refPath}: ${ref} does not exist`,
        });
      }
    } catch (e) {
      warnings.push({
        type: "reference",
        severity: "warning",
        message: `Reference at ${refPath} failed to resolve: ${(e as Error).message}`,
      });
    }
  }
  return { path, errors: [], warnings };
}

function errorResult(path: string, message: string): LintResult {
  // The cardworks formatter prints the file path as a header above each
  // result's issues, so strip any leading "<path>: " prefix the underlying
  // error (e.g. CardIOError) included to avoid printing the path twice.
  const prefix = `${path}: `;
  const cleaned = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  const issue: LintIssue = {
    type: "validation",
    severity: "error",
    message: cleaned,
  };
  return { path, errors: [issue], warnings: [] };
}

function typeFromFilename(filePath: string): string | undefined {
  const base = filePath.split("/").pop() ?? filePath;
  const match = base.match(/^.+\.([^.]+)\.card$/);
  return match ? match[1] : undefined;
}
