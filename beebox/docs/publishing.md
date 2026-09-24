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
2. Create a **Cloudflare API token**, not the S3-compatible R2 Access Key ID
   and secret. Prefer a token scoped to this one account. The current API
   operations need R2 bucket/object read and write access and Workers script
   upload/settings access. Cloudflare documents `Workers R2 Storage Write` for
   bucket creation/listing and object read/write/list, and `Workers Scripts
   Write` for Worker module upload. The server also reads account and Worker
   settings and checks the workers.dev hostname. The Bee Box verifier confirms
   that a token is active for the selected account; for a user token it also
   performs a read-only R2 bucket-list check. It does **not** prove write
   permissions. First successful bucket/object and Worker operations verify
   those capabilities in the app. If Cloudflare rejects a required operation,
   adjust the token policy in the dashboard and retry; do not paste a global
   API key into Bee Box.
3. In Bee Box, open **Admin → Cloudflare publishing**. Add a short lowercase
   connection name, the 32-character Cloudflare account ID, and the API token.
   Choose **Verify and save**. The token is stored in the host's machine secret
   store and is never shown again. The server records the token type and active
   verification result; the permission display remains unverified until real
   writes succeed.
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

## Box agent and member workflow

The agent owns files under `src/publications/<name>/`. It asks the server to
prepare a named publication; the request cannot select another box, PubId,
bucket, Worker, or credential. `bbx pub id` generates the stable CSPRNG PubId
for a new `publication.json`. The approved box CLI surface is:

```sh
bbx pub id
bbx pub prepare field-guide
bbx pub sites
```

`bbx pub prepare <name>` builds a site project when configured, scans and
uploads an immutable release, and reports the prepared/live state. A first
publication remains disabled until a box member enables it in the Bee Box
app. A same-audience/same-destination refresh of a live publication becomes
active as soon as preparation succeeds. A changed audience or destination
waits for a box member to approve it in the app. `bbx pub sites` reports the
current server-managed site state; it is read-only. The legacy TTY-only
`bbx pub go` flow does not enable or mutate server-managed publications.

For first enablement or a scope change, a signed-in member opens
**Publications**, reviews the title, displayed origin, requested tier and
recipients, file summary, and leak-scan findings, then enables or approves the
site. This is an ongoing permission for the agent to update content within
that approved audience; it is not approval of every content snapshot. The app
shows metadata and safe text summaries; it never runs the site's JavaScript on
the authenticated Bee Box origin.

After enablement, the agent can refresh content and confirm state:

```sh
bbx pub prepare field-guide
bbx pub sites
```

Any change to tier, recipient list, public slug, or origin requires new member
approval. A failed build, scan, or upload before promotion leaves the current
release live. If a remote write may have succeeded but its read-back or
activation check fails, report the serving state as unknown; do not claim
rollback. A box member disables a site
from **Publications**; the edge then returns HTTP 410 for the site and every
release URL. Confirm the disabled state in `bbx pub sites` and by fetching the
previous URL. If the server cannot reach Cloudflare to verify disablement, the
app must report the serving state as unknown rather than claiming success.

## First live verification session

Use this only with the boxholder present. The human performs Cloudflare
dashboard sign-in/enrollment, pastes the token directly into the Admin form,
and clicks the initial member enablement in Bee Box. The agent performs the
remaining setup and HTTP checks. Do not send credentials or full secret-link
URLs through chat, logs, or a report.

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
   `bbx pub sites` reports disabled and the previously working public URL now
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
- [Cloudflare Workers script upload permission](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)
- [Cloudflare R2 token types and permissions](https://developers.cloudflare.com/r2/api/tokens/) — the S3-compatible R2 credentials on this page are not the Cloudflare API bearer used by Bee Box.
- [Cloudflare R2 setup](https://developers.cloudflare.com/r2/get-started/)
- [Cloudflare workers.dev subdomains](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
