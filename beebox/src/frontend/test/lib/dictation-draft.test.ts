// # dictation-draft helpers
//
// Pure helpers for the interrupted-dictation draft the chat persists to
// localStorage so a screen sleep / tab eviction / reload can't erase an
// in-progress narration transcript. The hook owns the storage I/O; these own the
// key shape and the parse/serialize boundary. The age label moved to
// `relative-time.doctest.md`, where the capture chip shares it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  draftKey,
  parseDraft,
  serializeDraft,
  adoptLegacyDictationDrafts,
} from "../../src/lib/dictation-draft.js";
import type { KeyValueStorage } from "../../src/input/emission-persist.js";

function fakeStorage(): KeyValueStorage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
  };
}

// ## draftKey
//
// One singleton slot per box (docs/plans/input-extraction.md, chunk 4) — not
// per session, mirroring the composer's `emissionKey`. A missing box slug falls
// back to `default`:
void test("One singleton slot per box (docs/plans/input-extraction.md, chunk 4) — not pe...", async (t) => {
  t.check(draftKey({ boxSlug: "test1", scope: "" }), "bbx-chat-draft:test1:singleton");

  t.check(draftKey({ boxSlug: undefined, scope: "" }), "bbx-chat-draft:default:singleton");
});

// The slot is per box INSTANCE, mirroring the composer: two dev worktrees serving
// their own `test1` from one origin must not share a dictation draft. Production's
// scope is empty and its key is unchanged.
void test("The slot is per box INSTANCE, mirroring the composer:", async (t) => {
  t.check(
    [
      draftKey({ boxSlug: "test1", scope: "main/test1" }),
      draftKey({ boxSlug: "test1", scope: "" }),
    ],
    [
    "bbx-chat-draft:main/test1:singleton",
    "bbx-chat-draft:test1:singleton",
  ],
  );
});

// ## adoptLegacyDictationDrafts: most-recent wins, all legacy keys removed
//
// The named behavior change (mirrors `adoptLegacyComposerDrafts`): other
// sessions' stale dictation drafts are discarded, not merged.
void test("The named behavior change (mirrors adoptLegacyComposerDrafts):", async (t) => {
  const s = fakeStorage();
  s.setItem("bbx-chat-draft:test1:sess-a", JSON.stringify({ text: "older", narration: false, updatedAt: 100 }));
  s.setItem("bbx-chat-draft:test1:sess-b", JSON.stringify({ text: "newest", narration: true, updatedAt: 300 }));
  s.setItem("bbx-chat-draft:otherbox:sess-z", JSON.stringify({ text: "not ours", narration: false, updatedAt: 999 }));
  const result = adoptLegacyDictationDrafts(s, { boxSlug: "test1", scope: "" });
  t.check(result.adopted, {
    text: "newest",
    narration: true,
    updatedAt: 300,
  });

  t.check(result.discarded, 1);

  t.check(
    // This box's legacy keys are gone; the other box's are untouched.
    Object.keys(s.dump()).toSorted().join(","),
    "bbx-chat-draft:otherbox:sess-z",
  );
});

// An empty box (no legacy keys, or none that parse) adopts nothing:
void test("An empty box (no legacy keys, or none that parse) adopts nothing:", async (t) => {
  const empty = fakeStorage();
  const result2 = adoptLegacyDictationDrafts(empty, { boxSlug: "test1", scope: "" });
  t.check(result2, {
    adopted: null,
    discarded: 0,
  });
});

// The singleton key itself is never a candidate — it uses the new prefix,
// separate from the legacy per-session prefix, and adoption must not delete or
// re-adopt the slot it writes to:
void test("The singleton key itself is never a candidate — it uses the new prefix, separ...", async (t) => {
  const s2 = fakeStorage();
  s2.setItem("bbx-chat-draft:test1:singleton", "not json {{{");
  s2.setItem("bbx-chat-draft:test1:sess-a", JSON.stringify({ text: "legacy", narration: false, updatedAt: 100 }));
  const result3 = adoptLegacyDictationDrafts(s2, { boxSlug: "test1", scope: "" });
  t.check(result3.adopted, {
    text: "legacy",
    narration: false,
    updatedAt: 100,
  });

  t.check(
    // The malformed singleton survives (the caller overwrites it); only the legacy key is removed.
    Object.keys(s2.dump()).toSorted().join(","),
    "bbx-chat-draft:test1:singleton",
  );
});

// ## serializeDraft / parseDraft
//
// A well-formed draft round-trips:
void test("A well-formed draft round-trips:", async (t) => {
  const draft = { text: "buy oat milk and call the dentist", narration: true, updatedAt: 5 };
  t.check(parseDraft(serializeDraft(draft)), {
    text: "buy oat milk and call the dentist",
    narration: true,
    updatedAt: 5,
  });
});

// `parseDraft` returns null for anything it can't trust — absent, empty, or
// malformed-shape values — so a corrupt entry never reaches the UI:
void test("parseDraft returns null for anything it can't trust — absent, empty, or malfo...", async (t) => {
  t.check(parseDraft(null), null);

  t.check(parseDraft(""), null);
});

void test("serializeDraft / parseDraft", async (t) => {
  t.check(parseDraft('{"text":"   ","narration":true,"updatedAt":5}'), null);

  t.check(parseDraft('{"text":"hi","narration":"yes","updatedAt":5}'), null);

  t.check(parseDraft('{"text":"hi","narration":true}'), null);

  t.check(parseDraft('{"text":"hi","narration":true,"updatedAt":"5"}'), null);
});
