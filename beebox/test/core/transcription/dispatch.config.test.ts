// # Transcription config: realtime + HQ
//
// `src/core/transcription/dispatch/core.ts` owns the per-box transcription config. Two
// independent settings: `service` (realtime/batch — voxtral/deepgram/whisper)
// and `hqService` (narration-mode checkpoint HQ pass — whisper/voxtral).
// Stored at `_config/transcription.json`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  loadTranscriptionConfig,
  updateTranscriptionConfig,
} from "../../../src/core/transcription/dispatch/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

// ## Defaults
//
// With no box: defaults for both fields.
void test("With no box:", async (t) => {
  const cfg = await loadTranscriptionConfig();
  t.check(cfg, {
    service: "voxtral",
    hqService: "whisper",
  });
});

// With a box and no config file: same defaults, but read from a missing path.
void test("With a box and no config file:", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  t.check(await loadTranscriptionConfig(box.root), {
    service: "voxtral",
    hqService: "whisper",
  });
});

// ## Partial updates merge
//
// Setting just `hqService` preserves `service`.
void test("Setting just hqService preserves service.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await updateTranscriptionConfig(box.root, { service: "voxtral" });
  await updateTranscriptionConfig(box.root, { hqService: "voxtral" });
  t.check(await loadTranscriptionConfig(box.root), {
    service: "voxtral",
    hqService: "voxtral",
  });
});

// ## Legacy config with only `service` reads cleanly
//
// A pre-existing config file with just `service` should still load — the
// new `hqService` field is optional and defaults to `whisper`.
void test("A pre-existing config file with just service should still load — the new hqSe...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_config/transcription.json", '{"service":"deepgram"}\n');
  t.check(await loadTranscriptionConfig(box.root), {
    service: "deepgram",
    hqService: "whisper",
  });
});
