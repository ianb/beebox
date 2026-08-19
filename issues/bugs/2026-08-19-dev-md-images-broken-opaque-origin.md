---
title: "Images in rendered /dev markdown are broken: sandboxed pages make cookieless subrequests"
workstream: unattached
area: router
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workstream-story — relative-path SVGs in a dev/ .md page all rendered broken
---
Every `/dev/` response carries `Content-Security-Policy: sandbox` (no
`allow-same-origin`), so a rendered `.md` page has an **opaque origin**. Its
subresource requests — `<img src="foo/bar.svg">` — are therefore cross-site and
the browser does not attach the session cookie. The router's always-on auth
gate 401s them, and every image in every rendered dev markdown page shows as
broken. Loading the same image URL directly works (top-level navigation carries
the cookie), which makes the failure look mysterious.

Reproduce: any `dev/*.md` with a relative image, viewed at
`/<worktree>/dev/<file>.md` while logged in.

Compounding it: Markdoc does not parse `data:` URLs in image syntax (verified —
`![a](data:image/svg+xml;base64,…)` renders as literal text), so images cannot
be inlined in markdown as a workaround. The only current workaround is shipping
a page as `.html` with SVGs inlined as literal markup (done for
`dev/workstream-story.html`, 2026-08-19).

Same root as
[quick-open dead under the sandbox CSP](2026-08-19-dev-docs-quickopen-dead-under-sandbox-csp.md)
— the B.2c hardening's bare `sandbox` — but a different mechanism (cookieless
subrequests vs blocked scripts) and a different fix space. Directions:

1. Serve `/dev/` static artifacts (images at least) without the auth gate —
   they are tracked repo files, but the repo is source-available anyway; the
   gate protects liveness/actions, not these bytes. Scope carefully: only
   safe if limited to non-HTML content types.
2. Have the markdown renderer inline small local images itself (read the file,
   emit a `data:` URI in the HTML — the renderer emits HTML, so Markdoc's
   parser limitation doesn't apply).
3. `allow-same-origin` is NOT an option on its own terms (it would re-enable
   the CSRF vector the sandbox exists to close).
