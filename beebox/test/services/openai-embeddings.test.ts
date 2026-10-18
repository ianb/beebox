// # OpenAI embeddings service — response validation, chunking, key resolution
//
// `EmbeddingsService` wraps OpenAI's `/v1/embeddings` endpoint.
// `getOpenAiEmbeddingsKey` resolves the box's `openai` grant from the
// machine secret store — the grant semantics are covered in
// `test/core/secrets/lifecycle.keys.doctest.md`; what matters here is that an
// unconfigured box yields `null` rather than throwing, so the search path can
// degrade to text mode.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import {
  EMBEDDING_DIMENSIONS,
  parseEmbeddingsResponse,
  chunkTexts,
} from "../../src/services/openai-embeddings.js";
import { getOpenAiEmbeddingsKey } from "../../src/core/search/embeddings-key.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

// ## Response validation: every malformed shape is a typed EmbeddingsError
//
// The real service parses untrusted API responses through
// `parseEmbeddingsResponse`; nothing malformed may escape as a raw
// `TypeError` — the refresh and query layers degrade on `EmbeddingsError`
// specifically.
void test("The real service parses untrusted API responses through parseEmbeddingsRespon...", async (t) => {
  const out = printed();
  const print = out.print;
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L28
  function okVector(): number[] {
    return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
  }

  // doctest:L32
  await t.checkText(out.with(parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector() }] }, 1).length), "1");

  // doctest:L35
  await t.checkThrows(async () => (parseEmbeddingsResponse(null, 1)), "EmbeddingsError");

  // doctest:L38
  await t.checkThrows(async () => (parseEmbeddingsResponse({}, 1)), "EmbeddingsError");

  // doctest:L41
  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [] }, 1)), "EmbeddingsError");

  // doctest:L44
  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [null] }, 1)), "EmbeddingsError");

  // doctest:L47
  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 1, embedding: okVector() }] }, 1)), "EmbeddingsError");

  // doctest:L50
  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 0 }] }, 1)), "EmbeddingsError");

  // doctest:L53
  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] }, 1)), "EmbeddingsError");

  // doctest:L56
  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector().map(() => "x") }] }, 1)), "EmbeddingsError");

  // doctest:L59
  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector().map(() => NaN) }] }, 1)), "EmbeddingsError");

  // ## Request chunking respects input-count and character budgets

  // doctest:L66
  await t.checkText(out.with(chunkTexts([]).length), "0");

  // doctest:L69
  await t.checkText(out.with(chunkTexts(["a", "b"]).length), "1");

  // doctest:L72
  const manyTexts = Array.from({ length: 2049 }, (_, i) => `t${i}`);
  const byCount = chunkTexts(manyTexts);
  await t.checkText(out.with(JSON.stringify(byCount.map((c) => c.length))), "[2048,1]");

  // doctest:L77
  const bigTexts = ["x".repeat(250_000), "y".repeat(250_000), "z"];
  const byChars = chunkTexts(bigTexts);
  await t.checkText(out.with(JSON.stringify(byChars.map((c) => c.length))), "[1,2]");

  // doctest:L82
  await t.checkText(out.with(byChars.flat().join("").length === bigTexts.join("").length), "true");

  // ## Key resolution: an unconfigured box is `null`, not an error
  //
  // A stray in-tree `openai.secret.json` is not a key source; nothing reads it.

  // doctest:L91
  const box = await makeTmpBox();
  print(`no grant: ${await getOpenAiEmbeddingsKey(box.root)}`);

  // doctest:L94
  await box.write("_config/connectors/openai.secret.json", JSON.stringify({ apiKey: "file-key-456" }));
  await t.checkText(out.with(print(`stray file present: ${await getOpenAiEmbeddingsKey(box.root)}`)), `no grant: null
stray file present: null`);
});
