// # Managed publication candidates preserve human control
//
// Preparation uploads immutable release bytes and a review candidate while a new
// publication remains disabled. Approval requires the current candidate revision.
// Disabling only changes the edge authority; it does not remove the Worker route.

import { after, test } from "tap";
import "@ianbicking/tap-check/tap";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakePublishStore } from "../../src/services/publish-remote-store.js";
import { createFakeProvisioningClient } from "../../src/services/cloudflare-provisioning/core.js";
import { releaseIdForFiles, siteEdgeManifestSchema } from "../../src/publish/manifest-edge.js";
import { publicationDefinitionSchema } from "../../src/publish/publication-definition.js";
import { createPublicationCardTemplate } from "../../src/schemas/publication.js";
import { defaultManagedPublicationRuntime } from "../../src/services/managed-publication-runtime/core.js";
import { prepareManagedPublication } from "../../src/publish/managed-publications/core.js";
import { approveManagedPublication, disableManagedPublication, enableManagedPublication } from "../../src/publish/managed-publication-actions.js";
import { listManagedPublications, readManagedPublicationReleaseFile } from "../../src/publish/managed-publication-queries.js";
import { appRouter } from "../../src/webapp/trpc/routers.js";
import { publicationsRouter } from "../../src/webapp/trpc/routers/publications.js";
import type { CloudflarePublishBinding, CloudflarePublishBoxHost, CloudflarePublishConnectionSummary } from "../../src/core/secrets/cloudflare-publish.js";
import type { FakeProvisioningClient } from "../../src/services/cloudflare-provisioning/core.js";
import type { ManagedPublicationRuntime } from "../../src/services/managed-publication-runtime/core.js";
import type { TrpcActor } from "../../src/webapp/trpc/context.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { trpcContext } from "../helpers/trpc-context.js";

type PreparedCandidate = Awaited<ReturnType<typeof prepareManagedPublication>>;
const HOME_CARD = "_content/Home.publication.card";
// Candidates carried from one test to the next; tests run in file order.
let candidate!: PreparedCandidate;
let refreshed!: PreparedCandidate;
let afterDisable!: PreparedCandidate;
let pubId = "abcdefghijklmnopqrstuvwxyz";
const box = await makeTmpBox();
const boxRoot = box.root;
const releaseDir = path.join(boxRoot, "staged");
await mkdir(releaseDir, { recursive: true });
let source = "<h1>First</h1>";
const store = createFakePublishStore();
const provisioning = createFakeProvisioningClient({ accountSubdomain: "example-account" });
let binding: CloudflarePublishBinding | null = null;
const boxHost: CloudflarePublishBoxHost = { boxSlug: "box-a", connectionName: "main", accountId: "0123456789abcdef0123456789abcdef", bucketName: "box-bucket", workerName: "bbx-test-host", hostHandle: "bbx-test-host", hostname: "sites.example.com", status: "attached", createdAt: "2026-09-24T00:00:00.000Z" };
let connectionRows: CloudflarePublishConnectionSummary[] = [];
let tier = "public";
let slug = "demo";
let includeSlug = true;
const runtime: ManagedPublicationRuntime = {
  ...defaultManagedPublicationRuntime,
  now: () => new Date(Date.UTC(2026, 8, 24, 0, 0)),
  newHostHandle: () => "bbx-test-host",
  getBinding: async () => binding,
  reserveBinding: async (input) => (binding = { ...binding, ...input, accountId: "0123456789abcdef0123456789abcdef", createdAt: input.createdAt }),
  listBindings: async () => binding === null ? [] : [{ ...binding, pubId }],
  getBoxHost: async () => boxHost,
  listConnections: async () => connectionRows,
  resolveCredential: async () => ({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "placeholder" }),
  markCapability: async () => {},
  createStore: () => store,
  createProvisioning: () => provisioning,
  createWorkerDeployer: () => ({
    deploy: async (args) => {
      provisioning.scripts.set(args.scriptName, { bindings: [
        { type: "r2_bucket", name: "PUB_STORE", bucketName: args.bucketName },
        ...(args.mode === "shared" ? [
          { type: "plain_text", name: "PUB_WORKER_MODE", text: "shared-v1" },
          { type: "plain_text", name: "PUB_BOX_HANDLE", text: args.hostHandle },
          { type: "plain_text", name: "PUB_HOSTNAME", text: args.hostname },
        ] : [
          { type: "plain_text", name: "PUB_ID", text: args.pubId },
          { type: "plain_text", name: "HOST_HANDLE", text: args.hostHandle },
        ]),
        { type: "plain_text", name: "PUB_WORKER_VERSION", text: args.workerVersion },
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
      cleanup: async () => {},
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
function publicationCaller(actor: TrpcActor, options?: { authenticatedOwner?: boolean | undefined; boxSlug?: string; runtime?: ManagedPublicationRuntime }) {
  const user = actor === "user" ? { email: "member@example.com", name: "Member" } : null;
  return appRouter.createCaller(trpcContext({
    boxRoot,
    boxSlug: options?.boxSlug ?? "box-a",
    services: { managedPublicationRuntime: options?.runtime ?? runtime },
    user,
    isOwner: actor === "user",
    isAuthenticatedOwner: options?.authenticatedOwner ?? actor === "user",
    actor,
  }));
}
function publicationConnectionsCaller(actor: TrpcActor) {
  const user = actor === "user" ? { email: "member@example.com", name: "Member" } : null;
  return publicationsRouter.createCaller(trpcContext({
    boxRoot,
    boxSlug: "box-a",
    services: { managedPublicationRuntime: runtime },
    user,
    isOwner: actor === "user",
    isAuthenticatedOwner: actor === "user",
    actor,
  }));
}

function setupScenario(base: ManagedPublicationRuntime, scenario: { boxSlug: string; provisioning: FakeProvisioningClient }) {
  const { boxSlug, provisioning: scenarioProvisioning } = scenario;
  let mapping: CloudflarePublishBoxHost | null = null;
  let deploys = 0;
  const scenarioRuntime: ManagedPublicationRuntime = {
    ...base,
    newHostHandle: () => `${boxSlug}-host`,
    getBoxHost: async (requestedBox) => requestedBox === boxSlug ? mapping : null,
    reserveBoxHost: async (input) => {
      mapping ??= { ...input, accountId: "0123456789abcdef0123456789abcdef", status: "pending" };
      return { ...mapping };
    },
    attachBoxHost: async (input) => {
      if (mapping === null || mapping.hostname !== input.hostname) throw new Error("mapping changed");
      mapping.status = "attached";
      return { ...mapping };
    },
    createProvisioning: () => scenarioProvisioning,
    createWorkerDeployer: () => ({ deploy: async (input) => {
      assert.ok(input.mode === "shared");
      deploys += 1;
      scenarioProvisioning.scripts.set(input.scriptName, { bindings: [
        { type: "r2_bucket", name: "PUB_STORE", bucketName: input.bucketName },
        { type: "plain_text", name: "PUB_WORKER_MODE", text: "shared-v1" },
        { type: "plain_text", name: "PUB_BOX_HANDLE", text: input.hostHandle },
        { type: "plain_text", name: "PUB_HOSTNAME", text: input.hostname },
        { type: "plain_text", name: "PUB_WORKER_VERSION", text: input.workerVersion },
      ] });
    } }),
  };
  return { mapping: () => mapping, deploys: () => deploys, caller: () => publicationCaller("user", { boxSlug, runtime: scenarioRuntime }) };
}

after(async () => {
  try {
    await box.cleanup();
  } catch (error) {
    console.error("teardown failed:", error);
    process.exitCode = 1;
  }
});

// A first prepare writes a pending candidate and disabled edge authority.
void test("A first prepare writes a pending candidate and disabled edge authority.", async (t) => {
  candidate = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
  const firstManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
  t.check({ status: firstManifest.status, candidate: candidate.revision.length, release: firstManifest.activeRelease.id === candidate.releaseId }, {
    status: "disabled",
    candidate: 64,
    release: true,
  });

  // A stale revision is refused. The current revision approves and publishes the
  // candidate, and disable/enable only changes the authoritative status.

  const stale = await Promise.resolve()
    .then(() => approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: "0".repeat(64) }, runtime))
    .then(() => false, () => true);
  await approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: candidate.revision }, runtime);
  await disableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
  const disabled = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
  await enableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
  const enabled = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
  t.check({ stale, disabled: disabled.status, enabled: enabled.status }, {
    stale: true,
    disabled: "disabled",
    enabled: "live",
  });

  // A listed site names the card that claims its pubId.
});

// Listing names the card that claims each pubId.
void test("listing names the claiming card", async (t) => {
  await box.write(HOME_CARD, createPublicationCardTemplate({ pubId, connection: "main", title: "Home", tier: "public", slug: "demo" }));
  const listedHome = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, runtime)).sites.find((site) => site.pubId === pubId);
  t.check(({ cardPath: listedHome?.cardPath, duplicateCardPaths: listedHome?.duplicateCardPaths }), {
    cardPath: "_content/Home.publication.card",
    duplicateCardPaths: [],
  });

  // Two cards that claim the same pubId leave the site without a card and list
  // both claimants.

  await box.write("_content/Copy.publication.card", createPublicationCardTemplate({ pubId, connection: "main", title: "Copy", tier: "public", slug: "demo" }));
  const listedDuplicate = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, runtime)).sites.find((site) => site.pubId === pubId);
  await rm(box.path("_content/Copy.publication.card"));
  t.check(({ cardPath: listedDuplicate?.cardPath, duplicateCardPaths: listedDuplicate?.duplicateCardPaths }), {
    cardPath: null,
    duplicateCardPaths: [
      "_content/Copy.publication.card",
      "_content/Home.publication.card",
    ],
  });

  // A binding whose pubId no card claims is an orphan: no card and no duplicates.

  const orphanPubId = "qrstuvwxyzabcdefghijklmnop";
  assert.ok(binding !== null);
  const orphanBinding: CloudflarePublishBinding = { ...binding, pubId: orphanPubId };
  const orphanRuntime: ManagedPublicationRuntime = { ...runtime, listBindings: async (boxSlug) => [...(await runtime.listBindings(boxSlug)), orphanBinding] };
  const orphan = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, orphanRuntime)).sites.find((site) => site.pubId === orphanPubId);
  t.check(({ cardPath: orphan?.cardPath, duplicateCardPaths: orphan?.duplicateCardPaths }), {
    cardPath: null,
    duplicateCardPaths: [],
  });

  // Prepare through the API takes the card path and returns the card's browse URL
  // as the approval link.
});

// API prepare and member-only actions.
void test("the API prepares and restricts serving changes to members", async (t) => {
  const prepared = await publicationCaller("user").publications.prepare({ card: HOME_CARD });
  t.check(({ cardPath: prepared.cardPath, approvalUrl: prepared.approvalUrl }), {
    cardPath: "_content/Home.publication.card",
    approvalUrl: "/box-a/browse/_content/Home.publication.card",
  });

  // Agent and open contexts cannot change serving state; a signed-in member can.

  const actorResult = (actor: TrpcActor) => Promise.resolve()
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
  t.check({ agentAction, openAction, agentApproval, openEnable, memberAction: memberAction.code, memberError: memberAction.message, memberStatus: memberManifest.status }, {
    agentAction: {
      code: "FORBIDDEN",
      message: "A signed-in member of this box must perform this action.",
    },
    openAction: {
      code: "FORBIDDEN",
      message: "A signed-in member of this box must perform this action.",
    },
    agentApproval: "FORBIDDEN",
    openEnable: "FORBIDDEN",
    memberAction: "allowed",
    memberError: "",
    memberStatus: "disabled",
  });

  // Agent discovery returns only active connection names granted to this box.

  connectionRows = [
    { name: "for-this-box", accountId: "1".repeat(32), credentialType: "account-api-token", verifiedAt: null, tokenId: "private-token-id", tokenStatus: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "unverified", workerDeploy: "unverified", accessLive: "unverified" }, grants: [{ boxSlug: "box-a", access: "server" }] },
    { name: "other-box", accountId: "2".repeat(32), credentialType: "account-api-token", verifiedAt: null, tokenId: "private-token-id-2", tokenStatus: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "unverified", workerDeploy: "unverified", accessLive: "unverified" }, grants: [{ boxSlug: "box-b", access: "server" }] },
    { name: "revoked", accountId: "3".repeat(32), credentialType: "account-api-token", verifiedAt: null, tokenId: null, tokenStatus: "revoked", capabilities: { tokenForAccount: "unverified", r2ObjectWrite: "unverified", workerDeploy: "unverified", accessLive: "unverified" }, grants: [{ boxSlug: "box-a", access: "server" }] },
  ];
  t.check(await publicationConnectionsCaller("agent").connections(), {
    connections: [
      "for-this-box",
    ],
  });

  const openConnectionDiscovery = await Promise.resolve()
    .then(() => publicationConnectionsCaller("open").connections())
    .then(() => "allowed", (error) => error.code);
  t.check({ openConnectionDiscovery }, {
    openConnectionDiscovery: "FORBIDDEN",
  });

  // A changed audience stays pending and does not replace the approved live
  // manifest until a member approves that exact candidate.
});

// Pending audience changes and release refresh.
void test("changed audience stays pending and refresh keeps the previous release", async (t) => {
  tier = "secret";
  connectionRows = [{ name: "main", accountId: "0123456789abcdef0123456789abcdef", credentialType: "account-api-token", verifiedAt: null, tokenId: "private-token-id", tokenStatus: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "unverified", workerDeploy: "unverified", accessLive: "unverified" }, grants: [{ boxSlug: "box-a", access: "server" }] }];
  const changed = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
  const remainsPublic = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
  t.check({ approvedTier: remainsPublic.tier, approvedReleaseStillLive: remainsPublic.activeRelease.id === candidate.releaseId, pendingTier: changed.requestedScope.tier }, {
    approvedTier: "public",
    approvedReleaseStillLive: true,
    pendingTier: "secret",
  });

  // Enabling follows the active manifest's approved route even while a pending
  // candidate requests a different tier and path.

  await enableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);
  const activeWithOtherCandidate = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
  const activeMarker = JSON.parse(new TextDecoder().decode(await store.get(`shared-routes/${pubId}/route.json`)));
  const listedWithOtherCandidate = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, runtime)).sites.find((site) => site.pubId === pubId);
  t.check({ status: activeWithOtherCandidate.status, tier: activeWithOtherCandidate.tier, markerPath: activeMarker.path, reportedRoute: listedWithOtherCandidate?.sharedRoute, pendingTier: listedWithOtherCandidate?.pending?.requestedScope.tier }, {
    status: "live",
    tier: "public",
    markerPath: "/demo/",
    reportedRoute: {
      hostname: "sites.example.com",
      path: "/demo/",
    },
    pendingTier: "secret",
  });

  // Account approval fails closed until Access is actually verified.

  tier = "accounts";
  const accountCandidate = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
  const accessBlocked = await Promise.resolve()
    .then(() => approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: accountCandidate.revision }, runtime))
    .then(() => false, () => true);
  t.check({ accessBlocked }, {
    accessBlocked: true,
  });

  await enableManagedPublication({ boxRoot, boxSlug: "box-a", pubId }, runtime);

  // Same-scope content refresh is atomic: the new release becomes active and the
  // previous inventory remains available for the bounded overlap window.

  tier = "public";
  source = "<h1>Second</h1>";
  refreshed = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
  const refreshedManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
  t.check(
    {
      newActive: refreshedManifest.activeRelease.id === refreshed.releaseId,
      retainedPrevious: refreshedManifest.previousRelease?.id === candidate.releaseId,
      expiresWithinTenMinutes: refreshedManifest.previousRelease !== undefined
        && Date.parse(refreshedManifest.previousRelease.expiresAt) - Date.parse(refreshed.preparedAt) === 600_000,
    },
    {
    newActive: true,
    retainedPrevious: true,
    expiresWithinTenMinutes: true,
  },
  );

  // If a human disables while preparation is in progress, preparation leaves the
  // edge disabled and still persists the candidate for later review.
});

// Disable during preparation, release file reads.
void test("disable during preparation and release file reads", async (t) => {
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
  afterDisable = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
  const afterDisableManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
  t.check({ status: afterDisableManifest.status, activeUnchanged: afterDisableManifest.activeRelease.id === refreshed.releaseId, candidateExists: afterDisable.revision.length === 64 }, {
    status: "disabled",
    activeUnchanged: true,
    candidateExists: true,
  });

  // Release file reads cover the active release and the pending candidate only.
  // They read inventory-listed text and reject traversal paths, unknown paths,
  // retired releases, and another box's publication.

  const scopedRuntime: ManagedPublicationRuntime = { ...runtime, getBinding: async (query) => (query.boxSlug === "box-a" && query.pubId === pubId ? binding : null) };
  const read = (overrides: { releaseId?: string; path?: string; boxSlug?: string }) => readManagedPublicationReleaseFile({ boxRoot, boxSlug: "box-a", pubId, releaseId: afterDisable.releaseId, path: "index.html", ...overrides }, scopedRuntime);
  const rejection = (overrides: { releaseId?: string; path?: string; boxSlug?: string }) => read(overrides).then(() => "accepted", (error) => error.message);
  const pendingFile = await read({});
  const activeFile = await read({ releaseId: refreshed.releaseId });
  t.check(
    {
      pending: pendingFile.kind === "text" && pendingFile.text === source,
      active: activeFile.kind === "text" && activeFile.text !== source && activeFile.text.length > 0,
      previousDiffers: candidate.releaseId !== refreshed.releaseId && candidate.releaseId !== afterDisable.releaseId,
      previous: await rejection({ releaseId: candidate.releaseId }),
      unknown: await rejection({ releaseId: "f".repeat(64) }),
      traversal: await rejection({ path: "../pending.json" }),
      missing: await rejection({ path: "missing.html" }),
      otherBox: await rejection({ boxSlug: "box-b" }),
    },
    {
    pending: true,
    active: true,
    previousDiffers: true,
    previous: "That release is neither the active release nor the pending candidate.",
    unknown: "That release is neither the active release nor the pending candidate.",
    traversal: "Invalid publication file path.",
    missing: "That path is not in the release inventory.",
    otherBox: "Publication is not registered on this server.",
  },
  );

  // The box agent may read release files through `releaseFile`, but it still
  // cannot approve, enable, or disable.

  const agent = publicationCaller("agent").publications;
  const agentRead = await agent.releaseFile({ pubId, releaseId: afterDisable.releaseId, path: "index.html" });
  const refused = (call: () => Promise<unknown>) => Promise.resolve().then(call).then(() => "accepted", (error) => error.code);
  t.check(
    {
      read: agentRead.kind,
      approve: await refused(() => agent.approve({ pubId, expectedRevision: afterDisable.revision })),
      enable: await refused(() => agent.enable({ pubId })),
      disable: await refused(() => agent.disable({ pubId })),
    },
    {
    read: "text",
    approve: "FORBIDDEN",
    enable: "FORBIDDEN",
    disable: "FORBIDDEN",
  },
  );

  // A failed remote write never reports a successful disable.
});

// Remote write failures, routes, and slug moves.
void test("shared routes survive disable and slug moves", async (t) => {
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
  t.check({ writeFailure, stillLive: afterFailedWrite.status === "live" }, {
    writeFailure: true,
    stillLive: true,
  });

  // Shared-host approval enrolls the publication with an exact route marker and, for
  // public sites, a slug pointer. Every refresh remains gated by the approved marker.

  const marker = JSON.parse(new TextDecoder().decode(await store.get(`shared-routes/${pubId}/route.json`)));
  const slugPointer = new TextDecoder().decode(await store.get("slugs/demo"));
  t.check({ markerVersion: marker.schemaVersion, markerPub: marker.pubId, markerHost: marker.hostname, markerPath: marker.path, markerManifestHost: marker.manifestHostHandle, slugPointer }, {
    markerVersion: 1,
    markerPub: "abcdefghijklmnopqrstuvwxyz",
    markerHost: "sites.example.com",
    markerPath: "/demo/",
    markerManifestHost: "bbx-test-host",
    slugPointer: "abcdefghijklmnopqrstuvwxyz",
  });

  // A public-path collision blocks approval before changing the live manifest. Disable
  // keeps the routing marker and pointer; the live manifest controls whether they
  // serve.

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
  t.check({ collisionRejected, manifestUnchanged: afterCollision.status === beforeCollision.status, markerRetained: (await store.get(`shared-routes/${pubId}/route.json`)) !== null, pointerRetained: new TextDecoder().decode(await store.get("slugs/demo")) === pubId, disabled: siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`)))).status }, {
    collisionRejected: true,
    manifestUnchanged: true,
    markerRetained: true,
    pointerRetained: true,
    disabled: "disabled",
  });

  // After an approved slug changes, its old pointer is harmless because the live
  // manifest no longer claims that path. A second publication can then claim it.

  slug = "moved";
  const moved = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Home.publication.card", ownerEmail: null }, runtime);
  await approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: moved.revision }, runtime);
  const oldPointerRemains = new TextDecoder().decode(await store.get("slugs/demo")) === pubId;
  const movedManifest = siteEdgeManifestSchema.parse(JSON.parse(new TextDecoder().decode(await store.get(`pubs/${pubId}/manifest.json`))));
  const oldPathInert = movedManifest.tier === "public" && movedManifest.slug !== "demo";
  pubId = "zyxwvutsrqponmlkjihgfedcba";
  binding = null;
  slug = "demo";
  const reclaimed = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Other.publication.card", ownerEmail: null }, runtime);
  await approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId, expectedRevision: reclaimed.revision }, runtime);
  t.check({ oldPointerRemains, oldPathInert, reclaimedBy: new TextDecoder().decode(await store.get("slugs/demo")) }, {
    oldPointerRemains: true,
    oldPathInert: true,
    reclaimedBy: "zyxwvutsrqponmlkjihgfedcba",
  });

  // The old per-publication hostname assignment procedure is no longer available;
  // legacy hostname fields remain readable for existing bindings and Worker URLs.
  //
  // Admin shared-host setup is owner-only. It reserves the mapping, creates a fresh
  // bucket, deploys a versioned Worker with disabled aliases, attaches the hostname,
  // and verifies Cloudflare readback. Retrying an attached mapping is idempotent;
  // renaming it is refused before another provider mutation.
});

// Shared-host setup.
void test("shared-host setup is owner-only and fails closed", async (t) => {
  const adminProvisioning = createFakeProvisioningClient({ zones: [{ id: "config-zone", name: "example.org", status: "active", accountId: "0123456789abcdef0123456789abcdef" }] });
  let adminMapping: CloudflarePublishBoxHost | null = null;
  let adminDeploys = 0;
  const configRuntime: ManagedPublicationRuntime = {
    ...runtime,
    getBoxHost: async (requestedBox) => requestedBox === "box-config" ? adminMapping : null,
    listBindings: async () => [],
    reserveBoxHost: async (input) => {
      if (adminMapping !== null && (adminMapping.hostname !== input.hostname || adminMapping.connectionName !== input.connectionName)) throw new Error("This box already has a shared publishing hostname and connection. Bee Box cannot rename or move it.");
      adminMapping ??= { ...input, accountId: "0123456789abcdef0123456789abcdef", status: "pending" };
      return { ...adminMapping };
    },
    attachBoxHost: async (input) => {
      if (adminMapping === null || adminMapping.hostname !== input.hostname) throw new Error("mapping changed");
      adminMapping.status = "attached";
      return { ...adminMapping };
    },
    createProvisioning: () => adminProvisioning,
    createWorkerDeployer: () => ({ deploy: async (input) => {
      assert.ok(input.mode === "shared");
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
  const adminCaller = (actor: TrpcActor, authenticatedOwner?: boolean) => publicationCaller(actor, { authenticatedOwner, boxSlug: "box-config", runtime: configRuntime });
  const unauthorizedSetup = await Promise.resolve()
    .then(() => adminCaller("user", false).publications.configureSharedHost({ connectionName: "main", hostname: "sites.example.org" }))
    .then(() => "allowed", (error) => error.code);
  const setup = await adminCaller("user").publications.configureSharedHost({ connectionName: "main", hostname: "Sites.Example.org." });
  const retriedSetup = await adminCaller("user").publications.configureSharedHost({ connectionName: "main", hostname: "sites.example.org" });
  const renamedHost = await Promise.resolve()
    .then(() => adminCaller("user").publications.configureSharedHost({ connectionName: "main", hostname: "other.example.org" }))
    .then(() => "allowed", (error) => error.message);
  t.check({ unauthorizedSetup, setup, retryStatus: retriedSetup.status, renameRejected: renamedHost.includes("cannot rename"), deploys: adminDeploys, attachments: adminProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length, aliases: adminProvisioning.scriptSubdomains.get("bbx-test-host") }, {
    unauthorizedSetup: "FORBIDDEN",
    setup: {
      hostname: "sites.example.org",
      connectionName: "main",
      status: "attached",
    },
    retryStatus: "attached",
    renameRejected: true,
    deploys: 1,
    attachments: 1,
    aliases: {
      enabled: false,
      previewsEnabled: false,
    },
  });

  const zones = [{ id: "config-zone", name: "example.org", status: "active", accountId: "0123456789abcdef0123456789abcdef" }];
  const conflictProvisioning = createFakeProvisioningClient({ zones, workerDomains: [{ id: "foreign", hostname: "conflict.example.org", service: "another-worker", environment: "production", zoneId: "config-zone", zoneName: "example.org" }] });
  const conflictSetup = setupScenario(configRuntime, { boxSlug: "box-conflict", provisioning: conflictProvisioning });
  const conflictError = await Promise.resolve()
    .then(() => conflictSetup.caller().publications.configureSharedHost({ connectionName: "main", hostname: "conflict.example.org" }))
    .then(() => "allowed", (error) => error.message);

  const missingReadbackProvisioning = createFakeProvisioningClient({ zones });
  missingReadbackProvisioning.listWorkerDomains = async () => [];
  missingReadbackProvisioning.attachWorkerDomain = async (input) => ({ id: "not-readable", ...input, environment: "production" });
  const missingReadback = setupScenario(configRuntime, { boxSlug: "box-readback", provisioning: missingReadbackProvisioning });
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
  const lostResponse = setupScenario(configRuntime, { boxSlug: "box-lost-response", provisioning: lostResponseProvisioning });
  const firstAttempt = await Promise.resolve()
    .then(() => lostResponse.caller().publications.configureSharedHost({ connectionName: "main", hostname: "lost-response.example.org" }))
    .then(() => "attached", () => "pending");
  const secondAttempt = await lostResponse.caller().publications.configureSharedHost({ connectionName: "main", hostname: "lost-response.example.org" });

  const legacyScript = { bindings: [{ type: "plain_text", name: "PUB_ID", text: "legacy-publication" }] };
  adminProvisioning.scripts.set("legacy-worker-sentinel", legacyScript);
  const beforeRepairAttachments = adminProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length;
  const changedBundleRuntime = { ...configRuntime, workerBundle: async () => new TextEncoder().encode("updated shared worker") };
  await publicationCaller("user", { boxSlug: "box-config", runtime: changedBundleRuntime }).publications.configureSharedHost({ connectionName: "main", hostname: "sites.example.org" });
  t.check(
    {
      conflictRefused: conflictError.includes("routes this hostname to another Worker"), conflictAttaches: conflictProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length,
      missingReadbackFailed: missingReadbackError.includes("did not confirm"), missingReadbackStatus: missingReadback.mapping()?.status,
      lostResponseFirstAttempt: firstAttempt, retryStatus: secondAttempt.status, retryAttaches: lostResponseProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length,
      staleBundleRedeployed: adminDeploys === 2, repairDidNotReattach: adminProvisioning.ops.filter((op) => op.startsWith("attach-domain:")).length === beforeRepairAttachments,
      legacyScriptUnchanged: JSON.stringify(adminProvisioning.scripts.get("legacy-worker-sentinel")) === JSON.stringify(legacyScript),
    },
    {
    conflictRefused: true,
    conflictAttaches: 0,
    missingReadbackFailed: true,
    missingReadbackStatus: "pending",
    lostResponseFirstAttempt: "pending",
    retryStatus: "attached",
    retryAttaches: 1,
    staleBundleRedeployed: true,
    repairDidNotReattach: true,
    legacyScriptUnchanged: true,
  },
  );

  // A selected-connection legacy public publication without a slug can still
  // refresh and receive member approval on its existing Worker URL. It does not
  // silently join the shared host until the definition opts in with a slug.
});

// Legacy publications.
void test("a legacy publication without a slug keeps its Worker URL", async (t) => {
  const legacyPubId = "234567abcdefghijklmnopqrst";
  pubId = legacyPubId;
  includeSlug = false;
  const legacyBinding: CloudflarePublishBinding = { pubId: legacyPubId, boxSlug: "box-a", connectionName: "main", accountId: "0123456789abcdef0123456789abcdef", bucketName: "box-bucket", workerName: "bbx-legacy-worker", hostHandle: "bbx-legacy-host", createdAt: "2026-09-24T00:00:00.000Z" };
  const legacyRuntime: ManagedPublicationRuntime = {
    ...runtime,
    getBinding: async () => legacyBinding,
    reserveBinding: async () => legacyBinding,
    listBindings: async () => [legacyBinding],
  };
  const legacyCandidate = await prepareManagedPublication({ boxRoot, boxSlug: "box-a", card: "_content/Legacy.publication.card", ownerEmail: null }, legacyRuntime);
  const legacyScope = legacyCandidate.requestedScope;
  await approveManagedPublication({ boxRoot, boxSlug: "box-a", pubId: legacyPubId, expectedRevision: legacyCandidate.revision }, legacyRuntime);
  const legacySite = (await listManagedPublications({ boxRoot, boxSlug: "box-a" }, legacyRuntime)).sites[0];
  t.check({ hasSharedScope: "sharedHost" in legacyScope, status: legacySite?.approved?.status ?? null, legacyAlias: legacySite?.hostname }, {
    hasSharedScope: false,
    status: "live",
    legacyAlias: "bbx-legacy-host.example-account.workers.dev",
  });
});
