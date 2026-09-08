# Theme tour installer

The persistent visual gallery is installed into an isolated box by copying only
its owned `_content/theme-tour/` paths. Identical files are skipped and edited
files are reported as conflicts, so refreshing the seed cannot erase a boxholder's
work.

```ts setup
import { installThemeTour } from "../scripts/install-theme-tour.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Installation is idempotent and preserves edits

```ts
const box = await makeTmpBox();
const source = `${box.root}/seed`;
await box.write("seed/entry.card", "seed\n");
const first = await installThemeTour(box.root, source);
JSON.stringify(first)
=> {"copied":["entry.card"],"skipped":[],"conflicts":[]}
```

```ts continue
const second = await installThemeTour(box.root, source);
JSON.stringify(second)
=> {"copied":[],"skipped":["entry.card"],"conflicts":[]}
```

```ts continue
await box.write("_content/theme-tour/entry.card", "human edit\n");
const third = await installThemeTour(box.root, source);
JSON.stringify(third)
=> {"copied":[],"skipped":[],"conflicts":["entry.card"]}
```

```ts cleanup
await box.cleanup();
```
