/**
 * Boxholder scan-priors resolution for the scan-import photo flow.
 *
 * Priors live in `_config/scan.guide.card` (the scan guide); the photo flow
 * injects the COMPILED guide text into the per-page vision prompt. The
 * legacy box-root `CLAUDE_SCANS.md` file is a deprecated, warning-logged
 * fallback until boxes migrate (runbook: `docs/plans/scan-guide-card.md`).
 *
 * The guide is compiled in-memory from the card on every run — never read
 * from the possibly-stale `_content/docs/generated/scan-guide.md` derivative. The
 * parse chain here is deliberately NOT `parseGuideCard`, whose `null`
 * conflates no-frontmatter, YAML-syntax, and schema failures; each stage
 * throws a `ScanGuideParseError` naming what broke.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { splitCardContent } from "../../cards/index.js";
import { GuideObject } from "../../schemas/guide-elements.js";
import { parseGuide } from "../../schemas/guide-parse.js";
import { compileGuide } from "../../schemas/guide-compile.js";
import { errorMessage } from "../../lib/error-guards.js";

export const SCAN_GUIDE_REL_PATH = "_config/scan.guide.card";

/** The scan guide exists but cannot be parsed/validated — a hard error:
 * scanning without priors would commit misread names silently. `detail`
 * carries the stage-specific reason. */
class ScanGuideParseError extends Error {
  readonly detail: string;
  constructor(context: { detail: string }) {
    super(
      `${SCAN_GUIDE_REL_PATH} ${context.detail} — fix the card (bbx validate ${SCAN_GUIDE_REL_PATH})`
    );
    this.name = "ScanGuideParseError";
    this.detail = context.detail;
  }
}

export interface ScanGuideContext {
  /** The text to inject into the vision prompt. */
  text: string;
  /** Where it came from: the scan guide, or the deprecated legacy file. */
  source: "guide" | "claude-scans";
  /** Deprecation/conflict warnings for the caller to surface. */
  warnings: string[];
}

/**
 * Read the deprecated legacy priors file (`CLAUDE_SCANS.md`) from the box
 * root. Returns null when absent or blank — a fully valid state.
 */
export async function readScanContextFile(boxRoot: string): Promise<string | null> {
  for (const name of ["CLAUDE_SCANS.md", "claude_scans.md"]) {
    try {
      const content = await fs.readFile(path.join(boxRoot, name), "utf-8");
      if (content.trim().length > 0) return content;
    } catch (_e) {
      // Context file is optional — readFile rejects when this candidate
      // name doesn't exist, which is the common case. Try the next name;
      // returning null (no context) at the end is a valid outcome.
    }
  }
  return null;
}

/** Compile the scan guide card's frontmatter, throwing a stage-specific
 * `ScanGuideParseError` on any failure. */
function compileScanGuide(raw: string): string {
  const split = splitCardContent(raw);
  if (!split.hasFrontmatter) {
    throw new ScanGuideParseError({ detail: "has no YAML frontmatter" });
  }
  let fm: unknown;
  try {
    fm = parseYaml(split.frontmatterText);
  } catch (e) {
    throw new ScanGuideParseError({ detail: `has invalid YAML: ${errorMessage(e)}` });
  }
  const parsed = GuideObject.safeParse(fm ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ScanGuideParseError({ detail: `fails guide schema validation: ${issues}` });
  }
  return compileGuide(parseGuide(parsed.data), "scan");
}

/**
 * Resolve the boxholder's scan priors: the compiled scan guide when
 * `_config/scan.guide.card` exists, else the deprecated `CLAUDE_SCANS.md`
 * fallback (with a deprecation warning), else null (no priors — valid).
 *
 * @throws ScanGuideParseError when the guide card exists but is invalid.
 */
export async function resolveScanGuideContext(boxRoot: string): Promise<ScanGuideContext | null> {
  let raw: string | null = null;
  try {
    raw = await fs.readFile(path.join(boxRoot, SCAN_GUIDE_REL_PATH), "utf-8");
  } catch (_e) {
    // The scan guide is optional — absence falls through to the legacy
    // file, then to "no priors". Only a present-but-invalid card is fatal.
  }
  if (raw !== null) {
    const text = compileScanGuide(raw);
    const warnings: string[] = [];
    if ((await readScanContextFile(boxRoot)) !== null) {
      warnings.push(
        `Warning: CLAUDE_SCANS.md is ignored because ${SCAN_GUIDE_REL_PATH} exists — delete the legacy file`
      );
    }
    return { text, source: "guide", warnings };
  }
  const legacy = await readScanContextFile(boxRoot);
  if (legacy !== null) {
    return {
      text: legacy,
      source: "claude-scans",
      warnings: [
        `Warning: CLAUDE_SCANS.md is deprecated — migrate to ${SCAN_GUIDE_REL_PATH} (bbx create guide --name scan; runbook: docs/plans/scan-guide-card.md)`,
      ],
    };
  }
  return null;
}
