---
title: "Serve scripted /dev/ apps from a separate origin (proper isolation)"
workstream: github-pages-site
needs: [design]
area: router
filed-by: agent
discovered-in: worktree-github-pages-site — Codex review of the dev sandbox-exemption
labels: [security]
next-action: invalid
---

The dev router serves `/dev/` HTML with a bare `sandbox` CSP because it shares
an authenticated origin with the mutating `/__router/{stop,retry}` control
routes and every box API (`bin/router-docs.ts` `serveDev`). A trusted
first-party interactive app (currently only story-eval) opts out via
`dev/tools.json` `scripted`, receiving `sandbox allow-scripts
allow-same-origin` for files physically inside its directory.

**That exemption is a real, accepted reduction, not full isolation.** A
Codex review (2026-07-24) put it plainly: `allow-same-origin allow-scripts`
grants the page the *entire* owner-authenticated origin. Story-eval JS can
`fetch("/__router/stop/main", {method:"POST"})`, reach other worktrees' box
APIs, and read origin-wide storage. **URL path prefixes are not a security
boundary** — a CSP path allowlist cannot confine same-origin JavaScript. The
implementation was hardened so the grant can't be *stolen* by encoded
traversal or symlinks (keyed on the realpath'd on-disk location) and the
`scripted` list is validated to safe single segments — but the grant it
correctly applies is still origin-wide.

The proper fix (Codex's top recommendation): **serve scripted apps from a
distinct origin** from the control routes and box APIs — a separate
port/hostname — exposing only the narrow operation they need (story-eval's
autosave `POST …/save`) through a scoped, CORS-controlled endpoint. Then a
compromised or malicious scripted page can script itself but cannot reach the
router's authority.

Not urgent at current scale (single trusted operator; `scripted` requires
repo write, already full trust). File so the architectural limitation is on
record rather than buried in a code comment, and revisit if more scripted
apps appear or the exposure surface widens. Design surface: a second
listener bound in `bin/router.ts`, an origin dedicated to `/dev/` scripted
content, and moving the story-eval save route behind it.
