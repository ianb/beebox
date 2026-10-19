// # The Whisper path resolves its key through the store
//
// `core/transcription/index.ts` was the last consumer still reading
// `THINKING_OPENAI_API_KEY` from the environment directly. It goes through
// `getOpenAiThinkingKey(boxRoot)` like its siblings — the machine secret store's
// `openai-thinking` entry, and nothing else
// (`docs/implemented-plans/secret-custody.md`).
//
// `boxRoot` was already on `TranscribeAudioParams`, so nothing above changed
// shape; a caller that omits it has no box whose grants to check, and so no key.
//
// Values below are obvious placeholders. The success path is not exercised here —
// it would mean an outbound call to OpenAI — so this covers the refusal an
// unconfigured box gets, plus the ordering of the shared reader the Whisper path
// now calls.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribeAudioHq } from "../../../src/core/transcription/dispatch/core.js";
import { getOpenAiThinkingKey } from "../../../src/core/openai-thinking-key.js";
import { grantSecret, setSecret } from "../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-whisper-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

// ## No grant and no env var: a refusal naming the grant to ask for
//
// The message is the one the boxholder acts on, not the old bare env-var name.
void test("The message is the one the boxholder acts on, not the old bare env-var name.", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(dir, { recursive: true, force: true });
      delete process.env.THINKING_OPENAI_API_KEY;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L40
  const dir = await useTempStore();
  const box = await makeTmpBox();
  delete process.env.THINKING_OPENAI_API_KEY;

  // doctest:L44
  let failure: unknown;
  try {
    await transcribeAudioHq(
      { audioBuffer: Buffer.from("not really audio"), filename: "memo.webm", boxRoot: box.root },
      { service: "whisper" },
    );
  } catch (e) {
    failure = e;
  }
  assert.ok(failure instanceof Error && "permanent" in failure && "code" in failure);
  t.check(
    { name: failure.name, permanent: failure.permanent, code: failure.code, message: failure.message },
    {
      name: "MissingWhisperKeyError",
      permanent: true,
      code: "missing_api_key",
      message: 'No OpenAI key for transcription — ask the boxholder to grant the "openai-thinking" secret to this box',
    },
  );

  // ## Only the grant resolves
  //
  // This is the reader the Whisper path calls, exercised against the same box. The
  // retired env var is exported first to show it no longer participates.

  // doctest:L67
  const slug = await boxSlug(box.root);
  process.env.THINKING_OPENAI_API_KEY = "placeholder-whisper-env-key";
  const ungranted = await getOpenAiThinkingKey(box.root, { observe: true });

  // doctest:L71
  await setSecret({ name: "openai-thinking", value: "placeholder-whisper-store-key" });
  await grantSecret({ slug, name: "openai-thinking", access: "server" });
  const granted = await getOpenAiThinkingKey(box.root, { observe: true });

  // doctest:L75
  t.check(
    { ungranted, granted, noBox: await getOpenAiThinkingKey(undefined, { observe: true }) },
    { ungranted: null, granted: "placeholder-whisper-store-key", noBox: null },
  );
});
