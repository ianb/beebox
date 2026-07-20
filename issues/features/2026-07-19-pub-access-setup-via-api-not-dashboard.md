---
title: "cb pub setup's Access instructions are stale and dashboard-bound — provision via the API instead"
area: callback-box
needs: [design]
design: ../../callback-box/docs/plans/publish-pages.md
filed-by: agent
discovered-in: main session — boxholder ran the first live `cb pub setup` and got stuck on the manual Access step
---

`cb pub setup` provisions the R2 bucket and deploys the Worker fine (verified live
2026-07-19, first real run). But the account-tier half — Cloudflare Access — is
left as **printed manual instructions** pointing at dashboard pages, and those
instructions are already wrong. The boxholder lost real time to it.

## What it prints today

From `accessSetupInstructions` (`callback-box/src/publish/setup.ts`):

```
1. Zero Trust dashboard → Settings → Authentication → add Google as a login method.
2. Access → Applications → Add application (Self-hosted): ...
3. Copy the team domain and the application's Audience (aud) tag ...
4. Re-run: cb pub setup --access-team-domain ... --access-aud ...
```

## What actually happened

- **"Settings → Authentication" does not exist.** Cloudflare reorganized the Zero
  Trust dashboard into "Cloudflare One" — the left nav is now Overview / Insights
  & Logs / Team & Resources / Networks / **Access controls** / Traffic policies /
  Cloud & SaaS findings / … / Integrations / Settings. Applications live under
  **Access controls**, not a top-level "Access".
- Searching the dashboard for "integrations" surfaces only **Cloud & SaaS
  findings → Integrations**, which is CASB (SaaS posture scanning) — an unrelated
  product whose cards are all tagged CASB. It's an easy and total dead end.
- Constructed URLs like `/one/integrations/identity` **404**.
- Step 1 may be unnecessary entirely: Cloudflare now **auto-adds a Cloudflare
  identity provider** to a new Zero Trust org, and Access can use *Cloudflare* as
  the login method — no Google Cloud project, no OAuth consent screen. The
  instructions hard-assume Google.

Net: four steps, of which step 1 is wrong-and-maybe-unnecessary and step 2's path
is wrong. A user with no Cloudflare fluency cannot recover from this without
outside help.

## The tension

Printed dashboard walkthroughs for a third-party console are **inherently
rotting documentation**. Cloudflare renames and reorganizes this area often; we
have no way to notice when our string goes stale, and the failure mode is a user
wandering an unfamiliar admin UI. Every other piece of provisioning this feature
does (bucket create, Worker deploy, previews-disabled, read-back verification)
goes through the API behind an injectable client and is unit-tested. The Access
step is the one place we punt to prose.

**Proposal: provision Access through the API too**, so `cb pub setup` creates the
application itself and reads back the `aud` rather than asking a human to copy it.

- `POST /accounts/<id>/access/apps` with `type: self_hosted` and
  `domain: <worker-host>/a` returns the app including its **`aud`** tag — exactly
  the value the current step 3 asks the human to find and paste.
- The policy is a follow-up call on `.../access/apps/<id>/policies`.
- The team domain is readable from the account (it's shown in the dashboard's
  Account details; there is a corresponding Access organization endpoint).
- This composes with the existing design: extend
  `CloudflareProvisioningClient` (`src/services/cloudflare-provisioning.ts`) with
  the Access endpoints, fake for tests, same as the R2/Worker calls.

## Design questions

- **Token scope — the real cost.** The publish token is Workers Scripts:Edit +
  R2:Edit. Access provisioning additionally needs **Access: Apps and Policies:
  Edit** (and possibly Organizations/IdP read). Widening the one token makes a
  box compromise even more powerful, which sharpens the *already-open* security
  decision in
  [publish-pages-resume](2026-07-19-publish-pages-resume.md) about a
  least-privilege R2 token for the connector. Options: widen the single token;
  require a separate setup-only token used once and not stored; or keep Access
  manual precisely to avoid holding a token that can rewrite auth policy.
  **This is the fork that decides the whole item** — it may be that "manual, but
  with correct instructions" is the right answer for a credential-hygiene reason,
  not a laziness reason.
- **Which login method to default to.** Cloudflare-as-IdP removes the entire
  Google Cloud OAuth-client detour. Does the Worker's per-publication email
  allowlist match on the email a Cloudflare-IdP JWT carries? If yes, prefer it
  and mention Google only as an alternative.
- **Idempotency/drift**, matching the rest of setup: re-running should find an
  existing app rather than creating duplicates, and `cb pub status` should report
  Access config drift the way it reports Worker drift.

## Related: `~/.cb-publish.env` doesn't fit our secret management

Publishing's credentials are a **machine-level dotfile the user must remember to
source** (`set -a; . ~/.cb-publish.env; set +a`) before running anything;
`src/publish/setup.ts:59` and `src/services/publish-remote-store.ts:114` just
read `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` out of the environment.

That's a third pattern, matching neither of the two we already have:

- Per-box connector secrets live in **`config/connectors/*.secret.json`**
  (gitignored via the box scaffold, `src/core/box/index.ts:154`).
- The open decision [per-box secret management](../decisions/2026-03-15-per-box-secret-management.md)
  is already about how boxes get provisioned with API keys — publishing quietly
  added a fourth answer instead of joining that conversation.

Concrete problems, not just inconsistency:

1. **The connector can't work on the server.** `publish-submissions.ts` runs on
   every `cb wakeup`, including prod. A file at `~/.cb-publish.env` on the
   boxholder's laptop does not exist on the server, and (per the known
   prod-diagnostics gotcha) an ad-hoc `cb` invocation there doesn't inherit the
   services' environment anyway. So submission pulling is either silently
   broken in prod or needs a separate, undocumented credential path.
2. **No tooling knows about it.** `cb health` / `cb status` can't report "this
   box can't publish because it has no Cloudflare credential" the way they could
   for a `*.secret.json`. A forgotten `set -a` looks like a bug, not a config gap.
3. **It's account-wide, not per-box** — which may actually be correct (one CF
   account, one Worker), but that's a decision to make explicitly rather than
   inherit from "env vars were easiest."

Worth resolving **together with** the token-scope question above, since both are
"what credential does publishing hold, where does it live, and who can use it."

## Cheap immediate fix, regardless of the above

Even if API provisioning is rejected, **the printed string is wrong today** and
should be corrected: point at **Access controls → Applications**, drop or
demote the Google-IdP step in favor of the auto-added Cloudflare IdP, and stop
naming a nav path we can't keep current — link Cloudflare's own doc instead, so
the rot is on their side of the line:
<https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/>

Also worth stating in the output what the boxholder had to be told twice: **this
whole step is optional** — `public` and `secret` tier publications work without
any Access setup. The current output says account tiers "fail closed" but doesn't
make it obvious you can just proceed without them.
