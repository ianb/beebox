---
title: "guide cards inbox triage"
workstream: unknown
needs: [design]
area: beebox
priority: normal
---

Guide cards (`config/*.guide.card`) capture the boxholder's preferences as triage rules, named actions, default actions, and accumulated feedback. Today the compiled guide is read by job-processing agents (a `paths:` rule loads it when a matching job runs). But there's no live mechanism for the guide's *triage rules* to actually drive inbox routing — the agent decides per-item, and the guide only nudges in retrospect.

The shape we want is guide-as-policy, applied at intake, refined by feedback: the guide's triage rules score or route new items as they land, the boxholder sees what happened, and a "wrong bucket" signal feeds back into guide revisions.

Open questions:

- **Where does triage run?** During `bbx wakeup` per-item as new things land? As a separate `bbx intake` step? Inside the reactor on intake-jobs? The answer affects how aggressively rules get applied (a wakeup-time rule that auto-trashes feels different from a reactor decision that asks first).
- **One guide or per-stream?** A single `intake.guide.card` is simpler but blurs domains; per-stream guides (recipes vs bookmarks vs voice memos) match how feedback naturally clusters but multiplies setup.
- **Feedback surface.** Where does the boxholder say "this routing was wrong"? Probably a lightweight "wrong bucket" gesture on archived items + periodic guide-revision passes that read accumulated signals and rewrite the guide.
- **Relation to landmarks/triage-design.** `docs/plans/triage-design.md` already sketches a typed-routing pipeline using `<triage-destination>` on landmarks. Guides and landmarks both encode routing intent — figure out the division (landmarks = structural destinations, guides = policy for choosing among them?) before building either further.
