// # A scan photo's rotation comes from picking the upright copy
//
// The batch call sometimes turns a photo the wrong way (3 of 16 trials), so
// `createClaudeScanVision` asks a second question per photo page:
// which of four turned copies is upright. The fake below answers both calls;
// the copies it receives are measured with Sharp, no provider contacted.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createClaudeScanVision, type ClaudeQueryFunction } from "../../../src/services/scan-vision-claude/core.js";
import { MODEL_ID } from "../../../src/shared/model-ids.js";
import Sharp from "sharp";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "scan-vision-upright-"));
const photoPath = join(dir, "page-001.png");
const backPath = join(dir, "page-002.png");
// Landscape, so each copy's shape shows its turn.
await Sharp({ create: { width: 200, height: 100, channels: 3, background: "#888" } }).png().toFile(photoPath);
await Sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toFile(backPath);

const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const page = ({ index, kind, rotation }: { index: number; kind: "photo" | "back"; rotation: number }) => ({
  index, kind, paired_with_index: null, description: "", title: "", rotation, subject_bbox: null, has_text: false,
  text_blocks: [], date_hint: null, flag_for_review: false, flag_reason: null, slot_count: 0, slots: [],
});

/** A fake SDK: the Sonnet batch call says 270 for the photo; the Haiku call
 *  answers `upright` (fails when it is null, throws when it is "throw") and records the copies' sizes. */
function fakeQuery(upright: string | null, copies: string[]): ClaudeQueryFunction {
  const contentSchema = z.object({ message: z.object({ content: z.array(z.looseObject({ type: z.string() })) }) });
  const imageSchema = z.object({ source: z.object({ data: z.string() }) });
  return (params) => Object.assign(Object.create(Object.prototype), {
    async *[Symbol.asyncIterator]() {
      if (params.options?.model === MODEL_ID.haiku) {
        if (upright === "throw") throw new Error("subprocess died");
        if (typeof params.prompt !== "string") {
          for await (const message of params.prompt) {
            for (const block of contentSchema.parse(message).message.content.filter((b) => b.type === "image")) {
              const meta = await Sharp(Buffer.from(imageSchema.parse(block).source.data, "base64")).metadata();
              copies.push(`${String(meta.width)}x${String(meta.height)}`);
            }
          }
        }
        yield upright === null
          ? { type: "result", subtype: "error_max_turns", usage, total_cost_usd: 0.25, errors: [] }
          : { type: "result", subtype: "success", usage, total_cost_usd: 0.25, structured_output: { upright } };
        return;
      }
      yield {
        type: "result", subtype: "success", usage, total_cost_usd: 0.5,
        structured_output: { pages: [page({ index: 0, kind: "photo", rotation: 270 }), page({ index: 1, kind: "back", rotation: 0 })] },
      };
    },
  });
}

// ## The picked copy's turn replaces the batch call's rotation
//
// Copy B is the photo turned 90° clockwise, so picking B stores 90. Only the
// photo page gets a check: four copies, A to D turned 0/90/180/270. Its cost
// and tokens add to the batch's.
void test("The picked copy's turn replaces the batch call's rotation", async (t) => {
  t.teardown(() => rm(dir, { recursive: true, force: true }));
  const copies: string[] = [];
  const result = await createClaudeScanVision({ boxRoot: dir, query: fakeQuery("B", copies) })
    .analyzeBatch({ imagePaths: [photoPath, backPath], boxholderContext: null });
  t.check(
    { rotations: result.analyses.map((a) => a.rotation), copies, costUsd: result.costUsd, usage: result.usage },
    { rotations: [90, 0], copies: ["200x100", "100x200", "200x100", "100x200"], costUsd: 0.75, usage: { prompt: 20, output: 20, thinking: 0 } }
  );

  // ## A check that ends without an answer keeps the batch call's value and flags the page

  const kept = await createClaudeScanVision({ boxRoot: dir, query: fakeQuery(null, []) })
    .analyzeBatch({ imagePaths: [photoPath, backPath], boxholderContext: null });
  t.check(kept.analyses.map(({ rotation, flag_for_review, flag_reason }) => ({ rotation, flag_for_review, flag_reason })), [
    { rotation: 270, flag_for_review: true, flag_reason: "Orientation check failed; rotation unverified" },
    { rotation: 0, flag_for_review: false, flag_reason: null },
  ]);

  // ## A check that throws neither fails the batch nor loses its accounting

  const thrown = await createClaudeScanVision({ boxRoot: dir, query: fakeQuery("throw", []) })
    .analyzeBatch({ imagePaths: [photoPath, backPath], boxholderContext: null });
  t.check({ rotation: thrown.analyses[0]?.rotation, flagged: thrown.analyses[0]?.flag_for_review, costUsd: thrown.costUsd }, { rotation: 270, flagged: true, costUsd: 0.5 });
});
