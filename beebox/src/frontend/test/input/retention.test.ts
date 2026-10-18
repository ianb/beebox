// # RetentionStore — emission-keyed audio retention
//
// `createRetentionStore` (docs/plans/input-extraction.md, chunk 5) replaces
// the old single-slot "last message audio" cache with one keyed by emission
// id, so a send never has to clear anything — `latest()` is well-defined by
// construction. v1 policy: memory-only, oldest evicted first once past
// capacity.

import { test } from "tap";
import "agent-doctest/tap";
import { createRetentionStore } from "../../src/input/retention.js";

// ## Keying: retain and get by emission id
void test("Keying: retain and get by emission id", async (t) => {
  // doctest:L16
  const store = createRetentionStore<string>({ capacity: 5 });
  store.retain("msg-1", "audio-for-1");
  store.retain("msg-2", "audio-for-2");
  t.check(store.get("msg-1"), "audio-for-1");

  // doctest:L22
  t.check(store.get("msg-2"), "audio-for-2");

  // doctest:L25
  t.check(store.size(), 2);

  // ## Unknown id

  // doctest:L32
  t.check(store.get("msg-never-retained"), undefined);

  // ## `latest()` returns the most recently retained entry

  // doctest:L39
  t.check(store.latest(), {
    emissionId: "msg-2",
    audio: "audio-for-2",
  });

  // Re-retaining an id already present moves it to "most recent" too — it
  // doesn't just overwrite in place at its old position:

  // doctest:L47
  store.retain("msg-1", "audio-for-1-updated");
  t.check(store.latest(), {
    emissionId: "msg-1",
    audio: "audio-for-1-updated",
  });

  // doctest:L51
  t.check(store.size(), 2);
});

// ## Eviction at capacity: oldest drops first
void test("Eviction at capacity: oldest drops first", async (t) => {
  // doctest:L58
  const small = createRetentionStore<string>({ capacity: 2 });
  small.retain("a", "A");
  small.retain("b", "B");
  small.retain("c", "C");
  t.check(small.size(), 2);

  // doctest:L65
  t.check(small.get("a"), undefined);

  // doctest:L68
  t.check(small.get("b"), "B");

  // doctest:L71
  t.check(small.get("c"), "C");

  // doctest:L74
  t.check(small.latest(), {
    emissionId: "c",
    audio: "C",
  });
});

// ## Empty store
void test("Empty store", async (t) => {
  // doctest:L81
  const empty = createRetentionStore<string>({ capacity: 5 });
  t.check(empty.latest(), undefined);

  // doctest:L85
  t.check(empty.size(), 0);
});

// ## Null payloads are first-class entries (the no-audio tombstone)
//
// `lib/last-audio.ts` instantiates the store with `VoiceAudioPayload | null`:
// a voice send with no recording retains `null` under its emission id, so it
// OCCUPIES the latest slot — `get-last-audio` then answers none instead of
// serving an older message's recording as if it were the latest.
void test("lib/last-audio.ts instantiates the store with VoiceAudioPayload | null:", async (t) => {
  // doctest:L97
  const tomb = createRetentionStore<string | null>({ capacity: 5 });
  tomb.retain("voice-with-audio", "recording-A");
  tomb.retain("voice-without-audio", null);
  t.check(tomb.latest(), {
    emissionId: "voice-without-audio",
    audio: null,
  });

  // doctest:L103
  t.check(tomb.get("voice-with-audio"), "recording-A");
});
