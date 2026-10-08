# Arrival opens the place on the desktop layout

Going to a place whose chat has no saved arrangement in this tab opens the
place beside the chat: its single entry-point card, else its landmark card
(docs/plans/landmark-arrival.md, Track D). `arrivalOpens` makes the final
decision in the workspace provider, after the store's candidate flag is taken
and the place's `landmarks.forDir` query has settled.

```ts setup
import { arrivalOpens } from "../../../../../src/components/chat/workspace/WorkspaceProvider/arrival.js";

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
