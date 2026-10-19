// # Quick capture wire fixtures
//
// The generic acceptance declaration preserves material roles, admits complete
// inputs, and refuses empty/unknown versions or file-bearing follow-up.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { readFile } from "node:fs/promises";
import { quickCaptureDeclarationSchema, quickCaptureReceiptSchema } from "../../src/shared/quick-capture.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/quick-capture/${name}.json`, import.meta.url), "utf8"));
}

void test("line 14", async (t) => {
  // doctest:L15
  t.check(quickCaptureDeclarationSchema.parse(await fixture("text")), {
    version: 1,
    capturedAt: "2026-10-12T12:00:00Z",
    source: "apple-app-intents",
    input: "Phone test alpha",
  });

  // doctest:L18
  t.check(quickCaptureDeclarationSchema.parse(await fixture("image-with-words")).material, {
    kind: "image",
    id: "11111111-1111-4111-8111-111111111111",
    mimeType: "image/png",
    byteLength: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    fileName: "screenshot.png",
  });

  // doctest:L21
  t.check(quickCaptureDeclarationSchema.parse(await fixture("clipping")).input, undefined);

  // doctest:L24
  t.check(quickCaptureDeclarationSchema.parse(await fixture("context")).parentCaptureId, "11111111-1111-4111-8111-111111111111");

  // doctest:L27
  t.check(quickCaptureReceiptSchema.parse(await fixture("receipt")), {
    id: "11111111-1111-4111-8111-111111111111",
    state: "accepted",
  });

  // doctest:L30
  t.check(quickCaptureDeclarationSchema.safeParse(await fixture("invalid-empty")).success, false);

  // doctest:L33
  t.check(quickCaptureDeclarationSchema.safeParse(await fixture("invalid-material-context")).success, false);

  // doctest:L36
  t.check(quickCaptureDeclarationSchema.safeParse({version:2,capturedAt:"2026-10-12T12:00:00Z",source:"apple-app-intents",input:"hello"}).success, false);
});

// Interrupted provenance is technical audio metadata, never fabricated words.
void test("Interrupted provenance is technical audio metadata, never fabricated words.", async (t) => {
  // doctest:L44
  t.check(quickCaptureDeclarationSchema.parse(await fixture("audio-interrupted")).recordingInterrupted, true);

  // doctest:L47
  t.check(quickCaptureDeclarationSchema.safeParse(await fixture("invalid-interrupted-nonaudio")).success, false);
});
