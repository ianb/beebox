---
title: "Take the Pages site live once the repo is public"
area: docs
filed-by: agent
discovered-in: worktree-github-pages-site — building the site while the repo is still private
labels: [soft-launch]
---

The front-door site (principles:
[github-pages-site](../features/2026-07-20-github-pages-site.md); plan:
[plan doc](../../callback-box/docs/plans/github-pages-site.md)) builds and
deploys via a GitHub Actions workflow whose **deploy job is gated on the repo
being public** (`if: !github.event.repository.private` — an ungated deploy
fails 404 and emails the owner on every push to main, observed 2026-07-21).
The build job runs on every main push regardless, as free CI for the site.
Until the repo goes public the dev-router route is the only live view; at
go-public the deploy job un-gates by itself, but still fails until the
settings flip below is done.

When the repo goes public (or at soft launch), the go-live steps:

- Repo Settings → Pages → source = **GitHub Actions** (one-time manual flip,
  or via `gh api`).
- Confirm the first green run of `.github/workflows/pages.yml` and the site
  at `ianb.github.io/callback-box` — check internal links under the
  `/callback-box/` base path and that `llms.txt` + the `.md` twins are
  reachable.
- If a custom domain has been chosen by then (open question in the plan):
  the `CNAME` file must be *inside the build artifact* (Actions deploys
  ignore a repo-level CNAME), and the build's `--base` changes to `/`.
- Link the site from the README once it's live.

Not before the boxholder's own words are on the page — the plan's marked
placeholder must be gone before anyone is pointed at it.
