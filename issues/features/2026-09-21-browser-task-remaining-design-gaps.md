---
title: "browser-task design feedback (remaining points): unusable prompt arg, scan bound not in data, entity-resolution left entirely to the drain, no place to say what confidence means, no convention for where task cards live"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

A production box's agent authored and reviewed the first real `browser-task`
(a 33-record scan of a public social page) and filed nine points of design feedback.
Four of the nine are already filed and implemented as of this triage:
`issues/closed/features/2026-09-13-browser-task-cadence-and-staleness.md`
(staleness/`rescan-after`), `2026-09-13-browser-task-history-and-subject.md`
(`runs:` history and `subject:` ref), and
`2026-09-13-browser-task-inbox-table-view.md` (reviewable table instead of a
JSON blob). This issue covers the five remaining points.

## 1. The `prompt` template argument is unusable for a real task

`createBrowserTaskTemplate` takes a `prompt` string, and `bbx create` exposes
it as `prompt=`. A real prompt runs to forty lines with section headings, so
the agent passed `prompt="placeholder"` and then overwrote the whole card
body with a heredoc — hand-authoring the frontmatter the template exists to
get right. Proposed direction: drop `prompt` as a create-time argument and
have generation emit a scaffold body carrying the four headings the doc
prescribes (what to look for / what does not count / how far to go / what
each record must contain), so the recommended structure is self-enforcing
rather than advisory prose the author has to remember to include.

## 2. The scan bound lives in prose only

The box doc says to always bound a scan, so the agent wrote "40 posts, or
back to 1 January 2025, whichever comes first" into the prompt body. Nothing
else reads that bound: coverage came back `scanned:37 reason:reached-limit`
with no way to check it against the number the author actually wrote,
because the bound isn't data anywhere. A `limit` field (posts, since) in
frontmatter would let the drain verify the executor honored it and answer
"was this scan complete or truncated" mechanically instead of by re-reading
prose.

## 3. Entity resolution is entirely the drain's problem, though the executor already has the context

Of 33 records, several were duplicates of the same real-world event (the same
fair across two editions, one festival appearing three times). Per-post
fidelity from the executor was correct and shouldn't change, but the executor
had just read all 37 posts in sequence — it is the cheapest place to note
"these four are the same thing." An optional group-label or same-as index on
records would hand the drain a head start instead of re-deriving what the
executor already implicitly knew.

## 4. Only one of two confidence questions is the executor's to answer

The agent added its own `sure`/`unsure` field, which usefully flagged records
with inferred dates. But the judgment call it actually had to make — is this
event out of the box's declared scope — is not something the executor can
know; only an agent that knows the box can make that call. The doc should
state plainly that a batch always needs a scope pass by a box-aware agent
after the executor runs, and that executor-reported confidence is about
factual accuracy, never relevance/scope.

## 5. No named convention for where browser-task cards live

The drain globs all of content, so nothing constrains where task cards go;
this box invented a `browser-tasks/` directory. Two boxes will invent two
different conventions. Worth naming one location in the doc so cards are
discoverable without a repo-specific convention.

## Why these are not obvious fixes

- Point 1 changes what `bbx create -t browser-task` accepts and what
  generation emits — a template-shape change, not a copy fix.
- Point 2 is a schema addition whose semantics (does the drain *enforce* the
  limit, or only report against it after the fact?) needs deciding.
- Point 3 asks the executor for a judgment (same-as grouping) beyond
  per-record extraction, which changes what the executor prompt asks it to
  do and risks encouraging over-eager merging if not scoped carefully.
- Point 4 is a documentation/process change (a mandated scope-review step)
  more than a schema change, but it interacts with whatever "confidence"
  field batches carry, so it should land alongside any schema work in this
  area rather than separately.
- Point 5 is a convention, not a mechanism; enforcing it (vs. just
  documenting it) is an open question the doc doesn't currently answer.
