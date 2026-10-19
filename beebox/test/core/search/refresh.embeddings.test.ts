// # search: the refresh embedding pass — vectors, readiness, degradation
//
// `openSearchIndex` takes an optional `embeddings` service. When present, after
// the text refresh it batch-embeds every contains-bearing card whose `contains`
// changed (or was never embedded) and re-inserts its whole-card doc with a
// `vector[512]`. `embeddingsReady` is true only when a service is configured and
// no card is left pending — the signal the query layer gates hybrid on.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { search, getByID } from "@orama/orama";
import { openSearchIndex } from "../../../src/core/search/refresh/core.js";
import { loadManifest } from "../../../src/core/search/refresh/manifest.js";
import { searchLockPath } from "../../../src/core/search/store/core.js";
import { createFakeEmbeddings } from "../../../src/services/openai-embeddings.js";
import { acquireLock, releaseLock } from "../../../src/lib/file-lock.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const DOC = (text: string, contains?: string) =>
  `---\ntitle: Note\n${contains ? `contains: ${contains}\n` : ""}---\n${text}\n`;

// The deterministic vector the fake produces for a text — identical text
// always yields the identical vector, so a fresh fake reproduces what the
// build stored.
async function fakeVec(text: string): Promise<number[]> {
  return (await createFakeEmbeddings().embed([text]))[0] ?? [];
}

// ## Cold build with a service: contains-bearing cards get vectors, others don't
void test("Cold build with a service: contains-bearing cards get vectors, others don't", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await box2.cleanup();
      await box3.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment moved.", "Dentist moved to June 17."));
  await box.write("store/notes/Plain.doc.card", DOC("Just a note with no contains yet."));
  const fake = createFakeEmbeddings();
  const built = await openSearchIndex(box.root, { embeddings: fake });
  t.check({ embeddingsReady: built.embeddingsReady, warnings: built.warnings }, { embeddingsReady: true, warnings: [] });

  // Exactly one batched embed call for the one contains-bearing card.
  t.check(fake.calls, [["Dentist moved to June 17."]]);

  // The whole-card doc holds the fake's deterministic vector for that contains.
  const dentist = getByID(built.db, "_content/inbox/Dentist.doc.card#");
  t.check(dentist?.embedding, await fakeVec("Dentist moved to June 17."));

  // A card with no contains gets no vector.
  const plain = getByID(built.db, "store/notes/Plain.doc.card#");
  t.check(
    { path: plain?.path, kind: plain?.kind, title: plain?.title, contains: plain?.contains, content: plain?.content, embedding: plain?.embedding },
    {
      path: "store/notes/Plain.doc.card",
      kind: "doc",
      title: "Note",
      contains: "",
      content: "Just a note with no contains yet.",
      embedding: undefined,
    },
  );

  // The manifest records the embedded card's hash, and leaves the other's unset.
  const m1 = await loadManifest(box.root);
  t.check(m1.files["_content/inbox/Dentist.doc.card"], {
    mtimeMs: any(Number).positive(),
    size: 87,
    contentHash: "592d4dfdf5ad9cdf",
    docIds: ["_content/inbox/Dentist.doc.card#"],
    embeddedHash: "71c146e97cf32ec7",
  });

  t.check(m1.files["store/notes/Plain.doc.card"], {
    mtimeMs: any(Number).positive(),
    size: 54,
    contentHash: "7c1182a5e8826f8a",
    docIds: ["store/notes/Plain.doc.card#"],
  });

  // ## Second refresh, nothing changed: no new embed call, still ready

  const again = await openSearchIndex(box.root, { embeddings: fake });
  t.check(again.embeddingsReady, true);

  // Pending set is empty, so the fake is never called again.
  t.check(fake.calls, [["Dentist moved to June 17."]]);

  // ## Editing a card's contains re-embeds exactly that text

  await box.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment moved.", "Dentist moved to July 2 instead."));
  const edited = await openSearchIndex(box.root, { embeddings: fake });
  t.check(edited.embeddingsReady, true);

  t.check(fake.calls, [["Dentist moved to June 17."], ["Dentist moved to July 2 instead."]]);

  const reDentist = getByID(edited.db, "_content/inbox/Dentist.doc.card#");
  t.check(reDentist?.embedding, await fakeVec("Dentist moved to July 2 instead."));

  // ## Persist → restore → vector search round-trip (pins oramasearch/orama#834)
  //
  // A fresh `openSearchIndex` restores the index from disk; the persisted vectors
  // must survive the round-trip and answer a native vector search.

  const restored = await openSearchIndex(box.root);
  const vec = await fakeVec("Dentist moved to July 2 instead.");
  const vhits = await search(restored.db, { mode: "vector", vector: { value: vec, property: "embedding" }, similarity: 0.9, limit: 5 });
  t.check(vhits.hits.map((h) => String(h.document.path)).join("\n"), "_content/inbox/Dentist.doc.card");

  // ## No service: not ready, no warning (the designed not-configured state)

  const noService = await openSearchIndex(box.root);
  t.check({ embeddingsReady: noService.embeddingsReady, warnings: noService.warnings }, { embeddingsReady: false, warnings: [] });

  // ## Embed failure degrades visibly, re-pends, and reports not-ready

  const box2 = await makeTmpBox();
  await box2.write("_content/inbox/Bill.doc.card", DOC("The electric bill is due.", "Electric bill due Friday."));
  const flaky = createFakeEmbeddings({ failTimes: 1 });
  const failed = await openSearchIndex(box2.root, { embeddings: flaky });
  t.check({ embeddingsReady: failed.embeddingsReady, warnings: failed.warnings }, {
    embeddingsReady: false,
    warnings: [
      "embeddings unavailable (Embeddings error: scripted failure (attempt 1 of 1)) — semantic ranking degraded; ask the boxholder to grant the \"openai\" secret to this box",
    ],
  });

  // Text search still answers, and the text side persisted.
  const textHit = await search(failed.db, { term: "electric", properties: ["contains", "content"] });
  t.check(textHit.hits.map((h) => String(h.document.path)).join("\n"), "_content/inbox/Bill.doc.card");

  const failedManifest = await loadManifest(box2.root);
  t.check(failedManifest.files["_content/inbox/Bill.doc.card"], {
    mtimeMs: any(Number).positive(),
    size: 82,
    contentHash: "36e17a35407359ad",
    docIds: ["_content/inbox/Bill.doc.card#"],
  });

  // Same fake instance, next refresh: the card re-pends and this time succeeds.
  const retried = await openSearchIndex(box2.root, { embeddings: flaky });
  t.check(retried.embeddingsReady, true);

  const bill = getByID(retried.db, "_content/inbox/Bill.doc.card#");
  t.check(bill?.embedding, await fakeVec("Electric bill due Friday."));

  // ## Lock contention fails closed on readiness
  //
  // The stale path serves the last persisted index, which may predate whatever
  // the lock holder is writing — so it never claims `embeddingsReady`, even for
  // a fully embedded corpus. One contended query ranks text-only; the stale
  // warning already marks it degraded.

  const box3 = await makeTmpBox();
  await box3.write("_content/inbox/Contended.doc.card", DOC("A card.", "Fully embedded already."));
  await openSearchIndex(box3.root, { embeddings: createFakeEmbeddings() });

  await acquireLock(searchLockPath(box3.root), { purpose: "doctest-contender" });
  const contended = await openSearchIndex(box3.root, {
    embeddings: createFakeEmbeddings(),
    lockRetries: 1,
    lockRetryMs: 1,
  });
  await releaseLock(searchLockPath(box3.root));

  t.check({ stale: contended.stale, embeddingsReady: contended.embeddingsReady }, { stale: true, embeddingsReady: false });
});
