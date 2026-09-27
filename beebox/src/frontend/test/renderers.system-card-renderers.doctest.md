# Canonical list renderers

Canonical interface cards have dedicated renderers.

```ts setup
import { installRenderers } from "../src/renderers.js";
import { getRenderers } from "../src/file-type-registry.js";

installRenderers();

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

JSON.stringify(rendererNames("inventory"))
=> ["Inventory"]

JSON.stringify(rendererNames("admin"))
=> ["Admin"]
```
