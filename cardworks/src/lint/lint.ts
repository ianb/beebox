import type { ICardLoader } from "../loader/loader.js";
import type { ElementNode, Location } from "../parser/provenance.js";
import { parseRef, parseRefs } from "../refs/parse-ref.js";
import { parseCard } from "../parser/parse.js";

/**
 * A lint issue (error or warning).
 */
export interface LintIssue {
  type: "parse" | "validation" | "reference" | "id" | "schema";
  severity: "error" | "warning";
  message: string;
  location?: Location;
}

/**
 * Result of linting a single card.
 */
export interface LintResult {
  path: string;
  errors: LintIssue[];
  warnings: LintIssue[];
}

/**
 * Summary of all lint results.
 */
export interface LintSummary {
  results: LintResult[];
  totalErrors: number;
  totalWarnings: number;
  filesChecked: number;
  filesWithErrors: number;
}

/**
 * Options for linting.
 */
export interface LintOptions {
  /** Check references for broken links and version mismatches (default: true) */
  checkRefs?: boolean;
}

/**
 * Options for {@link lintCard}: the card path plus optional lint settings.
 */
export interface LintCardOptions extends LintOptions {
  /** The path to the card file to lint */
  path: string;
}

/**
 * Lint a single card file.
 */
export async function lintCard(
  loader: ICardLoader,
  options: LintCardOptions
): Promise<LintResult> {
  const { path } = options;
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const checkRefs = options.checkRefs ?? true;

  try {
    // Load will parse and validate against schema
    const card = await loader.load(path);

    // Check if schema exists for this tag (only if schemas are in use)
    if (loader.hasAnySchemas() && !loader.hasSchema(card.element.tagName)) {
      warnings.push({
        type: "schema",
        severity: "warning",
        message: `Unknown root tag <${card.element.tagName}> (no schema registered)`,
        location: card.element.location,
      });
    }

    // Check for duplicate IDs
    checkDuplicateIds(card.element, warnings);

    // Check references if enabled
    if (checkRefs) {
      await checkRefsInNode(card.element, { cardPath: path, loader, errors, warnings });
    }
  } catch (e) {
    if (e instanceof Error) {
      // Determine error type based on error class name
      const isValidation = e.name === "ValidationError";
      const isParse = e.name === "ParseError";

      const issue: LintIssue = {
        type: isValidation ? "validation" : isParse ? "parse" : "parse",
        severity: "error",
        message: e.message,
      };

      // Add location if available
      if ("location" in e && typeof e.location === "object" && e.location !== null) {
        issue.location = e.location as Location;
      }

      errors.push(issue);
    }
  }

  return { path, errors, warnings };
}

/**
 * Collected ID information for duplicate checking.
 */
interface IdOccurrence {
  id: string;
  location: Location;
}

/**
 * Check for duplicate IDs within a card.
 */
function checkDuplicateIds(root: ElementNode, warnings: LintIssue[]): void {
  const idOccurrences: IdOccurrence[] = [];

  // Collect all IDs
  collectIds(root, idOccurrences);

  // Find duplicates
  const seen = new Map<string, IdOccurrence>();
  for (const occurrence of idOccurrences) {
    const existing = seen.get(occurrence.id);
    if (existing) {
      // Report duplicate - warn at the second occurrence
      warnings.push({
        type: "id",
        severity: "warning",
        message: `Duplicate id "${occurrence.id}" (first defined at line ${String(existing.location.startLine)})`,
        location: occurrence.location,
      });
    } else {
      seen.set(occurrence.id, occurrence);
    }
  }
}

/**
 * Recursively collect all IDs from a node tree.
 */
function collectIds(node: ElementNode, occurrences: IdOccurrence[]): void {
  const id = node.attrs["id"];
  if (id) {
    occurrences.push({ id, location: node.location });
  }

  for (const child of node.children) {
    collectIds(child, occurrences);
  }
}

/**
 * Shared context threaded through the reference-checking helpers: the card
 * being linted, the loader used to resolve refs, and the issue accumulators.
 */
interface RefCheckContext {
  cardPath: string;
  loader: ICardLoader;
  errors: LintIssue[];
  warnings: LintIssue[];
}

/**
 * Check references in a node tree.
 */
async function checkRefsInNode(node: ElementNode, ctx: RefCheckContext): Promise<void> {
  // Check ref attribute (single reference)
  const refAttr = node.attrs["ref"];
  if (refAttr) {
    await checkSingleRef(refAttr, { location: node.location, ctx });
  }

  // Check refs attribute (multiple whitespace-separated references)
  const refsAttr = node.attrs["refs"];
  if (refsAttr) {
    const parsedRefs = parseRefs(refsAttr);
    for (const parsed of parsedRefs) {
      await checkSingleRef(parsed.original, { location: node.location, ctx });
    }
  }

  // Recurse into children
  for (const child of node.children) {
    await checkRefsInNode(child, ctx);
  }
}

/**
 * Options for {@link checkSingleRef}.
 */
interface CheckSingleRefOptions {
  location: Location;
  ctx: RefCheckContext;
}

/**
 * Check a single reference string.
 */
async function checkSingleRef(
  refStr: string,
  { location, ctx }: CheckSingleRefOptions
): Promise<void> {
  const { cardPath, loader, errors, warnings } = ctx;
  try {
    const parsed = parseRef(refStr);
    const resolved = await loader.resolveRef(refStr, cardPath);

    if (!resolved.exists) {
      errors.push({
        type: "reference",
        severity: "error",
        message: `Broken reference: ${parsed.path} does not exist`,
        location,
      });
    } else {
      // Check version mismatch
      if (resolved.versionMismatch) {
        warnings.push({
          type: "reference",
          severity: "warning",
          message: `Version mismatch: requested ${resolved.requestedVersion ?? "unknown"}, found ${resolved.actualVersion ?? "unknown"}`,
          location,
        });
      }

      // Check fragment errors
      if (resolved.fragmentError) {
        errors.push({
          type: "reference",
          severity: "error",
          message: resolved.fragmentError,
          location,
        });
      }
    }
  } catch (e) {
    errors.push({
      type: "reference",
      severity: "error",
      message: `Invalid reference "${refStr}": ${e instanceof Error ? e.message : String(e)}`,
      location,
    });
  }
}

/**
 * Options for {@link lintContent}.
 */
export interface LintContentOptions {
  /** XML string to validate */
  content: string;
  /** Display name for error messages (default: "<inline>") */
  sourceName?: string;
}

/**
 * Lint XML content in memory without writing to disk.
 *
 * Parses the XML and checks structure (well-formedness, duplicate IDs,
 * unknown root tags). For full schema validation, use `lintCard` with
 * a file path.
 *
 * @param loader - Card loader with registered schemas (for tag checking)
 * @param options - The XML content and optional display name
 */
export async function lintContent(
  loader: ICardLoader,
  options: LintContentOptions
): Promise<LintResult> {
  const { content } = options;
  const sourceName = options.sourceName ?? "<inline>";
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];

  try {
    const node = await parseCard(content, { source: sourceName });

    // Check if schema exists
    if (loader.hasAnySchemas() && !loader.hasSchema(node.tagName)) {
      warnings.push({
        type: "schema",
        severity: "warning",
        message: `Unknown root tag <${node.tagName}> (no schema registered)`,
        location: node.location,
      });
    }

    // Check for duplicate IDs
    checkDuplicateIds(node, warnings);
  } catch (e) {
    if (e instanceof Error) {
      const isParse = e.name === "ParseError";
      errors.push({
        type: isParse ? "parse" : "validation",
        severity: "error",
        message: e.message,
      });
    }
  }

  return { path: sourceName, errors, warnings };
}

/**
 * Lint all card files in the project.
 */
export async function lintAll(
  loader: ICardLoader,
  options?: LintOptions
): Promise<LintSummary> {
  const resolved = options ?? {};
  const paths = await loader.listCards();
  return lintCards(loader, { paths, ...resolved });
}

/**
 * Options for {@link lintCards}: the card paths plus optional lint settings.
 */
export interface LintCardsOptions extends LintOptions {
  /** The paths to the card files to lint */
  paths: string[];
}

/**
 * Lint a list of card files.
 */
export async function lintCards(
  loader: ICardLoader,
  options: LintCardsOptions
): Promise<LintSummary> {
  const { paths, ...lintOptions } = options;
  const results: LintResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;

  for (const path of paths) {
    const result = await lintCard(loader, { path, ...lintOptions });
    results.push(result);

    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;

    if (result.errors.length > 0) {
      filesWithErrors++;
    }
  }

  return {
    results,
    totalErrors,
    totalWarnings,
    filesChecked: results.length,
    filesWithErrors,
  };
}
