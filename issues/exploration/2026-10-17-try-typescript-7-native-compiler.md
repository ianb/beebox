---
title: "Try the TypeScript 7 native compiler (`tsgo`) beside `tsc` 5.9"
workstream: unattached
area: beebox
labels: [tooling, typecheck]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder asked whether the repo uses TypeScript 7
---

The repo uses TypeScript 5.9.3. The root `package.json` pins `^5.9.3`.
`beebox/` and `workstreams-app/` pin `^5.7.0`. `personal-vibe-check` peers on
`>=5`. Every `typecheck` script runs `tsc`. Nothing uses `tsgo` or
`@typescript/native-preview`.

TypeScript 7 is the native (Go) port of the compiler. Its main claim is a large
typecheck speedup. Typecheck time is part of every finish run (see
[speed up lint and typecheck](../closed/code-quality/2026-08-12-speed-up-lint-and-typecheck.md)).

## Questions

- How much faster is `tsgo --noEmit` than `tsc --noEmit` on `beebox/`
  (backend and frontend projects) and on `workstreams-app/`?
- Does `tsgo` report the same errors on a clean tree? Which differences come
  from 7.0 behavior changes, and which come from our config (for example
  options that 7.0 removed)?
- What else depends on the `typescript` package API: typescript-eslint,
  `tsx`, knip, the doctest module generation in `agent-doctest`, editor
  tooling. Can `tsgo` replace only the typecheck step while the API users
  stay on 5.x?

## First step

Run `tsgo` next to `tsc` without changing the pinned dependency. Record
timings and error differences here, then propose a migration or a reason to
wait.
