---
title: "A retried Clerk capture writes a second webpage card and commentary"
workstream: unattached
area: clerk
filed-by: agent
discovered-by: agent
discovered-in: worktree-card-fields-review — cross-model review of the webpage `sources` change
---

The Clerk commentary capture has no stable capture id
(`beebox/src/webapp/trpc/clerk-contract.ts`). The router names the card from
the title and the server's current time and writes the webpage and
commentary cards unconditionally (`beebox/src/webapp/trpc/routers/clerk.ts`).
If the request commits but the response is lost, the extension's retry writes
a second webpage card and a second commentary card.

The iOS share path avoids this with a client-supplied `share-id` that it
stores on the card and looks up before writing
(`beebox/src/webapp/trpc/routers/share/router.ts`). Clerk would need the same:
a capture id in the wire contract and on the card. That changes the
extension-to-box contract, so it needs a decision on the id's shape.
