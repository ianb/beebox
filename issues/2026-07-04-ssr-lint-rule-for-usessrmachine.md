# Lint rule: force `useSSRMachine` over `@xstate/react`'s `useMachine`

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
