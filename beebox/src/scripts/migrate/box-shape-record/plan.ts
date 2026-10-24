/**
 * `box-shape-record-2026-10` decision: given a box's `package.json` text and
 * its `.beebox/box.json` marker text (or null), what to write.
 *
 * The block is copied from the marker: `shapeVersion` and `created`. A marker
 * without both, or with a `shapeVersion` other than 3, is refused rather than
 * completed with a guess; the refusal names the file and the fix. Pure, so the
 * test reaches every case without a box.
 */

import { z } from "zod";
import { setShapeBlock, shapeBlockSchema } from "../../../lib/box-identity.js";
import { isRecord } from "../../../shared/is-record.js";

export type ShapeRecordPlan =
  | { kind: "already-converted" }
  | { kind: "write"; packageJson: string; created: string }
  | { kind: "refuse"; reason: string };

const markerSchema = z.object({ shapeVersion: z.literal(3), created: z.string() });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (_e) {
    // The caller reports the file as unparseable; the parser's message adds nothing it can act on.
    return undefined;
  }
}

export function planShapeRecord({ packageJson, marker }: { packageJson: string; marker: string | null }): ShapeRecordPlan {
  const pkg = parseJson(packageJson);
  if (!isRecord(pkg)) return { kind: "refuse", reason: "package.json is not a JSON object; fix it by hand, then rerun." };
  if (pkg["beebox"] !== undefined) {
    return shapeBlockSchema.safeParse(pkg["beebox"]).success
      ? { kind: "already-converted" }
      : { kind: "refuse", reason: "package.json has a malformed \"beebox\" block; set it to { \"shapeVersion\": 3, \"created\": \"<ISO date>\" }." };
  }
  if (marker === null) {
    return { kind: "refuse", reason: "no \"beebox\" block in package.json and no .beebox/box.json to copy it from; add the block by hand." };
  }
  const parsed = markerSchema.safeParse(marker.trim() === "" ? {} : parseJson(marker));
  if (!parsed.success) {
    return {
      kind: "refuse",
      reason: ".beebox/box.json needs \"shapeVersion\": 3 and a \"created\" date to copy; it has " + marker.trim() +
        ". Add the block to package.json by hand, using the box's first commit date for \"created\" if none is known.",
    };
  }
  const { created } = parsed.data;
  return { kind: "write", packageJson: setShapeBlock(packageJson, { shapeVersion: 3, created }), created };
}
