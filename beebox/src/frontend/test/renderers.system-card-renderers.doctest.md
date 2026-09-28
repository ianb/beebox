# Canonical list renderers

Canonical interface cards have dedicated renderers.

```ts setup
import { getRenderers, registerFileType } from "../src/file-type-registry.js";
import {
  adminRenderer,
  dashboardRenderer,
  historyCardRenderer,
  inventoryRenderer,
  landmarksRenderer,
  questionsRenderer,
  settingsRenderer,
} from "../src/renderers/system-cards.js";

// Only the system-card members, not the full registry (`installRenderers()`):
// other renderers pull in `lib/markdoc-parse.ts`, whose `@markdoc/markdoc`
// named import does not resolve under this doctest runtime (see
// WorkspaceCanvas.pdf-frame.doctest.md).
for (const entry of [dashboardRenderer, settingsRenderer, questionsRenderer, landmarksRenderer, historyCardRenderer, inventoryRenderer, adminRenderer]) {
  registerFileType(entry.selector, { renderer: entry.renderer });
}

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
