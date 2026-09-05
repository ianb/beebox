---
title: "/card/$ and /views/$ are two parallel single-card routes"
workstream: top-nav-ia
area: beebox
filed-by: agent
discovered-in: worktree-top-nav-ia — unified app bar (docs/implemented-plans/top-nav-ia.md)
next-action: reconfirm
priority: normal
---

The frontend has two routes that mean "show me this one card":
`/<box>/card/<path>` and `/<box>/views/<path>`. Both resolve a box path to
a single card and render it; neither is obviously the canonical one.

Who links where is split along no principle anyone chose:

- `LandmarkSection`'s link tiles (the merged Landmarks page) go to
  `/card/`.
- Most in-content links — markdown refs, the here menu's landmark links,
  companion-pane opens — go to `/views/`.

So the same target card is reachable at two URLs, with two histories, and
a user who bookmarks one form and a user who bookmarks the other are on
different code paths. Any behavior added to one (a header, a back
affordance, a view parameter) has to be remembered for the other or it
silently applies to half the links.

The tension is which one survives and what the other becomes. `?view=foo`
attaches to a card path, so whichever route wins has to carry that;
`/views/` reads like it predates that decision.

Deferred deliberately by the top-nav IA plan (it is in that plan's "NOT in
scope" list) — the plan added switch-menu and Landmarks-page links on top
of the existing split rather than resolving it, so the split is now a
little wider than it was.
