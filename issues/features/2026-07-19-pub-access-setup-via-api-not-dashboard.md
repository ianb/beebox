---
title: "cb pub setup's Access instructions are stale and dashboard-bound — provision via the API instead"
workstream: pub-setup-wrangler
area: callback-box
needs: [manual-testing]
design: ../../callback-box/docs/implemented-plans/pub-setup-wrangler.md
filed-by: agent
discovered-in: main session — boxholder ran the first live `cb pub setup` and got stuck on the manual Access step
priority: important
---

**2026-07-31 — BUILT (worktree-pub-setup-wrangler), pending live verification.**
The three forks were resolved with the boxholder and the rework is implemented
+ fake-tested per [pub-setup-wrangler](../../callback-box/docs/implemented-plans/pub-setup-wrangler.md)
(which also records the Codex security review that reshaped the credential
model — notably the content/ingestion R2 bucket split):

- Setup auth is `wrangler login` (OAuth); REST read-backs ride
  `wrangler auth token` through a refresh-on-401 bearer provider. No token, no
  `~/.cb-publish.env`. Env pair stays as an explicit escape hatch.
- Access is provisioned via the CF API (`cb pub setup --access`) under a
  SETUP-ONLY Access-edit token (hidden prompt / `CB_ACCESS_SETUP_TOKEN`,
  never argv, never stored; revoke-after printed as a completion step).
  Default login method: One-Time PIN; policy allow-everyone; the Worker's
  per-pub allowlist stays the authorization.
- The connector credential is an ingestion-bucket-scoped R2 token in
  `config/connectors/publish.secret.json` (per-box secret pattern) — and
  `cb pub setup --mint-connector-token` MINTS it via the account-token API
  (bootstrap token gains "Account API Tokens: Edit"), so there is no manual
  R2-dashboard token assembly (addendum in the design doc, 2026-07-31).
- Non-secret Access values persist in `config/publish.json` so reruns
  redeploy rather than erase them; `cb pub status` diffs deployed vars
  against that file.

**Manual testing needed (boxholder present — writes real auth policy):** run
`wrangler login` + `cb pub setup` live; then `--access` with a scoped token
against the real Zero Trust org; verify the plan's named live gaps (create
response `aud` placement, `/access/organizations` pre-onboarding behavior,
whether the OTP IdP is auto-provisioned, `wrangler whoami --json` shape, R2
object REST calls accepting the OAuth bearer, and the token-mint half —
permission-group names, bucket resource-key format, one-time `value` in the
create response); then an OTP login on a published `/a/` page confirming the
JWT email matches the allowlist.

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

## `wrangler login` (OAuth) — removes the manual token AND the dotfile, for setup

Confirmed (2026-07): **`wrangler login` authenticates through a browser OAuth
flow — "no API credentials needed."** Driving the provisioning half through
wrangler commands under that login (`wrangler r2 bucket create`, `wrangler
deploy`, `wrangler secret put`, preview-URLs via `wrangler.jsonc`) **eliminates
both friction points at once**: the hand-minted scoped API token (the manual
dashboard step) *and* `~/.cb-publish.env` (the dotfile). The only human action
becomes `wrangler login` → approve in the browser.

Two boundaries it does NOT cross:

- **Cloudflare Access is not in wrangler's surface** (wrangler is Workers / KV /
  D1 / R2 / secrets only). Account-tier Access still goes through the CF API, as
  proposed above — wrangler doesn't change that half.
- **The server-side submission-pull connector still needs a stored credential.**
  `wrangler login` is interactive and laptop-local; `publish-submissions.ts` runs
  headless on prod every `cb wakeup`. So wrangler-login fixes the one-time *setup*
  auth but not the *runtime* credential — that stays the secret-management
  question above.

Net target: **`cb pub setup` provisions via `wrangler login` (no token, no
dotfile); account-tier Access via the CF API (no dashboard); the runtime
submission connector draws its credential from the resolved
[per-box secret-management](../decisions/2026-03-15-per-box-secret-management.md)
decision.** That collapses the chaotic dashboard to, at most, one browser approve
for setup — and zero dashboard for `public`/`secret` tiers.

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

## Manual testing

Follow the concrete reproduction or verification steps above. Confirm the
observed result matches the expected behavior described in this issue before
clearing the manual-testing flag.
