---
title: "@xstate/store: recorded as adopted, never installed"
workstream: unknown
resolution: wontfix
---

> Closed 2026-09-24 as moot: no living document claims `@xstate/store` is adopted. `stack-decisions.md` became a frozen report (`beebox/docs/reports/stack-decisions-2026-09-04.md`, `dcc1778a7`), and `docs-reorg.md` is an implemented plan. The package was never installed. Adopting it for simple-page state would be a new proposal.

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
