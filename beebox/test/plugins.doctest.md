# Plugin registry

`src/plugins.ts` is the closed set of in-repo plugins (`docs/plans/plugins.md`):
each `src/plugins/<name>/plugin.ts` default-exports a `PluginDefinition`, and
the registry lists them by name. `pluginNames` and `pluginByName` are the
engine's two reads.

```ts setup
import { pluginByName, pluginNames, plugins } from "../src/plugins.js";
import { definePlugin } from "../src/cards/plugin-definition.js";
```

Every name the registry lists resolves to a definition carrying that name;
an unknown name is `undefined`, never a throw.

```ts
plugins.directory
=> ./plugins

pluginNames().every((name) => pluginByName(name)?.name === name)
=> true

pluginByName("no-such-plugin")
=> undefined
```

`definePlugin` is an identity with a type check: a plugin module's
`export default definePlugin({...})` is what the registry imports.

```ts
const def = definePlugin({ name: "example", description: "An example plugin", docs: "src/plugins/example/README.md" });
def
=> { name: "example", description: "An example plugin", docs: "src/plugins/example/README.md" }
```
