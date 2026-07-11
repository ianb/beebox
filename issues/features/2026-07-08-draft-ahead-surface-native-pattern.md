---
title: "draft ahead surface native pattern"
area: callback-box
---

From the Rowboat review (`research/rowboat-review.md`, Tier 2). Rowboat's email surface
*pre-creates drafts inline* — the reply is sitting there, ready, in the email view, not
delivered as a chat message. We have all the pieces to do the same (reactor, drafts, the
gmail connector), but we treat proactive output mostly as chat/job output, not as
"the surface shows you a ready thing."

The idea is small and mostly about naming + consistency: make **"the reactor pre-produces
a draft and the card's view shows it ready to accept/edit/send"** an explicit, reusable
UX pattern rather than an ad-hoc per-connector behavior. Candidates beyond email: a
proposed todo from an intake item, a suggested calendar reply, a drafted answer to a
question card — anywhere the reactor could stage a ready artifact on the card's own
surface instead of asking in chat.

Ties to `project_views_attach_to_cards` and the views-over-chat direction — this is that
thesis made concrete for *proactive* output (Rowboat validated it independently). Trace:
`src/core/reactor/`, the gmail connector, the views layer.

Low urgency; it's a consistency/vocabulary pass, not a missing capability.
