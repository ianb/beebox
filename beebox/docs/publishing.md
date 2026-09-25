# Operating Cloudflare site publishing

This is the operator and box-member runbook for the managed static-site
publisher. The box authoring workflow is in
[`docs/box/publishing.md`](box/publishing.md); this page covers server custody,
Cloudflare setup, member approval, and the first live verification. No live
Cloudflare enrollment or deployment has been performed as part of this work.

## What the first version supports

Public pages and secret-link pages use one Cloudflare Worker and isolated
workers.dev origin per publication. A box agent can prepare a site and refresh
content while it remains inside the already-approved audience and destination.
A signed-in member of the box approves first enablement and every audience or
destination change in the Bee Box app. Disablement is also a member action in
the app. The global administrator manages Cloudflare connections and grants;
they do not need to approve each publication.

Account-restricted managed tiers are currently blocked in the app. Although
the Worker has Access JWT validation code, the per-host setup/readiness
integration is not implemented, and Access provisioning, audience behavior,
login, and cookie isolation have not passed a real Cloudflare/browser check.
Do not present managed account-restricted publishing as ready. Keep it as a
follow-up requiring implementation and live browser verification. Legacy
account-tier sites are a separate existing flow.

The first live setup requires a browser for Cloudflare account enrollment and
for member approval in Bee Box. The agent handles local preparation and CLI
verification. No human-side `bbx` command is required.

## Global administrator setup

1. In the Cloudflare dashboard, open the account that should own publication
   Workers and R2 storage. If the account has never enabled R2, complete its
   initial R2 product setup in the dashboard. If it has no workers.dev account
   subdomain, configure one in the Cloudflare dashboard. Bee Box checks that
   these prerequisites exist; its API path does not claim to create the
   account subdomain or complete first-use enrollment.
2. Create a **user Cloudflare API token** (not the separate S3-compatible R2
   Access Key ID and secret). Open
   [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens),
   choose **Create Token → Create Custom Token**, and add these **Account**
   permissions. For account resources, select only the Cloudflare account
   whose ID you entered above:
   - **Account Settings: Read** — read account settings and the workers.dev
     account subdomain.
   - **Workers R2 Storage: Edit** (called **Workers R2 Storage Write** in the
     API permission reference) — create/list buckets and read, write, list,
     and delete objects.
   - **Workers Scripts: Edit** (called **Workers Scripts Write** in the API
     permission reference) — upload Workers and read/update their settings.

   The permissions must be account-scoped because Bee Box creates distinct buckets
   and Workers for publications later. Cloudflare's
   [token creation instructions](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
   explain custom tokens, resource scoping, and copying the secret. Copy the
   token value once. Do not paste an R2 S3 credential or a global API key into
   Bee Box.

   For an optional custom hostname, the documented minimum guidance is the
   existing **Account: Workers Scripts Edit**, plus **Zone: Zone Read** and
   **Zone: Workers Routes Edit** scoped to the zone that owns the hostname.
   Cloudflare's [Workers permissions guide](https://developers.cloudflare.com/workers/authorization/workers/)
   describes Worker Editor plus Workers Routes Write for that zone, while the
   [Attach Worker Domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/)
   lists Workers Scripts Write as an accepted permission. The documentation
   labels do not establish successful least-privilege authorization for this
   integration. If Cloudflare rejects the request, the owner must review and
   adjust the token's permissions. Bee Box has not verified this with a live
   token.

3. In Bee Box, open **Admin → Cloudflare publishing**. Choose a short lowercase
   connection name for Bee Box, such as `makers`; it is just a local label and
   does not have to match a Cloudflare name. Enter the 32-character Cloudflare
   account ID and the API token.
   Choose **Verify and save**. The token is stored in the host's machine secret
   store and is never shown again. The server records the token type and active
   verification result. Saving verifies that the token is active and identifies
   the selected account; it does not prove write permissions. The capability
   display remains unverified until actual bucket/object and Worker operations
   succeed.
4. Grant that connection to the box that will publish. This is a server-only
   grant: the box agent receives neither the token nor account-level Cloudflare
   credentials. The same account connection may be granted to multiple boxes;
   each box's publications remain bound to its server-derived Worker and R2
   bucket. A global administrator can revoke a box grant or rotate/revoke the
   token later. Removing the local grant or token does not take already-live
   sites offline. Disable sites while the credential still works if they must
   stop serving immediately.

An existing publication remains pinned to its original Cloudflare account.
Moving it requires creating a new publication with a new `pubId`, member
enablement on the new account, and disabling the old publication; changing
only the connection name is insufficient.

### Optional custom hostname

Custom hostnames are an authenticated global-owner operation on an existing
prepared publication;
they are not set by the agent in `publication.json` and there is no connection
selector in the form. The server uses the publication's existing box/account
binding. Use a hostname in a zone owned by that Cloudflare account.

1. As the authenticated Bee Box owner, open **Admin → Cloudflare publishing →
   Assign a custom hostname**.
2. Select an eligible prepared publication. Only disabled public or secret
   sites with available Cloudflare state and no existing custom hostname are
   eligible. Enter the exact hostname (for example, `www.example.org`) without
   `https://` or a path.
3. Read and acknowledge the warning before choosing **Assign hostname**.
   Cloudflare starts DNS and certificate changes immediately, while the site
   is still disabled. Assignment binds the hostname to the selected Worker and
   cannot be detached or changed from Bee Box. Cloudflare-side detach does not
   release Bee Box's permanent hostname reservation; there is no detach/remap
   or reservation-release control in Bee Box v1.
4. The server reads back the hostname, zone, and Worker binding. That confirms
   the mapping, not certificate readiness. HTTPS may take time to become
   reachable. A successful assignment creates a new destination candidate; a
   signed-in member of this box must approve it in **Publications** before the
   custom-host URL serves the site. The existing workers.dev URL remains an
   alternate.

   If Cloudflare does not confirm the exact mapping, the hostname stays
   reserved as **pending** and the publication stays disabled. Do not choose a
   different hostname or ask a member to approve yet. The authenticated owner
   can retry the same reserved hostname from this section; the server checks
   for and adopts an already-completed exact mapping, or attaches it and reads
   it back. If the state remains pending, inspect the Cloudflare domain
   assignment before retrying. Bee Box checks for conflicting Worker Custom
   Domain assignments, but does not inspect existing DNS records or Workers
   Routes; review those separately before assigning a hostname.

The custom hostname is immutable for that publication in Bee Box. A hostname
reservation is also permanent: manually detaching the Cloudflare mapping does
not release the hostname for another publication. Bee Box v1 has no recovery
or reassignment path for a reserved hostname. Do not create a new publication
expecting it to claim the same hostname; ask the administrator to inspect the
Cloudflare mapping and use a different hostname for any new publication.

After member approval, the agent can report the approved URL from
`bbx pub status` or `bbx pub sites`; a signed-in member can also see it in
**Publications**. Public pages use `/` (or their approved public slug); a
secret-link page keeps its complete `/s/<pubId>/` path on the custom hostname.
Do not share a hostname-only URL for a secret publication. Custom-host
attachment, zone permissions, HTTPS readiness, and the full browser flow are
not yet live-verified; do not treat the app's mapping read-back as evidence
that HTTPS is ready.

## Box agent and member workflow

The agent owns files under `src/publications/<name>/`. It asks the server to
prepare a named publication; the request cannot select another box, PubId,
bucket, Worker, or credential. `bbx pub id` generates the stable CSPRNG PubId
for a new `publication.json`. Before filling `connection`, the agent runs
`bbx pub connections` and selects a name that is active and granted to the
current box. If none is available, the agent asks the boxholder or admin for
the grant; it never reads machine secrets or private server config. The
box-managed CLI surface is:

```sh
bbx pub id
bbx pub connections
bbx pub prepare field-guide
bbx pub status
```

`bbx pub prepare <name>` builds a site project when configured, scans and
uploads an immutable release, and reports the prepared/live state. A first
publication remains disabled until a box member enables it in the Bee Box
app. A same-audience/same-destination refresh of a live publication becomes
active as soon as preparation succeeds. A changed audience or destination
waits for a box member to approve it in the app. `bbx pub prepare` prints a
`publication URL:` line with the complete destination and an `approval:` line
with a direct link to that box's Publications page when `BBX_SERVER_URL` and
`BBX_BOX_NAME` are configured; otherwise it tells you to use the app menu.
Preserve the full
secret URL path `/s/<pubId>/`; the id-bearing path is the capability, and a
hostname-only URL will not work. `bbx pub status` reports managed publication
state, granted connection names, and publication URLs. `bbx pub status
--legacy` explicitly requests the old Wrangler diagnostic. Without configured
box-server credentials, managed status returns an error; run it through the
configured box agent. Wrangler credentials are used only when the agent
explicitly requests the legacy diagnostic. Actual server query errors do not
fall back. `bbx pub sites` is also available
for the managed site list. The legacy TTY-only `bbx pub go` flow does not
enable or mutate server-managed publications.

For first enablement or a scope change, a signed-in member opens the direct
Publications URL printed on the `approval:` line (or signs into this box and
opens **Publications** from the profile menu), reviews the title, displayed origin,
requested tier and recipients, file summary, and leak-scan findings, then
chooses **Enable** or **Approve**. This is an ongoing permission for the agent to update content within
that approved audience; it is not approval of every content snapshot. The app
shows metadata and safe text summaries; it never runs the site's JavaScript on
the authenticated Bee Box origin.

After enablement, the agent can refresh content and confirm state:

```sh
bbx pub prepare field-guide
bbx pub status
```

Any change to tier, recipient list, public slug, or origin requires new member
approval. A failed build, scan, or upload before promotion leaves the current
release live. If a remote write may have succeeded but its read-back or
activation check fails, report the serving state as unknown; do not claim
rollback. A box member disables a site
from **Publications**; the edge then returns HTTP 410 for the site and every
release URL. Confirm the disabled state in `bbx pub status` and by fetching the
previous URL. If the server cannot reach Cloudflare to verify disablement, the
app must report the serving state as unknown rather than claiming success.

## First live verification session

Use this only with the boxholder present. The human performs Cloudflare
dashboard sign-in/enrollment, pastes the token directly into the Admin form,
and clicks the initial member enablement in Bee Box. The agent performs the
remaining setup and HTTP checks. Do not send credentials or secret URLs to
anyone other than the intended boxholder; do not write them to shared notes,
repository docs, logs, or a report. When the boxholder needs a secret-link
URL, preserve and provide the complete path printed by the CLI.

1. The administrator confirms the correct Cloudflare account, R2 is enabled,
   and a workers.dev account subdomain exists. If an account prerequisite is
   missing, stop at the dashboard and complete it before continuing.
2. The administrator creates and saves the scoped general API token in the
   Bee Box Admin form, grants it to the box, and confirms the app shows the
   connection active. R2 writes and Worker deployment may still show
   unverified until the agent's first successful operations.
3. The agent creates one minimal static public test site with a unique title,
   `index.html`, and a relative CSS asset; writes its definition with a fresh
   `bbx pub id`; then runs `bbx pub prepare <name>`. The agent reports the
   file/scan summary and waits for member action. It does not enable the site.
4. The member reviews the candidate in **Publications** and enables it. The
   app-displayed origin is the source of truth; do not construct a URL from
   the PubId or guess the account subdomain.
5. The agent checks that the stable page resolves to the release-qualified
   page and that its relative stylesheet loads from that same release. For a
   public page, use a request with no Bee Box or Cloudflare Access cookies:

   ```sh
   curl -sS -I -L "$PUBLICATION_URL"
   curl -sS -I -L "$PUBLICATION_URL/styles.css"
   ```

   Expect the final page and asset to return 200 with the correct MIME type,
   `Content-Security-Policy`, `Cross-Origin-Resource-Policy: same-origin`,
   `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
   For the stable entry path, confirm the redirect target includes the active
   release id. Do not print or retain a secret-tier capability URL if the
   smoke test uses one.

6. The agent changes one harmless sentence and runs `bbx pub prepare <name>`
   again. Confirm the active release changes without a new member click and
   the page's relative asset still comes from the matching release.
7. The member disables the page in **Publications**. The agent verifies
   `bbx pub status` reports disabled and the previously working public URL now
   returns 410. Re-enable only after the member takes a fresh deliberate
   action.

Record the Cloudflare token type, capability states, Worker hostname, HTTP
status/headers, refresh result, and disable result without recording token
bytes or secret URLs. A successful fake-backed test is not evidence for this
live pass. Do not test Access-restricted tiers until their enrollment and
browser isolation checks are separately ready.

## What the current verifier establishes

The connection verifier accepts account API tokens and user API tokens. It
calls Cloudflare's account-token verification endpoint first; if that fails,
it tries the user-token endpoint and performs a selected-account R2 list read.
The result proves the token is active, and in the user-token case that it can
read R2 in the selected account. It does not establish successful writes.
Capability badges advance only after actual R2 write or Worker deployment
operations and their read-back checks succeed.

The current admin form asks an administrator to paste a token. That is a
deliberate browser step; no service-side credential creation or token minting
flow is configured by this guide. Do not use the old single management token
that was exposed during the earlier publishing work. Create a new token and
rotate any remaining legacy credential separately.

## References

- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- [Find your Cloudflare account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)
- [Cloudflare Workers script upload permission](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)
- [Cloudflare Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/) — Worker Editor and zone-scoped Workers Routes Write for custom-domain changes.
- [Cloudflare Attach Worker Domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/) — API request and accepted permission listing; live least-privilege behavior remains unverified here.
- [Cloudflare R2 token types and permissions](https://developers.cloudflare.com/r2/api/tokens/) — the S3-compatible R2 credentials on this page are not the Cloudflare API bearer used by Bee Box.
- [Cloudflare R2 setup](https://developers.cloudflare.com/r2/get-started/)
- [Cloudflare workers.dev subdomains](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
