---
title: "directory head cards"
workstream: unknown
needs: [design]
area: beebox
priority: normal
---

> `fixed?` checked 2026-09-05: not built — no head-card mechanism, the `.attach` convention unchanged; the issue's own "big migration, not near-term" still applies. Tag removed.

Exploratory structural idea (2026-06-12), the deep version of [Prominence / surface-worthiness — one concept across tree nodes (cards AND directories)](../closed/features/2026-06-12-card-level-prominence.md). Today a card relates to a sibling container exactly one way — `Foo.attach/` is Foo's private bag of binaries — and a *directory* gets its identity a different way: a `landmark`/`briefing` card placed *inside* it. What if instead `Foo.type.card` paired with a plain `Foo/`? Then **a directory's "head card" — a same-named sibling of any type — gives the directory its type, identity, prominence, and primary content at once.** `Recipes.landmark.card + Recipes/`, `Chat.sandbox.card + Chat/`, `Foo.doc.card + Foo/` all become one pattern, recursive down the tree (every directory optionally typed by its sibling). This generalizes the prominence insight: a bare directory lacks the renderable identity a card has, so it needs a proxy — the head card *is* that proxy, and making it any-typed unifies attachments, landmarks, and briefings into "directories have head cards."

**The fault line (the "are directories and attachments different?" hesitation, made precise):** two relationships hide under one naming scheme —
- **Owns** — `Foo.attach/` is *private content, addressed via `attach/` refs*, owned by Foo; it has no independent existence.
- **Heads/describes** — a landmark over a directory of *peer* cards that exist in their own right.

A bare `Foo/` can't say which, and the `.attach` suffix is doing real disambiguating work today: it keys the asset-manifest discipline (`**/*.attach/**`), gitignore patterns, and `attach/`-prefix ref resolution, and it sidesteps basename-uniqueness (`Foo.doc.card` + `Foo.attach/` don't collide; `Foo.doc.card` + `Foo/` would need a blessed pairing exception). Drop the suffix and you lose the "private, owned, ref-addressed" signal.

**Synthesis:** attachments are the special case of *a head card that owns its directory as private content*; a general typed directory is a head card over located *peers*. Same machinery (card + sibling dir), different *ownership* semantic — and that semantic wants to stay explicit (keep the `.attach` marker, or move it to a frontmatter field on the head card: "private bag" vs "peer namespace"), not be collapsed away.

Open tensions:
- **Basename-uniqueness rule** must learn to treat `Foo.type.card` + `Foo/` as a deliberate pair, not a lint collision.
- **Ref resolution** — how do refs point into `Foo/` vs the current `attach/` prefix?
- **mv coupling flips.** A head card *beside* its directory must move as a pair (`bbx mv` already does this for `.attach/`); a landmark *inside* travels with the directory automatically. Beside is more visible in the parent listing (identity without descending) but more fragile to manual moves.
- **Asset-manifest** keys on `.attach/`; a rename of the convention is a migration touching that hook, gitignore, ref resolution, and `bbx mv`.

Big migration, not near-term — but it's the structural endpoint the prominence + interactive-views + attachment-writes threads all lean toward, so worth holding before any of them hardcode the `.attach`-only assumption.
