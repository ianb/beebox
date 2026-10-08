---
title: "The plate header prints \"Scope: _content (**)\", a glob the person cannot read"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending, C-reconnecting and F-newcomer journey walks, 2026-10-08
resolution: implemented
---

Fixed 2026-10-08: `scopeDescription` in `todo-view-card-logic.ts` words the scope line: `**` reads "the whole box", `dir/**` reads the folder; covered in `todo-view-card-logic.doctest.md`.

The line under the plate title reads `Scope: _content (**), plus todos
elsewhere that link here`. Three walkers found it meaningless; the
C-reconnecting report calls it "gibberish". Reports:
[A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md) (row 55),
[C-reconnecting](../../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-08.md) (row 27),
[F-newcomer](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-08.md) (row 30).

## Mechanism

`ScopeLine` in
`beebox/src/frontend/src/components/todo-view/TodoViewControls.tsx:39-50`
prints the place name, then the raw glob in parentheses unless the glob equals
`<here>/**` (or `**/*.card` at the root). The stock plate card is installed
with an explicit `glob: "**"` so it covers the whole box
(`beebox/src/core/box/structure/defaults.ts:286-300`), but its `here` is
`_content`, the folder it lives in. The test fails and the line prints both:
`_content (**)`. The line names a folder and a glob, while the plate covers
the whole box. The second clause ("plus todos elsewhere that link here") is
plain-code wording for the `includeReferring` flag.

## Fix direction

Say what the plate covers in words ("Everything in the box"), or drop the
line for the stock plate. When the glob is `**`, the scope is the whole box
whatever `here` says.
