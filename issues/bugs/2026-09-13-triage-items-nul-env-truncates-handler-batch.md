---
title: "TRIAGE_ITEMS NUL environment transport truncates handler batches"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-prompt-calibration — verifying the current triage documentation
priority: backlog
---

`bbx handle` can pass only the first item in a multi-item category bucket to a
live handler procedure. `beebox/src/core/handle.ts:91` joins box-relative paths
with `\0` and assigns the result to the `TRIAGE_ITEMS` environment variable.
The procedure engine then forwards the process environment to shell steps.
Environment transport cannot preserve an embedded NUL byte.

A direct Node probe set `process.env.TRIAGE_ITEMS` to `"a\0b"`, spawned a child
Node process, and printed the child's value. The child received only `"a"`:

```js
const { spawnSync } = require("node:child_process");
process.env.TRIAGE_ITEMS = "a\0b";
const result = spawnSync(
  process.execPath,
  ["-e", "console.log(JSON.stringify(process.env.TRIAGE_ITEMS))"],
  { env: process.env, encoding: "utf8" },
);
console.log(result.stdout); // "a"
```

The injected procedure runner in `beebox/test/core/handle.doctest.md` receives
the `triageItems` array before environment serialization, so those tests do not
exercise the failing live boundary.

Use a representation that survives process environment transport, or pass the
batch through a different channel. Add coverage that reaches a spawned handler
with at least two paths, including a path with spaces. Update
`beebox/src/core/docs-gen/triage.ts`, which currently advertises the broken
NUL-delimited shell recipe, together with the runtime contract. Keep
`beebox/docs/triage.md` aligned with the corrected transport.
