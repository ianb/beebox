# SSR state registry vs. real routes

`ssr/state-registry-routes.ts` hand-declares a `Record<string, RouteConfig>`
keyed by route path — it's a *manually maintained shadow* of the route table
in `router.tsx`. Not every route needs an entry (a route with no interesting
XState machines or SSR scenarios just falls back to defaults — see
`state-registry.ts`'s `routeConfig ?? undefined` handling), so the intended
invariant is **subset**, not exact match: every key the registry declares
must correspond to a real route, but a route is allowed to have no entry.

What this guards against: a route being renamed or removed in `router.tsx`
while a stale key lingers in the registry (silently pointing at nothing —
`buildSSRStateMap`/`getQueryOverrides` would just never match it, no error).

We can't `import` `router.tsx` here to read `createAppRouter()`'s route tree
directly — it eagerly imports every page component (for SSR parity), which
drags in browser-only module-scope code that isn't safe under this plain-Node
test runner (no `document`/`window` polyfills, no `@shared`/`@backend` path
aliases wired up outside the frontend's own tsconfig/Vite context). Instead
we parse `router.tsx`'s actual source text to recover the same list
`createAppRouter()` would build the route tree from — reading the file
directly means this test can't quietly drift from the routes file the way a
hand-copied list could.

```ts setup
import * as fs from "node:fs";
import * as path from "node:path";
import { routeConfigs } from "../../src/frontend/src/ssr/state-registry-routes";

const routerPath = path.join(import.meta.dirname, "../../src/frontend/src/router.tsx");
const routerSource = fs.readFileSync(routerPath, "utf8");

// Slice out the `[ ... ]` immediately following `open`, tracking bracket
// depth so a nested `]` (e.g. inside the dev-routes spread) doesn't end the
// slice early. Returns the slice including its own brackets.
function extractBracketed(source: string, openBracketIdx: number): string {
  let depth = 0;
  let i = openBracketIdx;
  for (; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return source.slice(openBracketIdx, i);
}

// Split a comma-separated list on top-level commas only (bracket/paren/brace
// depth 0), so a nested `[...]` or `(... ? [...] : [...])` item stays intact
// as one entry instead of being torn apart.
function splitTopLevel(source: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of source) {
    if (ch === "[" || ch === "(" || ch === "{") depth++;
    else if (ch === "]" || ch === ")" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(current);
  return items.map((item) => item.replace(/\/\/.*$/m, "").trim()).filter(Boolean);
}

// Mirrors the first-path-segment normalization `state-registry.ts` applies
// to a route path before looking it up in `routeConfigs` (e.g. "/history/$hash" -> "/history").
function normalizeRoute(routePath: string): string {
  return routePath === "/" ? "/" : "/" + routePath.replace(/^\//, "").replace(/\/.*/, "");
}

// The real, currently-declared box-scoped routes: every bare route-variable
// identifier passed to `boxLayoutRoute.addChildren([...])` in router.tsx.
// A conditional/spread entry (the dev-only routes) isn't a bare identifier,
// so it's naturally excluded — this only picks up routes that unconditionally
// exist in every build.
function realRouteIdentifiers(source: string): string[] {
  const marker = "boxLayoutRoute.addChildren([";
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error("Couldn't find `boxLayoutRoute.addChildren([` in router.tsx — did the route tree move?");
  }
  const arrayText = extractBracketed(source, markerIdx + marker.length - 1);
  const inner = arrayText.slice(1, -1);
  return splitTopLevel(inner).filter((item) => /^[A-Za-z_$][\w$]*$/.test(item));
}

// Each route's declared `path:` string, keyed by its `const <name> = createRoute(...)` identifier.
function pathsByIdentifier(source: string): Map<string, string> {
  const chunks = source.split(/\nconst /).slice(1);
  const result = new Map<string, string>();
  for (const chunk of chunks) {
    const nameMatch = /^(\w+)/.exec(chunk);
    const pathMatch = /path:\s*"([^"]+)"/.exec(chunk);
    if (nameMatch && pathMatch) {
      result.set(nameMatch[1]!, pathMatch[1]!);
    }
  }
  return result;
}

const identifiers = realRouteIdentifiers(routerSource);
const pathByIdentifier = pathsByIdentifier(routerSource);
const realNormalizedRoutePaths = new Set(
  identifiers.map((name) => {
    const routePath = pathByIdentifier.get(name);
    if (routePath === undefined) {
      throw new Error(`No \`path:\` found for route identifier "${name}" in router.tsx`);
    }
    return normalizeRoute(routePath);
  }),
);

const registryKeys = Object.keys(routeConfigs);
const staleRegistryKeys = registryKeys.filter((key) => !realNormalizedRoutePaths.has(key));
```

## The registry currently covers a real subset of routes

Sanity check on the extraction itself — confirms it's actually reading real
route data, not falling back to an empty/broken parse.

```ts
realNormalizedRoutePaths.size >= registryKeys.length
=> true
```

```ts
realNormalizedRoutePaths.has("/chat")
=> true
```

## No registry key points at a route that no longer exists

This is the drift guard: every key in `routeConfigs` must normalize-match a
route that's actually still declared in `router.tsx`. A rename, removal, or
typo here fails loudly instead of silently orphaning a scenario config.

```ts
JSON.stringify(staleRegistryKeys)
=> []
```
