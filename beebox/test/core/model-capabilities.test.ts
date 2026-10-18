// # Pickers ask the same question the dispatchers answer
//
// `serviceCapabilities` (`src/core/model-capabilities.ts`) tells the
// HQ-transcription and TTS pickers which options this box can actually use,
// derived from the same key-per-service facts `transcription/index.ts`'s
// `dispatchHqTranscription` and `tts/resolve.ts`'s `resolveTtsService` use — so
// the picker and the pass it configures can never disagree.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serviceCapabilities } from "../../src/core/model-capabilities.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { secretsLogDir } from "../../src/core/secrets/store.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

// ## No grants at all — nothing is usable
void test("No grants at all — nothing is usable", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L29
  await useTempStore();
  const box = await makeTmpBox();

  // doctest:L32
  const caps = await serviceCapabilities(box.root);
  t.check(caps.hq.mai, {
    usable: false,
    needs: [
      "openrouter",
    ],
  });

  // doctest:L36
  t.check(caps.hq.whisper, {
    usable: false,
    needs: [
      "openai-thinking",
      "openrouter",
    ],
  });

  // doctest:L39
  t.check(caps.hq["whisper-llm"], {
    usable: false,
    needs: [
      "openai-thinking",
      "openrouter",
    ],
  });

  // doctest:L42
  t.check(caps.hq["whisper-llm-mini"], {
    usable: false,
    needs: [
      "openai-thinking",
      "openrouter",
    ],
  });

  // doctest:L45
  t.check(caps.hq.voxtral, {
    usable: false,
    needs: [
      "mistral",
    ],
  });

  // doctest:L48
  t.check(caps.hq["voxtral-diarized"], {
    usable: false,
    needs: [
      "mistral",
    ],
  });

  // doctest:L51
  t.check(caps.hq["mai-diarized"], {
    usable: false,
    needs: [
      "openrouter",
    ],
  });

  // doctest:L54
  t.check(caps.tts.openai, {
    usable: false,
    needs: [
      "openai-thinking",
    ],
  });

  // doctest:L57
  t.check(caps.tts.gemini, {
    usable: false,
    needs: [
      "gemini",
    ],
  });
});

// ## An `openrouter` grant lights up everything OpenRouter can reach
//
// MAI has no direct arm, and the Whisper family falls back to OpenRouter.
// `voxtral` and both TTS backends stay unusable — neither TTS backend takes an
// OpenRouter key (Gemini through OpenRouter would lose its speaking style).
void test("MAI has no direct arm, and the Whisper family falls back to OpenRouter.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L72
  await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);
  await setSecret({ name: "openrouter", value: "sk-or-v1-placeholder" });
  await grantSecret({ slug, name: "openrouter", access: "server" });

  // doctest:L78
  const caps = await serviceCapabilities(box.root);
  t.check(caps.hq.mai.usable, true);

  // doctest:L82
  t.check(caps.hq.whisper.usable, true);

  // doctest:L85
  t.check(caps.tts.gemini.usable, false);

  // doctest:L88
  t.check(caps.hq.voxtral.usable, false);

  // doctest:L91
  t.check(caps.tts.openai.usable, false);

  // ## Granting `mistral` on top makes `voxtral` usable too

  // doctest:L98
  await setSecret({ name: "mistral", value: "placeholder-mistral-key" });
  await grantSecret({ slug, name: "mistral", access: "server" });

  // doctest:L101
  const caps2 = await serviceCapabilities(box.root);
  t.check(caps2.hq.voxtral.usable, true);

  // ## Asking is not an access
  //
  // The pickers poll this question, so it reads no key values and writes nothing to
  // the secret access log. The two checks in this store asked about granted keys
  // (`openrouter`, `mistral`) and ungranted ones (`openai-thinking`, `gemini`), and
  // neither wrote a line: no `resolve` and no refusal.

  // doctest:L114
  t.check(await readdir(secretsLogDir()).catch(() => []), []);
});

// ## A `gemini` grant is what reaches Gemini speech
//
// The Google AI Studio key alone makes Gemini speech usable. MAI stays unusable:
// it runs only on OpenRouter.
void test("The Google AI Studio key alone makes Gemini speech usable.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L128
  await useTempStore();
  const box = await makeTmpBox();
  await setSecret({ name: "gemini", value: "AIza-placeholder-gemini-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "gemini", access: "server" });

  // doctest:L133
  const caps = await serviceCapabilities(box.root);
  t.check(`${String(caps.tts.gemini.usable)} ${String(caps.hq.mai.usable)}`, "true false");
});
