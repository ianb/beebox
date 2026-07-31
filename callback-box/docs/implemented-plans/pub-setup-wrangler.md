# Plan: `cb pub setup` via wrangler login + Access via the CF API

**Status:** implemented 2026-07 — all three forks approved as recommended;
fake-tested; live verification pending (see the gaps section and the driving
issue's manual-testing checklist). Extends `publish-pages.md` Track E; driven
by [pub Access setup via API](../../../issues/features/2026-07-19-pub-access-setup-via-api-not-dashboard.md).

## Goal

`cb pub setup` configures publishing from the CLI with no Cloudflare dashboard
walkthroughs. The only browser step is `wrangler login` (OAuth approve), plus —
for the optional account tiers — one token mint. It kills both
`~/.cb-publish.env` and the hand-minted Workers+R2 API token for setup, and
replaces the stale printed Access instructions with API provisioning.

## Research findings that shape the design (2026-07-31)

1. **`wrangler login` stores a refresh token** (`~/.config/.wrangler/config/`)
   that keeps working for later non-interactive invocations. Default scopes
   cover `wrangler deploy`, `wrangler r2 bucket create`, `wrangler secret put`,
   and `wrangler whoami` (account ID). Multi-account ambiguity is suppressed by
   pinning `CLOUDFLARE_ACCOUNT_ID` or `account_id` in `wrangler.jsonc`.
2. **`wrangler auth token`** (Dec 2025) hands out the active credential — the
   OAuth access token, auto-refreshed — explicitly "for use with other tools."
   So our typed REST client can keep doing precise read-backs (R2 bucket probe,
   script settings, subdomain state) with `Bearer <oauth token>`, no API token.
3. **Wrangler's OAuth scope list has no Access scope.** Zero Trust Access
   endpoints (`/accounts/<id>/access/...`) cannot ride the wrangler login.
   Access provisioning needs a real API token with `Access: Apps and Policies:
   Edit` + `Access: Organizations, Identity Providers, and Groups: Edit`.
4. **`workers_dev` and `preview_urls` are config-keys in `wrangler.jsonc`**
   (preview_urls defaults to match workers_dev since 2025-10). We set both
   explicitly in the committed config; the REST read-back stays as the
   fail-closed verification (trust the observed state, not the write).
5. **Access API shape** (all faked for tests):
   - `POST /accounts/{id}/access/apps` `{type: "self_hosted", name, domain:
     "<host>/a", session_duration, allowed_idps?}` → result carries `id` + `aud`.
   - `POST /accounts/{id}/access/apps/{app_id}/policies` `{name, decision:
     "allow", precedence: 1, include: [{everyone: {}}]}` — the Worker enforces
     each publication's own email allowlist, so the Access policy is just
     "any authenticated identity."
   - `GET /accounts/{id}/access/organizations` → `auth_domain`
     (`<team>.cloudflareaccess.com`) — the team domain we currently ask the
     human to paste.
   - `GET /accounts/{id}/access/apps?domain=<d>&exact=true` — idempotent find.
   - `GET/POST /accounts/{id}/access/identity_providers` — find or create the
     One-Time PIN IdP (`type: "onetimepin"`).
6. **Login method: One-Time PIN.** The Access JWT's `email` claim is the
   address the PIN was mailed to; `pub-worker/src/access.ts` hard-requires a
   non-empty `email` claim (service tokens and email-less IdPs fail closed with
   401). OTP needs no Cloudflare account from visitors — lowest friction for
   "share with a few named people." The Cloudflare IdP requires visitors to
   hold Cloudflare accounts; Google requires a Google Cloud OAuth detour. Both
   demoted to "works if you add it yourself" (any IdP that yields a verified
   `email` claim matches the Worker's allowlist).

## Credential model (fork resolutions — NEED BOXHOLDER APPROVAL)

Three consumers, three answers, no stored broad token anywhere:

| Consumer | Where it runs | Credential |
|---|---|---|
| `cb pub setup` provisioning (bucket, deploy, secrets, read-backs) | laptop, interactive | wrangler OAuth login (stored by wrangler, refresh-token backed) |
| `cb pub setup` Access half (optional, account tiers only) | laptop, interactive | **setup-only** API token (Access edit scopes), prompted, used, NOT stored |
| `cb pub go` / `revoke` (R2 object writes) | laptop, interactive | wrangler OAuth via `wrangler auth token` → Bearer for the R2 REST calls |
| `publish-submissions` connector (R2 read/delete) | prod, headless, every wakeup | **R2-only, ingestion-bucket-scoped** API token in the per-box connector-secret pattern (`config/connectors/publish.secret.json`) — see amendment 1 (bucket split) |

- **Fork 1 (runtime credential):** the connector joins the existing per-box
  `config/connectors/*.secret.json` pattern — the same place every other
  connector secret lives — holding `{accountId, bucket, apiToken}` where the
  token is scoped to `Workers R2 Storage: Edit` only. This resolves the
  "fourth pattern" complaint by folding publishing into pattern #1 and also
  delivers the least-privilege R2-only connector token the provisioning-client
  header already calls for. `~/.cb-publish.env` is retired entirely.
  Env vars (`CLOUDFLARE_API_TOKEN` etc.) remain honored as an override for the
  laptop CLI (wrangler's own documented precedence).
- **Fork 2 (Access token scope):** a compromise-of-box can never rewrite auth
  policy, because no stored credential has Access scopes. The Access-edit
  token exists only in the interactive setup session (`--access-token` flag or
  prompt), and setup prints a reminder to delete it after the run. Widening a
  stored token is rejected; keeping Access fully manual is rejected because the
  research confirms the API path and the manual path is the documented-rotting
  one.
- **Fork 3 (IdP):** One-Time PIN, policy `include: [{everyone: {}}]`, real
  authorization stays in the Worker's per-publication allowlist (defense in
  depth: Access authenticates, the Worker authorizes).

### Access-token security notes

- The setup-only token is never written to disk by us and never echoed.
- Access provisioning is *optional and separable*: `cb pub setup` completes the
  public/secret tiers with zero tokens; a follow-up `cb pub setup --access`
  (with the token) turns on account tiers. Output states this explicitly.
- Idempotency: find-by-domain before create; re-running converges (same app,
  same policy) instead of duplicating.
- `cb pub status` gains Access drift reporting (app exists? aud matches
  deployed var? policy still allow-everyone? team domain matches?) — read
  calls, which also need the Access token, so status reports "Access state
  unverifiable without --access-token" rather than failing.

## Implementation tracks

### A. Wrangler runner service (`src/services/wrangler.ts`)

Interface + real + fake per the services pattern, subsuming today's
`DeployWorkerFn`:

- `whoami(): Promise<{ accountId: string; email: string } | null>` (null = not
  logged in) — `wrangler whoami` (JSON output).
- `authToken(): Promise<string | null>` — `wrangler auth token`, parsed.
- `run(args, { cwd })` — generic collected spawn for `deploy` / `r2 bucket
  create` / `secret put`, non-interactive posture (stdin not a TTY; account
  pinned via env `CLOUDFLARE_ACCOUNT_ID`; do NOT set `CI=true` — CI mode
  forces API-token-only auth and would bypass the OAuth login).

The fake records invocations and returns scripted results (logged-in/out,
deploy success/failure) — setup logic stays fully doctested with no wrangler.

### B. Setup flow rework (`src/publish/setup.ts`)

1. Resolve auth: env `CLOUDFLARE_API_TOKEN`+`CLOUDFLARE_ACCOUNT_ID` if present
   (unchanged escape hatch), else wrangler `whoami`. Not logged in → typed
   refusal telling the user to run `wrangler login` (with one line on what it
   does and where the credential lands).
2. Provisioning client construction: Bearer = env token or `wrangler auth
   token`. Same read-back verification as today (bucket, script subdomain
   previews-off, account subdomain).
3. `wrangler.jsonc` gains explicit `workers_dev: true`, keeps
   `preview_urls: false`; the deploy applies them, the REST read-back verifies.
4. Access (only with `--access` / `--access-token`): org read → IdP
   find-or-create (onetimepin) → app find-or-create (`domain: <host>/a`) →
   policy find-or-create (allow, everyone) → read `aud` + `auth_domain` →
   redeploy Worker with `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` vars. The old
   `--access-team-domain`/`--access-aud` flags stay as a manual override.
5. Retire `CREDENTIALS_INSTRUCTIONS` (dashboard token walkthrough) and
   `accessSetupInstructions` (stale dashboard prose). New output: short,
   states account tiers are optional, and where each credential lives.

### C. Provisioning client extension (`src/services/cloudflare-provisioning.ts`)

New ops (+ fake state): `getAccessOrganization()`, `findAccessApp({domain})`,
`createAccessApp(...)`, `listAppPolicies(appId)`, `createAppPolicy(appId, ...)`,
`listIdentityProviders()`, `createOtpIdentityProvider()`. Access calls take
their own token (constructor takes both bearers, or a second client instance —
decide at implementation by whichever keeps the seam narrow).

### D. Connector credential (`src/services/publish-remote-store.ts` + connector)

`r2ConfigFromEnv` → `r2Config(boxRoot, env)`: read
`config/connectors/publish.secret.json` first, env override second. Scaffold
addition to the gitignore'd secret dir docs; `cb health`/`status` can now
report "publishing unconfigured" from file presence. Setup prints the exact
JSON to place on the server (it knows accountId + bucket; the R2-only token the
boxholder mints once for prod — or reuses setup output if we later add
token-minting via API, out of scope now).

### E. `cb pub status` Access drift + docs

Status extension per above; update `docs/plans/publish-pages.md` pointers, the
resume issue, and retire the `~/.cb-publish.env` mentions in `deploy/README.md`.

## Codex cross-review amendments (2026-07-31)

An adversarial Codex review of this plan surfaced findings that amend the
design. Accepted:

1. **Bucket split (was Codex's top finding — CRITICAL).** The real
   authorization data is the R2 manifest's `allowedEmails`, not the Access
   policy. A stored connector token with R2 Edit on the one bucket can rewrite
   `pubs/<id>/manifest.json` (widen the allowlist, flip `accounts` →
   `any-account`) or replace published content — so "no stored credential can
   rewrite auth policy" was FALSE as tabled. R2 tokens scope per-bucket, not
   per-prefix. Fix: **split into two buckets** — the existing content bucket
   (`pubs/`, written by `cb pub go` under laptop OAuth) and a new ingestion
   bucket (`submissions/`, `access-log/`, Worker-written, connector-read). The
   stored connector token is scoped to the ingestion bucket only. The Worker
   binds both. With that split the credential-model claim actually holds.
2. **`auth_domain` normalization.** The Access org API returns a bare
   `<team>.cloudflareaccess.com`; the Worker (`pub-worker/src/access.ts`)
   requires the full `https://` origin for exact `iss` equality + JWKS URL
   construction, and `setup.ts` already validates that form. Setup must
   normalize `https://<auth_domain>` and run it through the same validation
   before baking the var.
3. **Reruns must not erase Access config.** Today the Access vars deploy only
   when flags are present; a later plain rerun would deploy empty vars and
   404 the `/a/` tiers. Fix: persist the non-secret Access metadata (team
   domain + aud) on first successful Access provisioning — in the box at
   `config/publish.json` (they are not secrets) — and bake it into every
   subsequent deploy automatically.
4. **No `--access-token` CLI flag.** Argv leaks via shell history/process
   list. The Access token is accepted via hidden interactive prompt or
   `CB_ACCESS_SETUP_TOKEN` env only. Post-run, setup prints revocation as a
   numbered completion step, not advice.
5. **Bearer-expiry handling.** The string `wrangler auth token` emits does not
   refresh itself. Clients take a **token provider** (`() => Promise<string>`)
   instead of a fixed string; on a 401/403 the client re-acquires once and
   retries idempotent requests, then fails with "run `wrangler login`".
6. **Multi-account is explicit.** If `whoami` shows multiple accounts, setup
   requires `--account-id` (validated against membership) and persists it as
   `account_id` in `pub-worker/wrangler.jsonc` (non-secret) so wrangler never
   guesses.
7. **Idempotency = converge or refuse with a diff.** Find-by-domain alone
   doesn't converge an app/policy that drifted (wrong IdP list, changed
   includes, extra policies). Setup verifies the found app+policy match the
   desired shape; on mismatch it reports an exact diff and refuses, rather
   than pretending convergence. (Update ops can come later if drift proves
   common.)
8. **Honest one-mint accounting.** Even in the target state, a box that wants
   the submissions connector on prod still needs ONE manually minted R2-only
   (ingestion-bucket-scoped) token placed on the server. Setup prints the
   secret-file JSON *template* (accountId + bucket filled in, token blank) —
   it cannot mint the token itself. Docs say this plainly.

Noted but out of scope (pre-existing Worker behavior, filed as issues rather
than folded in): pre-auth status/enumeration distinctions on `/a/` and
`/__submit/` (404 vs 410 vs 401 reveal pub-id liveness to holders of a
pub-id); `any-account` access-log writes are unbounded per verified email
(no dedup/rate limit).

## Live-verification gaps (collaborative session, NOT in this build)

Closed only with the boxholder present (writes real auth policy / needs browser):

1. `POST /access/apps` response envelope — confirm `aud` placement.
2. `/access/organizations` behavior on a never-onboarded account (404? auto?)
   — Zero Trust org onboarding may itself require one dashboard plan-selection
   step; setup must detect and say so rather than fail cryptically.
3. Whether `onetimepin` IdP is auto-provisioned on new orgs.
4. Whether the R2 *object* REST endpoints accept the wrangler OAuth bearer
   (bucket-level ops are documented; object-level assumed — verify in the
   `cb pub go` path before relying on it).
5. End-to-end: OTP login on a published `/a/` page → JWT email matches the
   allowlist.
6. The connector-token mint (`--mint-connector-token`, addendum below):
   permission-group display names ("Workers R2 Storage Bucket Item
   Read"/"Write"), the bucket resource-key format
   (`com.cloudflare.edge.r2.bucket.<account>_default_<bucket>`), and the
   one-time `result.value` in the create response.

Everything lands fake-tested; no test touches real Cloudflare or spawns real
wrangler.

## Addendum (2026-07-31): the connector token is minted, not hand-assembled

Boxholder follow-up: the "mint an R2 token in the dashboard" residue was the
one remaining weird manual step, and Cloudflare's account-owned token API
(`POST /accounts/<id>/tokens`, permission groups resolved live via
`/tokens/permission_groups`) removes it. `cb pub setup --mint-connector-token`
now mints the ingestion-bucket-scoped token itself and writes
`config/connectors/publish.secret.json` (mode 600), printing the JSON once for
the copy-to-server step. Idempotent: an existing secret file skips the mint.

Cost, decided explicitly: the setup-only bootstrap token gains **Account API
Tokens: Edit** (it can mint arbitrary tokens while it exists). Same
containment as the Access half — one prompt serves both `--access` and
`--mint-connector-token`, never argv, never stored, revocation printed as the
completion step. Wrangler's OAuth scopes cannot call the token endpoints (an
open wrangler feature request), so the bootstrap token is the only path.
Account-owned (not user-owned) so the credential survives the creating user
leaving the account. New seams: `services/cloudflare-tokens.ts` (client +
fake), `publish/connector-secret.ts` (secret file read/write + mint-ensure —
consolidated from the connector).
