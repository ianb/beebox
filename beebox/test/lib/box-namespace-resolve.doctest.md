# `resolveBoxNamespacePath` — the box namespace fence, checked on the resolved path

Every fenced HTTP/tRPC route resolves a client-supplied box path through
`resolveBoxNamespacePath` (`src/lib/box-namespace-resolve.ts`), which checks
the box namespace fence (`isInBoxNamespace`, Track B,
`docs/plans/one-root-box-layout.md`) against the RESOLVED filesystem path —
not the raw request string. Checking the raw string is a traversal bypass:
`_content/../package.json` starts with `_content` (passes a naive raw-string
check) but *resolves* to `package.json`, outside the namespace.

```ts setup
import { resolveBoxNamespacePath } from "../../src/lib/box-namespace-resolve.js";
```

An ordinary in-namespace path resolves normally:

```ts
JSON.stringify(resolveBoxNamespacePath("/box", "_content/inbox/x.memo.card"))
=> {"resolved":"/box/_content/inbox/x.memo.card","relativePath":"_content/inbox/x.memo.card"}
```

A path outside every underscore area is rejected:

```ts
resolveBoxNamespacePath("/box", "package.json")
=> null

resolveBoxNamespacePath("/box", "src/lib/paths.ts")
=> null

resolveBoxNamespacePath("/box", "node_modules/foo/index.js")
=> null
```

The box root itself (empty relative path) is never in-namespace:

```ts
resolveBoxNamespacePath("/box", "")
=> null
```

A genuine escape outside the box root entirely is rejected:

```ts
resolveBoxNamespacePath("/box", "../outside.txt")
=> null

resolveBoxNamespacePath("/box", "../box-other/secret.txt")
=> null
```

**The bypass this fixes**: a traversal form that starts inside an underscore
area but resolves outside the namespace once normalized. A raw-string check
on `isInBoxNamespace` alone would pass every one of these (each starts with
`_content`); checking the RESOLVED path catches them all:

```ts
resolveBoxNamespacePath("/box", "_content/../package.json")
=> null

resolveBoxNamespacePath("/box", "_content/./../src/x")
=> null

resolveBoxNamespacePath("/box", "_content/../../box-other/secret.txt")
=> null

resolveBoxNamespacePath("/box", "_content/foo/../../package.json")
=> null
```

A traversal form that stays inside the SAME underscore area after
normalizing is still fine — only the resolved location matters, not whether
the raw string contained dots:

```ts
JSON.stringify(resolveBoxNamespacePath("/box", "_content/inbox/../drafts/x.memo.card"))
=> {"resolved":"/box/_content/drafts/x.memo.card","relativePath":"_content/drafts/x.memo.card"}
```
