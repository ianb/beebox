/**
 * DoclingService — the slice of the Docling document extractor we drive.
 *
 * Docling is a Python tool; we shell out to it through `uvx` at a pinned
 * version (one cached uv environment per version, shared by every box on a
 * host because they all run as the same user). The interface is deliberately
 * one method: hand it a document and a scratch directory, get back either the
 * artifacts it produced or a human-readable reason it didn't. Extraction
 * failure is a *normal* outcome — the caller's job is to fall back to filing
 * the original bytes verbatim, never to blow up intake — so this returns a
 * `Result` rather than throwing.
 *
 * Every choice encoded here (the version pin, the flags, the timeouts, the
 * page-image handling) has a numbered entry in
 * `docs/plans/scanner-ingest-docling-decisions.md`. Change one, append there.
 */

import { execa } from "execa";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { err, ok, okVoid, type Result } from "../lib/result.js";
import { errorMessage } from "../lib/error-guards.js";
import { startAwakeTimeout } from "../lib/awake-timeout.js";
import { DOCLING_VERSION } from "./docling-version.js";

/**
 * Docling's own per-document budget, passed as `--document-timeout` (D6). It
 * covers conversion only, so the outer kill below is the one that also covers
 * model load and interpreter start.
 */
const DOCUMENT_TIMEOUT_SECONDS = 600;

/**
 * Outer kill, counted in *awake* time (D6). Larger than the inner budget
 * because a cold host still has to build the uv environment and load model
 * weights before conversion starts — but only by a few minutes: a run that has
 * not finished by then is stuck, not slow (boxholder review 2026-08-02).
 */
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

/** How much subprocess output travels into a failure message (which lands in a card's `error:`). */
const ERROR_DETAIL_LIMIT = 400;

/**
 * How much subprocess output we hold at once. Docling's output is only ever
 * read to build the failure message above, so everything past the tail is
 * discarded as it streams rather than buffered — a chatty run (a per-page
 * warning on a long document, a stack trace loop) must not grow the box's
 * server process by however much it decided to print.
 */
const OUTPUT_TAIL_BYTES = 64 * 1024;

/**
 * Bounds on what one extraction may hand back (D16). Docling controls how many
 * artifacts it writes and how big they are; everything past this point reads
 * them into memory and re-encodes them, so a pathological document (or a
 * Docling bug) would otherwise be unbounded work on the box's server process.
 *
 * Both numbers are sized to scanner reality, where a 200-page scan is already
 * huge — exceeding either means something is wrong, not that a document is
 * merely large, so the honest answer is an extraction failure (the caller falls
 * back to `status: new` + `error:` and intake still completes).
 */
export const MAX_EXTRACTION_ARTIFACTS = 500;
export const MAX_EXTRACTION_BYTES = 512 * 1024 ** 2;

export interface DoclingExtractOptions {
  /** Scratch directory Docling writes into. Caller owns creation and cleanup. */
  workDir: string;
  /** Re-OCR every page, discarding the embedded text layer. Off by default (D1). */
  forceOcr: boolean;
  /** OCR language codes, only meaningful with `forceOcr`. Null leaves Docling's default. */
  languages: string[] | null;
}

/** One page render or extracted figure, in document order. */
export interface DoclingImage {
  /** Absolute path to the PNG Docling wrote. */
  filePath: string;
  /** The name the markdown body references it by (the artifact's basename). */
  referencedAs: string;
}

export interface DoclingExtraction {
  /** Rendered markdown — may legitimately be empty (a document with no readable text). */
  markdown: string;
  /** Absolute path to the canonical `DoclingDocument` JSON. */
  jsonPath: string;
  /** Page renders, page 1 first. */
  pageImages: DoclingImage[];
  /** Extracted figures, in document order. */
  figures: DoclingImage[];
  /** Page count according to the extraction. */
  pageCount: number;
  /** The Docling release that produced this. */
  version: string;
}

export interface DoclingService {
  /** Extract `sourcePath`. A failure arm carries a message fit for a card's `error:` field. */
  extract(sourcePath: string, options: DoclingExtractOptions): Promise<Result<DoclingExtraction>>;
}

function condense(text: string): string {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  return flat.length > ERROR_DETAIL_LIMIT ? `${flat.slice(0, ERROR_DETAIL_LIMIT)}…` : flat;
}

/**
 * Build the CLI invocation. Split out so the decisions log has one place to
 * point at and the doctests can assert the exact argv without running anything.
 */
export function doclingArgs(sourcePath: string, options: DoclingExtractOptions): string[] {
  const args = [
    "--from", `docling==${DOCLING_VERSION}`,
    "docling", "convert", sourcePath,
    "--to", "md",
    "--to", "json",
    // Referenced mode is what makes page renders and figures land as real
    // files instead of base64 inside the JSON (D4).
    "--image-export-mode", "referenced",
    "--table-mode", "fast",
    // No GPU on the deploy target; `auto` would probe for one every run.
    "--device", "cpu",
    "--document-timeout", String(DOCUMENT_TIMEOUT_SECONDS),
    "--output", options.workDir,
    // Routine-success chatter is a bug (CLAUDE.md); warnings/errors still print.
    "-q",
  ];
  if (options.forceOcr) {
    // `--force-ocr` is deprecated in 2.117; `--ocr-mode full_page` is the
    // supported spelling for "replace the text layer wholesale" (D7).
    args.push("--ocr", "--ocr-mode", "full_page");
    if (options.languages && options.languages.length > 0) {
      args.push("--ocr-lang", options.languages.join(","));
    }
  } else {
    args.push("--no-ocr");
  }
  return args;
}

/** Recursively collect every file under `dir` (Docling nests its artifacts dir). */
async function walkFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await walkFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/**
 * Sort artifacts by the index Docling embeds in the filename
 * (`page_000001_<hash>.png`, `image_000000_<hash>.png`) rather than by string
 * order, which would put `page_000010` before `page_000002` on a long document.
 */
function byArtifactIndex(a: string, b: string): number {
  const index = (p: string): number => {
    const match = /_(\d+)_/u.exec(path.basename(p));
    return match?.[1] === undefined ? 0 : Number(match[1]);
  };
  return index(a) - index(b);
}

interface CollectedOutputs {
  markdown: string;
  jsonPath: string;
  pageImages: DoclingImage[];
  figures: DoclingImage[];
  pageCount: number;
}

/**
 * Read back what Docling wrote. Artifacts are found by walking the work dir
 * rather than by resolving the paths in the markdown/JSON: Docling emits those
 * relative to its own notion of the output root, which does not match the
 * on-disk location (it writes `<out>/<out>/<stem>_artifacts/…`). Basenames are
 * unique and carry the page/figure index, so they are the reliable key (D5).
 */
async function collectOutputs(workDir: string): Promise<Result<CollectedOutputs>> {
  const files = await walkFiles(workDir);
  const markdownPath = files.find((f) => f.endsWith(".md"));
  const jsonPath = files.find((f) => f.endsWith(".json"));
  if (markdownPath === undefined || jsonPath === undefined) {
    return err("Docling exited successfully but produced no markdown/JSON output");
  }
  const markdown = await fs.readFile(markdownPath, "utf-8");

  const artifacts = files.filter((f) => path.basename(path.dirname(f)).endsWith("_artifacts"));
  const toImage = (filePath: string): DoclingImage => ({
    filePath,
    referencedAs: path.basename(filePath),
  });
  const pageImages = artifacts
    .filter((f) => path.basename(f).startsWith("page_"))
    .toSorted(byArtifactIndex)
    .map(toImage);
  const figures = artifacts
    .filter((f) => path.basename(f).startsWith("image_"))
    .toSorted(byArtifactIndex)
    .map(toImage);

  return ok({
    markdown,
    jsonPath,
    pageImages,
    figures,
    pageCount: pageImages.length,
  });
}

/**
 * Is this extraction within the D16 bounds? Checked against the artifacts on
 * disk (not a self-report), so it holds for any {@link DoclingService} — the
 * real one, the fake, or a future replacement.
 *
 * Byte accounting includes the canonical JSON: it too is read whole into memory
 * before it is gzipped into the card.
 */
export async function checkExtractionBounds(extraction: DoclingExtraction): Promise<Result<void>> {
  const images = [...extraction.pageImages, ...extraction.figures];
  if (images.length > MAX_EXTRACTION_ARTIFACTS) {
    return err(
      `Docling produced ${String(images.length)} page/figure artifacts, over the limit of ${String(MAX_EXTRACTION_ARTIFACTS)}`
    );
  }
  let total = 0;
  for (const filePath of [extraction.jsonPath, ...images.map((image) => image.filePath)]) {
    total += (await fs.stat(filePath)).size;
    if (total > MAX_EXTRACTION_BYTES) {
      return err(
        `Docling produced more than ${String(MAX_EXTRACTION_BYTES)} bytes of artifacts, over the extraction limit`
      );
    }
  }
  return okVoid;
}

/**
 * Consume a subprocess output stream, keeping only its last
 * {@link OUTPUT_TAIL_BYTES}. The stream must be consumed either way (an
 * unconsumed pipe stalls the subprocess); this is what makes consuming it cheap.
 */
async function captureTail(stream: AsyncIterable<unknown> | undefined): Promise<string> {
  if (stream === undefined) return "";
  let tail = "";
  for await (const chunk of stream) {
    tail = (tail + String(chunk)).slice(-OUTPUT_TAIL_BYTES);
  }
  return tail;
}

export function createDoclingService(): DoclingService {
  return {
    async extract(sourcePath, options): Promise<Result<DoclingExtraction>> {
      const controller = new AbortController();
      // A plain multi-minute `setTimeout` fires the instant a sleeping laptop wakes
      // (CLAUDE.md, time discipline), which would kill a healthy extraction.
      const budget = startAwakeTimeout({
        timeoutMs: PROCESS_TIMEOUT_MS,
        onTimeout: () => controller.abort(),
      });
      try {
        const subprocess = execa("uvx", doclingArgs(sourcePath, options), {
          cancelSignal: controller.signal,
          reject: false,
          // Docling prints model-loading progress on stderr even under -q.
          all: true,
          // We read the output only to build a failure message, so stream it
          // through `captureTail` instead of letting execa buffer all of it.
          buffer: false,
        });
        const outputTail = captureTail(subprocess.all);
        const result = await subprocess;
        const output = await outputTail;
        if (controller.signal.aborted) {
          return err(`Docling did not finish within ${PROCESS_TIMEOUT_MS / 60_000} minutes and was stopped`);
        }
        if (result.exitCode !== 0) {
          return err(`Docling exited ${String(result.exitCode)}: ${condense(output)}`);
        }
        const collected = await collectOutputs(options.workDir);
        if (!collected.ok) return collected;
        return ok({ ...collected.value, version: DOCLING_VERSION });
      } catch (e) {
        // `uvx` missing from PATH, an unreadable work dir, a killed process —
        // all of them mean "no extraction", which is a card the agent can act
        // on rather than a crashed intake.
        return err(`Docling could not be run: ${condense(errorMessage(e))}`);
      } finally {
        budget.stop();
      }
    },
  };
}

// ─── Fake ────────────────────────────────────────────────────────────────────

export interface FakeDoclingOptions {
  /** Markdown the fake "extracts". Empty string models a text-free document. */
  markdown?: string;
  /** How many page renders to produce. */
  pageCount?: number;
  /** How many figures to produce. */
  figureCount?: number;
  /** When set, every call fails with this message instead. */
  failWith?: string;
}

export interface FakeDoclingService extends DoclingService {
  /** One entry per `extract` call, in order. */
  calls: Array<{ sourcePath: string; forceOcr: boolean; languages: string[] | null }>;
  describe(): string;
}

/** A 1x1 PNG — real bytes, so `sharp` can re-encode the fake's output for real. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export function createFakeDocling(options: FakeDoclingOptions): FakeDoclingService {
  const markdown = options.markdown === undefined ? "# Fake Document\n\nExtracted body.\n" : options.markdown;
  const pageCount = options.pageCount === undefined ? 1 : options.pageCount;
  const figureCount = options.figureCount === undefined ? 0 : options.figureCount;
  const calls: FakeDoclingService["calls"] = [];

  return {
    calls,
    async extract(sourcePath, extractOptions): Promise<Result<DoclingExtraction>> {
      calls.push({
        sourcePath,
        forceOcr: extractOptions.forceOcr,
        languages: extractOptions.languages,
      });
      if (options.failWith !== undefined) return err(options.failWith);

      const artifactsDir = path.join(extractOptions.workDir, "source_artifacts");
      await fs.mkdir(artifactsDir, { recursive: true });
      const write = async (name: string): Promise<DoclingImage> => {
        const filePath = path.join(artifactsDir, name);
        await fs.writeFile(filePath, TINY_PNG);
        return { filePath, referencedAs: name };
      };
      const pageImages: DoclingImage[] = [];
      for (let i = 0; i < pageCount; i++) {
        pageImages.push(await write(`page_${String(i + 1).padStart(6, "0")}_fake.png`));
      }
      const figures: DoclingImage[] = [];
      for (let i = 0; i < figureCount; i++) {
        figures.push(await write(`image_${String(i).padStart(6, "0")}_fake.png`));
      }

      const jsonPath = path.join(extractOptions.workDir, "source.json");
      await fs.writeFile(jsonPath, JSON.stringify({ schema_name: "DoclingDocument", name: "source" }));

      return ok({
        markdown,
        jsonPath,
        pageImages,
        figures,
        pageCount,
        version: `${DOCLING_VERSION}-fake`,
      });
    },
    describe(): string {
      const lines = [`docling fake (${options.failWith === undefined ? "succeeds" : "fails"}), ${calls.length} call(s)`];
      for (const call of calls) {
        const languages = call.languages === null ? "-" : call.languages.join(",");
        lines.push(`  ${path.basename(call.sourcePath)} force-ocr=${String(call.forceOcr)} languages=${languages}`);
      }
      return lines.join("\n");
    },
  };
}
