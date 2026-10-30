---
title: "theme-check cannot measure phone card headings whose text is partly covered"
workstream: theme-audit
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-audit — bin/theme-check --all
resolution: implemented
---

Resolved in the commit that moved this file. The covers were real layout overlaps, not a sampler limit: Letter set's heading padding overrode the card back's taller top, so "Back to card" sat over the title; Phosphor's wide "[ Properties ]" button sat over a long front title.

On the phone screen, `bin/theme-check` skips some card headings because
another element covers part of the text, so the pixel sampler cannot find a
clean background. These headings stay unmeasured:

- "Welcome table" in Candy and in Flat + Letter set lemon/sky.
- "A little room to grow" in Phosphor.

All three predate the theme-audit work. The check reports them as misses it
cannot measure rather than as passes. Options: sample the uncovered part of
the line, hide the covering element during capture, or exempt the case with a
stated reason.
