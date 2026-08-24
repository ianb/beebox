---
title: "The browse key can't reach `/dev/`, so an agent can't verify the surface built for agents"
workstream: dev-surface-access
area: router
labels: [router, auth, dev-surface, agent-tooling]
resolution: implemented
filed-by: agent
discovered-by: Ian
discovered-in: main session — two issues could not be settled because /dev/ 401s the browse key
---

> Boxholder: *"There's no reason you shouldn't access /dev/ …?"*

Measured against the running router:

```
/main/test1/     -> 200   (browse key works)
/main/dev/       -> 401
/main/dev/docs/  -> 401
```

`router-auth.ts:240-255` classifies `/dev` and `/<w>/dev/...` as `control-read`
— owner session only, the same tier as the worktree index and `/__router/*`.
The browse key authenticates box routes and nothing else.

## Why that ordering looks wrong

`/dev/` is the **agent-facing** surface. It serves the tracked `dev/` directory,
the markdown doc browser over every `.md` in the worktree, and dev pages built
for exactly this kind of inspection. Meanwhile a *box* route — real user content,
real chat history — is reachable with the browse key. So the credential opens the
sensitive surface and closes the working one.

It is also read-only by construction (`dev` serves from disk; the router even
notes "the worktree's dev browser (owner, read-only)"), which makes it a
strange thing to guard more tightly than a box.

## The cost is concrete

Two `reconfirm` issues could not be settled today for this reason alone, both
of which are *about* `/dev/` and both of which are one browser action to check:

- [Doc browser's Cmd-P quick-open is dead under the sandbox CSP](../bugs/2026-08-19-dev-docs-quickopen-dead-under-sandbox-csp.md)
- [Images in rendered /dev markdown are broken](../bugs/2026-08-19-dev-md-images-broken-opaque-origin.md)

The code side of both is verifiable and verified: the sandbox CSP was removed
2026-08-19 and the running router restarted 2026-08-24 06:39, well after. What
remains is "load the page and look", which is precisely what `bin/browse`
exists for and precisely what the gate refuses. So both sit in the boxholder's
manual-testing queue for want of a page load an agent could do.

That is the general shape: **issues about the dev surface become
boxholder-only by construction**, and the dev surface is where agent-authored
documentation and tooling lives.

## What to decide

- **Should the browse key grant `/dev/` read?** It is read-only, it is the
  agent's own surface, and the key already grants strictly more sensitive box
  routes. If the answer is yes this is a one-line reclassification.
- **If not, why not** — write the reason down where the table lives
  (`.claude/skills/browse/SKILL.md` documents the current split), because the
  asymmetry reads as an oversight rather than a decision, and it was treated as
  one today.
- **Keep `/__router/*` and the worktree index owner-only regardless.** Those are
  control surfaces with real verbs; `/dev/` is not, and lumping them together is
  what produced this.

Worth noting the trust argument already made for this surface: the sandbox CSP
was removed on the reasoning that "the dev agent authors the router's own code,
so sandboxing its HTML output guards nothing" (`bin/router-docs.ts:826`). The
same reasoning applies to reading it.


## Resolved (2026-08-24) — the `dev-read` route class

Split out of `control-read` in `bin/router-auth.ts`: `GET`/`HEAD` on
`/<w>/dev/...`, on the bare `/dev` redirect, and on `/workstreams/...` are now
`dev-read`, authorized as **owner session OR browse key**. The browse key
arrives via its own injected dep (`hasBrowseKey`), not `resolveWorktreeAsset` —
the dev surfaces deliberately do not inherit that resolver's wider set of
per-box mobile tokens and agent bearers.

The boxholder chose the wider of the two scopes on offer. `/dev/` alone was not
worth much: the doc browser those two reconfirm issues were about had already
been retired into `/workstreams/browse` (commit `46b03219`), so a `/dev/`-only
grant would have handed an agent a 301 into a surface it still could not read.

What did **not** move, and why: `/` (the worktree index), `/__router/*` — both
the mutating verbs and `/__router/status` — and every non-`GET` `/workstreams/*`
verb, which stay `control` (owner session AND a CSRF-safe origin). Those carry
real control verbs. Non-read methods on `/dev/` also stay owner-only; `serveDev`
has no write path, so keeping them out grants nothing.

Verified against an isolated router (`CALLBACK_STATE_DIR` + `ROUTER_PORT`):
`/main/dev/` and `/main/dev/skills.html` went 401 → 200 with the browse-key
cookie, `/dev/` → 301, `/workstreams/` → 503 (the gate allowed it; that
instance's workstreams app could not bind the fixed exhibits port 3230 already
held by the live router), while `/` and `/__router/status` stayed 401.

The path/credential table in `.claude/skills/browse/SKILL.md` is updated to
match.
