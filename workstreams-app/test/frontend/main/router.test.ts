// # Frontend routing
//
// The issues index is the only frontend issue route. Deep links were retired, so
// the route tree must not quietly recreate a public/private or open/closed
// redirect path.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createMemoryHistory } from "@tanstack/react-router";
import { router } from "../../../src/frontend/main/router.js";

router.update({ history: createMemoryHistory({ initialEntries: ["/issues"] }) });
const leaf = (pathname: string): string | undefined =>
  router.matchRoutes(pathname).at(-1)?.routeId;

void test("line 16", async (t) => {
  t.check(
    [
      leaf("/issues"),
      ...Object.values(router.routesById)
        .map((route) => route.fullPath)
        .filter((path) => path.startsWith("/issues/") && path !== "/issues"),
    ],
    [
    "/app/issues",
  ],
  );
});
