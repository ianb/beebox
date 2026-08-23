# The exhibit container

The shell every exhibit renders inside. It carries both halves of the ask: the
header that states the question, and — below whatever the page rendered — the
control that answers it. That placement is what makes an instrument answerable:
a page tier is a choice about presentation, never about whether the developer
can reply.

```ts setup
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The loader compiles .tsx through the package tsconfig, which scopes itself to
// the server tree and so leaves esbuild on the classic JSX runtime; the browser
// build uses Vite's automatic runtime, where the container needs no React
// import. Handing the global over is the smallest way to render one here.
Object.assign(globalThis, { React });

import { ExhibitContainer } from "../src/frontend/exhibits/Container.js";
import type { ExhibitBoot } from "../src/shared/exhibits.js";

function boot(overrides: Partial<ExhibitBoot>): ExhibitBoot {
  return {
    scope: "demo-ws/instrument",
    listUrl: "/demo-ws/",
    listLabel: "demo-ws",
    manifest: {
      title: "Threshold tuner",
      created: "2026-08-15T00:00:00Z",
      ask: { type: "react", prose: "Tell me how it feels." },
    },
    doc: null,
    module: "/@fs/store/demo-ws/instrument/index.tsx",
    ...overrides,
  };
}

function render(value: ExhibitBoot): string {
  return renderToStaticMarkup(
    createElement(ExhibitContainer, { boot: value }, createElement("p", null, "the page's own content")),
  );
}
```

An instrument — a page with its own `index.tsx` — gets the disposition control
appended below its content. Before this, an instrument that stated an ask gave
the developer no way to answer it.

```ts
const instrument = render(boot({}));
JSON.stringify({
  page: instrument.includes("the page&#x27;s own content"),
  form: instrument.includes("Your answer"),
  // Static rendering runs no effects, so the form is caught in its first state:
  // reading whatever answer is already on disk.
  reading: instrument.includes("Checking for a recorded answer"),
  pageComesFirst: instrument.indexOf("own content") < instrument.indexOf("Your answer"),
})
=> {"page":true,"form":true,"reading":true,"pageComesFirst":true}
```

A committed app may state no ask — a durable tool is not a question — and then
there is nothing to answer and no control.

```ts
const app = render(boot({
  scope: "apps/threshold-tuner",
  manifest: { title: "Threshold tuner", created: "2026-08-15T00:00:00Z" },
}));
JSON.stringify({
  page: app.includes("the page&#x27;s own content"),
  form: app.includes("Your answer"),
  note: app.includes("Committed app"),
})
=> {"page":true,"form":false,"note":true}
```
