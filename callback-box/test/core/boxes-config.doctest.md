# boxes-config: hand-editable manifest validation (Track D.4)

`~/.config/cb/boxes.json` is hand-editable, so `loadBoxesConfig` used to run
an unguarded `JSON.parse` on it — a typo crashed the CLI with a bare
`SyntaxError` pointing at nothing useful. It's now validated through a zod
schema with a named, loud `BoxesConfigParseError` that names the file and
the problem. See `src/core/box/boxes-config.ts`.

`loadBoxesConfig` takes an optional `configPath` override (tests only, mirrors
`loadHubConfig`'s explicit-path style) so this test never touches the real
`~/.config/cb/boxes.json`.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadBoxesConfig, BoxesConfigParseError } from "../../src/core/box/boxes-config.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

async function tryLoad(configPath) {
  try {
    return await loadBoxesConfig(configPath);
  } catch (e) {
    return e;
  }
}
```

## Missing file: treated as an empty manifest, no throw

```ts
const box = await makeTmpBox();
const configPath = path.join(box.root, "boxes.json");
const missing = await tryLoad(configPath);
JSON.stringify(missing)
=> {"boxes":[]}
```

## A valid manifest loads

```ts continue
await fs.writeFile(configPath, JSON.stringify({ boxes: ["/path/to/box-a", "/path/to/box-b"] }));
const valid = await tryLoad(configPath);
JSON.stringify(valid)
=> {"boxes":["/path/to/box-a","/path/to/box-b"]}
```

## Invalid JSON is a loud, named error — not a bare SyntaxError

```ts continue
await fs.writeFile(configPath, "{ not valid json");
const badJson = await tryLoad(configPath);
badJson instanceof BoxesConfigParseError
=> true

badJson.configPath === configPath
=> true

badJson.message.includes(configPath)
=> true
```

## Valid JSON that doesn't match the schema (wrong shape, unknown key) also throws

```ts continue
await fs.writeFile(configPath, JSON.stringify({ boxes: "not-an-array" }));
(await tryLoad(configPath)) instanceof BoxesConfigParseError
=> true

await fs.writeFile(configPath, JSON.stringify({ boxes: [], extra: true }));
(await tryLoad(configPath)) instanceof BoxesConfigParseError
=> true
```

```ts cleanup
await box.cleanup();
```
