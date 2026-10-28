/**
 * The upright check: a photo page's rotation is the turn of the copy Claude
 * picks as upright from four turned copies.
 */

import { z } from "zod";
import { MODEL_ID } from "../../shared/model-ids.js";
import type { BatchUsage, RawScanAnalysis } from "../../core/describe-images/gemini.js";
import type { ScanVisionResult } from "../scan-vision.js";
import {
  runClaudeQuery,
  toBatchUsage,
  toWireSchema,
  type ClaudeQueryFunction,
  type ScanImage,
  type SdkContent,
} from "./query.js";

/** The four quarter turns, in the order the upright check labels them. */
const TURNS = [0, 90, 180, 270] as const;
const TURN_LABELS = ["A", "B", "C", "D"] as const;

const UPRIGHT_PROMPT = "These are four copies of the same photograph, each turned differently, labelled A, B, C, D in order. Which copy is upright — the way the scene looked to the person who took it, with heads, sky, and ceilings at the top? Judge by faces, bodies, gravity, and text in the scene.";

const uprightSchema = z.object({ upright: z.enum(TURN_LABELS) });

const UNCHECKED_NOTE = "Orientation check failed; rotation unverified";

/**
 * Replace each photo page's `rotation` with the turn of the copy the model
 * picks as upright from four turned copies. The batch call turned a photo
 * the wrong way in 3 of 16 trials; picking among turned copies was right in
 * 44 of 44 on Haiku and on Sonnet (measured 2026-10-27,
 * `issues/closed/bugs/2026-10-27-scan-photo-rotation-direction-swapped.md`).
 * A check that fails or ends without an answer keeps the batch call's value
 * and flags the page for review; it never fails the batch.
 */
export async function correctPhotoRotations({
  boxRoot,
  analyses,
  images,
  usage,
  costUsd,
  query,
}: {
  boxRoot: string;
  analyses: RawScanAnalysis[];
  images: ScanImage[];
  usage: BatchUsage;
  costUsd: number;
  query: ClaudeQueryFunction | undefined;
}): Promise<ScanVisionResult> {
  const checks = await Promise.all(
    analyses.map(async (page) => {
      const image = images[page.index];
      if (page.kind !== "photo" || image === undefined) return null;
      try {
        return await pickUprightTurn({ boxRoot, image, query });
      } catch (_e) {
        // The batch analysis already succeeded; a broken check costs only
        // this photo's verified rotation, which the review flag reports.
        return { turn: null, usage: { prompt: 0, output: 0, thinking: 0 }, costUsd: 0 };
      }
    })
  );
  const total = { ...usage };
  let totalCost = costUsd;
  for (const check of checks) {
    if (check === null) continue;
    total.prompt += check.usage.prompt;
    total.output += check.usage.output;
    totalCost += check.costUsd;
  }
  return {
    analyses: analyses.map((page, i) => {
      const check = checks[i];
      if (check === null || check === undefined) return page;
      if (check.turn !== null) return { ...page, rotation: check.turn };
      return {
        ...page,
        flag_for_review: true,
        flag_reason: page.flag_reason === null ? UNCHECKED_NOTE : `${page.flag_reason}; ${UNCHECKED_NOTE}`,
      };
    }),
    usage: total,
    costUsd: totalCost,
  };
}

/** One Haiku call over the photo's four turned copies; `turn` is null when the
 *  call ends without a usable answer. */
async function pickUprightTurn({
  boxRoot,
  image,
  query,
}: {
  boxRoot: string;
  image: ScanImage;
  query: ClaudeQueryFunction | undefined;
}): Promise<{ turn: (typeof TURNS)[number] | null; usage: BatchUsage; costUsd: number }> {
  // Dynamic — see `core/scan/validate.ts`: keeps `sharp` out of the startup graph.
  const { default: Sharp } = await import("sharp");
  const source = Buffer.from(image.data, "base64");
  const content: SdkContent = [{ type: "text", text: UPRIGHT_PROMPT }];
  for (const [i, turn] of TURNS.entries()) {
    const copy = await Sharp(source)
      .autoOrient()
      .rotate(turn)
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    content.push({ type: "text", text: `Copy ${TURN_LABELS[i] ?? ""}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: copy.toString("base64") } });
  }
  const result = await runClaudeQuery({
    boxRoot,
    content,
    model: MODEL_ID.haiku,
    schema: toWireSchema(uprightSchema),
    query,
  });
  const answer = result.subtype === "success" ? uprightSchema.safeParse(result.structured_output) : null;
  const turn = answer?.success === true ? (TURNS[TURN_LABELS.indexOf(answer.data.upright)] ?? null) : null;
  return { turn, usage: toBatchUsage(result), costUsd: result.total_cost_usd };
}
