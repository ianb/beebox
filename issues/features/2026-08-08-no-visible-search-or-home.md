---
title: "No visible search box and no home surface — a knowledge base you can't search or survey"
workstream: integration-tests
area: beebox
filed-by: agent
discovered-in: worktree-integration-tests — field-test operator prototype (Priya, activities 1+2)
labels: [soft-launch, field-test-findings, ui-sensibility]
priority: normal
---

> **Boxholder, 2026-09-15: build it.** "We do really need search." Scoped to
> the search half; the home-surface half stays open below.

## The search engine already exists — only the surface is missing

`src/core/search/` is a complete engine: semantic embeddings, an index
manifest, `query.ts`, excerpt extraction, and incremental refresh. Its only
consumers today are `core/commands/search.ts` (the `bbx search` CLI, which the
agent uses) and a wakeup step that keeps the index warm. A real box on this
machine carries a 2.5 MB `search-index-manifest.json`.

So the assistant's "tagged chicken/family/one-pan so search finds it" was
truthful about a capability the boxholder has no way to invoke. This is a
missing surface over a built engine, not a missing feature. What it needs is a
read path the view can call — the engine is reached through the CLI today, not
through tRPC.

## Search is a card, like browse (boxholder, 2026-09-15)

This is the part that is new since filing, and it decides the shape.

Every canonical interface surface is a **card** at `_config/interface/<type>.card`
(`src/shared/system-card-paths.ts`): `dashboard`, `settings`, `browse`,
`questions`, `landmarks`, `history`, `inventory`, `admin`. Search joins them as
a ninth, at `_config/interface/search.card`, and **`browse` is the model to
copy** — same shape of problem, a live query over box content rendered in a
card view.

That means the work is:

- a `search` card schema (`src/schemas/`), modeled on `browse.ts`;
- `SYSTEM_CARD_PATHS.search` plus a migration cohort in
  `SYSTEM_CARD_COHORTS` so existing boxes get the card installed, and template
  stock so fresh `bbx init` boxes ship with it;
- a read path from the view to `core/search/query.ts`.

**Do not add a `/search` route.** The legacy paths — `/dashboard`, `/settings`,
`/admin`, `/inventory`, `/landmarks` — are now redirect-only shims whose
`beforeLoad` throws a `redirect` to the card path; they exist for old links,
not as surfaces. A new interface surface has no old links, so it starts at its
card path and never acquires a shim.

## Still open: the home surface

The return-visit complaint had two halves and only one is decided. There are
already three candidate "where am I" surfaces — `dashboard`, `inventory`,
`landmarks` — plus browse, and the field-test operator found none of them,
meeting "← Back to Dashboard" as the first evidence a dashboard existed. The
question is not what to build but **which existing card is home, and what the
other two become**. Adding a fourth would make it four.

> When I've put things into the box and come back days later, I want an
> obvious way to search for them or see what's there, so I can get to my stuff
> without depending on an old chat thread.

Two visits, two deliberate hunts for a search box: there is none visible
anywhere on the chat surface, and the operator (a first-week user persona)
never found a home/overview surface either. The app opens into the most recent
chat conversation; the only route to a saved recipe was a link buried in an
old chat message, which the operator correctly called "luck, not design."
Meanwhile the assistant itself advertises search: "tagged chicken/family/one-pan
**so search finds it**" — search *where*?

Aggravators seen in the same run: the full card view offers "← Back to
Dashboard" — the first mention of a dashboard the user has ever seen (an
orphaned entry point); the browse sidebar exists but is only reachable via an
unlabeled pop-out icon inside a card panel.

This may partly be a discoverability failure rather than a missing feature
(if search exists behind a shortcut or on some page, a first-week user cannot
find it — same outcome). Overlaps
[first-run-experience](2026-07-20-first-run-experience.md) (the empty box
explains nothing) but is distinct: this is about the *return* visit — finding
your things once you have things.
