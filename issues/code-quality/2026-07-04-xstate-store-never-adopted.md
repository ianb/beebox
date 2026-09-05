---
title: "@xstate/store: recorded as adopted, never installed"
workstream: unknown
---

2026-07-04 · decision needed.

`beebox/docs/stack-decisions.md` (~line 143) records `@xstate/store`
as the adopted answer for simple-page state, but the package is in neither
`package.json` nor any import — the decision was planned and never
implemented. The stack-decisions entry now carries an "unresolved" note
pointing here.

Resolve either way:
- **Strike it** — Zustand + full XState machines cover current needs; the
  entry becomes a superseded decision with a one-line rationale.
- **Adopt it** — pick a first page whose state is currently over-served by
  a full machine or ad-hoc useState, install, and record the precedent.

Until resolved, new simple-page state should not cite this entry as
precedent.
