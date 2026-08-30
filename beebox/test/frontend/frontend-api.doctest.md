# Frontend API helpers

Smoke-tests for the URL-prefixing helper used by the frontend to talk to the
backend through the dev router (or directly in prod). The helper is pure —
no dependency on `import.meta.env`, so it can be tested here in the backend
test runner without mocking Vite.

The concrete worry: in prod, Vite builds with the default `base: "/"` and
`BASE_URL` becomes `"/"`. The helper must be a no-op in that case so
production API calls go to `/api/...` and not accidentally `/api/api/...` or
`//api/...`.

```ts setup
import { joinBaseAndPath } from "../../src/frontend/src/api";
```

## In prod (base = "/"), the helper is a no-op

```ts
JSON.stringify(joinBaseAndPath("/", "/api/boxes"))
=> "/api/boxes"
```

```ts
JSON.stringify(joinBaseAndPath("/", "/auth/me"))
=> "/auth/me"
```

A path missing its leading slash gets one (defensive — shouldn't happen but
shouldn't break either).

```ts
JSON.stringify(joinBaseAndPath("/", "api/boxes"))
=> "/api/boxes"
```

## Under the dev router (base = "/main/"), paths are prefixed

```ts
JSON.stringify(joinBaseAndPath("/main/", "/api/boxes"))
=> "/main/api/boxes"
```

```ts
JSON.stringify(joinBaseAndPath("/main/", "/auth/me"))
=> "/main/auth/me"
```

## Base without trailing slash is accepted

```ts
JSON.stringify(joinBaseAndPath("/main", "/api/boxes"))
=> "/main/api/boxes"
```

## A worktree-named base works the same

```ts
JSON.stringify(joinBaseAndPath("/feature-x/", "/api/boxes"))
=> "/feature-x/api/boxes"
```

## No double slash when path is already absolute

```ts
JSON.stringify(joinBaseAndPath("/main/", "api/boxes"))
=> "/main/api/boxes"
```
