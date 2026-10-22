---
title: "Take the public site live on beebox.run"
workstream: public-site
area: docs
filed-by: agent
discovered-in: worktree-github-pages-site — building the site while the repo was private
labels: [soft-launch]
priority: important
---

The front-door site (principles:
[public-site](../features/2026-07-20-public-site.md); plan:
[plan doc](../../beebox/docs/plans/public-site.md)) builds and deploys through
Cloudflare Pages' Git integration. Cloudflare builds each `main` push; the
checks-only GitHub workflow is not the deploy mechanism.

For go-live, configure the public stack in this order:

- In Cloudflare Pages, connect `ianb/beebox` to a new Git-integrated project
  named `beebox`, with production branch `main`, root directory `/`, build
  command `pnpm install --frozen-lockfile && pnpm --dir site build --base /`,
  and build output directory `site/dist`.
- Configure `beebox.run` as that project's custom domain. Do not use a Direct
  Upload project or store Cloudflare deploy credentials in GitHub.
- Ensure DNS for `beebox.run` points at Cloudflare Pages and the certificate is
  valid before exposing links.
- Confirm Cloudflare's first green production build and the site at
  `https://beebox.run`, including internal links and that `llms.txt` + the `.md`
  twins are reachable.
- Link the site from the README once it's live.

Not before the boxholder's own words are on the page — the plan's marked
placeholder must be gone before anyone is pointed at it.
