---
title: "theme-check cannot measure phone card headings whose text is partly covered"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-audit — bin/theme-check --all
---

On the phone screen, `bin/theme-check` skips some card headings because
another element covers part of the text, so the pixel sampler cannot find a
clean background. These headings stay unmeasured:

- "Welcome table" in Candy and in Flat + Letter set lemon/sky.
- "A little room to grow" in Phosphor.

All three predate the theme-audit work. The check reports them as misses it
cannot measure rather than as passes. Options: sample the uncovered part of
the line, hide the covering element during capture, or exempt the case with a
stated reason.
