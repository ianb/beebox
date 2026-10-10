# The exhibit container

The shell every exhibit renders inside: breadcrumb, title, the manifest's prose
rendered as Markdown, and whatever the page rendered. A page tier is a choice
about presentation, never about whether the prose and title appear.

```ts setup
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The loader compiles .tsx through the package tsconfig, which scopes itself to
// the server tree and so leaves esbuild on the classic JSX runtime; the browser
// build uses Vite's automatic runtime, where the container needs no React
// import. Handing the global over is the smallest way to render one here.
Object.assign(globalThis, { React });

import { ExhibitContainer } from "../../../src/frontend/exhibits/boot/Container.js";
import type { ExhibitBoot } from "../../../src/shared/exhibits.js";

function boot(overrides: Partial<ExhibitBoot>): ExhibitBoot {
  return {
    scope: "demo-ws/instrument",
    listUrl: "/demo-ws/",
    listLabel: "demo-ws",
    manifest: {
      title: "Threshold tuner",
      created: "2026-08-15T00:00:00Z",
      prose: "The tuner shows **three** thresholds:\n\n- low\n- high",
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

Prose renders as Markdown under the title: a list comes out as a list and
emphasis as emphasis, not one run-on paragraph. The page's own content follows.
There is no answer form.

```ts
const instrument = render(boot({}));
JSON.stringify({
  page: instrument.includes("the page&#x27;s own content"),
  list: instrument.includes("<li>low</li>"),
  emphasis: instrument.includes("<strong>three</strong>"),
  form: instrument.includes("Your answer"),
  titleFirst: instrument.indexOf("Threshold tuner") < instrument.indexOf("three"),
  proseBeforePage: instrument.indexOf("three") < instrument.indexOf("own content"),
})
=> {"page":true,"list":true,"emphasis":true,"form":false,"titleFirst":true,"proseBeforePage":true}
```

A manifest without prose shows the title and the page only.

```ts
const bare = render(boot({
  scope: "apps/threshold-tuner",
  manifest: { title: "Threshold tuner", created: "2026-08-15T00:00:00Z" },
}));
JSON.stringify({
  page: bare.includes("the page&#x27;s own content"),
  title: bare.includes("Threshold tuner"),
  prose: bare.includes("three"),
})
=> {"page":true,"title":true,"prose":false}
```

A store exhibit carries the "Reply in the session" button; a committed app does
not, because it belongs to no workstream and has no session to bring forward.

```ts
const store = render(boot({}));
const committed = render(boot({
  scope: "apps/threshold-tuner",
  manifest: { title: "Threshold tuner", created: "2026-08-15T00:00:00Z" },
}));
JSON.stringify({
  storeButton: store.includes("Reply in the session"),
  appButton: committed.includes("Reply in the session"),
  // The refusal (and its link to the dashboard) renders only after a click.
  idleRefusal: store.includes("Open the workstream list"),
})
=> {"storeButton":true,"appButton":false,"idleRefusal":false}
```
