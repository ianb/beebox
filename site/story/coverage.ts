// Story-extraction coverage ledger. Run via tsx from the site/ package:
//
//   pnpm --dir site coverage           # regenerate site/story/coverage.json
//   pnpm --dir site coverage --check   # drift report; nonzero exit if any drift
//
// The extraction runs themselves (dev/apps/story-eval/runs/) are GITIGNORED — the
// triage process is untracked, only outcomes are. This ledger is the one
// committable record of WHICH repo docs have been scanned, in which runs and
// variants, and whether the content we scanned still matches what's on disk.
//
// For each doc it records a scannedContentHash. When a run file embeds docText
// (ingest.ts does this now) we hash that exact scanned text ("scanned-text");
// for older run files without docText we hash the doc's CURRENT content and say
// so ("current-file"), so the provenance is honest — a current-file entry is
// trivially "current" and can never report drift.
//
// Deterministic (docs sorted by path) so diffs stay clean. Regenerating prints
// one summary line; --check prints what needs re-scanning. See the story-
// extraction subplan, Track B.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// site/story/coverage.ts → repo root is two levels up from site/.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const RUNS_DIR = path.join(REPO_ROOT, "dev", "apps", "story-eval", "runs");
const LEDGER_PATH = path.join(import.meta.dirname, "coverage.json");

const LEDGER_NOTE =
  "Coverage ledger for story extraction: which repo docs have been scanned, in " +
  "which runs/variants, and whether the scanned content still matches disk. The " +
  "runs themselves (dev/apps/story-eval/runs/) are gitignored — this ledger is the only " +
  "tracked record. Regenerate with `pnpm --dir site coverage`; find docs needing a " +
  "re-scan with `pnpm --dir site coverage --check`.";

/** A hard, fail-closed coverage failure. */
export class CoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageError";
  }
}

// Short content fingerprint — first 16 hex of SHA-256. Replicated locally from
// callback-box/src/lib/content-hash.ts (site/ can't import engine internals).
function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** One scanned run file's contribution to the ledger. */
export interface RunFileRecord {
  run: string;
  variant: string;
  doc: string;
  nuggetCount: number;
  /** The exact text that was scanned, when the run file preserved it. */
  docText: string | undefined;
}

type HashSource = "scanned-text" | "current-file";

export interface DocCoverage {
  doc: string;
  runs: string[];
  variants: string[];
  nuggetCount: number;
  scannedContentHash: string;
  hashSource: HashSource;
  current: boolean;
}

export interface Ledger {
  note: string;
  generatedAt: string;
  docs: DocCoverage[];
}

// --- pure aggregation ---------------------------------------------------------

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted((a, b) => a.localeCompare(b));
}

function coverageForDoc(params: {
  doc: string;
  records: readonly RunFileRecord[];
  currentHash: string | undefined;
}): DocCoverage {
  const { doc, records, currentHash } = params;
  // Prefer the latest run that preserved its scanned text; run ids are
  // zero-padded (run-001…), so a string max is the newest.
  const withText = records.filter((r) => r.docText !== undefined);
  const latest = withText.toSorted((a, b) => b.run.localeCompare(a.run))[0];

  let scannedContentHash: string;
  let hashSource: HashSource;
  if (latest?.docText !== undefined) {
    scannedContentHash = contentHash(latest.docText);
    hashSource = "scanned-text";
  } else if (currentHash !== undefined) {
    scannedContentHash = currentHash;
    hashSource = "current-file";
  } else {
    throw new CoverageError(
      `doc "${doc}" is referenced by a run with no embedded docText and is missing on disk — ` +
        "cannot establish scanned content",
    );
  }

  return {
    doc,
    runs: sortedUnique(records.map((r) => r.run)),
    variants: sortedUnique(records.map((r) => r.variant)),
    nuggetCount: records.reduce((sum, r) => sum + r.nuggetCount, 0),
    scannedContentHash,
    hashSource,
    current: currentHash !== undefined && currentHash === scannedContentHash,
  };
}

/**
 * Build the ledger from scanned records and the current on-disk hash of each doc
 * (undefined = the doc is missing on disk now). Pure: no filesystem, no clock —
 * `now` and hashes are supplied, so two calls with identical inputs are
 * byte-identical.
 */
export function buildLedger(params: {
  records: readonly RunFileRecord[];
  currentHashByDoc: ReadonlyMap<string, string | undefined>;
  now: string;
}): Ledger {
  const { records, currentHashByDoc, now } = params;
  const byDoc = new Map<string, RunFileRecord[]>();
  for (const record of records) {
    (byDoc.get(record.doc) ?? byDoc.set(record.doc, []).get(record.doc) ?? []).push(record);
  }
  const docs = [...byDoc.keys()]
    .toSorted((a, b) => a.localeCompare(b))
    .map((doc) => coverageForDoc({ doc, records: byDoc.get(doc) ?? [], currentHash: currentHashByDoc.get(doc) }));
  return { note: LEDGER_NOTE, generatedAt: now, docs };
}

// --- filesystem scan ----------------------------------------------------------

const RUN_FILE_KEYS = ["run", "variant", "doc", "nuggets"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRunFile(where: string, text: string): RunFileRecord {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new CoverageError(`${where}: invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isRecord(json)) {
    throw new CoverageError(`${where}: expected a JSON object`);
  }
  const record = json;
  for (const key of RUN_FILE_KEYS) {
    if (!(key in record)) throw new CoverageError(`${where}: missing "${key}"`);
  }
  const { run, variant, doc, nuggets, docText } = record;
  if (typeof run !== "string" || typeof variant !== "string" || typeof doc !== "string") {
    throw new CoverageError(`${where}: run, variant, and doc must be strings`);
  }
  if (!Array.isArray(nuggets)) throw new CoverageError(`${where}: "nuggets" must be an array`);
  return { run, variant, doc, nuggetCount: nuggets.length, docText: typeof docText === "string" ? docText : undefined };
}

async function scanRuns(runsDir: string): Promise<RunFileRecord[]> {
  const entries = await fs.readdir(runsDir, { withFileTypes: true }).catch((e: unknown) => {
    throw new CoverageError(`cannot read runs directory ${runsDir}: ${e instanceof Error ? e.message : String(e)}`);
  });
  const records: RunFileRecord[] = [];
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    // Skip *-raw dirs (pre-ingest inputs) and anything that isn't a run dir.
    if (!entry.isDirectory() || !entry.name.startsWith("run-") || entry.name.endsWith("-raw")) continue;
    const dir = path.join(runsDir, entry.name);
    const files = (await fs.readdir(dir)).toSorted((a, b) => a.localeCompare(b));
    for (const file of files) {
      if (!file.endsWith(".json")) continue; // skips self-review.md etc.
      const text = await fs.readFile(path.join(dir, file), "utf8");
      records.push(parseRunFile(`${entry.name}/${file}`, text));
    }
  }
  return records;
}

// A doc absent from the returned map is missing on disk — buildLedger reads
// that as "no current hash" (drift for a scanned-text entry).
async function currentHashes(docs: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const doc of docs) {
    try {
      const content = await fs.readFile(path.resolve(REPO_ROOT, doc), "utf8");
      map.set(doc, contentHash(content));
    } catch (_e) {
      /* ignore: doc missing on disk → absent from map → treated as drift downstream */
    }
  }
  return map;
}

async function generate(now: string): Promise<Ledger> {
  const records = await scanRuns(RUNS_DIR);
  const currentHashByDoc = await currentHashes([...new Set(records.map((r) => r.doc))]);
  return buildLedger({ records, currentHashByDoc, now });
}

// --- CLI ----------------------------------------------------------------------

const HELP = `story coverage — the tracked ledger of which docs have been scanned

  pnpm --dir site coverage           Regenerate site/story/coverage.json + summary.
  pnpm --dir site coverage --check   Report docs whose content drifted from their
                                     scanned hash; nonzero exit if any. Writes nothing.

The extraction runs (dev/apps/story-eval/runs/) are gitignored; this ledger is the
only tracked record. Whether an unscanned doc belongs in the corpus is a human
call — --check flags drift, it does not enumerate the repo.`;

function reportCheck(ledger: Ledger): number {
  const drifted = ledger.docs.filter((d) => !d.current);
  const lines: string[] = [];
  if (drifted.length === 0) {
    lines.push(`coverage --check: ${ledger.docs.length} doc(s) scanned, all current.`);
  } else {
    lines.push(`coverage --check: ${drifted.length} of ${ledger.docs.length} doc(s) drifted — re-scan:`);
    for (const d of drifted) lines.push(`  ${d.doc} (last scanned in ${d.runs.join(", ")})`);
  }
  lines.push("Unscanned docs are not listed: corpus candidacy is a human call, not an enumeration.");
  process.stdout.write(`${lines.join("\n")}\n`);
  return drifted.length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const check = argv.includes("--check");
  const unknown = argv.find((a) => a !== "--check");
  if (unknown !== undefined) throw new CoverageError(`unknown argument: ${unknown}`);

  const ledger = await generate(new Date().toISOString());
  if (check) {
    process.exitCode = reportCheck(ledger);
    return;
  }

  await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  const current = ledger.docs.filter((d) => d.current).length;
  const drifted = ledger.docs.length - current;
  process.stdout.write(`coverage: ${ledger.docs.length} docs scanned, ${current} current, ${drifted} drifted\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename;
if (invokedDirectly) {
  main().catch((e: unknown) => {
    process.stderr.write(`coverage failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
