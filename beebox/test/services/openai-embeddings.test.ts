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
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  function okVector(): number[] {
    return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
  }

  t.check(parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector() }] }, 1), [okVector()]);

  await t.checkThrows(async () => (parseEmbeddingsResponse(null, 1)), "EmbeddingsError");

  await t.checkThrows(async () => (parseEmbeddingsResponse({}, 1)), "EmbeddingsError");

  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [] }, 1)), "EmbeddingsError");

  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [null] }, 1)), "EmbeddingsError");

  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 1, embedding: okVector() }] }, 1)), "EmbeddingsError");

  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 0 }] }, 1)), "EmbeddingsError");

  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] }, 1)), "EmbeddingsError");

  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector().map(() => "x") }] }, 1)), "EmbeddingsError");

  await t.checkThrows(async () => (parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector().map(() => NaN) }] }, 1)), "EmbeddingsError");

  // ## Request chunking respects input-count and character budgets

  t.check(chunkTexts([]), []);

  t.check(chunkTexts(["a", "b"]), [["a", "b"]]);

  const manyTexts = Array.from({ length: 2049 }, (_, i) => `t${i}`);
  t.check(chunkTexts(manyTexts), [manyTexts.slice(0, 2048), manyTexts.slice(2048)]);

  const bigTexts = ["x".repeat(250_000), "y".repeat(250_000), "z"];
  t.check(chunkTexts(bigTexts), [bigTexts.slice(0, 1), bigTexts.slice(1)]);


  // ## Key resolution: an unconfigured box is `null`, not an error
  //
  // A stray in-tree `openai.secret.json` is not a key source; nothing reads it.

  const box = await makeTmpBox();
  t.check(await getOpenAiEmbeddingsKey(box.root), null);

  await box.write("_config/connectors/openai.secret.json", JSON.stringify({ apiKey: "file-key-456" }));
  t.check(await getOpenAiEmbeddingsKey(box.root), null);
});
