// # search: hybrid query mode — embeddingsReady-gated vector ranking
//
// `searchBox` embeds the query and runs Orama's `mode: "hybrid"` (BM25 + vector
// fused) when an embeddings service is configured AND the refresh reports the
// corpus fully embedded (`embeddingsReady`). It degrades to text-only — visibly,
// with a warning — when the corpus isn't ready or the query embed fails, and
// silently when no key is configured (the designed normal state). `--mode text`
// forces text ranking offline; `--mode hybrid` fails loudly when it can't run.
//
// The fake embedder is deterministic: identical text → identical unit vector →
// cosine similarity 1.0, so querying the exact text of a card's `contains` makes
// the vector half rank that card top.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { anything } from "@ianbicking/tap-check/check";
import { searchBox } from "../../../src/core/search/query/core.js";
import { createFakeEmbeddings, EmbeddingsError, type EmbeddingsService } from "../../../src/services/openai-embeddings.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { toError } from "../../../src/shared/error-guards.js";

// No ambient key: the no-service cases must resolve to null, never a real
// network-backed service, regardless of the runner's environment.
delete process.env["BBX_OPENAI_API_KEY"];

const DOC = (text: string, contains?: string) =>
  `---\ntitle: Note\n${contains ? `contains: ${contains}\n` : ""}---\n${text}\n`;

// Run an awaitable and report the thrown error's class name (or "no throw").
async function throwName(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "did not throw";
  } catch (e) {
    return toError(e).name;
  }
}

async function throwMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "did not throw";
  } catch (e) {
    return toError(e).message;
  }
}

// ## auto + service: hybrid ranks the semantically-matched card top
void test("auto + service: hybrid ranks the semantically-matched card top", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const box = await makeTmpBox();
  await box.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment moved.", "Dentist moved to June 17."));
  await box.write("_content/inbox/Bill.doc.card", DOC("The electric bill is due.", "Electric bill due Friday."));
  const fake = createFakeEmbeddings();
  const res = await searchBox(box.root, { query: "Dentist moved to June 17.", embeddings: fake });
  // The second hit is box scaffolding that also matches; only the top hit is the contract.
  t.check(res, {
    results: [
      {
        path: "_content/inbox/Dentist.doc.card",
        fragment: "",
        kind: "doc",
        title: "Note",
        contains: "Dentist moved to June 17.",
        excerpt: "Dentist moved to June 17.",
        score: 1,
      },
      anything(),
    ],
    total: 2,
    truncated: false,
    warnings: [],
    stale: false,
    searchMode: "hybrid",
    embeddingsReady: true,
  });

  // ## auto + no service: text mode, no warning (the designed not-configured state)

  const res2 = await searchBox(box.root, { query: "dentist" });
  t.check(res2, {
    results: [
      {
        path: "_content/inbox/Dentist.doc.card",
        fragment: "",
        kind: "doc",
        title: "Note",
        contains: "Dentist moved to June 17.",
        excerpt: "Dentist moved to June 17.",
        score: 2.9782453381768477,
      },
    ],
    total: 1,
    truncated: false,
    warnings: [],
    stale: false,
    searchMode: "text",
    embeddingsReady: false,
  });

  // ## kind filter composes with hybrid
  //
  // A `--kind`-restricted hybrid search returns only that kind; the `where` filter
  // applies to both the text and vector halves.

  await box.write("_content/notes/Dentist.md", "# Dentist\nA plain markdown note about the dentist appointment.\n");
  const fakeK = createFakeEmbeddings();
  const resK = await searchBox(box.root, { query: "dentist appointment", embeddings: fakeK, kinds: ["doc"] });
  t.check(resK, {
    results: [
      {
        path: "_content/inbox/Dentist.doc.card",
        fragment: "",
        kind: "doc",
        title: "Note",
        contains: "Dentist moved to June 17.",
        excerpt: "Dentist moved to June 17.",
        score: 0.5,
      },
    ],
    total: 1,
    truncated: false,
    warnings: [],
    stale: false,
    searchMode: "hybrid",
    embeddingsReady: true,
  });
});

// ## mode "text" is fully offline: zero embed calls, works with a broken secret
//
// `--mode text` skips key resolution entirely and passes no service into the
// refresh — never a paid call, and never dependent on a key being configured.
void test("--mode text skips key resolution entirely and passes no service into the refr...", async (t) => {
  t.teardown(async () => {
    try {
      await boxT.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const boxT = await makeTmpBox();
  await boxT.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment moved.", "Dentist moved to June 17."));
  const fakeT = createFakeEmbeddings();
  const resT = await searchBox(boxT.root, { query: "dentist", embeddings: fakeT, mode: "text" });
  t.check(resT, {
    results: [
      {
        path: "_content/inbox/Dentist.doc.card",
        fragment: "",
        kind: "doc",
        title: "Note",
        contains: "Dentist moved to June 17.",
        excerpt: "Dentist moved to June 17.",
        score: 2.0300822947445445,
      },
    ],
    total: 1,
    truncated: false,
    warnings: [],
    stale: false,
    searchMode: "text",
    embeddingsReady: false,
  });

  // Zero calls: no corpus embed, no query embed.
  t.check(fakeT.calls, []);
});

// ## ready corpus + query-embed failure: auto degrades with a warning
//
// The corpus embeds fine at refresh (call 1); the query-stage embed (call 2)
// fails. Auto mode falls back to text-ranked results and says so.
void test("The corpus embeds fine at refresh (call 1); the query-stage embed (call 2) fa...", async (t) => {
  t.teardown(async () => {
    try {
      await boxQ.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const boxQ = await makeTmpBox();
  await boxQ.write("_content/inbox/Bill.doc.card", DOC("The electric bill is due.", "Electric bill due Friday."));
  const innerQ = createFakeEmbeddings();
  let embedCalls = 0;
  const queryStageFails: EmbeddingsService = {
    async embed(texts: string[]): Promise<number[][]> {
      embedCalls += 1;
      if (embedCalls > 1) throw new EmbeddingsError("scripted query-stage failure");
      return innerQ.embed(texts);
    },
  };
  const resQ = await searchBox(boxQ.root, { query: "electric", embeddings: queryStageFails });
  t.check(resQ, {
    results: [
      {
        path: "_content/inbox/Bill.doc.card",
        fragment: "",
        kind: "doc",
        title: "Note",
        contains: "Electric bill due Friday.",
        excerpt: "Electric bill due Friday.",
        score: 2.04753517221583,
      },
    ],
    total: 1,
    truncated: false,
    warnings: [
      "query embedding failed (Embeddings error: scripted query-stage failure) — results are text-ranked",
    ],
    stale: false,
    searchMode: "text",
    embeddingsReady: true,
  });
});

// ## auto + failing service: not ready → text mode with a warning
//
// `failTimes` large enough that the refresh's embed pass fails, leaving the
// corpus not ready. Auto mode falls back to text and the refresh's warning
// surfaces (the query stage is never reached, so no duplicate warning is added).
void test("failTimes large enough that the refresh's embed pass fails, leaving the corpu...", async (t) => {
  t.teardown(async () => {
    try {
      await boxF.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const boxF = await makeTmpBox();
  await boxF.write("_content/inbox/Bill.doc.card", DOC("The electric bill is due.", "Electric bill due Friday."));
  const flaky = createFakeEmbeddings({ failTimes: 10 });
  const resF = await searchBox(boxF.root, { query: "electric", embeddings: flaky });
  // Text search still answers.
  t.check(resF, {
    results: [
      {
        path: "_content/inbox/Bill.doc.card",
        fragment: "",
        kind: "doc",
        title: "Note",
        contains: "Electric bill due Friday.",
        excerpt: "Electric bill due Friday.",
        score: 2.04753517221583,
      },
    ],
    total: 1,
    truncated: false,
    warnings: [
      "embeddings unavailable (Embeddings error: scripted failure (attempt 1 of 10)) — semantic ranking degraded; ask the boxholder to grant the \"openai\" secret to this box",
    ],
    stale: false,
    searchMode: "text",
    embeddingsReady: false,
  });
});

// ## mode "hybrid" with no service throws a typed, actionable error
void test("mode \"hybrid\" with no service throws a typed, actionable error", async (t) => {
  t.teardown(async () => {
    try {
      await boxH.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  const boxH = await makeTmpBox();
  await boxH.write("_content/inbox/Dentist.doc.card", DOC("The dentist appointment moved.", "Dentist moved to June 17."));
  t.check(await throwName(() => searchBox(boxH.root, { query: "dentist", mode: "hybrid" })), "HybridUnavailableError");

  // ## mode "hybrid" + not-ready carries the refresh-side cause
  //
  // The forced-hybrid error must not swallow the actionable warning (401,
  // timeout, …) the refresh pushed when corpus embedding failed.

  const flakyH = createFakeEmbeddings({ failTimes: 10 });
  const msg = await throwMessage(() => searchBox(boxH.root, { query: "dentist", mode: "hybrid", embeddings: flakyH }));
  t.check(msg, "hybrid search unavailable: semantic index not ready (embeddings unavailable (Embeddings error: scripted failure (attempt 1 of 10)) — semantic ranking degraded; ask the boxholder to grant the \"openai\" secret to this box); retry, or search with --mode text");
});
