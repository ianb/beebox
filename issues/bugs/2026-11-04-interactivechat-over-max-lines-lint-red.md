---
title: "`pnpm lint` is red on main: `InteractiveChat` is 151 lines, over `max-lines-per-function`"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: knip-sweep — pre-landing `pnpm lint` on 2026-11-04
labels: [lint-failure]
---

`pnpm lint` fails on current main with one error:

```
196:8  error  Function 'InteractiveChat' has too many lines (151). Maximum allowed is 150  max-lines-per-function
```

The function is in
`beebox/src/frontend/src/components/chat/everywhere/InteractiveChat/`. It
went over the limit with the chat-catching-up work (merge b96ff31f6). The
knip-sweep branch does not touch that function, but red lint blocks the sweep
from landing itself.

Fix: split one part of `InteractiveChat` into a helper or hook so it is back
under 150 lines.
