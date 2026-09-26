# Todo locator identity (`shared/todo-locators.ts`)

`assignLocators` numbers every `{% todo %}` tag in one document-order pass,
BEFORE any walk that consumes the numbering — `core/todo/extract-body.ts`'s
collector and (per the plan) the frontend's `Markdown` render path both call
it, so the two cannot disagree about which todo `line#2` means.

```ts setup
import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config.js";
import { assignLocators, type TodoLocator } from "../../src/shared/todo-locators.js";

const { parse } = Markdoc;

function where(locator: TodoLocator): string {
  if (locator.kind === "frontmatter") return `fm[${String(locator.index)}]`;
  return `${String(locator.line)}${locator.nth === undefined ? "" : `#${String(locator.nth)}`}`;
}

/** Every todo tag's text, in the document order `assignLocators` walks, alongside its locator. */
function locate(markdown: string, lineOffset = 0): string {
  const ast = parse(markdown);
  const locators = assignLocators(ast, lineOffset);
  const out: string[] = [];
  const flattenText = (node: Node): string =>
    node.children.map((c) => (c.type === "text" ? String(c.attributes["content"] ?? "") : flattenText(c))).join("");
  const walk = (node: Node): void => {
    for (const child of node.children) {
      const locator = locators.get(child);
      if (locator !== undefined) out.push(`${where(locator)} "${flattenText(child)}"`);
      walk(child);
    }
  };
  walk(ast);
  return out.join("\n");
}
```

## Document order, one todo per line

Each todo sits on its own line, so every locator omits `nth`.

```ts
locate([
  "{% todo %}First{% /todo %}",
  "",
  "{% todo %}Second{% /todo %}",
  "",
  "{% todo %}Third{% /todo %}",
].join("\n"))
=>
1 "First"
3 "Second"
5 "Third"
```

## `nth` is omitted for the first todo on a line, then counts 2, 3, …

A line's identity is `path:line` until a second todo forces `#2`; a third
keeps counting rather than resetting.

```ts
locate('{% todo %}One{% /todo %} {% todo %}Two{% /todo %} {% todo %}Three{% /todo %}')
=>
1 "One"
1#2 "Two"
1#3 "Three"
```

## `lineOffset` is added to every line, so it reports the FILE line

The frontmatter block's line count shifts every body-relative line by the
same amount — this is what lets a body todo's locator read as a file line
rather than a body-only one.

```ts
locate("{% todo %}Shifted{% /todo %}", 4)
=>
5 "Shifted"
```

## Nested todos inside a list item are numbered too, still in document order

A todo's own list item can nest a deeper list with its own todo; both are
just tags encountered walking the tree, numbered as they are met.

```ts
locate([
  "- {% todo %}Sell the piano{% /todo %}",
  "  - {% todo %}Get it appraised{% /todo %}",
  "    - {% todo %}Call Marisol{% /todo %}",
].join("\n"))
=>
1 "Sell the piano"
2 "Get it appraised"
3 "Call Marisol"
```
