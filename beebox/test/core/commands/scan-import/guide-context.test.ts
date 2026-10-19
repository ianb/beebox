// # Scan guide context resolution
//
// The scan-import photo flow gets its boxholder priors from
// `_config/scan.guide.card`, compiled in-memory into prompt-ready markdown. The
// legacy box-root `CLAUDE_SCANS.md` is a deprecated fallback that keeps working
// with a warning; a present-but-invalid guide card is a hard error rather than
// a silent scan-without-priors. This file pins that resolution ladder.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveScanGuideContext,
  readScanContextFile,
  SCAN_GUIDE_REL_PATH,
} from "../../../../src/core/commands/scan-import/guide-context.js";
import { createInitialGuideTemplate } from "../../../../src/schemas/guide/templates.js";

async function makeBoxDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scan-guide-"));
  await fs.mkdir(path.join(root, "_config"), { recursive: true });
  return root;
}

async function writeGuide(root: string, content: string): Promise<void> {
  await fs.writeFile(path.join(root, SCAN_GUIDE_REL_PATH), content);
}

// ## No guide, no legacy file — no priors, and that's valid
void test("No guide, no legacy file — no priors, and that's valid", async (t) => {
  const root = await makeBoxDir();
  t.check(await resolveScanGuideContext(root), null);

  await fs.rm(root, { recursive: true, force: true });
});

// ## The scan seed template round-trips into compiled prompt text
//
// The `scan` entry in `DOMAIN_SEEDS` must produce a card that parses and
// compiles; the compiled text carries the applies-to line and the
// disambiguation-only rule into the vision prompt.
void test("The scan entry in DOMAINSEEDS must produce a card that parses and compiles; t...", async (t) => {
  const root = await makeBoxDir();
  await writeGuide(root, createInitialGuideTemplate({ name: "scan" }));
  const resolved = await resolveScanGuideContext(root);
  t.check(resolved, { text: `# Scan Guide

Scanner priors for bbx scan-import photo extraction — people, places, vendors, and handwriting clues used to disambiguate names and dates on scanned photos and documents

## Triage Rules

- **Note**: Use these priors for disambiguation only — never invent an identification without strong visual or textual evidence
- **Default → Ask User** — When a prior is missing or contradicted by what's on the page, ask rather than guess

## Actions

### Ask User
**When:** An identification or date on a scanned page is ambiguous and these priors don't resolve it
Create a question card in _bookkeeping/questions/

## Active Experiments

- **exp-scan-initial**: Priors listed here reduce misread names and dates in scan extraction
  Approach: Record durable identifications from answered scan questions as triage rules; verify low-confidence priors with the boxholder
`, source: "guide", warnings: [] });

  await fs.rm(root, { recursive: true, force: true });
});

// ## Guide wins over a lingering legacy file, loudly
void test("Guide wins over a lingering legacy file, loudly", async (t) => {
  const root = await makeBoxDir();
  await writeGuide(root, createInitialGuideTemplate({ name: "scan" }));
  await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "# Old priors\n");
  const resolved = await resolveScanGuideContext(root);
  t.check(resolved, { text: `# Scan Guide

Scanner priors for bbx scan-import photo extraction — people, places, vendors, and handwriting clues used to disambiguate names and dates on scanned photos and documents

## Triage Rules

- **Note**: Use these priors for disambiguation only — never invent an identification without strong visual or textual evidence
- **Default → Ask User** — When a prior is missing or contradicted by what's on the page, ask rather than guess

## Actions

### Ask User
**When:** An identification or date on a scanned page is ambiguous and these priors don't resolve it
Create a question card in _bookkeeping/questions/

## Active Experiments

- **exp-scan-initial**: Priors listed here reduce misread names and dates in scan extraction
  Approach: Record durable identifications from answered scan questions as triage rules; verify low-confidence priors with the boxholder
`, source: "guide", warnings: ["Warning: CLAUDE_SCANS.md is ignored because _config/scan.guide.card exists — delete the legacy file"] });

  await fs.rm(root, { recursive: true, force: true });
});

// ## Legacy file alone still works, with a deprecation warning
//
// Content passes through verbatim (it was hand-written for the prompt), and the
// lowercase filename variant is honored too.
void test("Content passes through verbatim (it was hand-written for the prompt), and the...", async (t) => {
  const root = await makeBoxDir();
  await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "# Scan Context\n- Walter (born 1950)\n");
  const resolved = await resolveScanGuideContext(root);
  assert.ok(resolved);
  t.check(resolved, { text: "# Scan Context\n- Walter (born 1950)\n", source: "claude-scans", warnings: ["Warning: CLAUDE_SCANS.md is deprecated — migrate to _config/scan.guide.card (bbx create guide --name scan; runbook: docs/plans/scan-guide-card.md)"] });

  await fs.rm(root, { recursive: true, force: true });
});

void test("Legacy file alone still works, with a deprecation warning", async (t) => {
  const root = await makeBoxDir();
  await fs.writeFile(path.join(root, "claude_scans.md"), "lowercase priors\n");
  const resolved = await resolveScanGuideContext(root);
  t.check(resolved, { text: "lowercase priors\n", source: "claude-scans", warnings: ["Warning: CLAUDE_SCANS.md is deprecated — migrate to _config/scan.guide.card (bbx create guide --name scan; runbook: docs/plans/scan-guide-card.md)"] });

  await fs.rm(root, { recursive: true, force: true });
});

// A blank legacy file counts as absent:
void test("A blank legacy file counts as absent:", async (t) => {
  const root = await makeBoxDir();
  await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "   \n");
  t.check(await readScanContextFile(root), null);

  t.check(await resolveScanGuideContext(root), null);

  await fs.rm(root, { recursive: true, force: true });
});

// ## A present-but-invalid guide card is a hard error, never a silent skip
//
// Each parse stage names itself: missing frontmatter, YAML syntax, schema
// validation. Scanning without priors would commit misread names silently, so
// the resolver refuses instead.
void test("Each parse stage names itself:", async (t) => {
  const root = await makeBoxDir();
  await writeGuide(root, "just prose, no frontmatter\n");
  await t.checkThrows(() => resolveScanGuideContext(root), "ScanGuideParseError: _config/scan.guide.card has no YAML frontmatter — fix the card (bbx validate _config/scan.guide.card)");

  await writeGuide(root, "---\nversion: [unclosed\n---\n");
  await t.checkThrows(() => resolveScanGuideContext(root), [
      "ScanGuideParseError: _config/scan.guide.card has invalid YAML: Flow sequence in block collection must be sufficiently indented and end with a ] at line 1, column 19:",
      "",
      "version: [unclosed",
      "                  ^",
      " — fix the card (bbx validate _config/scan.guide.card)",
    ].join("\n"));

  await writeGuide(root, "---\ntriage-rules: 5\n---\n");
  await t.checkThrows(() => resolveScanGuideContext(root), "ScanGuideParseError: _config/scan.guide.card fails guide schema validation: triage-rules: Invalid input: expected array, received number — fix the card (bbx validate _config/scan.guide.card)");

  await fs.rm(root, { recursive: true, force: true });
});
