---
title: "A `?` in a card filename opens the wrong card through `/views/` and `?card=`"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-no-browse-links — cross-model review of card links
---

A card whose filename contains `?` (for example `_content/Soup?2.doc.card`) does not open from a card link. The link URL is correct: `cardUrl` (`beebox/src/shared/card-url.ts`) encodes the segment to `Soup%3F2.doc.card`.

The route decodes it back. The `/views/$` route (`beebox/src/frontend/src/main/router.tsx`, `viewRoute`) and `workspaceRouteTarget` (`beebox/src/frontend/src/lib/system-card-navigation.ts`) join the decoded splat with the search string and give the result to `parseViewUrl` (`beebox/src/frontend/src/lib/view-url.ts:67`). `parseViewUrl` splits at the first `?`. The card path becomes `_content/Soup`, and `2.doc.card` becomes a query parameter.

The `?card=` search value has the same problem: `serializeViewUrl` writes the path without encoding, then a `?` and the parameters.

Resolution is not obvious, because the view-URL string (`<path>?view=…&viewState=…`) is a format shared by markdown `view:` refs, the companion pane, and the workspace. A fix must encode `?` in the path part of that format, or keep the path and the parameters apart at the route boundary. Either way, the parse and serialize sides must change together.

`#` and `%` in filenames work: a banner for `card:_content/Soup #2.doc.card` opens that card.
