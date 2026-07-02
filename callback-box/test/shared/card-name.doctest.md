# card-name: the canonical card filename grammar

One grammar, shared by backend and frontend, for splitting a card filename
into name + type. Two identity modes: **nominal** (`Name.<type>.card`) and
**positional** (bare `<type>.card` — "the ‹type› of this directory",
`name: null`). Job cards keep their dotted discovery convention.

```ts setup
import { parseCardFileName, cardTypeFromName } from "../../src/shared/card-name.js";
```

## Nominal names split into name + type

```ts
JSON.stringify(parseCardFileName("Meeting_Tomorrow.email-thread.card"))
=> {"name":"Meeting_Tomorrow","type":"email-thread"}

JSON.stringify(parseCardFileName("Bread.recipe.card"))
=> {"name":"Bread","type":"recipe"}
```

## Positional names are all type, no name

```ts
JSON.stringify(parseCardFileName("nav.card"))
=> {"name":null,"type":"nav"}

JSON.stringify(parseCardFileName("landmark.card"))
=> {"name":null,"type":"landmark"}
```

## Job cards resolve to their hyphenated schema type

There is no positional job form: a two-segment name ending in `.job.card`
is a nominal card of type `job`.

```ts
JSON.stringify(parseCardFileName("Foo.intake.job.card"))
=> {"name":"Foo","type":"intake-job"}

JSON.stringify(parseCardFileName("intake.job.card"))
=> {"name":"intake","type":"job"}
```

## Non-card names don't parse

```ts
parseCardFileName("notes.md")
=> null

parseCardFileName("plain")
=> null

parseCardFileName(".card")
=> null
```

## `cardTypeFromName` tolerates paths and `?query` suffixes

```ts
cardTypeFromName("store/recipes/Bread.recipe.card")
=> recipe

cardTypeFromName("store/projects/nav.card?create")
=> nav

JSON.stringify(cardTypeFromName("store/notes/readme.md"))
=> undefined
```
