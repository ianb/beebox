---
title: "Newly written views don't appear until a full page reload"
workstream: view-live-update-state
area: beebox
labels: [views, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — after writing views for a new card type, a reload was needed to see them
---

After authoring new views for a new card type (agent-written, in-box), the
views didn't show as available on the card until the web page was fully
reloaded. The available-views list is fetched once and never revalidated for
the session — the classic stale react-query cache for something the box
mutates underneath.

Fix directions, cheapest that works wins:

- **Invalidate on signal**: the box already has a change bus the frontend
  listens to (file-watcher → events WebSocket) — a view file appearing under
  `views/` (or wherever the registry reads) should invalidate the views
  queries, same as card edits refresh card views.
- **Or cheap staleness**: `staleTime` low / `refetchOnWindowFocus` for the
  views list — coarse but fixes the common flow (agent writes views in chat,
  user flips to the card in the same tab).
- Check both call sites: the card's view-tab strip and the `?view=` resolver
  (and `bbx view check`'s registry, if the server caches the view list
  in-process — a server-side cache would need the watcher poke too, not just
  query invalidation).

Note the flow this bites is the flagship one: agent builds a view during a
chat, boxholder looks at the card they were just talking about.
