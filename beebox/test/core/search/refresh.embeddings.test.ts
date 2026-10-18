// # search: the refresh embedding pass — vectors, readiness, degradation
//
// `openSearchIndex` takes an optional `embeddings` service. When present, after
// the text refresh it batch-embeds every contains-bearing card whose `contains`
// changed (or was never embedded) and re-inserts its whole-card doc with a
// `vector[512]`. `embeddingsReady` is true only when a service is configured and
// no card is left pending — the signal the query layer gates hybrid on.

import { test } from "tap";
import "agent-doctest/tap";
import { search, getByID } from "@orama/orama";
import { openSearchIndex } from "../../../src/core/search/refresh/core.js";
import { loadManifest } from "../../../src/core/search/refresh/manifest.js";
import { searchLockPath } from "../../../src/core/search/store/core.js";
import { createFakeEmbeddings } from "../../../src/services/openai-embeddings.js";
import { acquireLock, releaseLock } from "../../../src/lib/file-lock.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

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
  // doctest:L32
  const box = await makeTmpBox();
  await box.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment moved.", "Dentist moved to June 17."));
  await box.write("store/notes/Plain.doc.card", DOC("Just a note with no contains yet."));
  const fake = createFakeEmbeddings();
  const built = await openSearchIndex(box.root, { embeddings: fake });
  t.check(built.embeddingsReady, true);

  // doctest:L40
  t.check(built.warnings, []);

  // doctest:L43
  await t.checkText(
    // Exactly one batched embed call for the one contains-bearing card.
    fake.calls.length,
    "1",
  );

  // doctest:L47
  t.check(fake.calls[0], [
    "Dentist moved to June 17.",
  ]);

  // doctest:L50
  // The whole-card doc holds the fake's deterministic vector for that contains.
  const dentist = getByID(built.db, "_content/inbox/Dentist.doc.card#");
  await t.checkText(JSON.stringify(dentist?.embedding) === JSON.stringify(await fakeVec("Dentist moved to June 17.")), "true");

  // doctest:L55
  // A card with no contains gets no vector.
  const plain = getByID(built.db, "store/notes/Plain.doc.card#");
  await t.checkText(plain?.embedding === undefined, "true");

  // doctest:L60
  // The manifest records the embedded card's hash, and leaves the other's unset.
  const m1 = await loadManifest(box.root);
  t.check(typeof m1.files["_content/inbox/Dentist.doc.card"]?.embeddedHash, "string");

  // doctest:L65
  await t.checkText(m1.files["store/notes/Plain.doc.card"]?.embeddedHash === undefined, "true");

  // ## Second refresh, nothing changed: no new embed call, still ready

  // doctest:L72
  const again = await openSearchIndex(box.root, { embeddings: fake });
  t.check(again.embeddingsReady, true);

  // doctest:L76
  await t.checkText(
    // Pending set is empty, so the fake is never called again.
    fake.calls.length,
    "1",
  );

  // ## Editing a card's contains re-embeds exactly that text

  // doctest:L84
  await box.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment moved.", "Dentist moved to July 2 instead."));
  const edited = await openSearchIndex(box.root, { embeddings: fake });
  t.check(edited.embeddingsReady, true);

  // doctest:L89
  await t.checkText(fake.calls.length, "2");

  // doctest:L92
  t.check(fake.calls[1], [
    "Dentist moved to July 2 instead.",
  ]);

  // doctest:L95
  const reDentist = getByID(edited.db, "_content/inbox/Dentist.doc.card#");
  await t.checkText(JSON.stringify(reDentist?.embedding) === JSON.stringify(await fakeVec("Dentist moved to July 2 instead.")), "true");

  // ## Persist → restore → vector search round-trip (pins oramasearch/orama#834)
  //
  // A fresh `openSearchIndex` restores the index from disk; the persisted vectors
  // must survive the round-trip and answer a native vector search.

  // doctest:L106
  const restored = await openSearchIndex(box.root);
  const vec = await fakeVec("Dentist moved to July 2 instead.");
  const vhits = await search(restored.db, { mode: "vector", vector: { value: vec, property: "embedding" }, similarity: 0.9, limit: 5 });
  t.check(vhits.hits.map((h) => String(h.document.path)).join("\n"), "_content/inbox/Dentist.doc.card");

  // ## No service: not ready, no warning (the designed not-configured state)

  // doctest:L116
  const noService = await openSearchIndex(box.root);
  t.check(noService.embeddingsReady, false);

  // doctest:L120
  t.check(noService.warnings, []);

  // ## Embed failure degrades visibly, re-pends, and reports not-ready

  // doctest:L127
  const box2 = await makeTmpBox();
  await box2.write("_content/inbox/Bill.doc.card", DOC("The electric bill is due.", "Electric bill due Friday."));
  const flaky = createFakeEmbeddings({ failTimes: 1 });
  const failed = await openSearchIndex(box2.root, { embeddings: flaky });
  t.check(failed.embeddingsReady, false);

  // doctest:L134
  await t.checkText(failed.warnings.length, "1");

  // doctest:L137
  t.check(failed.warnings[0]?.startsWith("embeddings unavailable"), true);

  // doctest:L140
  // Text search still answers, and the text side persisted.
  const textHit = await search(failed.db, { term: "electric", properties: ["contains", "content"] });
  t.check(textHit.hits.map((h) => String(h.document.path)).join("\n"), "_content/inbox/Bill.doc.card");

  // doctest:L145
  const failedManifest = await loadManifest(box2.root);
  await t.checkText(failedManifest.files["_content/inbox/Bill.doc.card"]?.embeddedHash === undefined, "true");

  // doctest:L149
  // Same fake instance, next refresh: the card re-pends and this time succeeds.
  const retried = await openSearchIndex(box2.root, { embeddings: flaky });
  t.check(retried.embeddingsReady, true);

  // doctest:L154
  const bill = getByID(retried.db, "_content/inbox/Bill.doc.card#");
  await t.checkText(JSON.stringify(bill?.embedding) === JSON.stringify(await fakeVec("Electric bill due Friday.")), "true");

  // ## Lock contention fails closed on readiness
  //
  // The stale path serves the last persisted index, which may predate whatever
  // the lock holder is writing — so it never claims `embeddingsReady`, even for
  // a fully embedded corpus. One contended query ranks text-only; the stale
  // warning already marks it degraded.

  // doctest:L167
  const box3 = await makeTmpBox();
  await box3.write("_content/inbox/Contended.doc.card", DOC("A card.", "Fully embedded already."));
  await openSearchIndex(box3.root, { embeddings: createFakeEmbeddings() });

  // doctest:L171
  await acquireLock(searchLockPath(box3.root), { purpose: "doctest-contender" });
  const contended = await openSearchIndex(box3.root, {
    embeddings: createFakeEmbeddings(),
    lockRetries: 1,
    lockRetryMs: 1,
  });
  await releaseLock(searchLockPath(box3.root));

  // doctest:L179
  t.check(contended.stale, true);

  // doctest:L182
  t.check(contended.embeddingsReady, false);
});
