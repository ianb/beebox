---
title: "Docker: `bbx engine init` fails with EXDEV renaming the installed package's box-docs"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-box-host-packages — running beebox/docker/smoke-docker.sh
---

`beebox/docker/smoke-docker.sh` fails at step 2. In the built image,
`bbx engine init /data/box` stops with:

```
Error: EXDEV: cross-device link not permitted, rename
'/app/node_modules/.pnpm/beebox@file+beebox.tgz_…/node_modules/beebox/box-docs'
-> '…/node_modules/beebox/.box-docs-old-EfJ0G7'
```

`swapIn` in `beebox/src/core/docs-gen/package-docs.ts` replaces the package's
`box-docs/` by renaming the old directory aside. On overlayfs, a directory
that lives in a lower image layer cannot be renamed (the kernel returns EXDEV
unless `redirect_dir` is on). The engine tarball installs `box-docs/` in an
image layer, so every container's first docs refresh hits this.

The same error broke the image build when a locally generated
`beebox/box-docs/` entered the build context. That part is fixed by
excluding `beebox/box-docs` in `.dockerignore` (workstream box-host-packages).

Every image layer is a lower layer to a running container, so the fix
belongs in `swapIn`: on EXDEV, replace the directory's contents instead of
renaming the directory. Then re-run `smoke-docker.sh`.
