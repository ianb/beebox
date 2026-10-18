// # Scan guide context resolution
//
// The scan-import photo flow gets its boxholder priors from
// `_config/scan.guide.card`, compiled in-memory into prompt-ready markdown. The
// legacy box-root `CLAUDE_SCANS.md` is a deprecated fallback that keeps working
// with a warning; a present-but-invalid guide card is a hard error rather than
// a silent scan-without-priors. This file pins that resolution ladder.

import { test } from "tap";
import "agent-doctest/tap";
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
  // doctest:L35
  const root = await makeBoxDir();
  t.check(await resolveScanGuideContext(root), null);

  // doctest:L39
  await fs.rm(root, { recursive: true, force: true });
});

// ## The scan seed template round-trips into compiled prompt text
//
// The `scan` entry in `DOMAIN_SEEDS` must produce a card that parses and
// compiles; the compiled text carries the applies-to line and the
// disambiguation-only rule into the vision prompt.
void test("The scan entry in DOMAINSEEDS must produce a card that parses and compiles; t...", async (t) => {
  // doctest:L49
  const root = await makeBoxDir();
  await writeGuide(root, createInitialGuideTemplate({ name: "scan" }));
  const resolved = await resolveScanGuideContext(root);
  t.check(resolved?.source, "guide");

  // doctest:L55
  t.check(resolved?.warnings, []);

  // doctest:L58
  t.check(resolved?.text.split("\n")[0], "# Scan Guide");

  // doctest:L61
  t.check(resolved?.text.includes("disambiguation only"), true);

  // doctest:L64
  t.check(resolved?.text.includes("**Default → Ask User**"), true);

  // doctest:L67
  await fs.rm(root, { recursive: true, force: true });
});

// ## Guide wins over a lingering legacy file, loudly
void test("Guide wins over a lingering legacy file, loudly", async (t) => {
  // doctest:L73
  const root = await makeBoxDir();
  await writeGuide(root, createInitialGuideTemplate({ name: "scan" }));
  await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "# Old priors\n");
  const resolved = await resolveScanGuideContext(root);
  t.check(resolved?.source, "guide");

  // doctest:L80
  t.check(resolved?.warnings[0]?.includes("CLAUDE_SCANS.md is ignored"), true);

  // doctest:L83
  await fs.rm(root, { recursive: true, force: true });
});

// ## Legacy file alone still works, with a deprecation warning
//
// Content passes through verbatim (it was hand-written for the prompt), and the
// lowercase filename variant is honored too.
void test("Content passes through verbatim (it was hand-written for the prompt), and the...", async (t) => {
  // doctest:L92
  const root = await makeBoxDir();
  await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "# Scan Context\n- Walter (born 1950)\n");
  const resolved = await resolveScanGuideContext(root);
  assert.ok(resolved);
  t.check(resolved.source, "claude-scans");

  // doctest:L99
  await t.checkText(resolved.text.includes("Walter (born 1950)"), "true");

  // doctest:L102
  t.check(resolved.warnings[0]?.includes("deprecated"), true);

  // doctest:L105
  await fs.rm(root, { recursive: true, force: true });
});

void test("Legacy file alone still works, with a deprecation warning", async (t) => {
  // doctest:L109
  const root = await makeBoxDir();
  await fs.writeFile(path.join(root, "claude_scans.md"), "lowercase priors\n");
  const resolved = await resolveScanGuideContext(root);
  t.check(resolved?.source, "claude-scans");

  // doctest:L115
  await fs.rm(root, { recursive: true, force: true });
});

// A blank legacy file counts as absent:
void test("A blank legacy file counts as absent:", async (t) => {
  // doctest:L121
  const root = await makeBoxDir();
  await fs.writeFile(path.join(root, "CLAUDE_SCANS.md"), "   \n");
  t.check(await readScanContextFile(root), null);

  // doctest:L126
  t.check(await resolveScanGuideContext(root), null);

  // doctest:L129
  await fs.rm(root, { recursive: true, force: true });
});

// ## A present-but-invalid guide card is a hard error, never a silent skip
//
// Each parse stage names itself: missing frontmatter, YAML syntax, schema
// validation. Scanning without priors would commit misread names silently, so
// the resolver refuses instead.
void test("Each parse stage names itself:", async (t) => {
  // doctest:L139
  async function resolveError(root: string) {
    try {
      await resolveScanGuideContext(root);
      return "(no error)";
    } catch (e) {
      return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }

  // doctest:L148
  const root = await makeBoxDir();
  await writeGuide(root, "just prose, no frontmatter\n");
  await t.checkText((await resolveError(root)).includes("ScanGuideParseError: _config/scan.guide.card has no YAML frontmatter"), "true");

  // doctest:L153
  await writeGuide(root, "---\nversion: [unclosed\n---\n");
  await t.checkText((await resolveError(root)).startsWith("ScanGuideParseError: _config/scan.guide.card has invalid YAML:"), "true");

  // doctest:L157
  await writeGuide(root, "---\ntriage-rules: 5\n---\n");
  t.check(await resolveError(root), "ScanGuideParseError: _config/scan.guide.card fails guide schema validation: triage-rules: Invalid input: expected array, received number — fix the card (bbx validate _config/scan.guide.card)");

  // doctest:L161
  await fs.rm(root, { recursive: true, force: true });
});
