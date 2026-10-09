# Arrival opens the place on the desktop layout

Going to a place whose chat has no saved arrangement in this tab opens the
place beside the chat: its single entry-point card, else its landmark card
(docs/implemented-plans/landmark-arrival.md, Track D). `arrivalOpens` makes the final
decision in the workspace provider, after the store's candidate flag is taken
and the place's `landmarks.forDir` query has settled.

```ts setup
import { arrivalOpens, arrivalWaits } from "../../../../../src/components/chat/workspace/WorkspaceProvider/arrival.js";
import { decideWorkspaceNavigation } from "../../../../../src/components/chat/workspace/history.js";

const LIST = "_content/lending/Lending_List.lending-list.card";
```

## A new place chat on the desktop layout opens the target

The candidate flag is set, nothing is open, and the payload names a target.

```ts
arrivalOpens({ arrive: true, viewport: "desktop", tabCount: 0, target: LIST })
=> true
```

## The phone layout never opens a card

On a phone only one card or the chat fits, and the chat wins (boxholder
decision c).

```ts
arrivalOpens({ arrive: true, viewport: "mobile", tabCount: 0, target: LIST })
=> false
```

## A chat with a saved arrangement is left as it was

A saved arrangement clears the candidate flag, so `arrive` is false.

```ts
arrivalOpens({ arrive: false, viewport: "desktop", tabCount: 0, target: LIST })
=> false
```

## Arrival never adds to cards that are already open

```ts
arrivalOpens({ arrive: true, viewport: "desktop", tabCount: 1, target: LIST })
=> false
```

## No landmark or a failed query opens nothing

The provider passes null when `forDir` returned no landmark or the query
failed.

```ts
arrivalOpens({ arrive: true, viewport: "desktop", tabCount: 0, target: null })
=> false
```

## Only a chat with nothing to open waits for the place query

The provider decides the navigation first and waits for `landmarks.forDir`
only when that decision is `keep-current`, the one step where arrival can
apply. A route that names a card is the person's intent: it opens at once,
even while an arrival is pending and the query is slow or never settles.

```ts
const decision = decideWorkspaceNavigation({ history: undefined, scope: "s", identity: "chat-1",
  freshCard: "_content/lending/Piranesi_Noor.loan.card" });
({ decision: decision.kind,
  waits: arrivalWaits({ decision: decision.kind, candidate: true, viewport: "desktop", settled: false }) })
=> { decision: "open-url", waits: false }
```

A history snapshot is a saved arrangement, so it does not wait either.

```ts
arrivalWaits({ decision: "restore-snapshot", candidate: true, viewport: "desktop", settled: false })
=> false
```

A chat with no card in its route waits while the query is in flight, and
proceeds once it settles.

```ts
({ inFlight: arrivalWaits({ decision: "keep-current", candidate: true, viewport: "desktop", settled: false }),
  settled: arrivalWaits({ decision: "keep-current", candidate: true, viewport: "desktop", settled: true }) })
=> { inFlight: true, settled: false }
```

The phone layout never arrives, and a cancelled arrival has no candidate, so
neither waits.

```ts
({ phone: arrivalWaits({ decision: "keep-current", candidate: true, viewport: "mobile", settled: false }),
  cancelled: arrivalWaits({ decision: "keep-current", candidate: false, viewport: "desktop", settled: false }) })
=> { phone: false, cancelled: false }
```
