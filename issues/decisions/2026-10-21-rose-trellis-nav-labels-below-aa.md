---
title: "Rose Trellis nav labels are below AA (3.1-3.75:1) at the bar's warm end"
workstream: unattached
needs: [decision]
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-theme-audit — bin/theme-check --all
labels: [theme-contrast, do-not-apply-without-asking]
---

White nav labels on the Rose Trellis bar measure 3.1-3.75:1 where the bar is
warm. `bin/theme-check --all` therefore exits 1.

The boxholder chose to keep the current look over a darker bar. Do not apply
the fix below without asking the boxholder.

Rejected fix, in `beebox/src/frontend/src/themes/chrome.css`: change the bar
gradient stops `#933b58d9` to `#85334fe6` and `#ac574cbd` to `#823a37e8`.
This passes AA and shifts the bar noticeably darker. The commit that tried it
was reverted (`Revert "Proposed: Rose Trellis nav bar darker at its warm end"`).

Open: accept the miss permanently (and exempt it with a reason in the check),
or revisit the look later.

## Audit 2026-10-22

Pointer drift. The bar gradient is no longer in `chrome.css`. The stop `#933b58d9` is at `beebox/src/frontend/src/themes/textiles.css:150`. The revert is commit d9dcceee6. The decision is still open.
