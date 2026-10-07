# Research

Competitive/comparative research written to inform beebox planning — not
beebox's own documentation. Reviews of other systems (OpenClaw, Hermes,
Letta, PAI, gstack, comparables scouted along the way) done to steal good
ideas and validate or challenge our own bets.

## Shape

- Each corpus gets its own subdirectory (`gstack/`, `openclaw-hermes/`,
  `pai/`, …) with a `README.md` index: a table of the corpus's documents plus
  status/disposition columns (which idea is adopt/adapt/investigate/reject,
  or the doc's own status).
- Deep-dives on specific sub-topics live as separate per-topic note files
  alongside the index, cross-linked from it — don't cram everything into one
  giant file.
- A one-off comparison that isn't part of a larger corpus (e.g.
  `openclaw-architecture-review.md`, `memory-atlas-architecture-review.md`)
  can live flat at `research/` top level instead of getting its own directory.

## What a review must do

Every review ends in **explicit recommendations** — adopt / adapt / reject /
later, each traced to a concrete beebox specifics (a file, a design
doc, a boxholder decision), not left as abstract praise or criticism of the
other system. "Interesting" isn't a disposition.

Findings worth actually pursuing get **filed into the monorepo-root
`issues/` tree** (or a plan, if a finding is ready for one) — a good idea
stranded only in `research/` doesn't reach the place where work actually
gets picked up.

When an adopt or adapt disposition ships, the landing commit adds an entry to
the root `ACKNOWLEDGEMENTS.md`. The research note records the evaluation; the
acknowledgements file records the credit.

Research corpora do **not** need a cross-model (Codex) review (boxholder,
2026-08-02). That rule is for built things — code, plans, wire contracts. A
survey's dispositions get their scrutiny later, when an idea is picked up
and planned; don't spend a review cycle on the survey itself.

## Lifecycle

These are **dated snapshots**, not living docs. A review reflects the other
system's state and our own thinking on the date it was written. When
something changes enough to matter, write a new review (or a follow-up
deep-dive) rather than editing the old one in place — the old one stays as
the record of what was true when it was written, and the new one says what
it supersedes. Don't "maintain" a review by patching it as our code evolves.

## Fetching sources

Reddit (as of 2026-10-04) refuses agents on every default path: plain HTTP,
`.json`, `bin/browse`, reader proxies, and Claude in Chrome (blocklisted). The
official API no longer issues credentials without a manual review. What works:

- Arctic Shift, no key: `https://arctic-shift.photon-reddit.com/api/posts/ids?ids=<id>`
  and `.../api/comments/tree?link_id=<id>&limit=9999`. Archived at ingest, so
  scores and counts are stale and removed text is missing.
- The thread's `.rss` feed (`.../comments/<id>/.rss`). Reddit's own data, but
  it returns 429 after a few requests.
- `i.redd.it` images fetch directly; image posts often carry the content.

Do not use stealth-browser or residential-proxy fetchers. Details and the
proposed tool: [fetch-blocked-pages](../issues/features/2026-10-04-fetch-blocked-pages.md).
