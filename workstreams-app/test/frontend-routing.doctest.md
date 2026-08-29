# Frontend routing

The issues index is the only frontend issue route. Deep links were retired, so
the route tree must not quietly recreate a public/private or open/closed
redirect path.

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
  ...Object.values(router.routesById)
    .map((route) => route.fullPath)
    .filter((path) => path.startsWith("/issues/") && path !== "/issues"),
])
=> ["/app/issues"]
```
