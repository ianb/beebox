---
title: "TRIAGE_ITEMS NUL environment transport truncates handler batches"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-prompt-calibration — verifying the current triage documentation
priority: backlog
resolution: implemented
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

The injected procedure runner in `beebox/test/core/handle.test.ts` receives
the `triageItems` array before environment serialization, so those tests do not
exercise the failing live boundary.

Use a representation that survives process environment transport, or pass the
batch through a different channel. Add coverage that reaches a spawned handler
with at least two paths, including a path with spaces. Update
`beebox/src/core/docs-gen/package-docs/triage.ts`, which currently advertises the broken
NUL-delimited shell recipe, together with the runtime contract. Keep
`beebox/docs/triage.md` aligned with the corrected transport.

## Resolution

2026-10-19, bug-burndown-3: `liveRunProcedure` in `beebox/src/core/handle.ts`
now joins the bucket's box-relative paths with newlines. An item path that
contains a newline fails that bucket instead of splitting into two items. The
generated triage guide (`beebox/src/core/docs-gen/package-docs/triage.ts`),
`beebox/docs/triage.md`, and the `triage-handler-env` knowledge-audit
expectation document the `while IFS= read -r item` recipe in place of
`xargs -0`. A new test in `beebox/test/core/handle.test.ts` runs the live
procedure engine on a two-item bucket, one path with spaces. Its shell step
uses the documented recipe and records both paths. The test fails with the old
NUL join.
