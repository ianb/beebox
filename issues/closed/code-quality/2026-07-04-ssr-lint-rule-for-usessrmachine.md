---
title: "Lint rule: force `useSSRMachine` over `@xstate/react`'s `useMachine`"
workstream: unknown
resolution: implemented
---

**Resolved** (main session, 2026-07-11): added a `no-restricted-imports` block to
`beebox/src/frontend/eslint.config.mjs` banning `useMachine` from
`@xstate/react` with a message pointing at `useSSRMachine`
(`src/hooks/useSSRMachine.ts`); the wrapper file itself is exempted via
`ignores`. Zero existing violations, so it was a clean add. Verified: the wrapper
lints clean, a probe import fires the rule with the custom message, and the whole
frontend passes. (The preset sets no `no-restricted-imports`, so nothing was
clobbered.) Scope note: applied to the frontend eslint config — `src/webapp` is
backend and doesn't use `@xstate/react`, so no rule was needed there.

2026-07-04 · backlog, low effort.

Frontend components are supposed to use the project's `useSSRMachine` wrapper
rather than importing `useMachine` directly from `@xstate/react`, so SSR
safety is guaranteed rather than convention-only. Nothing currently enforces
this — a stray `useMachine` import compiles and runs fine on the client, and
only breaks (or silently diverges) under SSR.

Fix: an ESLint rule (`no-restricted-imports` with a targeted message, or a
custom rule if the message needs to name the replacement) banning
`useMachine` from `@xstate/react` in `src/webapp`/frontend code, pointing at
`useSSRMachine` as the replacement.
