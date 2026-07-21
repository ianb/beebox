---
title: "Vector-bearing search index restores in seconds per search — wait for upstream, cache in-process, or restructure?"
needs: [decision]
area: callback-box
filed-by: agent
discovered-in: worktree-orama-semantic-search — researching Orama persistence after semantic search shipped
---

With embeddings, a real box's search index restores in **~2-3 seconds on
every `cb search`** (a large real box: 2,458 cards, ~1k vectors, 34.5MB JSON). Before
vectors this was sub-second. The cost is structural in `@orama/orama`:
vectors persist in BOTH the documents store and the vector index
(~21KB/embedded doc in JSON), and the whole index restores as one blob per
CLI invocation. This also caps how far we can take semantic coverage —
embedding card *content* (not just `contains`) would multiply the vector
count and push restore toward the ~512MB string ceiling
(oramasearch/orama#851).

## Research (2026-07-10)

Docs/community (searched):
- No official Orama guidance on persistence-format trade-offs, vector-heavy
  index sizing, or per-invocation restore. Our pain points are open,
  acknowledged upstream issues: value duplication across index structures
  (#426, partially fixed for ids only), memory-vs-size trade-off requests
  (#573, open), 512MB restore ceiling (#851), restore can't take creation
  options (#640).
- OramaCore (their Rust rewrite) is server/Docker-shaped — wrong direction
  for a per-invocation CLI. JS Orama remains the right library shape.
- No quantization/int8 support; no lazy/partial restore API; the only
  wild precedent for avoiding double storage is a third-party pattern
  running separate text and vector Orama instances fused app-side.

Formats (benchmarked synthetically AND on that real box's index —
the synthetic numbers were misleading; trust the real ones):
- **json** (current): 34.5MB, restore ~2-3s.
- **binary** (msgpack): FAILS unpatched — the depth-100 encode limit is
  real on real corpora (radix tree nests per character; long attach paths
  and doc ids exceed 100 chars; `normalizeContent`'s 64-char splitting only
  covers body content, so synthetic benchmarks passed while the real box
  threw "Too deep objects in depth 101"). With a vendored `maxDepth` patch
  (the plugin doesn't expose encode options): 20.5MB but restore ~10%
  SLOWER than JSON — native JSON.parse beats msgpack decode on these deep
  structures. Tried and reverted 2026-07-10; findings recorded in
  `search-store.ts`'s module comment so nobody retries it blind.
- **seqproto**: hard-broken with vector fields in 3.1.18 (serializer
  string-encodes raw floats, throws). **dpack**: bigger AND slower than
  JSON. Neither viable.
- Split design (text-only Orama + raw-Float32 vector sidecar + app-side
  fusion): measured ~9MB / ~50ms restore for the pieces — the only shape
  that structurally fixes it — but the boxholder's read (2026-07-10) is
  that reimplementing vector storage + fusion app-side fights the library:
  "this is what Orama is supposed to do." Parked, not planned.

## The options, none chosen

1. **Live with it** (status quo): ~2-3s per `cb search` on a large embedded
   box; text-only boxes unaffected. Agents tolerate it; humans may not.
2. **Upstream**: file (or contribute) against oramasearch/orama — expose
   encode options in plugin-data-persistence, stop double-persisting
   vectors, or support partial/lazy restore. Aligns with the boxholder's
   "Orama's job" stance; timeline uncertain, JS-Orama release cadence has
   slowed since OramaCore.
3. **In-process index cache** for resident processes (`cb serve`/hub):
   cache the restored db keyed by index-file mtime, so web/chat-driven
   searches pay restore once, not per query. Doesn't help one-shot CLI
   invocations (reactor/agent searches), which stay at seconds.
4. **The split-sidecar restructure**: biggest win, most app-side machinery;
   parked per the boxholder's skepticism unless 1-3 prove insufficient.

Option 3 composes with any of the others and is cheap; 2 is worth doing
regardless as a low-effort issue filing. Content-embedding ambitions
(beyond `contains`) stay blocked until one of 2/4 lands.
