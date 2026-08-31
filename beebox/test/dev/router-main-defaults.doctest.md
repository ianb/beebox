# Main dev-router defaults

Real local boxes belong in the main checkout's gitignored `beebox/.env`
`BOXES=` line. Tracked source falls back only to the conventional test fixture.

```ts setup
import path from "node:path";
import { MAIN_BOX_DEFAULTS } from "../../../bin/router-config.js";
```

```ts
JSON.stringify(MAIN_BOX_DEFAULTS.map((boxPath) => path.basename(boxPath)))
=> ["test1"]
```
