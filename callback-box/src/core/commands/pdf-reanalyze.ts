/**
 * `cb pdf reanalyze <card>` — re-run extraction over an existing
 * `pdf.card`'s original file.
 *
 * Uncommon by design: it exists for the cases the intake-time default cannot
 * cover — a junk text layer that needs `--force-ocr`, a non-English document
 * that needs `--languages`, an extraction that failed and can now succeed, or
 * a newer Docling. Nothing automated calls it.
 *
 * The card's authored content survives: `description`, `title`, `contains`,
 * and every other field are read and written back untouched. Only the
 * extraction-derived parts — the body, `docling`, `metadata.pages`, `status`,
 * and `error` — are replaced, along with the page/figure assets in the attach
 * scope (stale ones from the previous run are removed first, so a re-run that
 * yields fewer pages leaves no orphans).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { splitCardContent } from "../../cards/index.js";
import { parseRef, resolveRefPath } from "../../shared/ref-path.js";
import { isRecord } from "../../lib/is-record.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { ensureBoxTmpDir } from "../../lib/box-tmp.js";
import { createDoclingService, type DoclingService } from "../../services/docling.js";
import { clearExtractionAssets, extractPdf } from "./pdf-extract.js";

const PdfReanalyzeArgsSchema = z.object({
  card: z.string(),
  "force-ocr": z.boolean().optional(),
  /** Comma-separated OCR language codes; only meaningful with `force-ocr`. */
  languages: z.string().optional(),
});

export interface PdfReanalyzeOptions {
  args: Record<string, unknown>;
  /** Injected in tests; production creates the real `uvx docling` wrapper. */
  docling?: DoclingService | undefined;
}

/**
 * Pull the original file's name out of the card's `filename.ref`. The ref is
 * always `attach/<name>` (the schema's own contract), so this reads the one
 * form rather than resolving arbitrary ref shapes.
 */
function originalFilename(fields: Record<string, unknown>): string | null {
  const filename = fields["filename"];
  if (!isRecord(filename)) return null;
  const ref = filename["ref"];
  if (typeof ref !== "string" || !ref.startsWith("attach/")) return null;
  const name = ref.slice("attach/".length);
  return name === "" || name.includes("/") ? null : name;
}

/**
 * Turn the `card` argument into a contained box-relative path, or null.
 *
 * The argument is user-supplied, so it goes through `shared/ref-path.ts` like
 * every other box path (CLAUDE.md): a `..` that climbs out of the box, or an
 * absolute path naming something outside it, resolves to `null` and becomes a
 * clean error here rather than a file read somewhere it shouldn't be. An
 * absolute path is relativized first so both forms meet the same check.
 */
function resolveCardRelPath(boxRoot: string, card: string): string | null {
  const relative = path.isAbsolute(card) ? path.relative(boxRoot, card) : card;
  return resolveRefPath({ fromPath: undefined, ref: parseRef(relative).path, kind: "card" });
}

export async function runPdfReanalyze(
  ctx: CommandContext,
  options: PdfReanalyzeOptions
): Promise<CommandResult> {
  const parsed = parseCommandArgs(options.args, PdfReanalyzeArgsSchema);
  const cardRelPath = resolveCardRelPath(ctx.boxRoot, parsed.card);
  if (cardRelPath === null) {
    return { success: false, error: `Card path is not inside the box: ${parsed.card}` };
  }
  const cardAbsPath = path.join(ctx.boxRoot, cardRelPath);
  if (!cardAbsPath.endsWith(".pdf.card")) {
    return { success: false, error: `Not a pdf card: ${cardRelPath}` };
  }

  let content: string;
  try {
    content = await fs.readFile(cardAbsPath, "utf-8");
  } catch (_e) {
    // The only failure that matters here is "no such card", and the path
    // already says everything the caller needs.
    return { success: false, error: `Card not found: ${cardRelPath}` };
  }
  const split = splitCardContent(content);
  const fields: unknown = parseYaml(split.frontmatterText);
  if (!isRecord(fields)) {
    return { success: false, error: `Card frontmatter is not a mapping: ${cardRelPath}` };
  }
  const original = originalFilename(fields);
  if (original === null) {
    return { success: false, error: `Card has no usable filename.ref: ${cardRelPath}` };
  }

  const cardBasename = path.basename(cardAbsPath).replace(/\.pdf\.card$/u, "");
  // `path.posix.join` rather than an interpolated `/`: a card at the box root
  // has dirname ".", which would otherwise produce a "./Foo.attach" prefix on
  // every staged path.
  const attachRelDir = path.posix.join(path.dirname(cardRelPath), `${cardBasename}.attach`);
  const attachAbsDir = path.join(ctx.boxRoot, attachRelDir);
  const sourcePath = path.join(attachAbsDir, original);
  try {
    await fs.access(sourcePath);
  } catch (_e) {
    // Without the original there is nothing to re-extract; the card's assets
    // are the whole input to this command.
    return { success: false, error: `Original file is missing: ${attachRelDir}/${original}` };
  }

  const languages = parsed.languages === undefined
    ? null
    : parsed.languages.split(",").map((l) => l.trim()).filter((l) => l !== "");
  const forceOcr = parsed["force-ocr"] === true;

  const removed = await clearExtractionAssets(attachAbsDir, { keep: original });
  const workDir = path.join(
    await ensureBoxTmpDir(ctx.boxRoot),
    `pdf-reanalyze-${randomUUID().slice(0, 8)}`
  );
  await fs.mkdir(workDir, { recursive: true });
  ctx.writeLine(`Reanalyzing ${cardRelPath}${forceOcr ? " (force-ocr)" : ""}...`);
  let extraction;
  try {
    extraction = await extractPdf({
      docling: options.docling ?? createDoclingService(),
      sourcePath,
      attachAbsDir,
      workDir,
      forceOcr,
      languages,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  const paths: string[] = [cardRelPath, ...removed.map((name) => `${attachRelDir}/${name}`)];
  let body: string;
  if (extraction.ok) {
    fields["status"] = "analyzed";
    fields["docling"] = {
      ref: `attach/${extraction.value.doclingFilename}`,
      version: extraction.value.doclingVersion,
    };
    const metadata = isRecord(fields["metadata"]) ? { ...fields["metadata"] } : {};
    metadata["pages"] = extraction.value.pageCount;
    fields["metadata"] = metadata;
    delete fields["error"];
    body = extraction.value.body;
    for (const name of extraction.value.assetNames) paths.push(`${attachRelDir}/${name}`);
    ctx.writeLine(`Extracted ${String(extraction.value.pageCount)} page(s)`);
  } else {
    // Same fallback as intake: the card goes back to unextracted-but-visible
    // rather than keeping a stale body that no longer matches its assets.
    fields["status"] = "new";
    fields["error"] = extraction.error;
    delete fields["docling"];
    body = "";
    console.warn(`[pdf] reanalyze failed for ${cardRelPath}: ${extraction.error}`);
    ctx.writeLine(`Extraction failed (status: new) — ${extraction.error}`);
  }

  await fs.writeFile(cardAbsPath, `---\n${stringifyYaml(fields)}---\n${body}`);
  await stageAndCommitPaths(ctx.boxRoot, {
    paths,
    message: `Pdf reanalyze: ${cardBasename}`,
    trailers: { "Created-By": "pdf-reanalyze" },
  });

  return {
    success: true,
    data: {
      card: cardRelPath,
      status: fields["status"],
      forceOcr,
      pages: extraction.ok ? extraction.value.pageCount : 0,
    },
  };
}

registerCommand({
  name: "pdf-reanalyze",
  description: "Re-run extraction over an existing pdf card's original file",
  args: [
    { name: "card", description: "Path to the .pdf.card (box-relative or absolute)", required: true, type: "string" },
    { name: "force-ocr", description: "Re-OCR every page, discarding the embedded text layer", required: false, type: "boolean" },
    { name: "languages", description: "Comma-separated OCR language codes (with --force-ocr)", required: false, type: "string" },
  ],
  execute: (ctx, args) => runPdfReanalyze(ctx, { args }),
});
