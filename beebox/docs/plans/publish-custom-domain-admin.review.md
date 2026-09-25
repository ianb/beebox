# Plan Engineering Review — custom hostname assignment

Independent Fable review of `publish-custom-domain-admin.md`, followed by source verification and adjudication. The user authorized an exact custom hostname assigned in Admin to a disabled prepared publication, a member approval before serving, no automatic alias or audience changes, and no detach/remap in v1. The user approved the combined estimate of 1,750–2,450 authored changed lines on 2026-09-25.

## What already exists

`managed-publication-actions.ts:9-16` serializes member actions by PubId. `managed-publications.ts:28-65` validates and hashes the full candidate, and `:67-77` builds and compares requested scope. `pub-worker/src/index.ts:55-59` routes a pinned publication Worker into `handleSite`; `pub-worker/src/site.ts:54-63` returns `410` for a disabled publication before examining the request path. `pub-worker/src/index.ts:80-88` confirms `/__version` exists only on the legacy handler. `PublicationsPage.tsx:149-153,265-272` decides whether approval is required by comparing tier and slug/email only. `managed-publication-actions.ts:34-41` enables a disabled manifest by flipping status without consulting the candidate. `CloudflarePublishConnectionsSection.tsx:196-210` documents the currently granted account token scope, while `cloudflare-publish-token-verifier.ts:59-86` does not verify zone/custom-domain permissions. The Admin page already has the current box context; the new operation can be box-scoped and share `ctx.boxRoot` and its PubId lock.

## Ontology

Use existing names `PublicationCandidate`, `requestedScope`, `SiteEdgeManifest`, `Publication`, and `CloudflarePublishBinding`. Add optional `customHostname` to server-built candidate requested scope, the approved edge manifest, and the server-owned publication binding. The hostname is routing metadata, never a capability or access check. It must be included in the candidate hash and `sameAudience` comparison.

## Prior art (external) — verified

- Cloudflare's Custom Domains guide says a Worker can be the origin, exact apex/subdomain matching is used, DNS records and certificates are created, and existing CNAME records are not allowed: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
- `GET /zones` requires Zone Read: [List Zones API](https://developers.cloudflare.com/api/resources/zones/methods/list/).
- The attach endpoint is `PUT /accounts/{account_id}/workers/domains`; its method documentation describes attaching a domain and documents `Workers Scripts Write`, but no conditional/CAS behavior: [Attach Worker Domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/).
- The current Workers roles guide says attach/change/remove requires Worker Editor plus zone-scoped Workers Routes Write: [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/). This conflicts with the API method's permission declaration. Confirm minimum permissions in a safe test account before telling the boxholder exactly which scopes to add. No token is changed by this plan.

## Stated preferences this plan trades against

The destination must remain under human control: the hostname is visible in the member candidate and must match the server assignment at approve/enable. The work stays narrow: one hostname per existing publication, no agent-selected hostname, no domain-grant framework, and no automatic detach.

## Could this be simpler? (verified)

Manual mapping in Cloudflare is smaller but does not meet the user's request to map from Admin. Exact Admin assignment to a disabled prepared site is the smallest version that supports the required workflow. The first draft's readiness state, `/__version` probe, and retry button were unnecessary; `/__version` is not served by site Workers, and disabled site requests return before routing by path. These are removed.

## Failure modes

The plan now covers: hostname already assigned, app-side concurrent claims, PubId action races, attach succeeds but local state write fails, DNS and certificate side effects, token permission refusal, stale candidate revisions, direct-enable bypass, and agent refresh losing the assigned hostname. Account-tier custom hosts are deferred until Access behavior on both hostnames is verified.

## Findings

### 1. Disabled Worker cannot answer the `/__version` readiness probe
**Status:** Accepted; probe and readiness state removed.
**Evidence:** `pub-worker/src/site.ts:54-63` returns `gone()` for disabled status before path handling; `pub-worker/src/index.ts:55-59,80-88` shows the version endpoint is the legacy branch.
**Why it matters:** The first draft would leave every custom hostname unready forever and disable member enablement.

### 2. Approval decision and enablement omitted custom hostname
**Status:** Accepted; `customHostname` participates in `sameAudience`, approve checks candidate against binding, and enable checks manifest against binding.
**Evidence:** `PublicationsPage.tsx:149-153,265-272`; `managed-publication-actions.ts:34-41`.
**Why it matters:** Without these checks, a user could enable a site whose active destination did not match the visible approved request.

### 3. New publication cannot replace an immutable hostname
**Status:** Accepted; plan says manual Cloudflare detach is required to recover. A new publication alone cannot take an attached hostname.
**Evidence:** V1 explicitly omits detach/remap.
**Why it matters:** A typo or revoked publication can leave the hostname attached; confirmation must not promise a new publication solves it.

### 4. Existing token guidance and verifier do not cover domain permissions
**Status:** Accepted; plan says verify scopes before writing UI instructions and owner updates/resaves a token manually if required. It adds no secret mutation.
**Evidence:** `CloudflarePublishConnectionsSection.tsx:196-210`; `cloudflare-publish-token-verifier.ts:59-86`; API and role docs disagree about attach scopes.
**Why it matters:** Current connection may work for R2/Worker deploy and still be denied zone discovery or Custom Domain attach.

### 5. Attach API does not document conflict-safe conditional behavior
**Status:** Accepted with boundary. The plan preflights and verifies read-back, serializes app assignments, and calls out an out-of-band Cloudflare dashboard race. Do not claim the endpoint's `PUT` is an atomic conflict gate.
**Evidence:** Attach API docs expose no conditional parameter. The reviewer mentioned “override flags,” but none appear in the current official request schema; that assertion is not adopted. Existing-CNAME refusal is documented, broader DNS record behavior is not.
**Why it matters:** App-local locks cannot prevent an external dashboard operation between preflight and attach. The confirmation now states the immediate DNS/certificate/routing effect.

### 6. DNS and certificate changes begin before member approval
**Status:** Accepted; Admin confirmation says all paths of the hostname route to the Worker and DNS/certificate changes start immediately while the site remains disabled.
**Evidence:** Cloudflare Custom Domains docs say attach creates DNS and issues certificates; disabled requests return unavailable.
**Why it matters:** Attachment is a visible external side effect before the member approves content at that destination.

### 7. Admin needs the owning box root for the shared lock
**Status:** Accepted; assignment lives in the per-box owner Admin context, receives `ctx.boxRoot`/`ctx.boxSlug`, and lists only that box's prepared publications.
**Evidence:** `AdminPage.tsx` renders the section in the box context; `publications.ts` and member actions have box-scoped context. The Admin-only Cloudflare connection list remains global.
**Why it matters:** A global-only procedure without a box root cannot share the lock used by member actions.

### 8. Agent refresh must inherit custom hostname
**Status:** Accepted; `requestedScope` uses the server binding's hostname for every later prepare, and this is a named test.
**Evidence:** `managed-publications.ts:67-77,275`; live refresh only updates when scope matches.
**Why it matters:** Otherwise every refresh would create a pending destination difference and require repeated approval.

### 9. Access tiers are not supported on custom hosts in v1
**Status:** Accepted; scope is public and secret only until Access is verified across both hostnames.
**Evidence:** Account-tier Access requirements and current configuration are tied to Worker host; existing app gates account tiers pending live Access verification.
**Why it matters:** A custom host without matching Access configuration would fail closed or behave differently from workers.dev.

### 10. Source line citations and parent plan scope
**Status:** Accepted; `SiteEdgeManifest` references now use `manifest-edge.ts:157-193`; binding references use `cloudflare-publish.ts:193-247`. The human's later request authorizes custom domains despite the parent plan's earlier deferral.
**Evidence:** Direct user authorization outranks prior plan scope. Cloudflare external claims now link to official docs and disclose the permission discrepancy.
**Why it matters:** Plans must reflect current authority and actual schema locations.

## NOT in scope (verified)

No detach/remap, wildcard, broad hostname grants, hostname-based security, account-tier custom host, automatic workers.dev disablement, automatic DNS cleanup, or live Cloudflare mutation.

## Things I checked and found clean

The user's exact-host assignment and member-approval requirements are compatible with current per-PubId serialization when the new Admin action uses the same box context. Public URLs use `/`; secret URLs use `/s/<PubId>/` (`PublicationsPage.tsx:274-280`). Keep the existing workers.dev URL as an alias to the same Worker and manifest. The Admin should disclose that Bee Box cannot reassign a hostname without a manual Cloudflare detach.
