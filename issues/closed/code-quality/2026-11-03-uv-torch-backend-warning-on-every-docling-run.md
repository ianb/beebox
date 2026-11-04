---
title: "uv prints an experimental --torch-backend warning on every Docling run"
workstream: docling-memory
area: beebox
labels: [docling, noise]
filed-by: agent
discovered-by: agent
discovered-in: "docling-memory workstream, 2026-11-03"
resolution: implemented
---

**Closed (implemented, 2026-11-03):** uvx --quiet in services/docling/subprocess.ts (commit 9c2fb96a6); uv errors still print

Every `uvx` call for Docling with `UV_TORCH_BACKEND=cpu` set (hosted boxes set
it in `/etc/beebox/box.env`; `src/core/script-env/allowlist.ts` passes it to
agents) prints:

```
warning: The `--torch-backend` option is experimental and may change without warning.
```

It is routine-success output on stderr. It reaches the output tail that
`services/docling/core.ts` keeps for failure messages; the driver's own
`bbx-docling:` reason now takes precedence there, but a Python traceback
failure still shows the warning first.

Directions: find whether uv has a setting that keeps the CPU wheel choice
without the warning (for example `UV_PREVIEW` or a pinned index for torch in
the `uvx` call), or filter that one line in `core.ts`.
