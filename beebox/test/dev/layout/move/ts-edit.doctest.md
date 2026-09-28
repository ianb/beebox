# `rewriteTsFile`: AST-located specifier rewrites

```ts setup
import { rewriteTsFile } from "../../../../src/dev/layout/move/ts-edit.js";
```

## Import, export-from, dynamic import, and require specifiers are all rewritten

```ts
const source = `import { a } from "./old.js";
export { b } from "./old.js";
const c = await import("./old.js");
const d = require("./old.js");
`;
rewriteTsFile({ path: "pkg/src/a.ts", text: source, rewrites: new Map([["./old.js", "./new.js"]]) })
=>
import { a } from "./new.js";
export { b } from "./new.js";
const c = await import("./new.js");
const d = require("./new.js");
```

## Only real specifier literals are touched, not an unrelated string that happens to match

```ts
const source2 = `import { a } from "./old.js";
const label = "./old.js";
`;
rewriteTsFile({ path: "pkg/src/a.ts", text: source2, rewrites: new Map([["./old.js", "./new.js"]]) })
=>
import { a } from "./new.js";
const label = "./old.js";
```

## The original quote character is preserved

```ts
const source3 = `import { a } from './old.js';\n`;
rewriteTsFile({ path: "pkg/src/a.ts", text: source3, rewrites: new Map([["./old.js", "./new.js"]]) })
=> import { a } from './new.js';
```

## Nothing to rewrite returns the text unchanged

```ts
const source4 = `import { a } from "./keep.js";\n`;
rewriteTsFile({ path: "pkg/src/a.ts", text: source4, rewrites: new Map([["./old.js", "./new.js"]]) }) === source4
=> true
```
