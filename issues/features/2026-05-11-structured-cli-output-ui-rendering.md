---
title: "Structured CLI output with UI rendering"
workstream: unknown
area: callback-box
---

`cb` commands could default to JSON output (or always emit it with `--json`) and the web UI could have per-command renderers — a React component or HTML template that receives the JSON and displays it nicely. This dissolves the tension between "JSON for agents, formatted tables for humans": the CLI is always machine-parseable, and the UI layer is where human-friendly rendering happens.

The analogy is how `git log --format=json` doesn't exist but git GUIs parse git's output anyway — except here the command itself controls the schema and the renderer can be co-designed. Commands would declare their output schema; the UI maps command names to renderer components. The admin page or a debug panel could be the first surface.

This also helps with the bounded-output problem: a renderer can decide what to show by default and expose a "show all" control, rather than the CLI trying to guess a good human default.
