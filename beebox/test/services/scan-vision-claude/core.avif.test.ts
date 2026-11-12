// # AVIF scan images cross the provider boundary with matching bytes and MIME
//
// Triage passes stored page and figure renders directly to scan vision. AVIF is
// valid storage, but Claude accepts JPEG, PNG, GIF, and WebP inputs. The mock
// below captures the actual SDK request built by `createClaudeScanVision`, while
// Sharp verifies the encoded bytes and dimensions without contacting a provider.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createClaudeScanVision, type ClaudeQueryFunction } from "../../../src/services/scan-vision-claude/core.js";
import Sharp from "sharp";
import { z } from "zod";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = await mkdtemp(join(tmpdir(), "scan-vision-avif-"));
const inputPath = join(dir, "page-001.avif");
const original = await Sharp(Buffer.from('<svg width="321" height="123" xmlns="http://www.w3.org/2000/svg"><rect width="321" height="123" fill="white"/></svg>')).avif().toBuffer();
await writeFile(inputPath, original);
let capturedMessage: unknown;
let calls = 0;
// The SDK query type models its complete production stream; this fake supplies
// only the user/result messages consumed by runScanQuery. The returned stream is
// a prototype-backed object: it carries the SDK's `Query` type without its control methods.
const query: ClaudeQueryFunction = (params) => Object.assign(Object.create(Object.prototype), {
  async *[Symbol.asyncIterator]() {
    calls += 1;
    if (typeof params.prompt !== "string") for await (const message of params.prompt) capturedMessage = message;
    yield {
      type: "result",
      subtype: "success",
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      total_cost_usd: 0.01,
      structured_output: { pages: [{ index: 0, kind: "back", paired_with_index: null, description: "", title: "", rotation: 0, subject_bbox: null, has_text: false, text_blocks: [], date_hint: null, flag_for_review: false, flag_reason: null, slot_count: 0, slots: [] }] },
    };
  },
});

/** The one image block of the user message the fake received. */
function sentImage(message: unknown) {
  const sent = z.object({ message: z.object({ content: z.array(z.looseObject({ type: z.string() })) }) }).parse(message);
  return z.object({ type: z.literal("image"), source: z.object({ data: z.string(), media_type: z.string() }) })
    .parse(sent.message.content.find((block) => block.type === "image"));
}

// ## Claude receives supported, correctly labeled bytes and alignment stays strict
void test("Claude receives supported, correctly labeled bytes and alignment stays strict", async (t) => {
  const result = await createClaudeScanVision({ boxRoot: dir, query }).analyzeBatch({ imagePaths: [inputPath], boxholderContext: null });
  const imageBlock = sentImage(capturedMessage);
  const sentBytes = Buffer.from(imageBlock.source.data, "base64");
  const sentMetadata = await Sharp(sentBytes).metadata();
  t.check([imageBlock.source.media_type, sentMetadata.format, sentMetadata.width, sentMetadata.height, calls, result.analyses.length, result.analyses[0]?.index], [
    "image/jpeg",
    "jpeg",
    321,
    123,
    1,
    1,
    0,
  ]);

  const sourceUnchanged = (await (await import("node:fs/promises")).readFile(inputPath)).equals(original);
  t.check([await Sharp(original).metadata().then((m) => [m.format, m.width, m.height]), sourceUnchanged], [
    [
      "heif",
      321,
      123,
    ],
    true,
  ]);

  const pngPath = join(dir, "page-002.png");
  await Sharp(original).png().toFile(pngPath);
  await createClaudeScanVision({ boxRoot: dir, query }).analyzeBatch({ imagePaths: [pngPath], boxholderContext: null });
  const pngBlock = sentImage(capturedMessage);
  t.check(`${pngBlock.source.media_type} ${await Sharp(Buffer.from(pngBlock.source.data, "base64")).metadata().then((m) => m.format)}`, "image/png png");
});

// An unreadable AVIF is rejected locally and never sent to the provider.
void test("An unreadable AVIF is rejected locally and never sent to the provider.", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const invalidPath = join(dir, "figure-001.avif");
  await writeFile(invalidPath, "not an image");
  let invalidCalls = 0;
  // This case checks that image validation precedes provider iteration, so the fake
  // intentionally supplies no SDK messages and must never be consumed.
  const invalidQuery: ClaudeQueryFunction = () => { invalidCalls += 1; return Object.assign(Object.create(Object.prototype), { async *[Symbol.asyncIterator]() {} }); };
  await createClaudeScanVision({ boxRoot: dir, query: invalidQuery }).analyzeBatch({ imagePaths: [invalidPath], boxholderContext: null }).then(() => "sent", () => "rejected");
  t.check(`${invalidCalls} provider calls`, "0 provider calls");
});
