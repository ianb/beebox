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
  type CardSchema,
} from "cardworks";
import { parse as parseYaml } from "yaml";
import { parseCardText, typeFromFilename, type LoadCardContext } from "./card-io.js";
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
  const containsWarning = lintContainsLength(parsed.fields);
  if (containsWarning !== null) warnings.push(containsWarning);
  warnings.push(...unknownKeyWarnings({ content, schema: parsed.schema }));
  const errors =
    type === "commentary"
      ? commentaryErrors({
          fields: parsed.fields,
          body: typeof bodyField === "string" ? bodyField : "",
        })
      : type === "extfile"
        ? extfileErrors({ fields: parsed.fields })
        : [];
  return { path, errors, warnings };
}

/**
 * Cross-field validation for extfile cards that Zod can't express: `href` must
 * be a parseable `file:` URL (the schema only types it as a string), and a
 * present `version` must carry a well-formed `sha256:<hex>` marker (it is
 * compared byte-for-byte against the live file's hash, so a malformed one would
 * never match). Whether the href *resolves* on this machine is deliberately not
 * checked here — that's machine-specific and the renderer/`cb extfile sync`
 * report it at use time.
 */
function extfileErrors(input: { fields: Record<string, unknown> }): LintIssue[] {
  const { fields } = input;
  const errors: LintIssue[] = [];
  const href = fields["href"];
  // A missing href is already a schema (Zod) error from parseCardText; here we
  // only refine a present href's shape.
  if (typeof href === "string" && href !== "" && !isFileUrl(href)) {
    errors.push({
      type: "validation",
      severity: "error",
      message: `extfile href must be a file: URL (got "${href}")`,
    });
  }
  const version = fields["version"];
  if (typeof version === "string" && version !== "" && !hasSha256Marker(version)) {
    errors.push({
      type: "validation",
      severity: "error",
      message: `extfile version must contain a sha256:<hex> marker (got "${version}")`,
    });
  }
  return errors;
}

function isFileUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "file:";
  } catch (_e) {
    return false;
  }
}

/** A space-separated marker set containing at least one `sha256:<hex>` token. */
function hasSha256Marker(version: string): boolean {
  return version.split(/\s+/).some((marker) => /^sha256:[\da-f]+$/.test(marker));
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

/**
 * Validation cardworks/Zod can't express for commentary cards: at most one of
 * `defaultHref`/`defaultRef`, and Markdoc validation of the body's tags (which
 * fires the `{% source %}` ref-xor-href rule — nothing else runs
 * `Markdoc.validate`, so this is where it lands).
 *
 * Neither default is allowed: an attach-scoped commentary defaults to its
 * *containing* document (the card that owns the attach scope), so it needs no
 * explicit default target. Both at once is still an error.
 */
function commentaryErrors(input: { fields: Record<string, unknown>; body: string }): LintIssue[] {
  const { fields, body } = input;
  const errors: LintIssue[] = [];
  const hasHref = typeof fields["defaultHref"] === "string" && fields["defaultHref"] !== "";
  const hasRef = typeof fields["defaultRef"] === "string" && fields["defaultRef"] !== "";
  if (hasHref && hasRef) {
    errors.push({
      type: "validation",
      severity: "error",
      message: "commentary card takes at most one of defaultHref or defaultRef, not both",
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

