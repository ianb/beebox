---
title: "Collect privacy-neutral usage statistics (control events like theme changes) to learn how Bee Box is used"
workstream: unattached
area: beebox
labels: [analytics, privacy]
needs: [design]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

The developer wants to build up knowledge of how Bee Box is actually used.
Today there is no record of which features people use, which settings they
change, or which surfaces they never open. The request is limited to
**privacy-neutral control information**: events about the interface, not
about content. The example given: a person changes their theme.

## What counts as privacy-neutral

In: which control was used and the chosen option from a closed set (theme
changed to `paper`; HQ dictation turned on; Properties opened; a view chosen
by type; a keyword used, by name), counts, coarse timing, app version,
client kind (web, iOS, extension).

Out: anything typed or spoken, card names, paths, titles, search queries,
chat text, URLs, box names, people, and free-text values of any kind. A rule
that is easy to check: an event value must come from a closed vocabulary
defined in code, never from the user or the box.

## Questions to decide

- **Who sees it.** Kept on the machine for the developer's own boxes only, or
  sent from other people's boxes to the developer? Sending off the box needs
  explicit opt-in, a visible list of what is collected, a security-report
  egress row, and a way to see and delete what was sent. For a self-hosted
  product this is the central decision.
- **Event vocabulary.** A typed, closed list of events in shared code, so the
  frontend cannot emit an unlisted event or a free-form value, and a lint or
  test that enforces it.
- **Storage and aggregation.** Raw events or counts per day; retention.
- **Reading it.** A dev dashboard view (workstreams-app) for the developer's
  boxes, at minimum.

Related: [in-box analytics for self-optimization](2026-08-26-in-box-analytics-for-self-optimization.md)
is a different purpose (the box's own agent reads its own click and agent
data, never shipped off the box). The two may share an event pipeline but
have different privacy rules.
