// # contains-state: staleness tracking without touching cards
//
// The `.beebox/contains-state.json` sidecar records, per searchable
// card, the `contains` text and the content basis it was written against.
// The index refresh maintains it; cards stay byte-clean. Stale = the content
// moved while `contains` didn't.

import { test } from "tap";
import "agent-doctest/tap";
import { openSearchIndex } from "../../../src/core/search/refresh/core.js";
import {
  loadContainsState,
  listStale,
  listMissing,
  staleContainsWarning,
  computeBasisForCardPath,
  rebaseContains,
  saveContainsState,
} from "../../../src/core/search/contains-state.js";
import { createCardSchemaMap } from "../../../src/schemas.js";
import type { LoadCardContext } from "../../../src/core/card-io.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const ctx: LoadCardContext = {
  cardSchemas: await createCardSchemaMap(),
};

const DOC = (text: string, contains?: string) =>
  "---\ntitle: Note\n" + (contains ? "contains: " + contains + "\n" : "") + "---\n" + text + "\n";

// ## The refresh records contains text and basis; fresh cards aren't stale
void test("The refresh records contains text and basis; fresh cards aren't stale", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L34
  const box = await makeTmpBox();
  await box.write("store/notes/Dentist.doc.card", DOC("Appointment moved to June 17.", "Dentist moved to June 17."));
  await box.write("store/notes/Bare.doc.card", DOC("No contains here yet."));
  await openSearchIndex(box.root);
  const state = await loadContainsState(box.root);
  t.check(state.cards["store/notes/Dentist.doc.card"]?.containsText, "Dentist moved to June 17.");

  // doctest:L42
  t.check(listStale(state), []);

  // doctest:L45
  t.check(listMissing(state), [
    "store/notes/Bare.doc.card",
  ]);

  // ## Editing the body while keeping contains flags the card stale

  // doctest:L52
  await box.write("store/notes/Dentist.doc.card", DOC("Appointment moved AGAIN, now July 2.", "Dentist moved to June 17."));
  await openSearchIndex(box.root);
  t.check(listStale(await loadContainsState(box.root)), [
    "store/notes/Dentist.doc.card",
  ]);

  // ## The hook-time warning fires live, even before any refresh

  // doctest:L61
  const warning = await staleContainsWarning(box.root, { relPath: "store/notes/Dentist.doc.card", ctx });
  await t.checkText(warning !== null && warning.startsWith("store/notes/Dentist.doc.card: card content changed but contains: didn't"), "true");

  // doctest:L65
  t.check(await staleContainsWarning(box.root, { relPath: "store/notes/Bare.doc.card", ctx }), null);

  // ## Updating the contains text re-bases; the flag clears

  // doctest:L72
  await box.write("store/notes/Dentist.doc.card", DOC("Appointment moved AGAIN, now July 2.", "Dentist moved to July 2."));
  await openSearchIndex(box.root);
  t.check(listStale(await loadContainsState(box.root)), []);

  // ## Confirming unchanged text re-bases too (the bbx contains update path)

  // doctest:L81
  await box.write("store/notes/Dentist.doc.card", DOC("Tweaked wording, July 2 still right.", "Dentist moved to July 2."));
  await openSearchIndex(box.root);
  t.check(listStale(await loadContainsState(box.root)), [
    "store/notes/Dentist.doc.card",
  ]);

  // doctest:L86
  // What `bbx contains update` does with identical text: re-base at the live basis.
  const confirm = await computeBasisForCardPath(box.root, { relPath: "store/notes/Dentist.doc.card", ctx });
  const state2 = await loadContainsState(box.root);
  rebaseContains(state2, { cardPath: "store/notes/Dentist.doc.card", contains: confirm.contains, basis: confirm.basis ?? "" });
  await saveContainsState(box.root, state2);
  t.check(listStale(await loadContainsState(box.root)), []);

  // doctest:L94
  t.check(await staleContainsWarning(box.root, { relPath: "store/notes/Dentist.doc.card", ctx }), null);

  // ## Operational field flips (status) don't stale a body-less card's contains

  // doctest:L101
  await box.write(
    "_content/inbox/email/t.email-thread.card",
    "---\nthread-id: t1\nstatus: new\nsubject: Pricing\nparticipants:\n  - a@x.example\ncontains: Metricly demo offer; no action needed.\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nmessages: []\n---\n"
  );
  await openSearchIndex(box.root);
  await box.write(
    "_content/inbox/email/t.email-thread.card",
    "---\nthread-id: t1\nstatus: read\nsubject: Pricing\nparticipants:\n  - a@x.example\ncontains: Metricly demo offer; no action needed.\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nmessages: []\n---\n"
  );
  await openSearchIndex(box.root);
  t.check(listStale(await loadContainsState(box.root)).filter((p) => p.includes("email")), []);

  // ## A described image satisfies contains (role separation, no duplication)
  //
  // `description` is the visual field; it doubles as the effective `contains`
  // until an explicit one exists — so described images never enter the
  // backfill worklist, and a description change re-bases rather than flagging
  // stale (the retrieval field moved with the content).

  // doctest:L123
  const IMG = (desc: string) =>
    "---\nfilename:\n  ref: attach/boiler.jpg\n  via:\n    channel: camera-user\n    at: 2026-05-01T10:00:00Z\ndescription: " + desc + "\n---\n";
  await box.write("_bookkeeping/archive/boiler.image.card", IMG("The boiler's serial-number plate (K-44210)"));
  await openSearchIndex(box.root);
  t.check(listMissing(await loadContainsState(box.root)).filter((p) => p.includes("image")), []);

  // doctest:L130
  await box.write("_bookkeeping/archive/boiler.image.card", IMG("A different plate entirely (Z-99)"));
  await openSearchIndex(box.root);
  t.check(listStale(await loadContainsState(box.root)).filter((p) => p.includes("image")), []);

  // doctest:L135
  t.check(await staleContainsWarning(box.root, { relPath: "_bookkeeping/archive/boiler.image.card", ctx }), null);
});
