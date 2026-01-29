import type { ICardLoader } from "../loader/loader.js";
import type { ElementNode, Location } from "../parser/provenance.js";
import { parseRef, parseRefs } from "../refs/parse-ref.js";

/**
 * A lint issue (error or warning).
 */
export interface LintIssue {
  type: "parse" | "validation" | "reference" | "id";
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
 * Lint a single card file.
 */
export async function lintCard(
  loader: ICardLoader,
  path: string,
  options: LintOptions = {}
): Promise<LintResult> {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const checkRefs = options.checkRefs ?? true;

  try {
    // Load will parse and validate against schema
    const card = await loader.load(path);

    // Check for duplicate IDs
    checkDuplicateIds(card.element, warnings);

    // Check references if enabled
    if (checkRefs) {
      await checkRefsInNode(card.element, path, loader, errors, warnings);
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
 * Check references in a node tree.
 */
async function checkRefsInNode(
  node: ElementNode,
  cardPath: string,
  loader: ICardLoader,
  errors: LintIssue[],
  warnings: LintIssue[]
): Promise<void> {
  // Check ref attribute (single reference)
  const refAttr = node.attrs["ref"];
  if (refAttr) {
    await checkSingleRef(refAttr, node.location, cardPath, loader, errors, warnings);
  }

  // Check refs attribute (multiple whitespace-separated references)
  const refsAttr = node.attrs["refs"];
  if (refsAttr) {
    const parsedRefs = parseRefs(refsAttr);
    for (const parsed of parsedRefs) {
      await checkSingleRef(parsed.original, node.location, cardPath, loader, errors, warnings);
    }
  }

  // Recurse into children
  for (const child of node.children) {
    await checkRefsInNode(child, cardPath, loader, errors, warnings);
  }
}

/**
 * Check a single reference string.
 */
async function checkSingleRef(
  refStr: string,
  location: Location,
  cardPath: string,
  loader: ICardLoader,
  errors: LintIssue[],
  warnings: LintIssue[]
): Promise<void> {
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
 * Lint all card files in the project.
 */
export async function lintAll(
  loader: ICardLoader,
  options: LintOptions = {}
): Promise<LintSummary> {
  const paths = await loader.listCards();
  return lintCards(loader, paths, options);
}

/**
 * Lint a list of card files.
 */
export async function lintCards(
  loader: ICardLoader,
  paths: string[],
  options: LintOptions = {}
): Promise<LintSummary> {
  const results: LintResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;

  for (const path of paths) {
    const result = await lintCard(loader, path, options);
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
