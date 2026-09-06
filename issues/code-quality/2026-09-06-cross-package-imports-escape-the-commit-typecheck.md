---
title: "workstreams-app imports beebox source, but a beebox change is never typechecked against it at commit"
workstream: unattached
area: workstreams-app
priority: important
labels: [tooling, hooks]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "There were just a bunch of deferred issue reports?"
---

`workstreams-app/src/server/issue-index.ts` imports
`beebox/src/services/openai-embeddings.js` directly across the package
boundary. The pre-commit hook typechecks each subproject only when that
subproject's files are staged (`.husky/pre-commit`, `run_pair beebox …`),
so a beebox commit that renames an export passes its own typecheck, lands,
and breaks `workstreams-app` silently. That is what happened on 2026-09-06:
the OpenRouter landing renamed `createOpenAIEmbeddingsService` to
`createEmbeddingsService(route)`, the `deferred-issues` schedule (which
runs `bin/issues`, which loads the issue index) failed on every hourly tick
with an `important` alert, and `bin/issues` itself was down until fixed.

Fix directions, pick one:

- Typecheck the importing packages whenever the imported package's files are
  staged: a small dependency map in the hook (`beebox/src/** → workstreams-app`)
  so the hook runs `workstreams-app`'s typecheck on beebox changes to files
  it imports. Cheap and precise.
- Or stop the cross-package source import: `bin/issues` and the dev index
  take the embeddings client through a small `bin/` module or a beebox
  export surface that the beebox typecheck itself owns.

Either way, `bin/issues` breaking should fail loudly once, not as an hourly
"run failed" alert with a stack trace the reader has to decode.
