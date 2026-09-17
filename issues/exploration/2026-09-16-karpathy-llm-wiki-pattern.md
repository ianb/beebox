---
title: "Check out Karpathy's \"LLM Wiki\" pattern — an agent-maintained knowledge base that compounds"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder shared the gist
---

[LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
is an idea file, written to be pasted into a coding agent. An agent keeps a
markdown wiki up to date from a set of raw sources. The person chooses sources
and asks questions. The agent does all writing and bookkeeping. The claim is
that synthesis done once at ingest time accumulates, and retrieval at query
time (RAG) does not.

Most of the pattern is already how a box works. The useful part is the few
places where it goes further.

## Pattern → Bee Box today

| LLM Wiki | Bee Box |
|---|---|
| Schema file (CLAUDE.md / AGENTS.md) that the human and agent evolve together | Box CLAUDE.md, agent guide, schema instructions |
| Wiki is a git repo of markdown | Box is a git repo of cards |
| `index.md`: catalog with one-line summaries, read first at query time | `MAP.md` per directory, kept current by refresh-maps |
| `log.md`: append-only, greppable `## [date] op \| title` entries | Git history with commit trailers; no single readable log |
| Ingest: drop a source, agent integrates it | Connectors and inbox intake jobs |
| File good answers back as pages | Law of Saving (`beebox/src/core/agent-guide/laws.ts`) |
| Search: index first, then local hybrid search (qmd) | Box search |

## Ideas that may be new

1. **Ingest updates the synthesis, not only the filing.** One source touches
   10–15 pages: entity pages, topic summaries, the overview. Check what an
   intake job does today after it files a source. Does it update the
   person, place, or topic cards the source mentions?
2. **Separate the raw layer from the derived layer.** Sources stay immutable.
   Derived pages record which sources they came from. With that provenance, a
   new source can mark the pages built on the old one as possibly stale.
3. **Knowledge lint, not structural lint.** A periodic pass looks for:
   contradictions between cards, claims a newer source replaced, concepts
   mentioned often without their own card, missing cross-references, and
   orphan cards. `bbx validate` checks structure only. Related:
   [backlinks surface](../features/2026-05-11-backlinks-surface.md).
4. **The agent proposes what to read or ask next.** A lint pass ends with
   questions to investigate and sources to find. This overlaps with
   [/spark mode](../features/2026-05-19-spark-mode.md).
5. **Contradictions are recorded, not resolved silently.** When new data
   conflicts with an existing claim, the page says so and cites both sources.
6. **Supervised ingest, one source at a time.** The agent discusses the key
   takeaways with the person before it writes. The person steers what to
   emphasize. Batch ingest with less supervision is the other mode. Boxes
   today are mostly the batch mode.
7. **A readable activity log.** One chronological file of ingests, queries,
   and lint passes that an agent can `grep | tail`. Compare with reading
   `git log`. This may be solved already by the history view.

## Open questions

- Which of these are a box-agent guidance change, and which need engine
  support (provenance fields, a lint procedure, a schedule)?
- Is "entity page" a card type or a convention? `person` cards exist
  (`beebox/src/schemas/person.tsx`); topics and places do not.
- The pattern assumes an index is enough up to about 100 sources and hundreds
  of pages. Production boxes are larger. What replaces `index.md` at that
  scale?
