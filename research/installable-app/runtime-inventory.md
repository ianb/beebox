# What a box needs on its host (2026-09-29)

Sources: `beebox/docker/Dockerfile`, `beebox/deploy/hetzner/setup-server.sh`,
`beebox/deploy/deploy.sh` (its post-deploy tool check), and measurements on
a maintained Apple-silicon Mac (macOS 26.5, Homebrew).

## The list

| Need | Server (`setup-server.sh`) | Docker image | Mac size (measured) |
|---|---|---|---|
| Node 24 (engine-strict pin) | NodeSource 24 | `node:24-bookworm-slim` | 121 MB binary |
| pnpm (corepack) | yes | yes | — |
| better-sqlite3, esbuild, sharp (native addons) | built by `pnpm install` | built in image | per-arch; rebuilt on Node ABI change |
| git, git-lfs | yes | yes | — |
| git-annex (hard requirement: box pre-commit hook) | yes | yes | 180 MB |
| pandoc | yes | yes | 258 MB |
| ImageMagick (`magick`) | yes | yes (IM6 + symlink) | ~615 MB brew closure (56 deps) |
| poppler (`pdftotext`, `pdfimages`) | yes | yes | ~380 MB brew closure (48 deps, overlaps ImageMagick) |
| python3-openpyxl, xlsx2csv | yes | yes | — |
| qpdf (scan upload validation) | yes | **no** | 40 KB + libs |
| ffmpeg | yes | **no** | ~185 MB closure |
| fclones | yes | amd64 only | — |
| uv + Docling models (`uvx docling`, scan document mode) | yes, models pre-fetched | **no** | uv 36 MB; Docling env + PyTorch is GBs |
| Claude Code CLI (native installer) | yes, per user | yes, under `node` | 213 MB |
| Codex CLI (package-pinned, `node_modules/.bin/codex`) | yes | via the engine install | 229 MB |
| sudo + `bbx-host-apt` wrapper (`bbx host install`) | yes | yes | no Mac equivalent |

Brew closure sizes include headers and docs and overlap each other, so they
are upper bounds. A realistic native bundle is 1–1.5 GB before Docling.

## Observations

- The image and the server have separate lists, and they have drifted
  (`qpdf`, `ffmpeg`, `uv`/Docling). `qpdf`'s absence refuses PDF scan
  uploads with a 503 (`beebox/src/core/scan/validate.ts:67`). Filed as
  [docker-image-missing-qpdf-and-docling](../../issues/bugs/2026-09-29-docker-image-missing-qpdf-and-docling.md).
- The agent contract names a subset
  (`beebox/src/core/agent-guide/chat.ts`); `pnpm run doctor` checks another
  subset. Any packaged form adds one more list. A single machine-readable
  host-dependency manifest, read by the Dockerfile, `setup-server.sh`, the
  doctor, and any future bundle, would stop the drift. Recorded in the same
  issue.
- `bbx host install` lets a box ask for extra distro packages through apt.
  It works on the server and in the container. A native Mac runtime has no
  equivalent without driving Homebrew, which is a much larger trust surface.
- Box-local `pnpm install` compiles native addons at run time. On a
  hardened, signed Mac Node, those unsigned addons load only with the
  `disable-library-validation` entitlement (see
  [packaging-options.md](packaging-options.md)).
