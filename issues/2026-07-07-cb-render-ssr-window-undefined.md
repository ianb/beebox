---
area: callback-box
filed-by: agent
discovered-in: main session — while debugging the prod blank-page outage, tried `cb render` on the server to inspect a box page past the OAuth wall
---

# `cb render` (SSR) crashes with `window is not defined`

`cb render <boxDir> <route>` dies at import time:

```
/opt/callback/callback-box/src/frontend/src/components/AgentViewRenderer.tsx:89
if (!window.__cbReact) {
^
ReferenceError: window is not defined
```

`AgentViewRenderer.tsx:89` touches `window` at module top-level, which is
undefined under Node SSR. Any route whose component graph imports
`AgentViewRenderer` therefore can't be server-rendered — reproduced with both
`/` and a box route, on the deployed server (main @ d197e465).

Why it matters: SSR (`cb render`) is the natural way to verify a box page renders
without a browser or auth — exactly what I reached for during the outage and
couldn't use. It's also covered by `docs/ssr-render-testing.md`, so SSR is
supposed to work.

Likely fix: guard the `window` access (`typeof window !== "undefined"`) or move
it out of module-eval into a lazy/effect path. Worth a sweep for other
module-level `window`/`document` reads that would break SSR the same way — a
lint rule (`no-restricted-globals` at module scope) might be the durable answer.

The prod-curl helper (`deploy/prod-curl`, gitignored) is the working alternative
for now — it fetches pages as the owner over the real HTTP path — but that gives
raw HTML, not a rendered DOM; SSR would be strictly better for render checks.
