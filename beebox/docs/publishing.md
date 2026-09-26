# Operating Cloudflare site publishing

This is the operator and box-member runbook for the managed static-site
publisher. The box authoring workflow is in
[`docs/box/publishing.md`](box/publishing.md); this page covers server custody,
Cloudflare setup, member approval, and the first live verification. No live
Cloudflare enrollment or deployment has been performed as part of this work.

## What the first version supports

Each box uses one Admin-configured hostname and one shared Worker for its
managed static sites. Public sites use `/<slug>/`; secret-link sites use
`/s/<pubId>/`. The owner configures the host and selects one granted Cloudflare
connection before the first site exists. The agent prepares content and gives
the boxholder a direct app link. A signed-in member approves first enablement
and every audience or destination change; same-scope refreshes may publish
immediately. Disablement is also a member action in the app. The global
administrator manages Cloudflare connections and grants; they do not approve
each publication.

All pages on one box hostname share a browser origin, storage, and same-origin
script access. The boxholder accepts mutual trust among pages published by
that box. CORS does not isolate them; the feature adds no iframe or
per-publication host boundary. Separate boxes use separate hostnames and
Workers. Existing per-publication `workers.dev` and custom-host URLs continue
to serve their existing publications. A legacy publication joins the shared
host only after prepare and member approval records its route.

Account-restricted managed tiers are currently blocked in the app. Although
the Worker has Access JWT validation code, the per-host setup/readiness
integration is not implemented, and Access provisioning, audience behavior,
login, and cookie isolation have not passed a real Cloudflare/browser check.
Do not present managed account-restricted publishing as ready. Keep it as a
follow-up requiring implementation and live browser verification. Legacy
account-tier sites are a separate existing flow.

The first live setup requires a browser for Cloudflare account enrollment,
Admin host assignment, and member approval in Bee Box. The agent handles local
preparation and CLI verification. No human-side `bbx` command is required.

## Global administrator setup

1. In the Cloudflare dashboard, open the account that should own publication
   Workers and R2 storage. If the account has never enabled R2, complete its
   initial R2 product setup in the dashboard. The shared publication Worker
   keeps `workers.dev` and preview routes disabled; visitors use the box's
   configured custom hostname.
2. Create a **user Cloudflare API token** (not the separate S3-compatible R2
   Access Key ID and secret). Open
   [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens),
   choose **Create Token → Create Custom Token**, and add these **Account**
   permissions. For account resources, select only the Cloudflare account
   whose ID you entered above:
   - **Workers R2 Storage: Edit** (called **Workers R2 Storage Write** in the
     API permission reference) — create/list buckets and read, write, list,
     and delete objects.
   - **Workers Scripts: Edit** (called **Workers Scripts Write** in the API
     permission reference) — upload Workers and read/update their settings.

   The permissions must be account-scoped because Bee Box creates one bucket
   and shared Worker for each publishing box. Cloudflare's
   [token creation instructions](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
   explain custom tokens, resource scoping, and copying the secret. Copy the
   token value once. Do not paste an R2 S3 credential or a global API key into
   Bee Box.

   The exact least-privilege permissions for attaching a Worker to a custom
   hostname have not been verified for this integration. Cloudflare's
   [Workers permissions guide](https://developers.cloudflare.com/workers/authorization/workers/)
   and [Attach Worker Domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/)
   use permission labels and scopes that do not establish a tested minimum
   here. If Cloudflare rejects setup, the owner must review the provider error
   and adjust the token's permissions. Bee Box has not verified this with a
   live token; do not treat any specific Zone permission combination as
   confirmed.

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
   bucket. Then, in Admin, select the granted connection and assign one exact
   hostname to the box. This setup provisions or reuses that box and
   connection's R2 bucket, deploys its shared Worker, and attaches the custom
   hostname before any publication exists. Review existing DNS records and
   Workers Routes before assignment. An exact provider read-back confirms the
   mapping, not HTTPS readiness. A global administrator can revoke a box grant or rotate/revoke the
   token later. Removing the local grant or token does not take already-live
   sites offline. Disable sites while the credential still works if they must
   stop serving immediately.

The box's shared host uses one selected connection. Other connections already
granted to that box remain usable for existing publications, but those sites
stay on their existing URLs. Do not silently move them or change their
connection.

### One shared hostname per box

The authenticated Bee Box owner sets up one hostname for the current box in
**Admin → Cloudflare publishing**, after granting a connection to the box and
before any site is prepared. Select one of the box's granted connections and
enter one exact hostname in a zone owned by that Cloudflare account. This
creates or reuses the box and connection's R2 bucket, deploys the shared
Worker, and attaches the hostname. All paths on that hostname route to this
box's Worker. Bee Box does not route several boxes through one hostname. The
box's hostname and connection cannot be changed in this version. The owner
should review existing DNS records and Workers Routes before submitting;
Cloudflare DNS and certificate changes begin at assignment. The API
read-back confirms the Worker mapping but does not show that HTTPS is ready.

If the assignment is pending or fails, the owner retries the same configured
mapping from Admin or inspects Cloudflare. Do not choose another hostname,
detach/delete a Worker, or claim that HTTPS is working until the host is
actually reachable. Bee Box does not automatically delete or move existing
Cloudflare resources.

After the box host is set, the agent can prepare a site. The CLI reports its
full public or secret URL and a direct `approval:` link. A signed-in member
reviews the candidate in **Publications** before the route is enrolled on the
shared hostname. Public paths require an explicit slug and use
`/<slug>/`; secret-link paths use `/s/<pubId>/`. Do not share only a hostname
for a secret publication.

Existing per-publication `workers.dev` and custom-host URLs keep working. A
same-connection publication reaches the shared hostname only after an explicit
prepare and member approval. Sites pinned to other connections remain on
their current URLs. New publications use only the shared Worker, whose
`workers.dev` and preview URLs stay disabled. No live Cloudflare hostname or
DNS change was performed during implementation; actual HTTPS, provider
permissions, and browser behavior need separate live verification.

## Box agent and member workflow

The agent owns files under `src/publications/<name>/`. It asks the server to
prepare a named publication; the request cannot select another box, PubId,
bucket, Worker, or credential. `bbx pub id` generates the stable CSPRNG PubId
for a new `publication.json`. Before authoring, the agent runs
`bbx pub connections` to discover granted connection names. It uses only the
connection selected for this box in Admin; it never selects or changes the
hostname itself. If Admin has not configured the box host, the agent asks the
boxholder to do that in the app. It never reads machine secrets or private
server config. The box-managed CLI surface is:

```sh
bbx pub id
bbx pub connections
bbx pub prepare field-guide
bbx pub status
```

`bbx pub prepare <name>` builds a site project when configured, scans and
uploads an immutable release, and reports the prepared/live state. A new
publication remains disabled until a box member approves it in the Bee Box
app. A same-audience/same-destination refresh of an enabled publication
becomes active as soon as preparation succeeds. A changed audience or
destination waits for a box member to approve it in the app. `bbx pub prepare` prints a
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
opens **Publications** from the profile menu), reviews the title, displayed
host and path, requested tier and recipients, file summary, and leak-scan findings, then
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

1. The administrator confirms the correct Cloudflare account and enables R2
   if this is the account's first use. A workers.dev subdomain is not required
   for the shared Worker; its `workers.dev` and preview routes are disabled.
2. The administrator saves the scoped API token in the Bee Box Admin form
   and grants the connection to the box. In Admin, the owner selects that
   connection and assigns the box's exact hostname before any publication is
   prepared. This provisions the shared Worker and bucket. R2 writes and Worker
   deployment may still show unverified until setup succeeds.
3. The agent creates one minimal static public test site with a unique title,
   `index.html`, a relative CSS asset, and an explicit public slug; writes its
   definition with a fresh `bbx pub id`; then runs `bbx pub prepare <name>`.
   The agent gives the member the direct `approval:` link and waits. It does
   not enable the site.
4. The member reviews the candidate in **Publications** and enables it. Use
   the app-displayed `https://<box-host>/<slug>/` URL; do not construct one
   from the PubId.
5. The agent checks that the public route serves the release-qualified page
   and that its relative stylesheet loads under the same slug prefix. For a
   public page, use a request with no Bee Box or Cloudflare Access cookies:

   ```sh
   curl -sS -I -L "$PUBLICATION_URL"
   curl -sS -I -L "$PUBLICATION_URL/styles.css"
   ```

   Expect the final page and asset to return 200 with the correct MIME type,
   `Content-Security-Policy`, `Cross-Origin-Resource-Policy: same-origin`,
   `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
   The redirect and asset path must remain beneath the approved publication
   path. Do not print or retain a secret-tier capability URL if the smoke test
   uses one. Same-origin headers do not isolate sites on this box host.

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
- [Cloudflare Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/) — documents Worker Editor and zone-scoped Workers Routes Write for custom-domain changes; Bee Box has not confirmed these as the integration's minimum permissions.
- [Cloudflare Attach Worker Domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/) — API request and accepted permission listing; live least-privilege behavior remains unverified here.
- [Cloudflare R2 token types and permissions](https://developers.cloudflare.com/r2/api/tokens/) — the S3-compatible R2 credentials on this page are not the Cloudflare API bearer used by Bee Box.
- [Cloudflare R2 setup](https://developers.cloudflare.com/r2/get-started/)
- [Cloudflare workers.dev subdomains](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
