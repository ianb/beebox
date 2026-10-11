# The scope of a raw exhibit page

A raw `index.html` exhibit that opts into the control bar has no boot
payload; the bar learns which exhibit it is on from the page URL. The scope
is the first two path segments, and a committed app under `apps/` is not a
store exhibit, so it gets no bar.

```ts setup
import { isStoreScope, scopeFromPath } from "../../../src/frontend/exhibits/controls/scope.js";
```

```ts
JSON.stringify([
  scopeFromPath("/logo-bakeoff/round-3/"),
  scopeFromPath("/logo-bakeoff/round-3"),
  scopeFromPath("/logo-bakeoff/round-3/figures/a.png"),
  scopeFromPath("/logo-bakeoff/"),
  scopeFromPath("/"),
  scopeFromPath("/apps/instrument/"),
])
=> ["logo-bakeoff/round-3","logo-bakeoff/round-3","logo-bakeoff/round-3",null,null,"apps/instrument"]
```

```ts
JSON.stringify([isStoreScope("logo-bakeoff/round-3"), isStoreScope("apps/instrument"), isStoreScope("main/x")])
=> [true,false,true]
```
