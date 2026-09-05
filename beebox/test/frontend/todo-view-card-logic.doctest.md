# `TodoViewCard`'s status-filter default (`todo-view-card-logic.ts`)

`resolveTodoViewStatusFilter` decides what `status` filter a `todo-view` card
queries with. An explicit `status:` list wins; an omitted one must default to
`["open", "parked"]` — every plate-state group an `open` todo can land in
(escalated/on-plate/quiet) PLUS `parked`. A default of `["open"]` alone made
the `parked` group permanently unreachable on the stock plate: `parked` is a
STATUS, not a plate-state, so it was never included by that default —
`{% todo status="parked" %}` cards existed but the plate never showed them.

```ts setup
import { resolveTodoViewStatusFilter } from "../../src/frontend/src/components/todo-view-card-logic.js";
```

## Omitted `status`: defaults to `open` + `parked`, not `open` alone

```ts
JSON.stringify(resolveTodoViewStatusFilter({}))
=> ["open","parked"]
```

## An explicit `status:` list wins over the default

```ts
JSON.stringify(resolveTodoViewStatusFilter({ status: ["done"] }))
=> ["done"]
```

## Garbage / empty `status` values fall back to the same default

```ts
JSON.stringify(resolveTodoViewStatusFilter({ status: "not-an-array" }))
=> ["open","parked"]

JSON.stringify(resolveTodoViewStatusFilter({ status: ["not-a-status"] }))
=> ["open","parked"]

JSON.stringify(resolveTodoViewStatusFilter({ status: [] }))
=> ["open","parked"]
```
