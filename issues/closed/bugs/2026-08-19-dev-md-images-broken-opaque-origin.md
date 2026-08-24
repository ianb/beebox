---
title: "Images in rendered /dev markdown are broken: sandboxed pages make cookieless subrequests"
workstream: workstream-story
area: router
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workstream-story — relative-path SVGs in a dev/ .md page all rendered broken
next-action: reconfirm
resolution: implemented
---
> **⏳ Awaiting manual testing** — fix landed in `worktree-workstream-story`
> (the `/dev/` sandbox CSP is removed); after merge + router restart, open a
> dev `.md` with relative images and confirm they render. Only the developer
> clears this.

Every `/dev/` response carried `Content-Security-Policy: sandbox` (no
`allow-same-origin`), so a rendered `.md` page had an **opaque origin**. Its
subresource requests — `<img src="foo/bar.svg">` — were therefore cross-site
and the browser did not attach the session cookie. The router's always-on auth
gate 401'd them, and every image in every rendered dev markdown page showed as
broken. Loading the same image URL directly worked (top-level navigation
carries the cookie), which made the failure look mysterious.

**Resolution (2026-08-19, boxholder decision): the sandbox CSP is removed
outright** — normal HTML and markdown in `dev/` should just work, no
workarounds. The threat the sandbox addressed (agent-authored pages scripting
same-origin requests at router control routes) is already an accepted residual
for this router: every worktree frontend is agent-authored JS running
unsandboxed on the same origin (workstreams plan, "same-origin worktree
frontends" acceptance, 2026-08-09), and the router is only exposed on
localhost or the owner's tailnet. Mutating router routes remain POST-only and
CSRF-classified. The decision comment lives in `bin/router-docs.ts` `serveDev`;
`bin/router-docs.test.ts` pins the header's absence.

Two rejected fixes, for the record: exempting image routes from auth (weakens
the every-TCP-request-authenticates invariant), and render-time inlining of
images as `data:` URIs (implemented, then reverted — the boxholder wants
normal markdown to work, not a rewrite pass).

This also resolves
[quick-open dead under the sandbox CSP](../../bugs/2026-08-19-dev-docs-quickopen-dead-under-sandbox-csp.md)
— same root cause, scripts instead of images.

## Manual testing

> Verified by boxholder 2026-08-24

After this lands on main and the router is restarted (`pnpm dev`): open any
dev markdown page with a relative image — e.g.
`/main/dev/workstream-story.md` — and confirm the diagrams render instead of
broken-image icons. While there, Cmd-P in `/main/dev/docs/` should open the
quick-open palette again (the sibling issue).

