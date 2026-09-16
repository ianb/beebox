---
title: "Box agents conclude Python libraries are unavailable: no documented path and no package policy"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: main — production box feedback triage (bbx feedback)
---

`uv` and `uvx` are installed on the server. The Python tools guide
(`beebox/src/core/python-tools-doc.ts`) covers CLIs through
`uvx tool@version`. For library imports it says to use "a real project venv"
and does not say where a box venv lives or how to make one. A box agent that
wanted `import reportlab` found no pip and no venv, and concluded the library
was unavailable.

`uv run --with pkg==ver python3 script.py` works. It is not documented.

## Gaps

1. **Path.** Document `uv run --with`, or give each box a `pyproject.toml`
   under `src/` that `uv run` picks up.
2. **Policy.** The boxholder's preference: "I'd like some conservative
   approaches though, using pypi, time to settle. Not necessarily hard limits
   there, but good defaults."

The box agent proposed these defaults: PyPI only; exact version pins; prefer a
release older than about 30 days; prefer widely used packages; record each
addition (name, version, reason) in the box for review; ask before anything
that needs a compiler or system libraries.

Related: [distro packages](2026-09-16-box-installs-distro-packages.md).
