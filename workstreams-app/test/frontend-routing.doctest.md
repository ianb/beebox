# Frontend routing

The issues index must remain the exact route. Legacy public/private and
open/closed issue paths match redirect-only routes without a catch-all that can
capture the index and redirect forever.

```ts setup
import { createMemoryHistory } from "@tanstack/react-router";
import { router } from "../src/frontend/router.js";

router.update({ history: createMemoryHistory({ initialEntries: ["/issues"] }) });
const leaf = (pathname: string): string | undefined =>
  router.matchRoutes(pathname).at(-1)?.routeId;
```

```ts
JSON.stringify([
  leaf("/issues"),
  leaf("/issues/bugs/example.md"),
  leaf("/issues/closed/bugs/example.md"),
  leaf("/issues/private/bugs/example.md"),
  leaf("/issues/private/closed/bugs/example.md"),
])
=> ["/app/issues","/app/issues/$category/$filename","/app/issues/closed/$category/$filename","/app/issues/private/$category/$filename","/app/issues/private/closed/$category/$filename"]
```
