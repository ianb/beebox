# Nested frontmatter references

Objects that carry a `ref` alongside descriptive fields keep both the link and
the sibling fields visible.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FrontmatterFields } from "../../src/frontend/src/components/FrontmatterFields.js";

globalThis.React = React;

const html = renderToStaticMarkup(
  React.createElement(FrontmatterFields, {
    fields: {
      context: [{ ref: "../Course.course.card", text: "Acids and bases" }],
    },
    onNavigate: () => undefined,
    basePath: "questions/Question.question.card",
  }),
);
```

```ts
html.includes("<button") && html.includes("../Course.course.card") && html.includes("Acids and bases")
=> true
```
