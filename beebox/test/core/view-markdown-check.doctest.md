# Box views render card text only through `Markdown`

`checkViewMarkdown(source)` (`src/core/views/markdown-check.ts`) is the
edit-time check that makes hand-rolled Markdown in a box view an error
(`docs/plans/todos-ui.md`, Track 6). The validation hooks run it after the
compile check. It reports each problem with its line; the hook message ends
with the rule and where to ask for more.

```ts setup
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkViewMarkdown, lintViewMarkdown } from "../../src/core/views/markdown-check.js";

async function problems(source: string): Promise<string> {
  const found = await checkViewMarkdown(source);
  return found.length === 0 ? "ok" : found.map((p) => `${String(p.line)}: ${p.what}`).join("\n");
}

const IMPORT = `import { Markdown } from "beebox/view-widgets";\n`;
```

## The guide's form passes

A card's body as the children of `<Markdown>`, guarded by a truthiness test
(`ViewCard.body` is optional):

```ts
await problems(IMPORT + `export default function V({ cards }) {
  return cards.map((card) => card.body ? <Markdown key={card.path} card={card}>{card.body}</Markdown> : null);
}`)
=> ok
```

Other truthiness tests pass too, and so does a destructured `body` used the
same way, `??` inside the children, and `Markdown` under another local name:

```ts
await problems(IMPORT + `function A({ card }) { return card.body && <Markdown card={card}>{card.body ?? ""}</Markdown>; }
function B({ card }) { if (!card.body) return null; return card.body !== undefined ? "has text" : "none"; }
function C({ card }) { const { body, path } = card; return body ? <Markdown card={card}>{body}</Markdown> : <p>{path}</p>; }
function D() { return <div ref={(el) => el && document.body.append(el)} />; }`)
=> ok

await problems(`import { Markdown as Prose } from "beebox/view-widgets";
export default ({ card }) => <Prose card={card}>{card.body!}</Prose>;`)
=> ok
```

## Reading a body any other way fails

The old guide's `<p>{card.body}</p>`, the split-and-render pattern, a
fallback that renders the raw text, and a destructured body rendered raw:

```ts
await problems(IMPORT + `function A({ card }) { return <p>{card.body}</p>; }
function B({ card }) { return card.body.split("\\n\\n").map((para) => <p>{para}</p>); }
function C({ card }) { return <div>{card.body || "No text"}</div>; }
function D({ card: { body } }) { return <div>{body}</div>; }`)
=> 2: reads `card.body` outside `<Markdown>`
3: reads `card.body` outside `<Markdown>`
4: reads `card.body` outside `<Markdown>`
5: uses `body` (a card's destructured `body`) outside `<Markdown>`
```

A component named `Markdown` that does not come from `beebox/view-widgets`
does not count:

```ts
await problems(`function Markdown({ children }) { return <pre>{children}</pre>; }
export default ({ card }) => <Markdown>{card.body}</Markdown>;`)
=> 2: reads `card.body` outside `<Markdown>`
```

## The Markdoc delimiter in a literal fails

A string, a template, and a regex (backslashes are ignored, so an escaped
`\{%` still counts):

```ts
await problems(`const OPEN = "{% todo %}";
const tag = (name) => \`{% \${name} %}\`;
const strip = (text) => text.replace(/\\{%[^%]*%\\}/g, "");`)
=> 1: has the Markdoc delimiter `{%` in a literal
2: has the Markdoc delimiter `{%` in a literal
3: has the Markdoc delimiter `{%` in a literal
```

## Importing a Markdown library fails

Any subpath, a library family, `require`, and dynamic `import()`:

```ts
await problems(`import { marked } from "marked";
import ReactMarkdown from "react-markdown";
import remarkParse from "remark-parse";
import MarkdownIt from "markdown-it/lib/index.mjs";
const showdown = require("showdown");
const load = () => import("micromark");`)
=> 1: imports `marked`
2: imports `react-markdown`
3: imports `remark-parse`
4: imports `markdown-it/lib/index.mjs`
5: imports `showdown`
6: imports `micromark`
```

## The hook message

`lintViewMarkdown(path)` is what `bbx validate --hook` and the in-process
hook call. A clean view gives `null`; a failing one names each problem and
ends with the rule:

```ts
const dir = await mkdtemp(join(tmpdir(), "view-md-"));
await writeFile(join(dir, "clean.tsx"), IMPORT + `export default ({ card }) => card.body ? <Markdown card={card}>{card.body}</Markdown> : null;`);
await writeFile(join(dir, "raw.tsx"), `export default ({ card }) => <p>{card.body}</p>;`);
await lintViewMarkdown(join(dir, "clean.tsx"))
=> null

await lintViewMarkdown(join(dir, "raw.tsx"))
=> View renders Markdown by hand:
  line 1: reads `card.body` outside `<Markdown>`
Render card text with `Markdown` from `beebox/view-widgets`. If it lacks something this view needs, say so in `_config/feedback/`.
```

```ts cleanup
await rm(dir, { recursive: true, force: true });
```
