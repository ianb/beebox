# Quick chat disposition: post or ask

`routingDisposition` decides whether a judged quick chat message posts to its
selected destination or waits for the person to choose. It sums the judged
probability of every candidate in the selected destination's place (its
landmark, or the root when it has none) and posts when that sum reaches the
floor, 0.9 by default.

```ts setup
import { routingDisposition, selectRoutingDestination } from "../../../../src/core/chat/routing/policy.js";

const garden = { path: "_content/Garden/Garden.landmark.card", label: "Garden" };
const household = { path: "_content/Household/Household.landmark.card", label: "Household" };
const trips = { path: "_content/Trips/Trips.landmark.card", label: "Trips" };
const candidates = [
  { id: "raised-beds", label: "Garden raised beds", target: { kind: "existing-session", sessionId: "s-garden", contextDir: "_content/Garden" }, landmark: garden },
  { id: "household", label: "Household", target: { kind: "existing-session", sessionId: "s-household", contextDir: "_content/Household" }, landmark: household },
  { id: "trip", label: "Trip planning", target: { kind: "existing-session", sessionId: "s-trip", contextDir: "_content/Trips" }, landmark: trips },
  { id: "new-finances", label: "New chat in Finances", target: { kind: "new-session", contextDir: "_content/Finances" }, landmark: { path: "_content/Finances/Finances.landmark.card", label: "Finances" } },
  { id: "new-recipes", label: "New chat in Recipes", target: { kind: "new-session", contextDir: "_content/Recipes" }, landmark: { path: "_content/Recipes/Recipes.landmark.card", label: "Recipes" } },
  { id: "new-garden", label: "New chat in Garden", target: { kind: "new-session", contextDir: "_content/Garden" }, landmark: garden },
  { id: "general", label: "New general chat", target: { kind: "new-session", contextDir: "" } },
];

/** Judge one thought: unnamed candidates get zero, as Jev's complete answer would. */
function decide(scores, options) {
  const pool = options?.candidates ?? candidates;
  const probabilities = Object.fromEntries(pool.map((candidate) => [candidate.id, scores[candidate.id] ?? 0]));
  const { selected, ranked } = selectRoutingDestination({ candidates: pool, probabilities });
  const postFloor = options?.postFloor;
  return `${selected.label}: ${routingDisposition({ selected, ranked, ...(postFloor === undefined ? {} : { postFloor }) })}`;
}
```

The ten synthetic thoughts measured against the real service post seven and
ask three. The last row is not doubt: both top choices are in Garden, and the
existing-chat preference selects the raised-beds chat.

```ts
[
  decide({ "raised-beds": 1 }),                               // Check whether the raised bed lumber order shipped
  decide({ household: 1 }),                                    // The dishwasher repair guy is coming Tuesday at 10
  decide({ trip: 0.99, general: 0.01 }),                       // Look into whether we need travel insurance
  decide({ "new-finances": 0.98, general: 0.02 }),             // How much did we spend on groceries last month
  decide({ "new-recipes": 0.98, general: 0.02 }),              // Save this: sourdough starter feeding ratio is 1:5:5
  decide({ general: 0.96, household: 0.04 }),                  // Call mom
  decide({ trip: 0.85, general: 0.14, household: 0.01 }),      // Remind me to renew my passport
  decide({ trip: 0.83, general: 0.17 }),                       // Ask Dana about the 14th
  decide({ general: 0.58, "raised-beds": 0.40, trip: 0.02 }),  // ok
  decide({ "new-garden": 0.53, "raised-beds": 0.47 }),         // What should I plant next to the tomatoes
]
=> [
  "Garden raised beds: post",
  "Household: post",
  "Trip planning: post",
  "New chat in Finances: post",
  "New chat in Recipes: post",
  "New general chat: post",
  "Trip planning: ask",
  "Trip planning: ask",
  "New general chat: ask",
  "Garden raised beds: post",
]
```

An exact tie between two places asks. The selection still names one of them,
by the existing-chat preference and then by id, so the result is stable.

```ts
decide({ household: 0.5, trip: 0.5 })
=> Household: ask
```

A box with one candidate always posts: its place holds all the probability.

```ts
decide({ general: 1 }, { candidates: candidates.filter((candidate) => candidate.id === "general") })
=> New general chat: post
```

A selected chat with no landmark is in the root place, together with the new
general chat. Their sum reaches the floor even though neither alone does.

```ts
const unplaced = [
  { id: "loose", label: "Loose ends", target: { kind: "existing-session", sessionId: "s-loose", contextDir: "" } },
  ...candidates,
];
decide({ loose: 0.5, general: 0.45, trip: 0.05 }, { candidates: unplaced })
=> Loose ends: post
```

A floor of 1 posts only a place that holds every probability. Floating-point
summation of 0.53 and 0.47 still counts as the whole.

```ts
[
  decide({ "new-garden": 0.53, "raised-beds": 0.47 }, { postFloor: 1 }),
  decide({ trip: 0.99, general: 0.01 }, { postFloor: 1 }),
]
=> ["Garden raised beds: post", "Trip planning: ask"]
```

A floor outside zero to one is a programming error.

```ts
decide({ general: 1 }, { postFloor: 1.5 })
=> throws InvariantError: Routing post floor must be between zero and one
```
