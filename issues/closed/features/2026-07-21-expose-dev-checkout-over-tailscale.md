---
title: "Expose a dev checkout (main) over Tailscale without running a second server"
workstream: tailscale-exposure
area: bin + callback-box
needs: [decision, design]
filed-by: agent
discovered-in: worktree-tailscale-exposure — boxholder testing cb tailscale on the dev machine
resolution: implemented
---

**Closed 2026-07-21** — implemented via Option 1 below, which became the
`expose-dev-router` plan
(`callback-box/docs/implemented-plans/expose-dev-router.md`): the shared
router is now a fail-closed authenticating reverse proxy (Track B,
`bin/router-auth.ts`/`bin/router-auth-deps.ts`, wired into `bin/router.ts`),
the login-prefix bug is fixed (Track A, closes
[dev-router-login-page-broken](../bugs/2026-07-20-dev-router-login-page-broken.md)),
and `cb tailscale setup --target <routerPort>` now exposes the whole
authenticated router (Track C), refusing to expose an ungated one. Verified by
the full test suite plus four adversarial Codex reviews (final verdict GO for
a private tailnet) and browser/curl/WebSocket acceptance checks on an isolated
router. **Not yet done:** a live exposure against the real `tailscaled`
(including pairing the iOS app over the tailnet) — that's the boxholder's
acceptance test, still outstanding.

The `cb tailscale` tooling works (verified live: `cb tailscale status --target
3399` against a real tailnet correctly classified a standalone `cb serve` and
landed on `serve-unconfigured`). But there's no clean way to expose the box the
boxholder actually develops — **main, as served by `pnpm dev`** — over the
tailnet. The boxholder's framing: "I really only want to expose main, but
running two servers seems problematic. Because I also want to develop main this
way."

## Why the obvious answers fail

- **Expose the shared dev router (`:3210`).** Refused by design, and correctly:
  the router has unauthenticated `/__router/*` control routes and fronts *every*
  worktree, so exposing it both leaks a control plane and over-exposes (the
  boxholder wants main only). `cb tailscale setup --target 3210` refuses with
  exactly this message.
- **Expose the running per-worktree hub behind the router.** Its port is
  dynamically allocated per worktree start and idle-stops after 5 min — no
  stable target.
- **Run a standalone `cb serve` alongside the router and expose that.** Works
  (`cb serve --port 3300 <main-box>` → `cb tailscale setup --target 3300`), but
  it's a *second* server for the same checkout, and — the crux — it's a
  **different dev experience**: `cb serve --dev` only hot-restarts the backend
  (`node --watch`, `src/cli/commands/serve.ts`), serving the *built* frontend
  bundle. The shared router is the only path with Vite frontend HMR. So "develop
  main this way" and "expose main" pull toward two different servers.

So today: full-HMR dev (router, unexposable) XOR exposable single-port serve (no
frontend HMR). No single server is both.

## Entanglement with the login-prefix bug

Exposing main *through* the router at a path prefix (`tailscale serve
--set-path=/main/ → :3210`) hits the same root cause as
[dev-router-login-page-broken](../bugs/2026-07-20-dev-router-login-page-broken.md):
the frontend's root-absolute asset paths and `/auth/login` redirect break behind
a `/<prefix>/`. Whatever makes the router prefix-safe unblocks both. These two
should likely be solved together.

## Options (each with a real cost — decide, don't assume)

1. **Make the dev router safely exposable for one checkout.** (a) Router refuses
   `/__router/*` (and cross-worktree paths) when the request arrived via
   Tailscale Serve — detectable via the `Tailscale-User-Login` header Serve
   injects and strips from client input, so it's trustworthy; (b) scope the
   serve mapping to just `/main/`; (c) fix prefix-absolute assets/redirects (the
   login bug). Yields one server, full HMR, main-only exposure — but reverses
   "never expose the router" and needs the prefix fix first. Highest leverage,
   most work.
2. **Give the single-port `cb serve` real frontend HMR** (Vite middleware mode
   on one stable port), so `cb serve --dev` becomes a full dev server that's also
   exposable. One server, full dev, no router involved for main. Architectural
   change to dev serving; main stops using the shared `/main/` router slot.
3. **Accept two servers, make the split cheap.** Keep developing main via the
   router; run a throwaway `cb serve` only when you want the phone to reach it.
   No code, but it's the status quo the boxholder already flagged as
   unsatisfying, and the exposed copy lags the HMR one.

## Lean

Option 1, folded together with the login-prefix bug, looks like the highest
leverage: it fixes a known bug and delivers main-only tailnet exposure from the
one server you already run. But it commits to making the router prefix-safe and
to a carefully-scoped control-plane lockdown — a real design step, hence
`needs: [decision, design]`, not a quick fix.

## Not blocking today

For reaching main from the phone *right now*: `cb serve --port <p> <main-box>`
(plain, for viewing) or `cb serve --dev --port <p> <main-box>` (backend
auto-reload, built frontend), then `cb tailscale setup --target <p>`. That's the
two-server path the boxholder wants to avoid long-term, but it works.
