# Managed publication candidates preserve human control

Preparation uploads immutable release bytes and a review candidate while a new
publication remains disabled. Approval requires the current candidate revision.
Disabling only changes the edge authority; it does not remove the Worker route.

```ts setup
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakePublishStore } from "../../src/services/publish-remote-store.js";
import { createFakeProvisioningClient } from "../../src/services/cloudflare-provisioning/core.js";
import { releaseIdForFiles, siteEdgeManifestSchema } from "../../src/publish/manifest-edge.js";
import { publicationDefinitionSchema } from "../../src/publish/publication-definition.js";
import { createPublicationCardTemplate } from "../../src/schemas/publication.js";
import { defaultManagedPublicationRuntime } from "../../src/services/managed-publication-runtime/core.js";
import { prepareManagedPublication, readCandidate } from "../../src/publish/managed-publications/core.js";
import { approveManagedPublication, disableManagedPublication, enableManagedPublication } from "../../src/publish/managed-publication-actions.js";
import { listManagedPublications, previewManagedPublicationFile } from "../../src/publish/managed-publication-queries.js";
import { appRouter } from "../../src/webapp/trpc/routers.js";
import { publicationsRouter } from "../../src/webapp/trpc/routers/publications.js";
import type { CloudflarePublishConnectionSummary } from "../../src/core/secrets/cloudflare-publish.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

let pubId = "abcdefghijklmnopqrstuvwxyz";
const box = await makeTmpBox();
const boxRoot = box.root;
const releaseDir = path.join(boxRoot, "staged");
await mkdir(releaseDir, { recursive: true });
let source = "<h1>First</h1>";
const store = createFakePublishStore();
const provisioning = createFakeProvisioningClient({ accountSubdomain: "example-account" });
let binding = null;
const boxHost = { boxSlug: "box-a", connectionName: "main", accountId: "0123456789abcdef0123456789abcdef", bucketName: "box-bucket", workerName: "bbx-test-host", hostHandle: "bbx-test-host", hostname: "sites.example.com", status: "attached", createdAt: "2026-09-24T00:00:00.000Z" };
let connectionRows: CloudflarePublishConnectionSummary[] = [];
let tier = "public";
let slug = "demo";
let includeSlug = true;
const runtime = {
  ...defaultManagedPublicationRuntime,
  now: () => new Date(Date.UTC(2026, 8, 24, 0, 0)),
  newHostHandle: () => "bbx-test-host",
  getBinding: async () => binding,
  reserveBinding: async (input) => (binding = { ...(binding ?? {}), ...input, accountId: "0123456789abcdef0123456789abcdef", createdAt: input.createdAt }),
  listBindings: async () => binding === null ? [] : [{ ...binding, pubId }],
  getBoxHost: async () => boxHost,
  listConnections: async () => connectionRows,
  resolveCredential: async () => ({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "placeholder" }),
  markCapability: async () => undefined,
  createStore: () => store,
  createProvisioning: () => provisioning,
  createWorkerDeployer: () => ({
    deploy: async ({ mode, scriptName, bucketName, pubId: deployedPubId, hostHandle, hostname, workerVersion }) => {
      provisioning.scripts.set(scriptName, { bindings: [
        { type: "r2_bucket", name: "PUB_STORE", bucketName },
        ...(mode === "shared" ? [
          { type: "plain_text", name: "PUB_WORKER_MODE", text: "shared-v1" },
          { type: "plain_text", name: "PUB_BOX_HANDLE", text: hostHandle },
          { type: "plain_text", name: "PUB_HOSTNAME", text: hostname },
        ] : [
          { type: "plain_text", name: "PUB_ID", text: deployedPubId },
          { type: "plain_text", name: "HOST_HANDLE", text: hostHandle },
        ]),
        { type: "plain_text", name: "PUB_WORKER_VERSION", text: workerVersion },
      ] });
    },
  }),
  workerBundle: async () => new TextEncoder().encode("worker module"),
  prepare: async ({ card }) => {
    const bytes = new TextEncoder().encode(source);
    await writeFile(path.join(releaseDir, "index.html"), bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const files = { "index.html": { bytes: bytes.length, sha256 } };
    const definition = publicationDefinitionSchema.parse({ pubId, connection: "main", content: "static", title: card, tier, ...(tier === "public" && includeSlug ? { slug } : {}), ...(tier === "accounts" ? { emails: ["member@example.com"] } : {}) });
    return { ok: true, prepared: {
      definition, pubId, contentHash: await releaseIdForFiles(files), stagedDir: releaseDir,
      files: [{ path: "index.html", bytes: bytes.length, sha256 }],
      preview: [{ path: "index.html", bytes: bytes.length, sha256 }],
      scan: { findings: [], scannedFiles: ["index.html"], skippedBinaries: [] },
      cleanup: async () => undefined,
    } };
  },
};
const sharedWorkerVersion = createHash("sha256").update(await runtime.workerBundle()).digest("hex");
provisioning.scripts.set("bbx-test-host", { bindings: [
  { type: "r2_bucket", name: "PUB_STORE", bucketName: "box-bucket" },
  { type: "plain_text", name: "PUB_WORKER_MODE", text: "shared-v1" },
  { type: "plain_text", name: "PUB_BOX_HANDLE", text: "bbx-test-host" },
  { type: "plain_text", name: "PUB_HOSTNAME", text: "sites.example.com" },
  { type: "plain_text", name: "PUB_WORKER_VERSION", text: sharedWorkerVersion },
] });
const noBus = { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} };
function publicationCaller(actor, authenticatedOwner = actor === "user", boxSlug = "box-a", injectedRuntime = runtime) {
  const user = actor === "user" ? { email: "member@example.com", name: "Member" } : null;
  return appRouter.createCaller({
    boxRoot,
    boxSlug,
    eventBus: noBus,
    services: { managedPublicationRuntime: injectedRuntime },
    user,
    authed: true,
    isOwner: actor === "user",
    isAuthenticatedOwner: authenticatedOwner,
    actor,
  });
}
function publicationConnectionsCaller(actor) {
  const user = actor === "user" ? { email: "member@example.com", name: "Member" } : null;
  return publicationsRouter.createCaller({
    boxRoot,
    boxSlug: "box-a",
    eventBus: noBus,
    services: { managedPublicationRuntime: runtime },
    user,
    authed: true,
    isOwner: actor === "user",
    isAuthenticatedOwner: actor === "user",
    actor,
  });
}
```

A first prepare writes a pending candidate and disabled edge authority.

```ts
const candidate = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
const firstManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
JSON.stringify({ status: firstManifest.status, candidate: candidate.revision.length, release: firstManifest.activeRelease.id === candidate.releaseId })
=> {"status":"disabled","candidate":64,"release":true}
```

A stale revision is refused. The current revision approves and publishes the
candidate, and disable/enable only changes the authoritative status.

```ts continue
const stale = await Promise.resolve()
  .then(() => approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: "0".repeat(64) }, runtime))
  .then(() => false, () => true);
await approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: candidate.revision }, runtime);
await disableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
const disabled = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
await enableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
const enabled = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
JSON.stringify({ stale, disabled: disabled.status, enabled: enabled.status })
=> {"stale":true,"disabled":"disabled","enabled":"live"}
```

A listed site names the card that claims its pubId.

```ts continue
const HOME_CARD = "_content/Home.publication.card";
await box.write(HOME_CARD, createPublicationCardTemplate({ pubId, connection: "main", title: "Home", tier: "public", slug: "demo" }));
const listedHome = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, runtime)).sites.find((site) => site.pubId === pubId);
({ cardPath: listedHome.cardPath, duplicateCardPaths: listedHome.duplicateCardPaths })
=> { cardPath: "_content/Home.publication.card", duplicateCardPaths: [] }
```

Two cards that claim the same pubId leave the site without a card and list
both claimants.

```ts continue
await box.write("_content/Copy.publication.card", createPublicationCardTemplate({ pubId, connection: "main", title: "Copy", tier: "public", slug: "demo" }));
const listedDuplicate = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, runtime)).sites.find((site) => site.pubId === pubId);
await rm(box.path("_content/Copy.publication.card"));
({ cardPath: listedDuplicate.cardPath, duplicateCardPaths: listedDuplicate.duplicateCardPaths })
=> { cardPath: null, duplicateCardPaths: ["_content/Copy.publication.card", "_content/Home.publication.card"] }
```

A binding whose pubId no card claims is an orphan: no card and no duplicates.

```ts continue
const orphanPubId = "qrstuvwxyzabcdefghijklmnop";
const orphanRuntime = { ...runtime, listBindings: async () => [...(await runtime.listBindings()), { ...binding, pubId: orphanPubId }] };
const orphan = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, orphanRuntime)).sites.find((site) => site.pubId === orphanPubId);
({ cardPath: orphan.cardPath, duplicateCardPaths: orphan.duplicateCardPaths })
=> { cardPath: null, duplicateCardPaths: [] }
```

Prepare through the API takes the card path and returns the card's browse URL
as the approval link.

```ts continue
const prepared = await publicationCaller("user").publications.prepare({ card: HOME_CARD });
({ cardPath: prepared.cardPath, approvalUrl: prepared.approvalUrl })
=> { cardPath: "_content/Home.publication.card", approvalUrl: "/box-a/browse/_content/Home.publication.card" }
```

Agent and open contexts cannot change serving state; a signed-in member can.

```ts continue
const actorResult = (actor) => Promise.resolve()
  .then(() => publicationCaller(actor).publications.disable({ pubId }))
  .then(() => ({ code: "allowed", message: "" }), (error) => ({ code: error.code, message: error.message }));
const agentAction = await actorResult("agent");
const openAction = await actorResult("open");
const agentApproval = await Promise.resolve()
  .then(() => publicationCaller("agent").publications.approve({ pubId, expectedRevision: candidate.revision }))
  .then(() => "allowed", (error) => error.code);
const openEnable = await Promise.resolve()
  .then(() => publicationCaller("open").publications.enable({ pubId }))
  .then(() => "allowed", (error) => error.code);
const memberAction = await actorResult("user");
const memberManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
JSON.stringify({ agentAction, openAction, agentApproval, openEnable, memberAction: memberAction.code, memberError: memberAction.message, memberStatus: memberManifest.status })
=> {"agentAction":{"code":"FORBIDDEN","message":"A signed-in member of this box must perform this action."},"openAction":{"code":"FORBIDDEN","message":"A signed-in member of this box must perform this action."},"agentApproval":"FORBIDDEN","openEnable":"FORBIDDEN","memberAction":"allowed","memberError":"","memberStatus":"disabled"}
```

Agent discovery returns only active connection names granted to this box.

```ts continue
connectionRows = [
  { name: "for-this-box", accountId: "1".repeat(32), credentialType: "account-api-token", verifiedAt: null, tokenId: "private-token-id", tokenStatus: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "unverified", workerDeploy: "unverified", accessLive: "unverified" }, grants: [{ boxSlug: "box-a", access: "server" }] },
  { name: "other-box", accountId: "2".repeat(32), credentialType: "account-api-token", verifiedAt: null, tokenId: "private-token-id-2", tokenStatus: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "unverified", workerDeploy: "unverified", accessLive: "unverified" }, grants: [{ boxSlug: "box-b", access: "server" }] },
  { name: "revoked", accountId: "3".repeat(32), credentialType: "account-api-token", verifiedAt: null, tokenId: null, tokenStatus: "revoked", capabilities: { tokenForAccount: "unverified", r2ObjectWrite: "unverified", workerDeploy: "unverified", accessLive: "unverified" }, grants: [{ boxSlug: "box-a", access: "server" }] },
];
JSON.stringify(await publicationConnectionsCaller("agent").connections())
=> {"connections":["for-this-box"]}

const openConnectionDiscovery = await Promise.resolve()
  .then(() => publicationConnectionsCaller("open").connections())
  .then(() => "allowed", (error) => error.code);
JSON.stringify({ openConnectionDiscovery })
=> {"openConnectionDiscovery":"FORBIDDEN"}
```

A changed audience stays pending and does not replace the approved live
manifest until a member approves that exact candidate.

```ts continue
tier = "secret";
connectionRows = [{ name: "main", accountId: "0123456789abcdef0123456789abcdef", credentialType: "account-api-token", verifiedAt: null, tokenId: "private-token-id", tokenStatus: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "unverified", workerDeploy: "unverified", accessLive: "unverified" }, grants: [{ boxSlug: "box-a", access: "server" }] }];
const changed = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
const remainsPublic = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
JSON.stringify({ approvedTier: remainsPublic.tier, approvedReleaseStillLive: remainsPublic.activeRelease.id === candidate.releaseId, pendingTier: changed.requestedScope.tier })
=> {"approvedTier":"public","approvedReleaseStillLive":true,"pendingTier":"secret"}
```

Enabling follows the active manifest's approved route even while a pending
candidate requests a different tier and path.

```ts continue
await enableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
const activeWithOtherCandidate = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
const activeMarker = JSON.parse(new TextDecoder().decode(await store.get(`shared-routes/${pubId}/route.json`)));
const listedWithOtherCandidate = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, runtime)).sites.find((site) => site.pubId === pubId);
JSON.stringify({ status: activeWithOtherCandidate.status, tier: activeWithOtherCandidate.tier, markerPath: activeMarker.path, reportedRoute: listedWithOtherCandidate.sharedRoute, pendingTier: listedWithOtherCandidate.pending.requestedScope.tier })
=> {"status":"live","tier":"public","markerPath":"/demo/","reportedRoute":{"hostname":"sites.example.com","path":"/demo/"},"pendingTier":"secret"}
```

Account approval fails closed until Access is actually verified.

```ts continue
tier = "accounts";
const accountCandidate = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
const accessBlocked = await Promise.resolve()
  .then(() => approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: accountCandidate.revision }, runtime))
  .then(() => false, () => true);
JSON.stringify({ accessBlocked })
=> {"accessBlocked":true}
```

```ts continue
await enableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
```

Same-scope content refresh is atomic: the new release becomes active and the
previous inventory remains available for the bounded overlap window.

```ts continue
tier = "public";
source = "<h1>Second</h1>";
const refreshed = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
const refreshedManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
JSON.stringify({
  newActive: refreshedManifest.activeRelease.id === refreshed.releaseId,
  retainedPrevious: refreshedManifest.previousRelease?.id === candidate.releaseId,
  expiresWithinTenMinutes: refreshedManifest.previousRelease !== undefined
    && Date.parse(refreshedManifest.previousRelease.expiresAt) - Date.parse(refreshed.preparedAt) === 600_000,
})
=> {"newActive":true,"retainedPrevious":true,"expiresWithinTenMinutes":true}
```

If a human disables while preparation is in progress, preparation leaves the
edge disabled and still persists the candidate for later review.

```ts continue
const originalBundle = runtime.workerBundle;
let disableDuringDeploy = true;
runtime.workerBundle = async () => {
  if (disableDuringDeploy) {
    disableDuringDeploy = false;
    await disableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
  }
  return originalBundle();
};
source = "<h1>Third</h1>";
const afterDisable = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
const afterDisableManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
JSON.stringify({ status: afterDisableManifest.status, activeUnchanged: afterDisableManifest.activeRelease.id === refreshed.releaseId, candidateExists: afterDisable.revision.length === 64 })
=> {"status":"disabled","activeUnchanged":true,"candidateExists":true}
```

Member preview reads only inventory-listed text and rejects traversal paths.

```ts continue
const preview = await previewManagedPublicationFile({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: afterDisable.revision, path: "index.html" }, runtime);
const traversalRejected = await Promise.resolve()
  .then(() => previewManagedPublicationFile({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: afterDisable.revision, path: "../pending.json" }, runtime))
  .then(() => false, () => true);
JSON.stringify({ kind: preview.kind, textMatches: preview.kind === "text" && preview.text === source, traversalRejected })
=> {"kind":"text","textMatches":true,"traversalRejected":true}
```

A failed remote write never reports a successful disable.

```ts continue
await enableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
const originalPut = store.put.bind(store);
store.put = async (key, input) => {
  if (key === `pubs/${pubId}/manifest.json`) return;
  await originalPut(key, input);
};
const writeFailure = await Promise.resolve()
  .then(() => disableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime))
  .then(() => false, () => true);
store.put = originalPut;
const afterFailedWrite = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
JSON.stringify({ writeFailure, stillLive: afterFailedWrite.status === "live" })
=> {"writeFailure":true,"stillLive":true}
```

Shared-host approval enrolls the publication with an exact route marker and, for
public sites, a slug pointer. Every refresh remains gated by the approved marker.

```ts continue
const marker = JSON.parse(new TextDecoder().decode(await store.get(`shared-routes/${pubId}/route.json`)));
const slugPointer = new TextDecoder().decode(await store.get("slugs/demo"));
JSON.stringify({ markerVersion: marker.schemaVersion, markerPub: marker.pubId, markerHost: marker.hostname, markerPath: marker.path, markerManifestHost: marker.manifestHostHandle, slugPointer })
=> {"markerVersion":1,"markerPub":"abcdefghijklmnopqrstuvwxyz","markerHost":"sites.example.com","markerPath":"/demo/","markerManifestHost":"bbx-test-host","slugPointer":"abcdefghijklmnopqrstuvwxyz"}
```

A public-path collision blocks approval before changing the live manifest. Disable
keeps the routing marker and pointer; the live manifest controls whether they
serve.

```ts continue
const beforeCollision = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
await store.put("pubs/zyxwvutsrqponmlkjihgfedcba/manifest.json", { body: JSON.stringify({ ...beforeCollision, hostHandle: "bbx-other-host", status: "live" }) });
await store.put("slugs/demo", { body: "zyxwvutsrqponmlkjihgfedcba" });
const collisionRejected = await Promise.resolve()
  .then(() => approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: afterDisable.revision }, runtime))
  .then(() => false, (error) => error.message.includes("already assigned"));
const afterCollision = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
await store.put("slugs/demo", { body: pubId });
await store.delete("pubs/zyxwvutsrqponmlkjihgfedcba/manifest.json");
await disableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
JSON.stringify({ collisionRejected, manifestUnchanged: afterCollision.status === beforeCollision.status, markerRetained: (await store.get(`shared-routes/${pubId}/route.json`)) !== null, pointerRetained: new TextDecoder().decode(await store.get("slugs/demo")) === pubId, disabled: siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`)))).status })
=> {"collisionRejected":true,"manifestUnchanged":true,"markerRetained":true,"pointerRetained":true,"disabled":"disabled"}
```

After an approved slug changes, its old pointer is harmless because the live
manifest no longer claims that path. A second publication can then claim it.

```ts continue
slug = "moved";
const moved = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
await approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: moved.revision }, runtime);
const oldPointerRemains = new TextDecoder().decode(await store.get("slugs/demo")) === pubId;
const movedManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
const oldPathInert = movedManifest.slug !== "demo";
pubId = "zyxwvutsrqponmlkjihgfedcba";
binding = null;
slug = "demo";
const reclaimed = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Other.publication.card", ownerEmail: null }, runtime);
await approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: reclaimed.revision }, runtime);
JSON.stringify({ oldPointerRemains, oldPathInert, reclaimedBy: new TextDecoder().decode(await store.get("slugs/demo")) })
=> {"oldPointerRemains":true,"oldPathInert":true,"reclaimedBy":"zyxwvutsrqponmlkjihgfedcba"}
```

The old per-publication hostname assignment procedure is no longer available;
legacy hostname fields remain readable for existing bindings and Worker URLs.

Admin shared-host setup is owner-only. It reserves the mapping, creates a fresh
bucket, deploys a versioned Worker with disabled aliases, attaches the hostname,
and verifies Cloudflare readback. Retrying an attached mapping is idempotent;
renaming it is refused before another provider mutation.

```ts continue
const adminProvisioning = createFakeProvisioningClient({ zones: [{ id: "config-zone", name: "example.org", status: "active", accountId: "0123456789abcdef0123456789abcdef" }] });
let adminMapping = null;
let adminDeploys = 0;
const configRuntime = {
  ...runtime,
  getBoxHost: async (requestedBox) => requestedBox === "box-config" ? adminMapping : null,
  listBindings: async () => [],
  reserveBoxHost: async (input) => {
    if (adminMapping !== null && (adminMapping.hostname !== input.hostname || adminMapping.connectionName !== input.connectionName)) throw new Error("This box already has a shared publishing hostname and connection. Bee Box cannot rename or move it.");
    adminMapping ??= { ...input, accountId: "0123456789abcdef0123456789abcdef", status: "pending" };
    return { boxSlug: input.boxSlug, ...adminMapping };
  },
  attachBoxHost: async (input) => {
    if (adminMapping === null || adminMapping.hostname !== input.hostname) throw new Error("mapping changed");
    adminMapping.status = "attached";
    return { boxSlug: input.boxSlug, ...adminMapping };
  },
  createProvisioning: () => adminProvisioning,
  createWorkerDeployer: () => ({ deploy: async (input) => {
    adminDeploys += 1;
    adminProvisioning.scripts.set(input.scriptName, { bindings: [
      { type: "r2_bucket", name: "PUB_STORE", bucketName: input.bucketName },
      { type: "plain_text", name: "PUB_WORKER_MODE", text: "shared-v1" },
      { type: "plain_text", name: "PUB_BOX_HANDLE", text: input.hostHandle },
      { type: "plain_text", name: "PUB_HOSTNAME", text: input.hostname },
      { type: "plain_text", name: "PUB_WORKER_VERSION", text: input.workerVersion },
    ] });
  } }),
};
const adminCaller = (actor, authenticatedOwner = actor === "user") => publicationCaller(actor, authenticatedOwner, "box-config", configRuntime);
const unauthorizedSetup = await Promise.resolve()
  .then(() => adminCaller("user", false).publications.configureSharedHost({ connectionName: "main", hostname: "sites.example.org" }))
  .then(() => "allowed", (error) => error.code);
const setup = await adminCaller("user").publications.configureSharedHost({ connectionName: "main", hostname: "Sites.Example.org." });
const retriedSetup = await adminCaller("user").publications.configureSharedHost({ connectionName: "main", hostname: "sites.example.org" });
const renamedHost = await Promise.resolve()
  .then(() => adminCaller("user").publications.configureSharedHost({ connectionName: "main", hostname: "other.example.org" }))
  .then(() => "allowed", (error) => error.message);
JSON.stringify({ unauthorizedSetup, setup, retryStatus: retriedSetup.status, renameRejected: renamedHost.includes("cannot rename"), deploys: adminDeploys, attachments: adminProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length, aliases: adminProvisioning.scriptSubdomains.get("bbx-test-host") })
=> {"unauthorizedSetup":"FORBIDDEN","setup":{"hostname":"sites.example.org","connectionName":"main","status":"attached"},"retryStatus":"attached","renameRejected":true,"deploys":1,"attachments":1,"aliases":{"enabled":false,"previewsEnabled":false}}
```

Shared-host setup fails closed on a conflicting route or missing readback. A
retry after Cloudflare attached the exact route but its response was lost
recognizes that route without attaching it twice.

```ts continue
function setupScenario(boxSlug, provisioning) {
  let mapping = null;
  let deploys = 0;
  const scenarioRuntime = {
    ...configRuntime,
    newHostHandle: () => `${boxSlug}-host`,
    getBoxHost: async (requestedBox) => requestedBox === boxSlug ? mapping : null,
    reserveBoxHost: async (input) => {
      mapping ??= { ...input, accountId: "0123456789abcdef0123456789abcdef", status: "pending" };
      return { boxSlug: input.boxSlug, ...mapping };
    },
    attachBoxHost: async (input) => {
      if (mapping === null || mapping.hostname !== input.hostname) throw new Error("mapping changed");
      mapping.status = "attached";
      return { boxSlug: input.boxSlug, ...mapping };
    },
    createProvisioning: () => provisioning,
    createWorkerDeployer: () => ({ deploy: async (input) => {
      deploys += 1;
      provisioning.scripts.set(input.scriptName, { bindings: [
        { type: "r2_bucket", name: "PUB_STORE", bucketName: input.bucketName },
        { type: "plain_text", name: "PUB_WORKER_MODE", text: "shared-v1" },
        { type: "plain_text", name: "PUB_BOX_HANDLE", text: input.hostHandle },
        { type: "plain_text", name: "PUB_HOSTNAME", text: input.hostname },
        { type: "plain_text", name: "PUB_WORKER_VERSION", text: input.workerVersion },
      ] });
    } }),
  };
  return { mapping: () => mapping, deploys: () => deploys, caller: () => publicationCaller("user", true, boxSlug, scenarioRuntime) };
}
const zones = [{ id: "config-zone", name: "example.org", status: "active", accountId: "0123456789abcdef0123456789abcdef" }];
const conflictProvisioning = createFakeProvisioningClient({ zones, workerDomains: [{ id: "foreign", hostname: "conflict.example.org", service: "another-worker", environment: "production", zoneId: "config-zone", zoneName: "example.org" }] });
const conflictSetup = setupScenario("box-conflict", conflictProvisioning);
const conflictError = await Promise.resolve()
  .then(() => conflictSetup.caller().publications.configureSharedHost({ connectionName: "main", hostname: "conflict.example.org" }))
  .then(() => "allowed", (error) => error.message);

const missingReadbackProvisioning = createFakeProvisioningClient({ zones });
missingReadbackProvisioning.listWorkerDomains = async () => [];
missingReadbackProvisioning.attachWorkerDomain = async (input) => ({ id: "not-readable", ...input, environment: "production" });
const missingReadback = setupScenario("box-readback", missingReadbackProvisioning);
const missingReadbackError = await Promise.resolve()
  .then(() => missingReadback.caller().publications.configureSharedHost({ connectionName: "main", hostname: "readback.example.org" }))
  .then(() => "allowed", (error) => error.message);

const lostResponseProvisioning = createFakeProvisioningClient({ zones });
const attachDomain = lostResponseProvisioning.attachWorkerDomain.bind(lostResponseProvisioning);
let loseResponse = true;
lostResponseProvisioning.attachWorkerDomain = async (input) => {
  const attached = await attachDomain(input);
  if (loseResponse) { loseResponse = false; throw new Error("provider response lost"); }
  return attached;
};
const lostResponse = setupScenario("box-lost-response", lostResponseProvisioning);
const firstAttempt = await Promise.resolve()
  .then(() => lostResponse.caller().publications.configureSharedHost({ connectionName: "main", hostname: "lost-response.example.org" }))
  .then(() => "attached", () => "pending");
const secondAttempt = await lostResponse.caller().publications.configureSharedHost({ connectionName: "main", hostname: "lost-response.example.org" });

const legacyScript = { bindings: [{ type: "plain_text", name: "PUB_ID", text: "legacy-publication" }] };
adminProvisioning.scripts.set("legacy-worker-sentinel", legacyScript);
const beforeRepairAttachments = adminProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length;
const changedBundleRuntime = { ...configRuntime, workerBundle: async () => new TextEncoder().encode("updated shared worker") };
await publicationCaller("user", true, "box-config", changedBundleRuntime).publications.configureSharedHost({ connectionName: "main", hostname: "sites.example.org" });
JSON.stringify({
  conflictRefused: conflictError.includes("routes this hostname to another Worker"), conflictAttaches: conflictProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length,
  missingReadbackFailed: missingReadbackError.includes("did not confirm"), missingReadbackStatus: missingReadback.mapping().status,
  lostResponseFirstAttempt: firstAttempt, retryStatus: secondAttempt.status, retryAttaches: lostResponseProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length,
  staleBundleRedeployed: adminDeploys === 2, repairDidNotReattach: adminProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length === beforeRepairAttachments,
  legacyScriptUnchanged: JSON.stringify(adminProvisioning.scripts.get("legacy-worker-sentinel")) === JSON.stringify(legacyScript),
})
=> {"conflictRefused":true,"conflictAttaches":0,"missingReadbackFailed":true,"missingReadbackStatus":"pending","lostResponseFirstAttempt":"pending","retryStatus":"attached","retryAttaches":1,"staleBundleRedeployed":true,"repairDidNotReattach":true,"legacyScriptUnchanged":true}
```

A selected-connection legacy public publication without a slug can still
refresh and receive member approval on its existing Worker URL. It does not
silently join the shared host until the definition opts in with a slug.

```ts continue
const legacyPubId = "234567abcdefghijklmnopqrst";
pubId = legacyPubId;
includeSlug = false;
const legacyBinding = { pubId: legacyPubId, boxSlug: "box-a", connectionName: "main", accountId: "0123456789abcdef0123456789abcdef", bucketName: "box-bucket", workerName: "bbx-legacy-worker", hostHandle: "bbx-legacy-host", createdAt: "2026-09-24T00:00:00.000Z" };
const legacyRuntime = {
  ...runtime,
  getBinding: async () => legacyBinding,
  reserveBinding: async () => legacyBinding,
  listBindings: async () => [legacyBinding],
};
const legacyCandidate = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Legacy.publication.card", ownerEmail: null }, legacyRuntime);
const legacyScope = legacyCandidate.requestedScope;
await approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId: legacyPubId, expectedRevision: legacyCandidate.revision }, legacyRuntime);
const legacySite = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, legacyRuntime)).sites[0];
JSON.stringify({ hasSharedScope: "sharedHost" in legacyScope, status: legacySite.approved?.status ?? null, legacyAlias: legacySite.hostname })
=> {"hasSharedScope":false,"status":"live","legacyAlias":"bbx-legacy-host.example-account.workers.dev"}
```

```ts teardown
await box.cleanup();
```
