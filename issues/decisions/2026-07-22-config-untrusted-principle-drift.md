---
title: "\"Config is untrusted content too\" — boxholder no longer believes it"
workstream: public-site
needs: [decision]
area: beebox
filed-by: agent
discovered-in: worktree-github-pages-site — story-extraction triage of engineering-principles.md
priority: normal
---

During the story-nugget triage pass (2026-07-22), the boxholder dropped the
engineering-principles claim that hand-editable config is an untrusted input
boundary, with the note: **"I don't think I believe this anymore."**

The stance is currently documented in
`beebox/docs/engineering-principles.md` (principle 3's config clause:
"Config is untrusted content too: a hand-editable file is an input boundary
like any other"). If the belief has changed, the doc — and possibly
validation code that implements the stance at config-load boundaries —
should follow, or at least the principle should be rescoped (e.g. schema
validation for helpful errors, not as a trust boundary).

The call is his: what replaces the clause, and whether any existing
config-parse strictness gets relaxed or simply reframed. Until decided, the
doc is drifted against the boxholder's actual belief — the exact "stale
principle" failure mode the principles doc warns about in other contexts.
