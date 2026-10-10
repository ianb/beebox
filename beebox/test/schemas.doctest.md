# Card Schemas

The schema system registers card types, provides template generators, and validates cards. Each card type has a type name, template generator, and optional instructions for agents.

```ts setup
import { createMemoTemplate } from "../src/schemas/memo.js";
import { createSelectQuestionTemplate } from "../src/schemas/question.js";
import { getCardTypes } from "../src/schemas.js";
import { getDefaultTemplate, getTemplate } from "../src/templates-registry.js";
import { createIntakeJobTemplate } from "../src/schemas/intake-job.js";
import { createWebpageTemplate } from "../src/schemas/webpage.js";
import { FigureSchema, createFigureTemplate } from "../src/schemas/figure.js";
import { figureStarterSketch } from "../src/templates/builtins/starters.js";
import { extractRefs } from "../src/exports/cards.js";
import { parseCardText } from "../src/core/card-io.js";
import { createCardSchemaMap } from "../src/schemas.js";
```

## Schema Registry

The registry tracks all known card types:

```ts
["memo", "question", "intake-job", "webpage"].filter((type) => !getCardTypes().includes(type))
=> []
```

## Templates

Template generators produce frontmatter card content for the core card types.

Looking a template up (`getTemplate`/`getDefaultTemplate`, imported above with
no side-effect `import "../src/templates.js"` alongside them) is sufficient to
have every built-in registered — the store module loads the built-in groups
itself:

```ts
getTemplate("memo")?.name
=> memo

getDefaultTemplate("recipe")?.name
=> recipe
```

## Memo

A memo captures a piece of content, optionally with a source. The
content lives in the markdown body; created/source/etc. are in the
YAML frontmatter.

```ts
createMemoTemplate("Test content", "test-source")
=>
---
status: new
created: «*»
source: test-source
---
Test content
```

Source is optional:

```ts
createMemoTemplate("Just content")
=>
---
status: new
created: «*»
---
Just content
```

## Question

A select question presents options to the user:

```ts
createSelectQuestionTemplate({
  memo: "Context here",
  prompt: "What do you want?",
  options: [
    { id: "a", label: "Choice A" },
    { id: "b", label: "Choice B" },
  ],
  askedAt: "2026-07-10T09:00:00-07:00",
})
=>
---
memo: Context here
prompt: What do you want?
input:
  type: select
  options:
    - id: a
      label: Choice A
    - id: b
      label: Choice B
asked-at: 2026-07-10T09:00:00-07:00
---

```


## Intake Job

An intake job groups items for triage. It has a `priority`, a list of item references, and — when a connector-scoped wakeup made it — the `connector` (every job card on disk is pending; finishing a job deletes it):

```ts
createIntakeJobTemplate({
  description: "Triage 2 new capture sessions",
  items: [
    "_content/inbox/capture-1/session.capture-session.card",
    "_content/inbox/capture-2/session.capture-session.card",
  ],
})
=>
---
priority: normal
description: Triage 2 new capture sessions
items:
  - ref: _content/inbox/capture-1/session.capture-session.card
  - ref: _content/inbox/capture-2/session.capture-session.card
---
```

Supports `priority: "low"` and a `connector`:

```ts
createIntakeJobTemplate({
  connector: "raindrop",
  description: "Triage bookmarks",
  items: ["_content/inbox/bookmark.bookmark.card"],
  priority: "low",
})
=>
---
connector: raindrop
priority: low
description: Triage bookmarks
items:
  - ref: _content/inbox/bookmark.bookmark.card
---
```

## Webpage

A webpage card is a captured external page: provenance in frontmatter, the
readable rendering inline as the body.

```ts
createWebpageTemplate({
  title: "Example Page",
  url: "https://example.com/article",
  capturedAt: "2026-06-15T12:00:00Z",
  content: "The readable page body.",
})
=>
---
title: Example Page
sources:
  - href: https://example.com/article
    retrieved: 2026-06-15T12:00:00Z
---
The readable page body.
```

Optional capture metadata and the frozen-snapshot ref are included only when
set:

```ts
createWebpageTemplate({
  title: "Example Page",
  url: "https://example.com/article",
  capturedAt: "2026-06-15T12:00:00Z",
  content: "Body.",
  siteName: "Example",
  frozenRef: "attach/page.frozen",
})
=>
---
title: Example Page
sources:
  - href: https://example.com/article
    retrieved: 2026-06-15T12:00:00Z
siteName: Example
frozen:
  ref: attach/page.frozen
---
Body.
```

## Figure

A figure card is an embeddable interactive graphic. Its body describes the
figure; the runnable source lives in the attach scope, pointed to by `entry`.

The frontmatter validates a runtime plus the required `entry` source pointer,
and optional `params` (declared embed parameters) and `data` (free-form author
config) when present:

```ts
FigureSchema.frontmatterSchema.safeParse({
  type: "figure",
  runtime: "d3",
  entry: "attach/chart.ts",
  params: [{ name: "molecule", type: "string", default: "H2O2" }],
  data: { palette: ["#fff", "#000"] },
}).success
=> true
```

`entry` is required — a figure with no source pointer fails validation:

```ts
FigureSchema.frontmatterSchema.safeParse({
  type: "figure",
  runtime: "p5js",
}).success
=> false
```

The figure template scaffolds a valid card pointing at `attach/sketch.ts`; no
`size` param is scaffolded — the starter sizes itself from the container:

```ts
createFigureTemplate({ runtime: "p5js", title: "Spinner" })
=>
---
runtime: p5js
entry: attach/sketch.ts
title: Spinner
---
A p5.js sketch figure. Describe what it demonstrates here; the runnable code lives in `attach/sketch.ts`.
```

The canvas-loop template declares embed params that match its starter's
value-bearing module params — `speed`/`show-ring`/`tone`, NOT `size` (which no
canvas-loop module param would match, warning on every mount). Its `reset`
trigger is not embed-controllable, so it is omitted; the select `tone` maps to a
card `string`:

```ts
createFigureTemplate({ runtime: "canvas-loop" })
=>
---
runtime: canvas-loop
entry: attach/sketch.ts
params:
  - name: speed
    type: number
    default: 1
  - name: show-ring
    type: boolean
    default: true
  - name: tone
    type: string
    default: sky
---
A canvas-loop TEA sketch figure. Describe what it demonstrates here; the runnable code lives in `attach/sketch.ts`.
```

The generated card validates against the schema:

```ts
const text = createFigureTemplate({ runtime: "three" });
const schemas = await createCardSchemaMap();
const parsed = parseCardText(text, { source: "X.figure.card", schemas });
parsed.fields.runtime
=> three
```
