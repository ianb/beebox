---
title: "Webapp card mutations lack concurrency protection"
---

2026-07-04 · low priority (boxholder: "not a big deal, I'm not all that
interested in interactive editing compared to agent led editing. But it
could be good to do.")

`trpc/routers/todos.ts` (~:56-83) and the scheduler router do
read→mutate→whole-file-write with no lock and no version token: two
concurrent checkbox toggles lose one update silently. The conflict-safe
primitive already exists on the view-widget path — `writeFile {expect}`
(`callback-box/src/types/views.ts` ~:86) — so the fix is adoption, not
invention: thread an expected-content (or hash) token through the mutating
tRPC procedures and surface a retry/conflict result to the UI.

Also worth a look while there: whether these paths should go through
`src/lib/file-lock.ts` when the writer is server-side vs. relying purely on
optimistic tokens.
