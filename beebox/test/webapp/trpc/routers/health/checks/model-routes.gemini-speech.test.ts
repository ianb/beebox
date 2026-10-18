// # Health: a box set to speak with Gemini needs the `gemini` key
//
// `geminiKeyCheck` (`src/webapp/trpc/routers/health/checks/model-routes.ts`)
// reports whether Gemini is reachable. For audio questions and scan vision an
// OpenRouter key is a working fallback, so its absence is not a failure. Speech
// is different: it takes the `gemini` key or nothing (`src/core/tts/resolve.ts`),
// so a box whose voice backend is Gemini fails this check without one — even
// when OpenRouter could reach the model, because that route loses the speaking
// style.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiKeyCheck } from "../../../../../../src/webapp/trpc/routers/health/checks/model-routes.js";
import { updateTtsConfig } from "../../../../../../src/core/tts/config.js";
import { grantSecret, setSecret } from "../../../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../../../src/lib/box-slug.js";
import type { TtsBackend } from "../../../../../../src/shared/tts-backends.js";
import { makeTmpBox } from "../../../../../helpers/doctest-helpers.js";

/** A fresh secret store and a box with the given voice backend and grants. */
async function boxWith({ backend, grants }: { backend: TtsBackend; grants: ("gemini" | "openrouter")[] }) {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  const box = await makeTmpBox();
  await updateTtsConfig(box.root, { backend });
  const values = { gemini: "AIza-placeholder-gemini-key", openrouter: "sk-or-v1-placeholder-placeholder-placeholder-placeholder" };
  for (const name of grants) {
    await setSecret({ name, value: values[name] });
    await grantSecret({ slug: await boxSlug(box.root), name, access: "server" });
  }
  return box;
}

// ## Gemini voice with only an OpenRouter key fails, naming the fix
void test("Gemini voice with only an OpenRouter key fails, naming the fix", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L40
  const box = await boxWith({ backend: "gemini", grants: ["openrouter"] });
  const check = await geminiKeyCheck(box.root);
  t.check(({ ok: check.ok, message: check.message }), {
    ok: false,
    message: "TTS backend \"gemini\" but no Gemini key — chat speech will fail. Grant the \"gemini\" secret to this box, or choose a different voice backend; an OpenRouter key does not stand in",
  });
});

// ## The same keys on an OpenAI-voice box are fine
//
// There the OpenRouter key is a working route for audio questions, and the check
// says so rather than failing.
void test("There the OpenRouter key is a working route for audio questions, and the chec...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L56
  const box = await boxWith({ backend: "openai", grants: ["openrouter"] });
  const check = await geminiKeyCheck(box.root);
  t.check(({ ok: check.ok, message: check.message }), {
    ok: true,
    message: "No Gemini key — audio questions and the Gemini scan backend go through OpenRouter",
  });
});
