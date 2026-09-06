---
title: "card level prominence"
workstream: card-visibility
needs: [design]
area: beebox
priority: important
---

Started as "a landmark-ish marker in the card itself" and resolved (2026-06-12 discussion) into a unification: **there is one editorial axis — "should the box surface this node?" — applied to nodes in the box tree.** A card expresses it with an inline marker; a directory expresses it with a landmark card. Today's landmarks (`docs/landmarks.md`) are just **the directory form of this one concept**, not a separate thing.

Why the directory form looks fatter (a whole separate `*.landmark.card` with label/symbol/pinned links) while the card form is a bare flag: it's forced by "a directory isn't a card." A directory has no frontmatter to mark and no intrinsic renderable identity, so it needs a proxy object supplying what a card supplies for itself — a name, an icon, a tile. The landmark's extra payload is exactly *prominence + the identity a bare directory can't carry*. A card already has a title, a type, and a renderer, so a flag suffices; the card renders its own tile.

The clincher for the unification: a landmark's hand-picked `navigation.links` are the **manual** version of what card-prominence **auto-derives**. An `expand` entry selecting prominent cards replaces "list the key items here by hand" with "surface the cards that declared themselves key." The two layers collapse — directory landmark says "this spot matters," card prominence says "these documents in it matter," and the latter can feed the former instead of being curated twice.

(Note that `expand` today takes a `query` that is a **glob** relative to the landmark's directory — `{ query: "*.recipe.card", order: modified-desc }`. Selecting on a prominence *field* rather than a filename pattern is a real extension to that resolver, not just a new query string.)

The motivating shape: a `.sandbox.card` (2026-06-12) IS the activity; it should be the headline of its directory, shown by default through its own view, with attachments/logs/notes receding — "not a hard filter, but an editorial default that flips browse from flat-everything to here-are-the-real-things."

Caveat — don't over-unify: landmarks are currently **overloaded**. The `navigation:` role is the directory-prominence thing that merges here. But landmarks also carry a `destinations:` role (`for: [triage]` + category rules + handler procedure) — that's intake *routing* policy, not prominence at all. The unification covers navigation only; the destinations role is a separate concern riding the same card type and should stay distinct (possibly: split it out so "landmark" cleanly means "directory prominence").

Design questions:
- **The card marker.** A boolean-ish frontmatter field (`prominent: true` / `featured: true`) or a small enum (`prominence: primary | normal | hidden` — `hidden` is the useful inverse: demote housekeeping cards). A frontmatter field keeps it cheap, and since it'd want to apply across card types it's a question of whether this belongs in the automatic fields every `cardSchema` gets rather than being declared per-schema. Distinct from `status` (lifecycle) — this is editorial weight.
- **Who sets it.** Human, or the agent as it produces the main artifact of a piece of work ("this is the thing; the rest is supporting"). The agent marking its own headline output is the high-value case, and self-contained-in-the-card means prominence travels with moves/renames and needs no curation artifact alongside.
- **View-conditional, not global.** Browse's default view leads with prominent nodes and collapses the rest behind "show all"; a raw/flat mode still shows everything. Each view opts in. Also feeds ["Today" view as a recurring procedure](2026-05-11-today-view.md) aggregation and search/excerpt ranking (a prominent card outranks a buried note).
- **Migration.** If landmarks become "the directory case," does the navigation-role schema get reframed/renamed, and do the two implementations share a "surface the prominent children" resolver (children being directories-with-landmarks + cards-with-prominence)? A single Browse resolver over both is the payoff.
- **Card-type→view binding.** A prominent `.sandbox.card` rendered through its custom view (the binding the interactive-views work needs) is the full picture: the right document, surfaced by default, shown as its app.
