// # Gemini scan image transport
//
// The scan transport passes HEIC/HEIF bytes through with the MIME type derived
// from their extension, preserving compatibility with Sharp builds without an
// HEVC decoder. Other unsupported formats, including AVIF, are converted before
// the request. This test captures the actual Gemini HTTP payload and
// never contacts a provider.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import Sharp from "sharp";
import { z } from "zod";
import { analyzeScanBatchWithGemini } from "../../../src/core/describe-images/gemini.js";

void test("line 18", async (t) => {
  t.teardown(async () => {
    try {
      globalThis.fetch = previousFetch;
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-scan-images-"));
  const previousFetch = globalThis.fetch;
  const heicPath = path.join(dir, "synthetic.heic");
  const heicBytes = Buffer.from("synthetic HEIC transport fixture");
  await fs.writeFile(heicPath, heicBytes);
  const heifPath = path.join(dir, "synthetic.heif");
  const heifBytes = Buffer.from("synthetic HEIF transport fixture");
  await fs.writeFile(heifPath, heifBytes);
  const avifPath = path.join(dir, "real.avif");
  await Sharp(Buffer.from('<svg width="257" height="113" xmlns="http://www.w3.org/2000/svg"><rect width="257" height="113" fill="white"/></svg>')).avif().toFile(avifPath);

  const GeminiRequest = z.object({ contents: z.array(z.object({ parts: z.array(z.object({ inlineData: z.object({ data: z.string(), mimeType: z.string() }).optional() })) })) });
  const requestBodies: Array<z.infer<typeof GeminiRequest>> = [];
  globalThis.fetch = async (input, init) => {
    requestBodies.push(GeminiRequest.parse(await new Request(input, init).json()));
    return Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify([
          { index: 0, kind: "back", paired_with_index: null, description: "", title: "", rotation: 0, subject_bbox: null, has_text: false, text_blocks: [], date_hint: null, flag_for_review: false, flag_reason: null },
          { index: 1, kind: "back", paired_with_index: null, description: "", title: "", rotation: 0, subject_bbox: null, has_text: false, text_blocks: [], date_hint: null, flag_for_review: false, flag_reason: null },
          { index: 2, kind: "back", paired_with_index: null, description: "", title: "", rotation: 0, subject_bbox: null, has_text: false, text_blocks: [], date_hint: null, flag_for_review: false, flag_reason: null },
      ]) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, thoughtsTokenCount: 0, totalTokenCount: 5 },
    });
  };

  const result = await analyzeScanBatchWithGemini("fake-key", { imagePaths: [heicPath, heifPath, avifPath], boxholderContext: null });
  const parts = (requestBodies[0]?.contents[0]?.parts ?? []).flatMap((part) => part.inlineData ?? []);
  const heicRoundTrip = Buffer.from(parts[0]?.data ?? "", "base64").equals(heicBytes);
  const heifRoundTrip = Buffer.from(parts[1]?.data ?? "", "base64").equals(heifBytes);
  const avifBytes = Buffer.from(parts[2]?.data ?? "", "base64");
  const avifMetadata = await Sharp(avifBytes).metadata();
  t.check([parts.map((part) => part.mimeType), heicRoundTrip, heifRoundTrip, avifMetadata.format, avifMetadata.width, avifMetadata.height, result.analyses.length, result.analyses[2]?.index], [
    [
      "image/heic",
      "image/heif",
      "image/jpeg",
    ],
    true,
    true,
    "jpeg",
    257,
    113,
    3,
    2,
  ]);
});
