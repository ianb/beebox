---
title: "Tailscale to expose and protect boxes — tooling, not another documented path"
area: callback-box
needs: [design]
filed-by: agent
discovered-in: main session — boxholder asked for it; worktree-tailscale-exposure spun up on Fable
---

Use Tailscale to both **expose** boxes (reach them from anywhere without opening
ports) and **protect** them (nothing on the public internet). Two environments:

- **Local dev boxes** — the shared router on `:3210` serving worktrees by path
  prefix.
- **The deployed instance** (`box.example.com`) — a real server several
  **family members** access.

The boxholder notes this is a typical setup for other users too, so it's a
general capability, not personal plumbing.

## The bar: tooling, not documentation

> I want something much tighter than just docs.

This is the whole point of the item. Tailscale is **already documented** — as a
first-class alternative in `callback-box/docs/plans/installation-story.md` and
as a variant in `callback-box/docs/docker-install.md` (keep loopback mapping,
join tailnet, zero open ports) — and has **never once been exercised**
([installation-remaining-work](2026-07-19-installation-remaining-work.md) item 2:
"documented in `docs/docker-install.md`, never exercised (needs a tailnet + auth
key)").

So "write a good guide" is the failure mode, not the deliverable. Another
untested prose path would leave this exactly where it already is. What's wanted
is **automation of everything automatable, and tooling that closes the gap on
what isn't** — the boxholder's own sketch:

> Or even have like `cb doctor tailscale` that checks status and gives better
> context aware instructions on next steps.

That's the shape: the tool inspects actual state and tells you the next concrete
step *from where you are*, rather than a linear document you match yourself
against.

## It augments auth; it does not replace it

> I don't expect it to replace auth, but rather to augment it.

Defense in depth, explicitly. **"On the tailnet" must never silently become
"authenticated as someone"** — and that matters most in the exact case driving
this, since several family members share the tailnet and identity between them
is the thing that would be lost. Relevant neighbours:

- [local password auth](../closed/features/2026-07-16-local-password-auth-default-on.md)
  (shipped) changed what `isAuthEnabled()` means.
- [per-box lock](2026-07-19-per-box-lock-native-auth.md) is a third axis again
  (may this client open *this* box).

Three separate questions — is the box reachable, is the client authenticated, may
it open this box — and Tailscale answers only the first.

## Groundwork that exists

- `bin/doctor.ts` (+ `bin/doctor.test.ts`) — monorepo preflight doctor, run as
  `pnpm run doctor`. Note `pnpm doctor` collides with pnpm's own builtin, a
  gotcha `docs/developer-install.md` has to warn about — a real argument for a
  `cb`-side entry point.
- `callback-box/src/cli/commands/health.ts` — `cb health` for a running box
  (`docs/health-checks.md`). Decide where a Tailscale check belongs rather than
  adding a third diagnostic surface by default.
- Docker compose already defaults to `127.0.0.1:3210:3210`, with public access
  only via an explicit Caddy profile or Tailscale — the architecture already
  assumes this shape.
- **OpenClaw is the prior art**: explicit auth modes including a `tailscale` one
  alongside none/token/password/device-token/trusted-proxy, failing closed when
  none is configured (`research/openclaw-hermes/compare-security.md:101`; also
  `deep-installation.md`). Any review written gets adopt/adapt/reject
  dispositions per `research/CLAUDE.md`.

## Constraints carried in from today's lessons

- **Don't transcribe a vendor's dashboard.** `cb pub setup` printed a manual
  Cloudflare console walkthrough; Cloudflare reorganized and it became a dead end
  that cost real time — see
  [pub Access setup via API](2026-07-19-pub-access-setup-via-api-not-dashboard.md).
  Prefer Tailscale's CLI/API; where a human step is unavoidable, detect state and
  say what's next, and link the vendor's own doc rather than re-describing their
  UI.
- **Auth keys are secrets — don't invent a fourth storage pattern.** Publishing
  already added a divergent one (`~/.cb-publish.env`) that fits neither
  `config/connectors/*.secret.json` nor anything else, and left its connector
  with no credential path on the server. Join
  [per-box secret management](../decisions/2026-03-15-per-box-secret-management.md)
  rather than adding to the pile.
- Fail-closed by default; a machine that isn't on the tailnet should be
  unreachable, not quietly public.

Work is running in `worktree-tailscale-exposure` (Fable), briefed to survey
first and propose before building, with a Codex cross-review of the design
before implementation.
