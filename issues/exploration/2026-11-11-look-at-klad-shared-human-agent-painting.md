---
title: "Look at `klad-app/klad`: a painting app where a person and a coding agent edit the same drawing"
workstream: unattached
area: beebox
labels: [research, agent-collaboration]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — boxholder request, 2026-11-11"
---

[klad](https://github.com/klad-app/klad) is a 2D painting and animation app
built for a person and a coding agent to share. The person paints in an
editor with a pen. The agent paints through a `klad` CLI (`klad stroke`,
`klad set`, `klad fill`) with the same brushes, and its strokes show in the
editor about a second later. There is no image model: every stroke, shape and
fill is stored as editable data (path, pressure, brush, colour). Drawings are
folders of plain files with a documented format (`docs/format.md`). `klad
skill` prints the agent's instructions. It is written in Rust with Skia, made
on macOS first, early (first public version, no installers). The app is
source-available (PolyForm Internal Use); the format, CLI reference, agent
skills and the `klad-client` crate are MIT.

Facts above are from the README as of 2026-11-11, read through a summary;
check them against the repository.

## Why look

Its interaction model is close to ours: the agent and the person work on the
same files, through different tools, and see each other's edits live. Choices
worth comparing:

- **Shared undo history.** Every change, human or agent, is one step in one
  undo history. Compare with how the box shows and reverts agent edits to
  cards (git history, chat diff badges).
- **Pointing the agent at something.** The person pins notes on the canvas or
  selects a region for the agent to read. Compare with how a chat gets card
  context today (the open card, `card=` in the chat URL).
- **Agent instructions shipped by the tool.** `klad skill` prints the
  guidance from the CLI itself, versioned with it. Compare with the box guide
  and schema instructions.
- **Editable data instead of generated output.** Relevant to
  [canvas-loop](../../canvas-loop/README.md), our deterministic Canvas2D
  sandbox, and to box-authored figures and views.
- **Plain-file format with a spec**, used by both a CLI and an editor.

## Questions

- Which of these choices would change something in the box, and which are
  specific to painting?
- Is klad useful to box agents as a tool (a box drawing or sprite), or only
  as a design reference? The licence allows personal use.
- What does its live sync between CLI and editor use, and how does it handle
  a conflict between a pen stroke and an agent edit?
