// Story-extraction ingest tool (run via tsx: `pnpm --dir site ingest ...`, see
// --help). Turns the raw JSON an extraction subagent emits ({"nuggets":[...]})
// into the run files the story-eval review app reads (dev/apps/story-eval/runs/<run>/).
// It is the honesty boundary of the extraction loop: every nugget is validated
// against a strict zod schema and every span is verified to appear VERBATIM in
// its source document. A fabricated span (0 occurrences) is a hard error naming
// the nugget — never written out (engineering principle 4). Any validation,
// JSON, or span failure fails the whole run closed (nothing written, non-zero
// exit); success prints one summary line per run file and nothing else. See
// beebox/docs/plans/github-pages-site-story-extraction.subplan.md, Track B.

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { locateSpan, type SpanCheck } from "./span-locate.js";

// site/story/ingest.ts → repo root is two levels up from site/.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const DEFAULT_RUNS_DIR = path.join(REPO_ROOT, "dev", "apps", "story-eval", "runs");

/** A hard, fail-closed ingest failure: bad input, a fabricated span, etc. */
export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}

// --- schema (strict) ----------------------------------------------------------

// Variants are the committed prompt set in site/story/prompts/ (v1/v2/v3). The
// subplan's flag sketch said "<v1|v2>", but v3-outsider-surprise is a real
// variant the seed runs already use, so all three are accepted.
const VARIANTS = ["v1", "v2", "v3"] as const;
const variantSchema = z.enum(VARIANTS);
export type Variant = z.infer<typeof variantSchema>;

const kebabCase = z.string().regex(/^[\da-z]+(?:-[\da-z]+)*$/, "must be kebab-case");

// The raw nugget shape an extraction subagent emits — no spanCheck (ingest
// computes that). Strict: an unknown key (e.g. a stray spanCheck) is rejected.
const rawNuggetSchema = z.strictObject({
  slug: kebabCase,
  span: z.string().min(1),
  gloss: z.string().min(1),
  tags: z.array(kebabCase),
  // A run-2 agent emitted a nonexistent criterion 12 — the rubric has 8.
  criteria: z.array(z.number().int().min(1).max(8)).min(1),
  confidence: z.enum(["strong", "generous"]),
});
export type RawNugget = z.infer<typeof rawNuggetSchema>;

const rawFileSchema = z.strictObject({ nuggets: z.array(rawNuggetSchema) });

/** An output nugget: the raw shape plus the verified spanCheck verdict. */
export interface OutputNugget extends RawNugget {
  spanCheck: SpanCheck;
}

/** A run file, in the exact key order the review app reads (docText last). */
export interface RunFile {
  run: string;
  variant: Variant;
  doc: string;
  nuggets: OutputNugget[];
  docText: string;
}

// --- core ingest --------------------------------------------------------------

function formatIssuePath(parts: readonly PropertyKey[]): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out || "(root)";
}


/**
 * Validate one raw extraction file and verify every span against its source.
 * Throws IngestError (naming file + nugget index + field, or the fabricated
 * nugget) on any hard failure. Pure: takes already-read text, touches no disk.
 */
export function buildRunFile(params: {
  run: string;
  variant: Variant;
  doc: string;
  docText: string;
  fileName: string;
  rawJson: unknown;
}): RunFile {
  const { run, variant, doc, docText, fileName, rawJson } = params;
  const parsed = rawFileSchema.safeParse(rawJson);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `${fileName}: ${formatIssuePath(issue.path)}: ${issue.message}`,
    );
    throw new IngestError(`invalid extraction output:\n  ${lines.join("\n  ")}`);
  }

  const nuggets: OutputNugget[] = [];
  for (const [index, nugget] of parsed.data.nuggets.entries()) {
    const located = locateSpan(docText, nugget.span);
    if (located.kind === "missing") {
      throw new IngestError(
        `${fileName}: nugget "${nugget.slug}" (index ${index}): span not found in ` +
          `${doc} (even under whitespace normalization) — fabricated span, refusing to write`,
      );
    }
    // Store located.span — the canonical SOURCE substring — never the agent's
    // copy, so a whitespace-recovered span is still verbatim in the output.
    nuggets.push({
      slug: nugget.slug,
      span: located.span,
      gloss: nugget.gloss,
      tags: nugget.tags,
      criteria: nugget.criteria,
      confidence: nugget.confidence,
      spanCheck: located.kind,
    });
  }

  return { run, variant, doc, nuggets, docText };
}

// --- CLI ----------------------------------------------------------------------

interface IngestItem {
  variant: Variant;
  doc: string;
  input: string;
  label: string | undefined;
}

interface CliPlan {
  run: string;
  outDir: string;
  items: IngestItem[];
  /** Directory that item `input`/`out` paths resolve against. */
  baseDir: string;
}

const HELP = `story ingest — validate raw extraction output into review run files

Inline (one or more --in triples share a sticky --variant/--doc):
  ingest --run <run-id> --variant <v1|v2|v3> --doc <repo-rel> --in <raw.json>
         [--label <slug>] [--variant ... --doc ... --in ...] [--out <dir>]
Manifest:
  ingest --manifest <manifest.json> [--out <dir>]

  --run <id>      Run id, e.g. run-004 (required unless the manifest sets it).
  --variant <v>   v1 | v2 | v3 — sticks across later --in until changed.
  --doc <path>    Source doc, repo-root-relative — sticks like --variant.
  --in <raw>      A raw extraction file; flushes one item (variant+doc+input).
  --label <slug>  Output filename slug for the NEXT --in (default: doc basename).
  --out <dir>     Output directory (default: dev/apps/story-eval/runs/<run-id>).
  --manifest <f>  JSON {run, out?, inputs:[{variant,doc,input,label?}]}; input
                  and out paths resolve against the manifest's directory.
  --help          Show this help.

Output: one run file per input, named <variant>-<label>.json, in the app's
shape plus an embedded "docText". Every span is verified verbatim against its
source; a fabricated span is a hard error and nothing is written.`;

const manifestSchema = z.strictObject({
  run: z.string().min(1),
  out: z.string().min(1).optional(),
  inputs: z
    .array(
      z.strictObject({
        variant: variantSchema,
        doc: z.string().min(1),
        input: z.string().min(1),
        label: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

// Split "--flag=value" once; returns [flag, value|undefined].
function splitFlag(arg: string): { flag: string; inline: string | undefined } {
  const eq = arg.indexOf("=");
  if (arg.startsWith("--") && eq !== -1) return { flag: arg.slice(0, eq), inline: arg.slice(eq + 1) };
  return { flag: arg, inline: undefined };
}

interface InlineArgs {
  run: string | undefined;
  out: string | undefined;
  manifest: string | undefined;
  items: IngestItem[];
}

function parseInlineArgs(argv: readonly string[]): InlineArgs {
  let run: string | undefined;
  let out: string | undefined;
  let manifest: string | undefined;
  let variant: Variant | undefined;
  let doc: string | undefined;
  let label: string | undefined;
  const items: IngestItem[] = [];

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] ?? "";
    const { flag, inline } = splitFlag(raw);
    const take = (): string => {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new IngestError(`${flag} requires a value`);
      return value;
    };
    switch (flag) {
      case "--run":
        run = take();
        break;
      case "--out":
        out = take();
        break;
      case "--manifest":
        manifest = take();
        break;
      case "--variant":
        variant = variantSchema.parse(take());
        break;
      case "--doc":
        doc = take();
        break;
      case "--label":
        label = take();
        break;
      case "--in": {
        const input = take();
        if (variant === undefined || doc === undefined) {
          throw new IngestError("--in requires a preceding --variant and --doc");
        }
        items.push({ variant, doc, input, label });
        label = undefined; // a label applies to one --in only
        break;
      }
      default:
        throw new IngestError(`unknown argument: ${raw}`);
    }
  }
  return { run, out, manifest, items };
}

async function planFromManifest(manifestPath: string, outOverride: string | undefined): Promise<CliPlan> {
  const abs = path.resolve(process.cwd(), manifestPath);
  const raw = await fs.readFile(abs, "utf8").catch((e: unknown) => {
    throw new IngestError(`cannot read manifest ${manifestPath}: ${e instanceof Error ? e.message : String(e)}`);
  });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new IngestError(`manifest ${manifestPath}: invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
    throw new IngestError(`manifest ${manifestPath} is invalid:\n  ${lines.join("\n  ")}`);
  }
  const baseDir = path.dirname(abs);
  const items = parsed.data.inputs.map((e) => ({ variant: e.variant, doc: e.doc, input: e.input, label: e.label }));
  const out = outOverride ?? parsed.data.out;
  const outDir = out ? path.resolve(baseDir, out) : path.join(DEFAULT_RUNS_DIR, parsed.data.run);
  return { run: parsed.data.run, outDir, items, baseDir };
}

function planFromInline(args: InlineArgs): CliPlan {
  if (args.run === undefined) throw new IngestError("--run is required");
  if (args.items.length === 0) throw new IngestError("no inputs — pass at least one --in (or --manifest)");
  const baseDir = process.cwd();
  const outDir = args.out ? path.resolve(baseDir, args.out) : path.join(DEFAULT_RUNS_DIR, args.run);
  return { run: args.run, outDir, items: args.items, baseDir };
}

function outputFileName(item: IngestItem): string {
  const base = item.label ?? path.basename(item.doc).replace(/\.[^.]+$/, "");
  return `${item.variant}-${base}.json`;
}

async function readDocText(doc: string): Promise<string> {
  const abs = path.resolve(REPO_ROOT, doc);
  return fs.readFile(abs, "utf8").catch((e: unknown) => {
    throw new IngestError(`cannot read source doc ${doc}: ${e instanceof Error ? e.message : String(e)}`);
  });
}

async function readRawJson(input: string, baseDir: string): Promise<unknown> {
  const abs = path.resolve(baseDir, input);
  const text = await fs.readFile(abs, "utf8").catch((e: unknown) => {
    throw new IngestError(`cannot read extraction file ${input}: ${e instanceof Error ? e.message : String(e)}`);
  });
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new IngestError(`${input}: invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface BuiltFile {
  fileName: string;
  runFile: RunFile;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const args = parseInlineArgs(argv);
  if (args.manifest !== undefined && args.items.length > 0) {
    throw new IngestError("--manifest cannot be combined with inline --in triples");
  }
  const plan =
    args.manifest !== undefined ? await planFromManifest(args.manifest, args.out) : planFromInline(args);

  // Build (validate + span-check) EVERYTHING before writing anything, so a
  // fabricated span in a later file aborts the whole run — nothing partial lands.
  const built: BuiltFile[] = [];
  for (const item of plan.items) {
    const docText = await readDocText(item.doc);
    const rawJson = await readRawJson(item.input, plan.baseDir);
    const fileName = outputFileName(item);
    const runFile = buildRunFile({
      run: plan.run,
      variant: item.variant,
      doc: item.doc,
      docText,
      fileName,
      rawJson,
    });
    built.push({ fileName, runFile });
  }

  await fs.mkdir(plan.outDir, { recursive: true });
  const summary: string[] = [];
  for (const { fileName, runFile } of built) {
    const outPath = path.join(plan.outDir, fileName);
    await fs.writeFile(outPath, `${JSON.stringify(runFile, null, 2)}\n`, "utf8");
    const ok = runFile.nuggets.filter((n) => n.spanCheck === "ok").length;
    const ambiguous = runFile.nuggets.length - ok;
    summary.push(`${fileName}: ${runFile.nuggets.length} nugget(s), ${ok} ok, ${ambiguous} ambiguous`);
  }
  process.stdout.write(`${summary.join("\n")}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename;
if (invokedDirectly) {
  main().catch((e: unknown) => {
    process.stderr.write(`ingest failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
