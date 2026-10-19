// # Audio Cache
//
// `AudioCache` is the optimistic in-memory store for generated TTS audio, used so
// replaying speech doesn't re-hit the TTS backend. It is byte-bounded with LRU
// eviction so it can never grow without limit.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { not } from "@ianbicking/tap-check/check";
import { AudioCache, cacheKey } from "../../../../src/lib/audio/tts-client/cache.js";

// ## Cache keys
//
// A key is derived from backend + voice + instructions + text (joined with a NUL separator
// that can't appear in any input, so distinct triples can't collide). It is
// deterministic and contains each part:
void test("A key is derived from backend + voice + instructions + text (joined with a NU...", async (t) => {
  t.check(cacheKey({ text: "hello", voice: "marin", instructions: "calm", backend: "openai" }), "openai\0marin\0calm\0hello");

  const same = cacheKey({ text: "hi", voice: "marin", instructions: "x", backend: "openai" });
  t.check(cacheKey({ text: "hi", voice: "marin", instructions: "x", backend: "openai" }), same);
});

// Distinct inputs produce distinct keys (so a re-voiced generation is its own
// entry):
void test("Distinct inputs produce distinct keys (so a re-voiced generation is its own e...", async (t) => {
  const a = cacheKey({ text: "hi", voice: "marin", instructions: "calm", backend: "openai" });
  const b = cacheKey({ text: "hi", voice: "coral", instructions: "calm", backend: "openai" });
  t.check(a, not(b));
});

// ## Store and retrieve
void test("Store and retrieve", async (t) => {
  // doctest:L41
  const cache = new AudioCache({ maxBytes: 100 });
  cache.set("a", new ArrayBuffer(40));
  t.check(cache.count, 1);

  // doctest:L46
  t.check(cache.byteLength, 40);

  // A hit returns the buffer; a miss returns undefined:

  // doctest:L53
  t.check(cache.get("a")?.byteLength, 40);

  // doctest:L56
  t.check(cache.get("missing"), undefined);
});

// ## Byte-budget eviction (LRU)
//
// Adding past the budget evicts the least-recently-used entry:
void test("Adding past the budget evicts the least-recently-used entry:", async (t) => {
  // doctest:L65
  const cache = new AudioCache({ maxBytes: 100 });
  cache.set("a", new ArrayBuffer(40));
  cache.set("b", new ArrayBuffer(40));
  cache.set("c", new ArrayBuffer(40));
  t.check(["a", "b", "c"].map((k) => cache.has(k)), [false, true, true]);

  // doctest:L75
  t.check(cache.byteLength, 80);
});

// ## A `get` bumps recency
//
// Reading an entry makes it most-recently-used, so a later insertion evicts a
// different (now-oldest) entry instead:
void test("Reading an entry makes it most-recently-used, so a later insertion evicts a d...", async (t) => {
  // doctest:L85
  const cache = new AudioCache({ maxBytes: 100 });
  cache.set("a", new ArrayBuffer(40));
  cache.set("b", new ArrayBuffer(40));
  cache.get("a");
  cache.set("c", new ArrayBuffer(40));
  t.check(["a", "b", "c"].map((k) => cache.has(k)), [true, false, true]);
});

// ## Oversized buffers are not cached
//
// A single buffer larger than the whole budget is dropped rather than cached
// (caching it would immediately blow the budget):
void test("A single buffer larger than the whole budget is dropped rather than cached (c...", async (t) => {
  // doctest:L103
  const cache = new AudioCache({ maxBytes: 100 });
  cache.set("big", new ArrayBuffer(200));
  t.check(cache.count, 0);
});
