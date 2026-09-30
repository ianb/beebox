---
title: "The Docker image lacks qpdf, uv/Docling, and a codex on PATH, so scan uploads 503 and Codex login cannot run"
workstream: unattached
area: beebox
labels: [install]
filed-by: agent
discovered-in: worktree-installable-app — runtime inventory for the installable-app research
---

The server provisioning script and the Docker image keep separate lists of
host binaries, and the lists have drifted.

- `beebox/deploy/hetzner/setup-server.sh:30` installs `qpdf` and `ffmpeg`,
  and lines 98–126 install `uv` and pre-fetch the pinned Docling models.
- `beebox/docker/Dockerfile` installs neither `qpdf`, `ffmpeg`, nor `uv`.
- `beebox/deploy/deploy.sh:944` checks the server for `qpdf` and `ffmpeg`.
  Nothing checks the image.

Consequences in the container, the primary install path
([container-first](../features/2026-09-06-container-install-is-the-primary-path.md)):

- `qpdfAvailable()` fails, and every PDF scan upload is refused with a 503
  (`beebox/src/core/scan/validate.ts:67-99`).
- `uvx docling` is missing, so scan-import document mode cannot run
  (`beebox/src/services/docling/core.ts:295`).
- `codex` is installed only as a transitive dependency
  (`/app/node_modules/.pnpm/node_modules/.bin/codex`) and is not on PATH.
  The server links it into `/usr/local/bin`
  (`beebox/deploy/hetzner/setup-server.sh:136`); the image does not. The
  in-container `codex login --device-auth` that the container-first item
  requires cannot run.
- `smoke-docker.sh` does not exercise any of these paths, so the harness
  passes.

Observed again 2026-09-29 running the image under Apple's `container`: the
server logs `qpdf is not installed; PDF scan uploads will be refused with
503` at startup, and `codex` is not found
([phase 0 note](../../research/installable-app/phase0-apple-container.md)).

## Why the fix is not only "add two packages"

There are at least four lists: the Dockerfile, `setup-server.sh`,
`deploy.sh`'s post-deploy check, and `pnpm run doctor`. The agent contract
in `beebox/src/core/agent-guide/chat.ts` names a fifth subset. Any packaged
app would add another
([installable-app research](../../research/installable-app/runtime-inventory.md)).
One machine-readable host-dependency manifest that each consumer reads would
stop the drift. Docling in the image also has a size cost: its model
pre-fetch and PyTorch environment are large, and pre-fetching them at build
time versus first use is a real choice.
