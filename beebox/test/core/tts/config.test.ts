// # TTS backend config
//
// Which engine the box speaks with, in `_config/tts.json`. Same shape as the
// transcription config next door — absent means defaults, writes are serialized,
// and a corrupted file is loud.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { loadTtsConfig, updateTtsConfig } from "../../../src/core/tts/config.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

// ## A box that never chose keeps sounding the same
//
// The default is `openai`, and that is the point: shipping backend selection must
// not change what an existing box sounds like, whatever keys it happens to hold.
void test("The default is openai, and that is the point:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  t.check(await loadTtsConfig(box.root), {
    backend: "openai",
  });
});

// ## Choosing a backend writes it, and reads back
void test("Choosing a backend writes it, and reads back", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  t.check(await updateTtsConfig(box.root, { backend: "gemini" }), {
    backend: "gemini",
  });

  t.check(await loadTtsConfig(box.root), {
    backend: "gemini",
  });
});

// ## A hand-edited file with an unknown backend fails loudly
//
// The boxholder can edit this by hand, and a typo must not silently fall back to
// the default — that would be a box speaking in a voice nobody chose.
void test("The boxholder can edit this by hand, and a typo must not silently fall back t...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
  await fs.writeFile(path.join(box.root, "_config/tts.json"), '{"backend":"elevenlabs"}\n');
  t.check(await loadTtsConfig(box.root).then(() => "no throw", (e) => e.constructor.name), "ZodError");
});

// ## An unreadable file is not "no config"
//
// Absent means defaults; malformed JSON means something is wrong and should be
// seen.
void test("Absent means defaults; malformed JSON means something is wrong and should be...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await fs.mkdir(path.join(box.root, "_config"), { recursive: true });
  await fs.writeFile(path.join(box.root, "_config/tts.json"), "{not json\n");
  t.check(await loadTtsConfig(box.root).then(() => "no throw", () => "threw"), "threw");
});

// ## No box root at all resolves to the default
//
// `loadTtsConfig()` is called from paths that may have no box in scope; it
// answers rather than throwing.
void test("loadTtsConfig() is called from paths that may have no box in scope; it answer...", async (t) => {
  t.check(await loadTtsConfig(undefined), {
    backend: "openai",
  });
});
