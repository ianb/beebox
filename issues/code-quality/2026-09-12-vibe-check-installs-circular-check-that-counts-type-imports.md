---
title: "The preset installs a lint:circular that counts type imports, so its output is mostly noise"
workstream: unattached
area: personal-vibe-check
filed-by: agent
discovered-in: supplemental-lint schedule run 20260912-152524
priority: normal
---

`personal-vibe-check` installs `"lint:circular": "madge --circular --extensions
ts,tsx src/"` into every project it bootstraps (`install.md`, and its own
`package.json`), and `conventions.md` tells the reader what the output means:
"type-only cycles (`import type`) are acceptable, value import cycles are not".

madge does not make that distinction unless told to. Out of the box it counts
`import type` edges, and a barrel that imports its leaves while the leaves
import the barrel's types — the normal shape of a directory with an `index.ts` —
reads as a cycle per leaf. In beebox that was 41 reported cycles of which 40
were type-only; the check had never been green, so nobody read it. Turning on
`skipTypeImports` left one real cycle, and beebox now ships a `.madgerc`:

```json
{ "detectiveOptions": { "ts": { "skipTypeImports": true }, "tsx": { "skipTypeImports": true } } }
```

The preset should install that file (or fold the option into the script) next to
the `lint:circular` script, so a bootstrapped project gets a check whose output
matches the convention it is handed. Worth deciding at the same time whether
`lint:circular` then joins the pre-commit gate — a check that is reliably zero
can be enforced, and one that prints 41 lines cannot.

Related: the preset's own `lint:circular` still points at a `src/` it does not
have ([personal-vibe-check has no working self-lint](2026-07-29-personal-vibe-check-no-self-lint.md)).

Second, smaller thing noticed in the same run: madge prints `Processed 1812
files (45 warnings)` and offers no way to see the warnings — `--warning` only
changes the count (45 vs 60 across runs). Those are files madge skipped, i.e.
graph coverage the check silently does not have. Worth one look before trusting
a green `lint:circular` as a gate.
