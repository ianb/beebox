---
title: "Decide once: axe 'region' violation on the composer's floating role=menu"
workstream: unattached
needs: [decision]
area: beebox
labels: [a11y, tours]
filed-by: agent
discovered-by: agent
discovered-in: tour-health — new-chat tour, add-menu checkpoint, both viewports
priority: normal
---

The `new-chat` tour's `add-menu` checkpoint reports one axe violation at
both viewports: `region` on the Add menu's
`<div role="menu" ... style="position: fixed ...">` — content outside any
landmark. A fixed-position popover menu portaled to `body` is the usual
trigger for this rule, and it is a judgment whether that counts (wrap the
portal root in a landmark, or add `region` to `SUPPRESS_RULES` in
`test/tours/tour-lib/axe.ts` with the reason). Decide once rather than
letting the weekly tour check re-report it; it is the only standing axe
finding besides
[the /questions heading-order](../closed/bugs/2026-08-26-questions-page-heading-order.md)
one.

Re-encountered during the Bloom theme tour on 2026-10-16 at both widths: the
composer Add menu still reports the same `region` violation. Styling does not
change its portal or landmark structure.

Re-encountered in weekly tour check run 20261021-221418, at both viewports:
`new-chat` `add-menu`, and the `bloom-composer-menu`, `deck-composer-menu` and
`ribbon-composer-menu` checkpoints (`.shadow-lg` target). The priority may be
stale; the rule is now the most-repeated axe finding across the tours.
