# Managed publication candidates preserve human control

Preparation uploads immutable release bytes and a review candidate while a new
publication remains disabled. Approval requires the current candidate revision.
Disabling only changes the edge authority; it does not remove the Worker route.

```ts setup
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakePublishStore } from "../../src/services/publish-remote-store.js";
import { createFakeProvisioningClient } from "../../src/services/cloudflare-provisioning.js";
import { releaseIdForFiles, siteEdgeManifestSchema } from "../../src/publish/manifest-edge.js";
import { publicationDefinitionSchema } from "../../src/publish/publication-definition.js";
import { defaultManagedPublicationRuntime } from "../../src/services/managed-publication-runtime.js";
import { prepareManagedPublication } from "../../src/publish/managed-publications.js";
import { approveManagedPublication, disableManagedPublication, enableManagedPublication } from "../../src/publish/managed-publication-actions.js";
import { previewManagedPublicationFile } from "../../src/publish/managed-publication-queries.js";
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

const pubId = "abcdefghijklmnopqrstuvwxyz";
const box = await makeTmpBox();
const boxRoot = box.root;
const releaseDir = path.join(boxRoot, "staged");
await mkdir(releaseDir, { recursive: true });
let source = "<h1>First</h1>";
const store = createFakePublishStore();
const provisioning = createFakeProvisioningClient({ accountSubdomain: "example-account" });
let binding = null;
let tier = "public";
const runtime = {
  ...defaultManagedPublicationRuntime,
  now: () => new Date(Date.UTC(2026, 8, 24, 0, 0)),
  newHostHandle: () => "bbx-test-host",
  getBinding: async () => binding,
  reserveBinding: async (input) => (binding = { ...input, accountId: "0123456789abcdef0123456789abcdef", createdAt: input.createdAt }),
  listBindings: async () => binding === null ? [] : [{ ...binding, pubId }],
  listConnections: async () => [],
  resolveCredential: async () => ({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "placeholder" }),
  markCapability: async () => undefined,
  createStore: () => store,
  createProvisioning: () => provisioning,
  createWorkerDeployer: () => ({
    deploy: async ({ scriptName, bucketName, pubId: deployedPubId, hostHandle, workerVersion }) => {
      provisioning.scripts.set(scriptName, { bindings: [
        { type: "r2_bucket", name: "PUB_STORE", bucketName },
        { type: "plain_text", name: "PUB_ID", text: deployedPubId },
        { type: "plain_text", name: "HOST_HANDLE", text: hostHandle },
        { type: "plain_text", name: "PUB_WORKER_VERSION", text: workerVersion },
      ] });
    },
  }),
  workerBundle: async () => new TextEncoder().encode("worker module"),
  prepare: async ({ name }) => {
    const bytes = new TextEncoder().encode(source);
    await writeFile(path.join(releaseDir, "index.html"), bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const files = { "index.html": { bytes: bytes.length, sha256 } };
    const definition = publicationDefinitionSchema.parse({ pubId, connection: "main", content: "static", title: name, tier, ...(tier === "public" ? { slug: "demo" } : {}), ...(tier === "accounts" ? { emails: ["member@example.com"] } : {}) });
    return { ok: true, prepared: {
      definition, pubId, contentHash: await releaseIdForFiles(files), stagedDir: releaseDir,
      files: [{ path: "index.html", bytes: bytes.length, sha256 }],
      preview: [{ path: "index.html", bytes: bytes.length, sha256 }],
      scan: { findings: [], scannedFiles: ["index.html"], skippedBinaries: [] },
      cleanup: async () => undefined,
    } };
  },
};
const noBus = { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} };
function publicationCaller(actor) {
  const user = actor === "user" ? { email: "member@example.com", name: "Member" } : null;
  return appRouter.createCaller({
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
const candidate = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", name: "home", ownerEmail: null }, runtime);
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

A changed audience stays pending and does not replace the approved live
manifest until a member approves that exact candidate.

```ts continue
tier = "secret";
const changed = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", name: "home", ownerEmail: null }, runtime);
const remainsPublic = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
JSON.stringify({ approvedTier: remainsPublic.tier, approvedReleaseStillLive: remainsPublic.activeRelease.id === candidate.releaseId, pendingTier: changed.requestedScope.tier })
=> {"approvedTier":"public","approvedReleaseStillLive":true,"pendingTier":"secret"}
```

Account approval fails closed until Access is actually verified.

```ts continue
tier = "accounts";
const accountCandidate = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", name: "home", ownerEmail: null }, runtime);
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
const refreshed = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", name: "home", ownerEmail: null }, runtime);
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
const afterDisable = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", name: "home", ownerEmail: null }, runtime);
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

```ts teardown
await box.cleanup();
```
