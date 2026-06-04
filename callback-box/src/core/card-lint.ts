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
import Markdoc, { type Node as MarkdocNode } from "@markdoc/markdoc";
import { markdocConfig } from "../shared/markdoc-config.js";

// Value named imports (`{ parse, validate }`) don't resolve from this CommonJS
// module under Node's ESM loader (used by tsx / the doctest runner). Destructure
// off the default import — same pattern + lint exception as `markdoc-config.ts`.
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { parse: markdocParse, validate: markdocValidate } = Markdoc;

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
  return lintCard(options.loader, { path });
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
  const errors =
    type === "commentary"
      ? commentaryErrors({
          fields: parsed.fields,
          body: typeof bodyField === "string" ? bodyField : "",
        })
      : [];
  return { path, errors, warnings };
}

/**
 * Validation cardworks/Zod can't express for commentary cards: exactly one of
 * `defaultHref`/`defaultRef`, and Markdoc validation of the body's tags (which
 * fires the `{% source %}` ref-xor-href rule — nothing else runs
 * `Markdoc.validate`, so this is where it lands).
 */
function commentaryErrors(input: { fields: Record<string, unknown>; body: string }): LintIssue[] {
  const { fields, body } = input;
  const errors: LintIssue[] = [];
  const hasHref = typeof fields["defaultHref"] === "string" && fields["defaultHref"] !== "";
  const hasRef = typeof fields["defaultRef"] === "string" && fields["defaultRef"] !== "";
  if (hasHref === hasRef) {
    errors.push({
      type: "validation",
      severity: "error",
      message: "commentary card requires exactly one of defaultHref or defaultRef",
    });
  }
  for (const message of validateMarkdocBody(body)) {
    errors.push({ type: "validation", severity: "error", message });
  }
  return errors;
}

function validateMarkdocBody(body: string): string[] {
  if (body === "") return [];
  let ast: MarkdocNode;
  try {
    ast = markdocParse(body);
  } catch (_e) {
    return ["commentary body is not parseable Markdoc"];
  }
  return markdocValidate(ast, markdocConfig)
    .filter((entry) => entry.error.level === "error" || entry.error.level === "critical")
    .map((entry) => entry.error.message);
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
