# Issue Markdown rendering

Issue bodies render as document markup rather than a preformatted source dump.
Unsafe link protocols do not become clickable links.

```ts setup
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Markdown } from "../src/frontend/components/Markdown.js";

const render = (source: string): string => renderToStaticMarkup(createElement(Markdown, { source }));
```

```ts
render("## Verify this\n\n- first\n- **second**\n\n`pnpm test`").includes("<h2>Verify this</h2>")
=> true
```

```ts
render("## Verify this\n\n- first\n- **second**\n\n`pnpm test`").includes("<strong>second</strong>")
=> true
```

```ts
render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)").includes('href="HTTPS://example.com"')
=> true
```

```ts
render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)").includes('href="../plan.md"')
=> true
```

```ts
render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)").includes('href="custom:')
=> false
```

```ts
render("[safe](HTTPS://example.com) [relative](../plan.md) [unsafe](custom:payload)").includes("Unsupported link: custom:payload")
=> true
```

Unknown Markdoc tags follow Markdoc's normal behavior: their inner content is
preserved even though the tag wrapper itself has no issue-app meaning.

```ts
render("before {% mystery %}inside{% /mystery %} after").includes("before inside after")
=> true
```
