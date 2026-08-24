/**
 * ClaudeScanVision — the default scan-import photo-analysis backend: Claude
 * Sonnet via the Claude Agent SDK, riding the same subscription auth the
 * reactor uses (no per-deployment API key).
 *
 * Shape of every call (measured configuration — see
 * `docs/plans/scan-vision-claude.md` and `scratch/model-comparison/REPORT.md`):
 * one stateless `query()` per small batch, images inlined as base64 (the
 * file-path/Read variant measured 2× cost, 5× latency, and one lost page),
 * outline-then-capture prompting with a machine-checked slot invariant, and a
 * hermetic call surface (`tools: []`, `settingSources: []`). `subject_bbox`
 * is schema-forced to null — Sonnet's boxes carry a systematic y-offset and
 * are never trusted. Rotation is best-effort (measured inconsistent).
 */

import type { SDKUserMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { MODEL_ID } from "../shared/model-ids.js";
import { resolveClaudeCodeBinary } from "../core/sdk-binary-path.js";
import { buildScriptEnv } from "../core/script-env.js";
import { dropUndefined } from "../lib/drop-undefined.js";
import { errorMessage } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";
import {
  assertBatchAlignment,
  buildScanPrompt,
  rawScanAnalysisSchema,
  ScanBatchMisalignedError,
  type BatchUsage,
  type RawScanAnalysis,
} from "../core/commands/scan-import-gemini.js";
import {
  ScanVisionBatchError,
  type ScanVisionResult,
  type ScanVisionService,
} from "./scan-vision.js";

const MAX_TURNS = 8;

const slotSchema = z.object({
  slot: z.int(),
  label: z.string(),
  text: z.string(),
  legibility: z.enum(["clear", "partial", "illegible"]),
});

/**
 * The Claude wire schema: `rawScanAnalysisSchema` plus the outline fields,
 * with the Claude-facing contract tightened — integer indices, rotation
 * restricted to the four values the image card accepts, and `subject_bbox`
 * forced to null at the schema level (a non-null box fails the parse).
 */
export const claudeScanAnalysisSchema = rawScanAnalysisSchema.extend({
  index: z.int(),
  paired_with_index: z.int().nullable(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  subject_bbox: z.null(),
  slot_count: z.int(),
  slots: z.array(slotSchema),
});
type ClaudeScanAnalysis = z.infer<typeof claudeScanAnalysisSchema>;

const claudeResponseSchema = z.object({ pages: z.array(claudeScanAnalysisSchema) });

/** Drop the vacuous MAX_SAFE_INTEGER bounds `z.toJSONSchema` puts on `z.int()`
 *  — structured-output dialects commonly reject numeric range constraints. */
function stripIntBounds(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripIntBounds(item);
    return;
  }
  if (!isRecord(node)) return;
  const record = node;
  if (record["type"] === "integer") {
    delete record["minimum"];
    delete record["maximum"];
  }
  for (const value of Object.values(record)) stripIntBounds(value);
}

/** The JSON Schema handed to the SDK's `outputFormat` — generated, not hand-written. */
export function claudeScanWireSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(claudeResponseSchema);
  // The CLI validates --json-schema with a draft-07 ajv; the 2020-12 `$schema`
  // marker z.toJSONSchema emits makes it reject the whole schema ("no schema
  // with key or ref"). The structure is draft-07-compatible, so drop the marker.
  delete schema["$schema"];
  stripIntBounds(schema);
  return schema;
}

/**
 * Backend-specific prompt suffix: index convention plus the two-phase
 * outline-then-capture procedure (Experiment A) that keeps transcription
 * complete on handwriting-dense pages and yields per-slot legibility.
 */
export const CLAUDE_SCAN_NOTE = `
The images are supplied in batch order; image at position i is page index i (0-based).
Always set subject_bbox to null.

TRANSCRIPTION PROCEDURE — apply BOTH phases to EVERY page, in this single response.

PHASE 1 — ENUMERATE. For each page, before transcribing anything, survey the whole
page and count its discrete written units: guestbook entries, signature lines,
journal lines/paragraphs, form fields, printed blocks — whatever unit that page is
made of. Emit that count as slot_count and list every unit in slots[], in reading
order, each with a short positional label (e.g. "row 3, left column", "line 7").
Enumerate by physical position: you must be able to point at each slot on the page
WITHOUT having read it. A unit you cannot read at all still gets a slot. A page with
no written units has slot_count 0 and empty slots.

PHASE 2 — CAPTURE. Emit exactly one entry in slots[] per enumerated unit, with slot
numbers 1..slot_count and no gaps. For each slot give your best reading in "text".
"Illegible" is a per-slot verdict, never a page-level one, and even an illegible
slot must carry your best partial reading: the letters, word shapes, or word count
you can make out. Set legibility to "clear", "partial", or "illegible". NEVER write
a summary phrase like "(remaining entries illegible)" — that is a bail, not a
transcription. If you are uncertain, guess and mark it partial.

Then fill text_blocks as usual (the full page text, concatenated from that page's
slots) plus the rest of the page fields.

Return a single JSON object: {"pages": [ ...one object per page, in index order... ]}.
`;

/** The model's enumeration must be internally consistent: `slots.length ===
 *  slot_count` and slot numbers exactly `1..slot_count`. */
class ScanSlotInvariantError extends ScanVisionBatchError {
  constructor({ index, usage, costUsd }: { index: number; usage: BatchUsage | null; costUsd: number | null }) {
    super(`page ${String(index)} broke the slot invariant (slot_count vs slots numbering)`, {
      retry: "split",
      usage,
      costUsd,
    });
    this.name = "ScanSlotInvariantError";
  }
}

/** The SDK returned an error result (or a success we cannot use). */
class ClaudeScanFailedError extends ScanVisionBatchError {
  constructor({
    detail,
    retry,
    usage,
    costUsd,
  }: {
    detail: string;
    retry: "transient" | "split" | "batch";
    usage: BatchUsage | null;
    costUsd: number | null;
  }) {
    super(`Claude scan analysis failed: ${detail}`, { retry, usage, costUsd });
    this.name = "ClaudeScanFailedError";
  }
}

/** `structured_output` did not match the generated wire schema. */
class ClaudeScanSchemaError extends ScanVisionBatchError {
  constructor({ detail, usage, costUsd }: { detail: string; usage: BatchUsage | null; costUsd: number | null }) {
    super(`Claude scan output failed schema validation: ${detail}`, { retry: "split", usage, costUsd });
    this.name = "ClaudeScanSchemaError";
  }
}

/** The query stream ended without ever yielding a result message. */
class ClaudeScanNoResultError extends ScanVisionBatchError {
  constructor() {
    super("Claude scan query ended without a result message", { retry: "fatal" });
    this.name = "ClaudeScanNoResultError";
  }
}

/** The SDK subprocess itself could not run (spawn/auth-level failure). */
class ClaudeScanSubprocessError extends ScanVisionBatchError {
  constructor({ detail, cause }: { detail: string; cause: unknown }) {
    super(`Claude scan subprocess failed: ${detail}`, { retry: "fatal", cause });
    this.name = "ClaudeScanSubprocessError";
  }
}

function checkSlotInvariant(page: ClaudeScanAnalysis): boolean {
  if (page.slots.length !== page.slot_count) return false;
  const numbers = page.slots.map((s) => s.slot).toSorted((a, b) => a - b);
  return numbers.every((n, i) => n === i + 1);
}

/**
 * Fold per-slot legibility into the review channel: any non-`clear` slot
 * forces `flag_for_review` with a compact slot list, turning "this page needs
 * review" into "these rows need review" (the Experiment A product win)
 * without any card-schema change.
 */
export function foldSlotsIntoReviewFlags(page: ClaudeScanAnalysis): RawScanAnalysis {
  const { slots, slot_count: _slotCount, ...rest } = page;
  const hard = slots.filter((s) => s.legibility !== "clear");
  if (hard.length === 0) return rest;
  const slotList = hard.map((s) => `${String(s.slot)} (${s.legibility})`).join(", ");
  const note = `Slots needing review: ${slotList}`;
  return {
    ...rest,
    flag_for_review: true,
    flag_reason: rest.flag_reason === null ? note : `${rest.flag_reason}; ${note}`,
  };
}

function toBatchUsage(result: SDKResultMessage): BatchUsage {
  const usage = result.usage;
  return {
    prompt: usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
    // The SDK reports no separate thinking count; it is folded into output.
    output: usage.output_tokens,
    thinking: 0,
  };
}

/** Rate/capacity blips are worth re-attempting the same batch. */
function isTransientClaudeFailure(text: string): boolean {
  return /rate.?limit|overloaded|529|429/iu.test(text);
}

export function createClaudeScanVision({ boxRoot }: { boxRoot: string }): ScanVisionService {
  return {
    backend: "claude",
    // Measured at 3 (scratch/model-comparison/run-batch3.ts): completeness
    // holds, pairing stays co-visible with sliding overlap, and the harness
    // preamble amortizes over 3 pages.
    batchSize: 3,
    async analyzeBatch(args): Promise<ScanVisionResult> {
      const images = [];
      for (const imagePath of args.imagePaths) {
        images.push((await fs.readFile(imagePath)).toString("base64"));
      }
      const text = buildScanPrompt(args.boxholderContext) + "\n" + CLAUDE_SCAN_NOTE;

      const result = await runScanQuery({ boxRoot, text, images });
      const usage = toBatchUsage(result);
      const costUsd = result.total_cost_usd;

      if (result.subtype !== "success") {
        const detail = result.subtype === "error_during_execution" ? result.errors.join("; ") : result.subtype;
        const retry =
          result.subtype === "error_max_structured_output_retries"
            ? "split"
            : isTransientClaudeFailure(detail)
              ? "transient"
              : "batch";
        throw new ClaudeScanFailedError({ detail, retry, usage, costUsd });
      }

      const analyses = parseClaudeScanBatch(result.structured_output, {
        imageCount: args.imagePaths.length,
        usage,
        costUsd,
      });
      return { analyses, usage, costUsd };
    },
  };
}

/**
 * The parse boundary from `structured_output` to post-conditioned analyses:
 * Zod validation, the per-page slot invariant, legibility→flag folding, and
 * batch alignment. Exported so the doctest can exercise it with canned
 * SDK-shaped fixtures, no subprocess involved.
 */
export function parseClaudeScanBatch(
  structuredOutput: unknown,
  { imageCount, usage, costUsd }: { imageCount: number; usage: BatchUsage | null; costUsd: number | null }
): RawScanAnalysis[] {
  const parsed = claudeResponseSchema.safeParse(structuredOutput);
  if (!parsed.success) {
    throw new ClaudeScanSchemaError({ detail: parsed.error.message, usage, costUsd });
  }
  const analyses: RawScanAnalysis[] = [];
  for (const page of parsed.data.pages) {
    if (!checkSlotInvariant(page)) {
      throw new ScanSlotInvariantError({ index: page.index, usage, costUsd });
    }
    analyses.push(foldSlotsIntoReviewFlags(page));
  }
  try {
    assertBatchAlignment(analyses, imageCount);
  } catch (e) {
    if (e instanceof ScanBatchMisalignedError) {
      throw new ScanVisionBatchError(e.message, { retry: "split", usage, costUsd, cause: e });
    }
    throw e;
  }
  return analyses;
}

/** One hermetic SDK call; throws `ScanVisionBatchError` (`fatal`) when the
 *  subprocess itself cannot run (spawn/auth-level failures). */
async function runScanQuery({
  boxRoot,
  text,
  images,
}: {
  boxRoot: string;
  text: string;
  images: string[];
}): Promise<SDKResultMessage> {
  // CLAUDECODE is unset so the SDK can run nested inside Claude Code;
  // buildScriptEnv strips ANTHROPIC_API_KEY to force subscription auth
  // (same conventions as core/agent/run.ts).
  const env = dropUndefined(await buildScriptEnv(boxRoot, { CLAUDECODE: undefined }));
  const binaryPath = resolveClaudeCodeBinary();

  const userMessage: SDKUserMessage = {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map(
          (data) =>
            ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }) as const
        ),
      ],
    },
    parent_tool_use_id: null,
    session_id: "",
  };
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    yield userMessage;
  }

  try {
    // Dynamic — see `core/agent/stream.ts`: keeps the Agent SDK out of the
    // startup graph of every `cb` invocation that never asks for vision.
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const q = query({
      prompt: prompt(),
      options: {
        model: MODEL_ID.sonnet,
        maxTurns: MAX_TURNS,
        cwd: boxRoot,
        env,
        tools: [],
        settingSources: [],
        systemPrompt: { type: "preset", preset: "claude_code" },
        outputFormat: { type: "json_schema", schema: claudeScanWireSchema() },
        ...(binaryPath === null ? {} : { pathToClaudeCodeExecutable: binaryPath }),
      },
    });
    let result: SDKResultMessage | null = null;
    for await (const msg of q) {
      if (msg.type === "result") result = msg;
    }
    if (result === null) {
      throw new ClaudeScanNoResultError();
    }
    return result;
  } catch (e) {
    if (e instanceof ScanVisionBatchError) throw e;
    // A throw from query() iteration is process-level (spawn failure, missing
    // or broken binary, dead subprocess) — the provider is broken, not the page.
    throw new ClaudeScanSubprocessError({ detail: errorMessage(e), cause: e });
  }
}
