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
 * Ref-checking walks two sides: `extractRefs` (src/cards) over parsed
 * frontmatter fields, and `extractBodyRefs` over the Markdoc body. Both
 * yield `{path, ref}` entries with the same shape; both are surfaced as
 * warnings (not errors) so legitimate moves don't block commits.
 *
 * Type-specific, self-contained validation (rules Zod can't express, e.g.
 * commentary's Markdoc check or extfile's `file:`-URL refinement) is NOT here:
 * it lives on each schema as a `validate` hook (cardworks), invoked generically
 * below. The ref-existence walk stays here because it is box-aware (needs the
 * loader), which the self-contained hook deliberately lacks.
 */

import { readFile } from "node:fs/promises";
import { lintCard, type ICardLoader } from "cardworks";
import {
  splitCardContent,
  extractRefs,
  type CardSchema,
  type LintResult,
  type LintSummary,
  type LintIssue,
} from "../cards/index.js";
import { parse as parseYaml } from "yaml";
import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
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
  const containsWarning = lintContainsLength(parsed.fields);
  if (containsWarning !== null) warnings.push(containsWarning);
  warnings.push(...unknownKeyWarnings({ content, schema: parsed.schema }));
  // Type-specific, self-contained validation (rules Zod can't express) lives on
  // the schema as its `validate` hook — see the commentary/extfile schema
  // modules. The generic ref-existence walk above stays here because it needs
  // the loader (box-aware), which the self-contained hook deliberately lacks.
  const errors = parsed.schema.validate ? parsed.schema.validate({ fields: parsed.fields }) : [];
  return { path, errors, warnings };
}

/**
 * Frontmatter keys present on disk that the card's schema doesn't declare. The
 * loader strips these in memory (a drifted card still loads, renders, and
 * indexes), so they are surfaced as **warnings** — visible to `cb validate` and
 * the PostToolUse hook — to be cleaned off disk eventually, without blocking
 * commits or breaking load. Allowed keys are the schema's own fields (minus the
 * body field, which lives in the file body, not frontmatter), the injected
 * global fields, and `type`.
 */
function unknownKeyWarnings(input: { content: string; schema: CardSchema }): LintIssue[] {
  const { content, schema } = input;
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return [];
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (_e) {
    // Malformed YAML is a separate, error-level failure already surfaced by
    // parseCardText (which threw → errorResult); nothing to add here.
    return [];
  }
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return [];
  const allowed = new Set<string>(["type", ...schema.globalFieldNames, ...Object.keys(schema.fields)]);
  if (schema.bodyFieldName !== null) allowed.delete(schema.bodyFieldName);
  const warnings: LintIssue[] = [];
  for (const key of Object.keys(fm as Record<string, unknown>)) {
    if (allowed.has(key)) continue;
    warnings.push({
      type: "schema",
      severity: "warning",
      message:
        `Unknown frontmatter key "${key}" — not declared by the ${schema.type} schema; ` +
        "it is ignored on load and should be removed",
    });
  }
  return warnings;
}

/** Soft budget for the `contains` field — one concise sentence, not a summary essay. */
const CONTAINS_MAX_CHARS = 200;

function lintContainsLength(fields: Record<string, unknown>): LintIssue | null {
  const contains = fields["contains"];
  if (typeof contains !== "string" || contains.length <= CONTAINS_MAX_CHARS) return null;
  return {
    type: "contains",
    severity: "warning",
    message:
      `contains: is ${String(contains.length)} chars (budget ${String(CONTAINS_MAX_CHARS)}) — ` +
      "tighten it to one sentence stating what can be found in this card",
  };
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

