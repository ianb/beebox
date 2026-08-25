# Code highlighting in the browser

A `.ts` file in the file browser is read, not just displayed. The browser
highlights it with highlight.js — the same highlighter and the same palette as
`bin/router-docs.ts`, the doc reader it consolidates.

```ts setup
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// The doctests run through the backend tsconfig, which has no `jsx` setting, so
// tsx emits classic `React.createElement` calls that need React in scope — the
// same setup `front-page.doctest.md` does.
Object.assign(globalThis, { React });

import {
  CodeBlock,
  highlightedHtml,
  languageForFence,
  languageForPath,
} from "../src/frontend/components/CodeBlock.js";
import { Markdown } from "../src/frontend/components/Markdown.js";

const render = (element) => renderToStaticMarkup(element);
```

The extensions the repository actually holds map to a registered grammar. A
path with no extension, or one nothing here parses, answers null rather than
being guessed at — mis-colored code reads as a bug in the code.

```ts
JSON.stringify(
  ["src/a.ts", "src/a.tsx", "bin/run.sh", "config.yaml", "App.swift", "data.json", "notes.txt", "Makefile", ".gitignore"]
    .map((p) => [p, languageForPath(p)]),
)
=> [["src/a.ts","typescript"],["src/a.tsx","typescript"],["bin/run.sh","bash"],["config.yaml","yaml"],["App.swift","swift"],["data.json","json"],["notes.txt",null],["Makefile",null],[".gitignore",null]]
```

A fence names its language the way an author writes it, so the info string is
read the same way — including the aliases the extension map already carries.

```ts
JSON.stringify(["ts", "tsx", "sh", "ts setup", "", "klingon"].map(languageForFence))
=> ["typescript","typescript","bash","typescript",null,null]
```

Highlighting escapes what it wraps, so the only markup that reaches the page is
highlight.js's own spans.

```ts
highlightedHtml("const x = \"<script>\";", "typescript")
=> <span class="hljs-keyword">const</span> x = <span class="hljs-string">&quot;&lt;script&gt;&quot;</span>;
```

An unknown grammar costs colour, never content: the source still renders, as
text.

```ts
render(createElement(CodeBlock, { source: "a < b && c", language: null }))
=> <pre class="code-view hljs"><code>a &lt; b &amp;&amp; c</code></pre>
```

A fenced block inside a rendered document is highlighted by the same component:
a `.ts` file and a fence tagged `ts` are the same thing to read.

```ts
render(createElement(Markdown, { source: "```ts\nconst x = 1;\n```" })).includes('<span class="hljs-keyword">const</span>')
=> true
```
