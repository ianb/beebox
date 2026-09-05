#!/usr/bin/env -S npx tsx
/**
 * gen-image — generate an image via the Gemini image API.
 *
 * Usage:
 *   bin/gen-image "<prompt>" [out.png]
 *
 * Key: defaults to SKE_GEMINI_API_KEY (the one with image-generation quota),
 * falling back to GEMINI_KEY. Override with GEMINI_IMAGE_KEY. The plain
 * GEMINI_KEY free tier has zero image quota, which is why SKE is the default
 * here.
 *
 * Used to build /dev/ artifacts (favicons, illustration assets). Output is a
 * PNG (Gemini returns ~1024px); downsize with `sips -Z <px> in.png --out out.png`.
 */
import { writeFileSync } from "node:fs";
import { z } from "zod";

/**
 * Only the sliver of the generateContent response this script reads. Unknown
 * keys are dropped rather than rejected, and a shape that does not match at all
 * falls through to the "no image in response" path below.
 */
const GenerateContentResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ inlineData: z.object({ data: z.string() }).optional() })).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const KEY = process.env.GEMINI_IMAGE_KEY ?? process.env.SKE_GEMINI_API_KEY ?? process.env.GEMINI_KEY;
const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";

async function main(): Promise<void> {
  const prompt = process.argv[2];
  const out = process.argv[3] ?? "/tmp/gen-image.png";
  if (!prompt) {
    console.error('usage: bin/gen-image "<prompt>" [out.png]');
    process.exit(2);
  }
  if (!KEY) {
    console.error("no API key — set SKE_GEMINI_API_KEY (or GEMINI_IMAGE_KEY)");
    process.exit(2);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    console.error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }

  const parsed = GenerateContentResponse.safeParse(await res.json());
  const json = parsed.success ? parsed.data : {};
  const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!b64) {
    console.error("no image in response");
    process.exit(1);
  }
  writeFileSync(out, Buffer.from(b64, "base64"));
  console.log(out);
}

await main();
