// # Chat Review: the span journal
//
// `src/core/chat/review/span.ts` decides which slice of a transcript has not yet
// been folded into a session's account.
//
// The journal records the **identity** of the last entry read (`endUuid`) plus a
// hash of every entry before it (`prefixHash`) — never a bare index. Transcripts
// are SDK-owned and get rewritten (auto-compaction, `--resume` forks), and
// `parseSessionLog` slices positionally, so an index alone silently shifts under
// a rewrite that keeps the total the same.

import { test } from "tap";
import "agent-doctest/tap";
import {
  appliedSpanFor,
  computeSpanId,
  pagesOf,
  prefixHash,
  resolveSpan,
  spanSize,
} from "../../../../src/core/chat/review/span.js";

const NOW = new Date("2026-07-28T04:00:00Z");

/** A minimal parsed entry — uuid is what the journal keys on. */
function entry(uuid: string, text: string) {
  return {
    uuid,
    type: "user" as const,
    timestamp: "2026-07-28T03:00:00Z",
    content: [{ type: "text" as const, text }],
  };
}

const a = entry("u-a", "first");
const b = entry("u-b", "second");
const c = entry("u-c", "third");
const d = entry("u-d", "fourth");

// ## No journal yet: bootstrap over the whole transcript
//
// A session nobody has reviewed reads from the top. This is also how an existing
// long session enters the system — one pass over everything, rather than replaying
// its history span by span.
void test("A session nobody has reviewed reads from the top.", async (t) => {
  // doctest:L47
  const fresh = await resolveSpan({ readPage: pagesOf([a, b, c]), applied: null });
  t.check(fresh.bootstrap, "no-journal");

  // doctest:L51
  t.check(fresh.entries.map((e) => e.uuid).join(","), "u-a,u-b,u-c");

  // doctest:L54
  t.check(fresh.endIndex, 2);
});

// ## Normal advance: only what arrived since the boundary
//
// With a journal pointing at `u-b`, the span is everything after it.
void test("With a journal pointing at u-b, the span is everything after it.", async (t) => {
  // doctest:L63
  const applied = appliedSpanFor({ sessionId: "s1", span: await resolveSpan({ readPage: pagesOf([a, b]), applied: null }), now: NOW });
  t.check(applied?.endUuid, "u-b");

  // doctest:L67
  const next = await resolveSpan({ readPage: pagesOf([a, b, c, d]), applied });
  t.check(next.bootstrap, null);

  // doctest:L71
  t.check(next.entries.map((e) => e.uuid).join(","), "u-c,u-d");

  // A transcript that hasn't grown yields an empty span, which the size gate then
  // rejects — nothing is re-read and no model is called.

  // doctest:L79
  const unchanged = await resolveSpan({ readPage: pagesOf([a, b]), applied });
  t.check({ bootstrap: unchanged.bootstrap, entries: unchanged.entries.length }, {
    bootstrap: null,
    entries: 0,
  });
});

// ## The boundary entry is gone: history was rewritten wholesale
void test("The boundary entry is gone: history was rewritten wholesale", async (t) => {
  // doctest:L87
  const applied = appliedSpanFor({ sessionId: "s1", span: await resolveSpan({ readPage: pagesOf([a, b]), applied: null }), now: NOW });

  // doctest:L89
  // The SDK replaced the transcript; `u-b` no longer exists.
  const rewritten = await resolveSpan({ readPage: pagesOf([entry("u-x", "summary"), entry("u-y", "later")]), applied });
  t.check(rewritten.bootstrap, "boundary-missing");
});

// ## The boundary survives but its history changed — the case an index misses
//
// This is the important one. The boundary uuid is still present at the same index
// and the total is unchanged, so an index-based cursor would happily continue and
// skip the rewritten material. The prefix hash catches it.
void test("This is the important one.", async (t) => {
  // doctest:L102
  const applied = appliedSpanFor({ sessionId: "s1", span: await resolveSpan({ readPage: pagesOf([a, b]), applied: null }), now: NOW });

  // doctest:L104
  // `u-b` is still at index 1, total still 2 — but `u-a` was replaced.
  const mutated = [entry("u-z", "replaced"), b, c];
  t.check((await resolveSpan({ readPage: pagesOf(mutated), applied })).bootstrap, "prefix-rewritten");

  // The whole transcript comes back as the span, so nothing is lost — the caller
  // keeps the existing account, which is now the only record of what was rewritten.

  // doctest:L114
  t.check((await resolveSpan({ readPage: pagesOf(mutated), applied })).entries.map((e) => e.uuid).join(","), "u-z,u-b,u-c");
});

// ## The content changed but every uuid stayed the same
//
// The subtler rewrite. Identity is unchanged all the way through the boundary, so
// a uuid-only hash would call this history untouched and skip the edited material
// forever. The prefix hash covers rendered content, so it does not.
void test("The subtler rewrite.", async (t) => {
  // doctest:L125
  const applied = appliedSpanFor({ sessionId: "s1", span: await resolveSpan({ readPage: pagesOf([a, b]), applied: null }), now: NOW });

  // doctest:L127
  // Same uuids, same positions, same count — different words.
  const edited = [entry("u-a", "first, REVISED"), b, c];
  t.check((await resolveSpan({ readPage: pagesOf(edited), applied })).bootstrap, "prefix-rewritten");
});

// ## An entry with no uuid can't anchor a journal
//
// `parseSessionLog` defaults a missing uuid to `""`, which is not an identity —
// several entries could carry it. Rather than resolve to the wrong one, such a
// boundary is refused at both ends: no journal entry is written, and one that
// somehow exists forces a bootstrap.
void test("parseSessionLog defaults a missing uuid to \"\", which is not an identity — sev...", async (t) => {
  // doctest:L141
  t.check(appliedSpanFor({ sessionId: "s1", span: await resolveSpan({ readPage: pagesOf([entry("", "anonymous")]), applied: null }), now: NOW }), null);

  // doctest:L144
  t.check(
    (await resolveSpan({
      readPage: pagesOf([a, b]),
      applied: {
        spanId: "x", endUuid: "", endIndex: 0, prefixHash: "y", at: "2026-07-28T04:00:00Z",
      },
    })).bootstrap,
    "boundary-missing",
  );
});

// ## The walk is paged: nothing before the boundary is retained, and the span is bounded
//
// `limit` is both the page size and the most entries a span may hold. The
// boundary can sit on any page — the prefix hash is folded as the pages go by —
// and the journal hash for the new end covers the whole prefix, exactly as the
// whole-array `prefixHash` would compute it. So a journal written by either form
// verifies against the other.
void test("limit is both the page size and the most entries a span may hold.", async (t) => {
  // doctest:L162
  const applied = appliedSpanFor({ sessionId: "s1", span: await resolveSpan({ readPage: pagesOf([a, b, c]), applied: null }), now: NOW });
  const e = entry("u-e", "fifth");
  const f = entry("u-f", "sixth");
  const g = entry("u-g", "seventh");
  const all = [a, b, c, d, e, f, g];

  // doctest:L168
  // Pages of two: the boundary `u-c` is on the second page.
  const paged = await resolveSpan({ readPage: pagesOf(all), applied, limit: 2 });
  t.check(
    {
      bootstrap: paged.bootstrap,
      entries: paged.entries.map((x) => x.uuid).join(","),
      endIndex: paged.endIndex,
      clipped: paged.clipped,
      hashMatchesWholeArray: paged.endPrefixHash === prefixHash(all, paged.endIndex),
    },
    {
    bootstrap: null,
    entries: "u-d,u-e",
    endIndex: 4,
    clipped: true,
    hashMatchesWholeArray: true,
  },
  );

  // Journalling that clipped span and resolving again continues from `u-e`; the
  // walk converges rather than re-reading anything.

  // doctest:L184
  const next = appliedSpanFor({ sessionId: "s1", span: paged, now: NOW });
  const rest = await resolveSpan({ readPage: pagesOf(all), applied: next, limit: 2 });
  t.check({ entries: rest.entries.map((x) => x.uuid).join(","), endIndex: rest.endIndex, clipped: rest.clipped }, {
    entries: "u-f,u-g",
    endIndex: 6,
    clipped: false,
  });

  // A bootstrap is bounded the same way: the first-ever review of an over-long
  // transcript takes the first window and reports it as clipped.

  // doctest:L194
  const first = await resolveSpan({ readPage: pagesOf(all), applied: null, limit: 3 });
  t.check({ bootstrap: first.bootstrap, entries: first.entries.length, clipped: first.clipped }, {
    bootstrap: "no-journal",
    entries: 3,
    clipped: true,
  });

  // A boundary that IS present with a changed prefix is a real rewrite, whichever
  // page it sits on — that bootstraps over the first window.

  // doctest:L203
  const rewrittenPrefix = await resolveSpan({
    readPage: pagesOf([entry("u-z", "replaced"), b, c, d]),
    applied,
    limit: 2,
  });
  t.check({ bootstrap: rewrittenPrefix.bootstrap, entries: rewrittenPrefix.entries.map((x) => x.uuid).join(",") }, {
    bootstrap: "prefix-rewritten",
    entries: "u-z,u-b",
  });
});

// ## Span ids are stable, and distinguish what they should
//
// The id is the idempotency key written to the husk, so identical inputs must
// produce an identical id across runs — and a different boundary or a different
// history must not collide.
void test("The id is the idempotency key written to the husk, so identical inputs must p...", async (t) => {
  // doctest:L219
  const p = prefixHash([a, b], 1);
  await t.checkText(
    computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: p })
      === computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: p }),
    "true",
  );

  // doctest:L224
  await t.checkText(
    // Different session, same boundary.
    computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: p })
      === computeSpanId({ sessionId: "s2", endUuid: "u-b", prefixHash: p }),
    "false",
  );

  // doctest:L229
  await t.checkText(
    // Same boundary, rewritten history.
    computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: p })
      === computeSpanId({ sessionId: "s1", endUuid: "u-b", prefixHash: prefixHash([entry("u-z", "x"), b], 1) }),
    "false",
  );

  // `appliedSpanFor` returns null for an empty transcript rather than inventing a
  // boundary.

  // doctest:L239
  t.check(appliedSpanFor({ sessionId: "s1", span: await resolveSpan({ readPage: pagesOf([]), applied: null }), now: NOW }), null);
});

// ## Span size is measured pre-elision
//
// The gate cannot use `renderSessionCompact`'s output: that is clamped at 40k
// chars, so a long session's rendered length stops growing and it would never
// qualify again. `spanSize` renders uncapped.
void test("The gate cannot use renderSessionCompact's output:", async (t) => {
  // doctest:L250
  const long = Array.from({ length: 500 }, (_, i) => entry(`u-${i}`, "x".repeat(200)));
  const size = spanSize(await resolveSpan({ readPage: pagesOf(long), applied: null }));
  await t.checkText(size > 40_000, "true");
});
