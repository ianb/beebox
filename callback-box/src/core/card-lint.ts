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
 * Ref-checking for frontmatter cards is not implemented yet — schema
 * fields can carry refs but the field-walker isn't taught about them.
 * Until that lands, broken refs in migrated cards will surface only
 * at use sites, not at validate time.
 */

import { readFile } from "node:fs/promises";
import {
  lintCard,
  splitCardContent,
  type LintResult,
  type LintSummary,
  type LintIssue,
  type ICardLoader,
} from "cardworks";
import { parse as parseYaml } from "yaml";
import { parseCardText, type LoadCardContext } from "./card-io.js";

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
    const type = peekFrontmatterType(split.frontmatterText);
    if (type !== undefined && options.ctx.cardSchemas.has(type)) {
      return lintFrontmatterCard({ path, content, options });
    }
  }
  return lintCard(options.loader, path);
}

function lintFrontmatterCard(input: {
  path: string;
  content: string;
  options: LintDispatchOptions;
}): LintResult {
  const { path, content, options } = input;
  try {
    parseCardText(content, { source: path, schemas: options.ctx.cardSchemas });
    return { path, errors: [], warnings: [] };
  } catch (e) {
    return errorResult(path, (e as Error).message);
  }
}

function errorResult(path: string, message: string): LintResult {
  const issue: LintIssue = {
    type: "validation",
    severity: "error",
    message,
  };
  return { path, errors: [issue], warnings: [] };
}

function peekFrontmatterType(text: string): string | undefined {
  try {
    const parsed = parseYaml(text) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const type = (parsed as Record<string, unknown>)["type"];
    return typeof type === "string" ? type : undefined;
  } catch {
    return undefined;
  }
}
