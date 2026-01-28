import type { ICardLoader } from "../loader/loader.js";
import type { Location } from "../parser/provenance.js";
import { parseRef } from "../refs/parse-ref.js";

/**
 * A lint issue (error or warning).
 */
export interface LintIssue {
  type: "parse" | "validation" | "reference";
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
    const node = await loader.load(path);

    // Check references if enabled
    if (checkRefs) {
      await checkRefsInNode(node, path, loader, errors, warnings);
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
 * Check references in a node tree.
 */
async function checkRefsInNode(
  node: { attrs: Record<string, string>; children: typeof node[]; location: Location },
  cardPath: string,
  loader: ICardLoader,
  errors: LintIssue[],
  warnings: LintIssue[]
): Promise<void> {
  // Check ref attribute
  const refAttr = node.attrs["ref"];
  if (refAttr) {
    try {
      const parsed = parseRef(refAttr);
      const resolved = await loader.resolveRef(refAttr, cardPath);

      if (!resolved.exists) {
        errors.push({
          type: "reference",
          severity: "error",
          message: `Broken reference: ${parsed.path} does not exist`,
          location: node.location,
        });
      } else if (resolved.versionMismatch) {
        warnings.push({
          type: "reference",
          severity: "warning",
          message: `Version mismatch: requested ${resolved.requestedVersion ?? "unknown"}, found ${resolved.actualVersion ?? "unknown"}`,
          location: node.location,
        });
      }
    } catch (e) {
      errors.push({
        type: "reference",
        severity: "error",
        message: `Invalid reference "${refAttr}": ${e instanceof Error ? e.message : String(e)}`,
        location: node.location,
      });
    }
  }

  // Recurse into children
  for (const child of node.children) {
    await checkRefsInNode(child, cardPath, loader, errors, warnings);
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
