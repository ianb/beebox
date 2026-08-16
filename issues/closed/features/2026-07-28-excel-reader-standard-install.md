---
title: "Make an Excel/.xlsx reader part of the standard install"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder request
resolution: implemented
---

**Closed (implemented) 2026-07-28.** `python3-openpyxl` + `xlsx2csv` added to
provisioning (`deploy/setup-server.sh` apt line, `docker/Dockerfile`), documented
(`developer-install.md`, `docker-install.md`), and added to the agent's
"always available" contract (`src/core/agent-guide/chat.ts`). Installed live on
the prod server (Ubuntu 24.04, via apt) and on the local dev machine (via pip —
no brew formula exists). Legacy `.xls` left unsupported by decision (openpyxl is
`.xlsx`-only; LibreOffice too heavy). The cosmetic `xlsx2csv` SyntaxWarning on
the apt-packaged 0.7.8 is a known upstream issue; openpyxl is the clean primary.

Box agents run Claude Code and shell out to CLI/Python tools, and the standard
install already provisions a document toolchain for that — but **nothing can read
spreadsheets.** `.xlsx` files already reach boxes (gmail-mime recognizes `.xls`/
`.xlsx` attachments; the in-progress bulk-file-upload work — worktree
`bulk-file-upload` — will bring more), and today an agent handed one has no
reader. Add openpyxl or an equivalent to the standard install.

## The gap

`deploy/setup-server.sh` installs (via apt) `pandoc`, `poppler-utils`,
`imagemagick`, etc. — so agents can extract PDFs (`pdftotext`), convert docs
(`pandoc`), and handle images — but there is **no spreadsheet reader**. The
Google Sheets path (`connectors/drive-handler-sheets.ts`, the Drive service) is
API-based and doesn't help with a local `.xlsx` on disk.

## Recommendation

- **Add `python3-openpyxl` via apt**, not `pip install openpyxl`. Python3 is
  already present, and installing via the distro package sidesteps PEP 668
  (system `pip install` is blocked on current Ubuntu/Debian without
  `--break-system-packages`). This matches the apt-based provisioning and covers
  the common case (`.xlsx` read; openpyxl also writes).
- Optionally also `xlsx2csv` (light, pure-Python CLI) so an agent can `xlsx2csv
  file.xlsx` and get CSV text directly — the same "run a CLI, read text" shape as
  `pdftotext`/`pandoc`, which fits how agents already work here. `python3-pandas`
  would be heavier and is probably overkill.
- **Legacy `.xls`** (old binary format) is a minor remaining gap — openpyxl is
  `.xlsx`-only. `.xls` needs `xlrd` or a `libreoffice --headless` convert;
  LibreOffice is a very heavy dep, so probably note `.xls` as unsupported rather
  than pull it in. Decide.

## Surfaces to update (it's "standard install," so all of them)

- `deploy/setup-server.sh` — the apt install line (prod provisioning).
- `docs/developer-install.md`, `docs/docker-install.md`, `docs/agent-install.md`
  — the documented dependency lists (mac dev: openpyxl via pip, since there's no
  brew formula; Linux: `python3-openpyxl`).

**Wrinkle:** adding it to `setup-server.sh` only affects *new* server
provisioning — **existing prod servers need the package installed / setup re-run**
to actually get it. Note that so a box in the field doesn't silently lack it.

## Related

- Bulk file upload (worktree `bulk-file-upload`, not yet a filed issue) —
  uploaded spreadsheets are a prime reason agents will hit `.xlsx` locally.
