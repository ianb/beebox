# Presentation catalog route

The frontend loads one box-scoped snapshot: built-in catalog metadata, validated
box selection rules, schema defaults, and independently resolved chrome.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { clearBoxConfigCache, loadBoxConfig, loadBoxConfigResult } from "../../src/core/box/config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { execFileSync } from "node:child_process";

function caller(boxRoot, options) {
  return appRouter.createCaller({
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
    user: null,
    authed: true,
    isOwner: options?.isOwner !== false,
  });
}
```

An absent config is ordinary and exposes the stable built-in catalog.

```ts
const box = await makeTmpBox();
const first = await caller(box.root).presentation.get({ boxKey: "test" });
JSON.stringify([first.catalog.map((theme) => theme.name), first.presentation, first.chrome, first.configProblems])
=> [["plain","paper","post-it"],{"status":"absent"},{"choice":{"name":"plain","stock":"neutral"},"origin":"engine","problem":null},[]]

JSON.stringify([
  first.canEditCardThemes,
  (await caller(box.root, { isOwner: false }).presentation.get({ boxKey: "test-reader" })).canEditCardThemes,
])
=> [true,false]
```

Invalid JSON stays distinguishable from absence while legacy callers retain
their established empty-object fallback. A corrected edit recovers.

```ts continue
const configPath = path.join(box.root, "_config", "box.json");
await fs.mkdir(path.dirname(configPath), { recursive: true });
await fs.writeFile(configPath, "{ broken\n");
clearBoxConfigCache(box.root);
const originalWarn = console.warn;
console.warn = () => {};
const broken = await loadBoxConfigResult(box.root);
console.warn = originalWarn;
JSON.stringify([broken.status, await loadBoxConfig(box.root)])
=> ["invalid",{}]

await fs.writeFile(configPath, JSON.stringify({
  timezone: "America/Chicago",
  presentation: {
    default: { name: "paper", stock: "blue" },
    rules: [{ match: "_content/notes/**", theme: { name: "post-it" } }],
    chrome: { name: "paper", stock: "manila" },
  },
}));
clearBoxConfigCache(box.root);
const recovered = await caller(box.root).presentation.get({ boxKey: "test" });
JSON.stringify([recovered.presentation.status, recovered.chrome.choice, recovered.configProblems])
=> ["valid",{"name":"paper","stock":"manila"},[]]
```

A structurally valid box file with an invalid presentation subtree leaves the
unrelated settings readable while the route reports presentation failure.

```ts continue
await fs.writeFile(configPath, JSON.stringify({
  timezone: "America/Chicago",
  presentation: { default: { name: "paper", stock: "purple" } },
}));
clearBoxConfigCache(box.root);
const invalidPresentation = await caller(box.root).presentation.get({ boxKey: "test-v2" });
JSON.stringify([
  (await loadBoxConfig(box.root)).timezone,
  invalidPresentation.presentation.status,
  invalidPresentation.configProblems[0].includes("available stocks"),
  invalidPresentation.chrome.choice,
])
=> ["America/Chicago","invalid",true,{"name":"plain","stock":"neutral"}]
```

```ts cleanup
await box.cleanup();
```

## A swatch choice writes only the theme field

The Properties picker is owner-only. It validates catalog membership before
touching the file, then preserves unrelated and currently unknown frontmatter,
comments, and the body. Clearing the choice restores inheritance.

```ts
const cardBox = await makeTmpBox({ git: true });
const cardPath = "_content/notes/Keep.memo.card";
await cardBox.write(cardPath, "---\n# keep this comment\ntitle: Keep\nfuture-field: still here\n---\nBody stays here.\n");

const set = await caller(cardBox.root).card.setTheme({
  path: cardPath,
  theme: { name: "paper", stock: "blue" },
});
const afterSet = await cardBox.read(cardPath);
JSON.stringify([
  set.theme,
  typeof set.commit === "string",
  afterSet.includes("# keep this comment"),
  afterSet.includes("future-field: still here"),
  afterSet.includes("name: paper"),
  afterSet.endsWith("Body stays here.\n"),
])
=> [{"name":"paper","stock":"blue"},true,true,true,true,true]
```

An unknown stock is refused and leaves the prior choice in place.

```ts continue
await caller(cardBox.root).card.setTheme({
  path: cardPath,
  theme: { name: "paper", stock: "purple" },
}).then(() => "accepted", (error) => error.code)
=> BAD_REQUEST

(await cardBox.read(cardPath)).includes("stock: blue")
=> true
```

```ts continue
await caller(cardBox.root).card.setTheme({ path: cardPath, theme: null });
const afterClear = await cardBox.read(cardPath);
JSON.stringify([
  afterClear.includes("theme:"),
  afterClear.includes("future-field: still here"),
  afterClear.endsWith("Body stays here.\n"),
])
=> [false,true,true]
```

```ts continue
await caller(cardBox.root, { isOwner: false }).card.setTheme({
  path: cardPath,
  theme: { name: "post-it" },
}).then(() => "accepted", (error) => error.code)
=> FORBIDDEN
```

If Git rejects the focused commit after the atomic write, the mutation reports
the partial success and the saved theme remains visible to the caller's normal
file-change refresh.

```ts continue
const hooksPath = path.join(cardBox.root, ".git", "rejecting-hooks");
await fs.mkdir(hooksPath, { recursive: true });
await fs.writeFile(path.join(hooksPath, "pre-commit"), "#!/bin/sh\nexit 1\n");
await fs.chmod(path.join(hooksPath, "pre-commit"), 0o755);
execFileSync("git", ["config", "core.hooksPath", hooksPath], { cwd: cardBox.root });
const partial = await caller(cardBox.root).card.setTheme({
  path: cardPath,
  theme: { name: "post-it", stock: "rose" },
});
JSON.stringify([
  partial.commit,
  partial.commitWarning,
  (await cardBox.read(cardPath)).includes("name: post-it"),
])
=> [null,"Saved, but the Git commit failed.",true]
```

```ts cleanup
await cardBox.cleanup();
```
