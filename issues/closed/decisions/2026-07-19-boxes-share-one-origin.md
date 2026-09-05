---
title: "Boxes are path siblings on one origin, so per-box isolation isn't enforceable in the browser"
workstream: mobile-token-handshake
area: beebox
filed-by: agent
discovered-in: worktree-mobile-token-handshake — cross-model review of the bbx_mobile cookie design
resolution: wontfix
---

> **Resolved 2026-08-06 — option 3 (accept + say so), boxholder call.** Per-box
> browser isolation (options 1/2) is a NON-GOAL, not a gap: a beebox instance
> is single-operator — every box on an origin belongs to one operator running content
> they/their agents authored, and no operator co-hosts a *different* operator's boxes
> on the same origin (e.g. all of one person's boxes live on their own domain). The
> server side still prevents cross-box AUTH forgery; the accepted residual is
> same-origin ambient access between one operator's own boxes. Documented honestly in
> `src/webapp/auth.ts` (the trust-model comment) and `docs/content-security-policy.md`
> (new "Cross-box isolation: single-operator by design" section). Revisit only if
> boxes ever render third-party views or are shared between people.

`src/webapp/auth.ts:276` states the trust model plainly: *"the session-cookie secret is
symmetric (HMAC), so any box that can VERIFY a cookie could also FORGE one for a sibling
box. Under the plan's trust model (hub trusted, boxes mutually untrusting) that is
unacceptable."* The server side honors that — per-box secrets, `CHILD_ENV_ALLOWLIST`
withholding `BBX_SESSION_SECRET` from boxes (`src/hub/CLAUDE.md`).

The browser side does not, and cannot as currently laid out. Boxes are served as path
prefixes on ONE origin (`/<slug>/...`), so everything the same-origin policy protects is
shared between them:

- A script running under box A can `fetch("/boxB/api/...")` or open
  `new WebSocket("/boxB/api/trpc")`, and box B's credentials ride automatically. It can read
  the responses, too.
- This is not hypothetical content: `docs/content-security-policy.md` notes *"box views and
  figures run as same-origin compiled ES modules"*, and the CSP is **Report-Only** — it
  reports, blocks nothing.
- Cookie `Path` scoping doesn't help. It bounds which cookie the browser *offers*, not which
  requests a script may *make*. `bbx_session` isn't path-scoped at all.

The mobile-token work (`docs/implemented-plans/mobile-token-handshake.md`) ran into this and deliberately
did not try to fix it — a per-box signing secret means a shadowing or stolen cookie can't
*authenticate* as another box, which closes escalation but not ambient same-origin access. It
did fix the narrow cross-box DoS this enables (duplicate-cookie shadowing; see
`src/lib/cookies.ts` `parseCookieHeaderAll`).

The decision is whether the stated trust model is real or aspirational:

1. **Per-box origins** — `<slug>.box.example.com`, or per-box ports in dev. Real isolation,
   but touches the router, the hub, OAuth redirect URIs, `BBX_PUBLIC_URL`, and every
   path-prefix assumption in the frontend. Large.
2. **Sandbox untrusted box content** — keep one origin, but run views/figures in a
   `sandbox`ed iframe on a null origin (the frozen-capture route already does something like
   this per `docs/content-security-policy.md`). Smaller, and only helps for the content that
   gets sandboxed.
3. **Accept it, and say so** — write down that boxes on one origin are mutually trusting in
   the browser, and stop claiming otherwise in `auth.ts`. Cheapest, and honest.

Worth noting the practical risk today is low: a boxholder's own boxes, running content they
or their agents authored. It matters if boxes are ever shared between people, or if a box
renders third-party-authored views.
