# Canonical list renderers

Canonical interface cards have dedicated renderers.

```ts setup
import "../../src/frontend/src/renderers/system-cards.js";
import { getRenderers } from "../../src/frontend/src/renderers/index.js";

function rendererNames(type: string): string[] {
  const path = `_config/interface/example.${type}.card`;
  return getRenderers(path, { path, type, kind: "frontmatter", frontmatter: {} }).map((renderer) => renderer.name);
}
```

```ts
JSON.stringify(rendererNames("questions"))
=> ["Questions"]

JSON.stringify(rendererNames("landmarks"))
=> ["Landmarks"]

JSON.stringify(rendererNames("history"))
=> ["History"]
```
