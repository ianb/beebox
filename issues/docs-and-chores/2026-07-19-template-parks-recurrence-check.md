---
title: "Check that template updates aren't parking again without due cause"
workstream: unknown
area: beebox
filed-by: agent
needs: [decision]
priority: important
---

On 2026-07-19 we cleared a backlog of parked template updates
(`config/_template-updates/`) that had accumulated across test1 and the prod
fleet — some for months. This item is the follow-up check: **in a few weeks,
look again and see whether parks have reappeared, and whether each one has a
legitimate cause.**

## Why parks are expected sometimes, and suspicious in bulk

A template parks when the box's local copy matches neither the new template nor
the last-installed hash — the installer can't prove the local copy is unmodified,
so it refuses to overwrite and drops the new version alongside for a human
(`src/core/install-template-file.ts`). That is correct behavior when a box (or an
agent) genuinely edited the file.

It is *not* correct as a steady state. The backlog we cleared had two causes,
only one of them legitimate:

1. **No tracker entry** — `content/config/template-versions.json` had no baseline
   for the file, so any change parked regardless of whether the local copy was
   touched. This is the suspicious one: it means boxes silently stop receiving
   updates. The parked `process-pages` on 5 of 6 prod boxes was still teaching
   agents the **retired XML card format** and the `answered-by` field that the
   `question-lifecycle` migration removed the same day.
2. **Real local divergence** — an agent had written learned content into the
   file. Legitimate; these need a human merge, not an accept.

## What to check

- Are there parked files under `config/_template-updates/` on test1 or any prod
  box? (`find <box>/content/config/_template-updates -type f`)
- For each: does `content/config/template-versions.json` have an entry for that
  path? **No entry is the smell** — it means the park was structural, not a real
  divergence.
- Is the 30-day stale sweep (`STALE_TEMPLATE_UPDATE_MS`) actually running? The
  backlog we found was older than 30 days, which suggests it either isn't firing
  or doesn't cover these paths.

## The decision this is really pointing at

If parks recur structurally (cause 1), the fix isn't to keep clearing them by
hand — it's to make the tracker seed a baseline whenever a template is installed
without one, so "no entry" stops being a permanent park. That's a code change to
`install-template-file.ts` and wants deciding rather than repeating this cleanup.

## Distinguishing content-bearing cards from stock ones

The 2026-07-19 pass found the accept/keep call is decided by **card kind**, and
this is the trap to avoid on any future sweep:

- **Stock instruction cards** (procedures, guides, schedules) — accept the
  template; local copies are just outdated.
- **Box-owned content cards** (`briefing`, `personality`) — never blind-accept.
  test1's `main.personality.card` template was the *blank-slate stock version*,
  still carrying `unresolved: What register does the boxholder actually use?`,
  while the local copy had answered it through observation. Accepting would have
  reverted the box's personality to factory settings.

Grep the local copy for `source: inferred` before accepting anything — that marks
agent-learned content the parked template does not carry (box-*owned fields* are
merged into the parked copy, but learned content is not).

Related: [questions-end-to-end followups](2026-07-19-questions-end-to-end-followups.md).

## 2026-09-26 check (doc-structure landing)

Parks had reappeared on every production box: on each of six boxes,
`_config/_template-updates/` held `calendar.guide.card`, `intake.guide.card`,
`main.personality.card`, the three stock procedures, and `briefing.briefing.card`
(the last two families on five boxes). All were re-parked by every sync, so
their mtimes say nothing about when they first parked. The guide rewrites that
landed the same day parked too, for two causes: the boxes carried older stock
versions the ledger (`beebox/src/core/template-stock-hashes.ts`) never recorded
(fixed by adding the field hashes), and the maps finalizer had prepended or
planted MAP-include shims over four guides
(`issues/closed/bugs/2026-09-26-maps-finalizer-shims-over-tracked-guides.md`).
The guide parks were accepted by hand; the content-bearing parks above were
left alone, per the distinction in the previous section.

