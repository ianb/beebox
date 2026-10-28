// # Agent-facing managed publication commands
//
// The managed commands use the box server's agent bearer. `sites` reports
// serving status without Cloudflare credentials, while `prepare` reports whether
// the returned release became live immediately under the already approved
// audience or is waiting for a signed-in member.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { is } from "@ianbicking/tap-check/check";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../src/webapp/trpc/routers.js";
import { pubCommand } from "../../../../src/cli/commands/pub/command.js";
import { publicationApprovalUrl, publicationDestinationUrl, publicationFilesLines, publicationForCard, publicationPreparedLines, publicationSharedHostLines, publicationSiteLines } from "../../../../src/cli/commands/pub/managed.js";

type Site = inferRouterOutputs<AppRouter>["publications"]["list"]["sites"][number];
type Candidate = inferRouterOutputs<AppRouter>["publications"]["prepare"];
const sites = pubCommand.commands.map((command) => command.name());
const releaseId = "a".repeat(64);
const candidate: Candidate = {
  pubId: "abcdefghijklmnopqrstuvwxyz",
  name: "notes",
  title: "Notes",
  cardPath: "_content/publications/abcdefghijklmnopqrstuvwxyz.publication.card",
  approvalUrl: "/box-a/views/notes/Notes.publication.card",
  revision: "b".repeat(64),
  releaseId,
  requestedScope: { kind: "site", hostHandle: "notes-host", tier: "public", expiresAt: null, slug: "notes" },
  preparedAt: "2026-09-24T17:00:00.000Z",
  preview: [{ path: "index.html", bytes: 42, sha256: "c".repeat(64) }],
  scan: { total: 0, byKind: {}, skippedBinaries: 0, sample: [] },
};
function site(overrides?: Partial<Site>): Site {
  return {
    pubId: candidate.pubId,
    name: "notes",
    title: "Notes",
    cardPath: "notes/Notes.publication.card",
    duplicateCardPaths: [],
    hostname: "notes.example.workers.dev",
    assignedCustomHostname: null,
    customHostnameStatus: null,
    requested: candidate.requestedScope,
    approved: { tier: "public", status: "live", slug: "notes", expiresAt: null },
    activeReleaseId: releaseId,
    activeFiles: [{ path: "index.html", bytes: 42, sha256: "c".repeat(64) }],
    pending: null,
    sharedRoute: null,
    remoteStatus: { status: "available" },
    connection: { name: "primary", status: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "verified", workerDeploy: "verified", accessLive: "unverified" } },
    ...overrides,
  };
}

// `bbx pub` carries only the server-managed commands.
void test("bbx pub carries only the server-managed commands.", async (t) => {
  t.check(sites, [
    "prepare",
    "id",
    "status",
    "files",
    "cat",
  ]);
});

// A remote outage must not read as disabled, even when the last observed edge
// manifest had been live.
void test("A remote outage must not read as disabled, even when the last observed edge m...", async (t) => {
  t.check(publicationSiteLines([site({ remoteStatus: { status: "unavailable", reason: "cloudflare-unavailable" } })]), [
    "notes — card notes/Notes.publication.card; serving state unknown; serving audience public at /notes/; active aaaaaaaaaaaa; no prepared update; publication: https://notes.example.workers.dev/p/notes/",
  ]);

  t.check(publicationSiteLines([site({ pending: { ...candidate, requestedScope: candidate.requestedScope } })]), [
    "notes — card notes/Notes.publication.card; live; serving audience public at /notes/; active aaaaaaaaaaaa; prepared aaaaaaaaaaaa; publication: https://notes.example.workers.dev/p/notes/",
  ]);

  t.check(publicationSiteLines([site({ approved: { tier: "public", status: "live", slug: "hello", expiresAt: null } })]), [
    "notes — card notes/Notes.publication.card; live; serving audience public at /hello/; active aaaaaaaaaaaa; no prepared update; publication: https://notes.example.workers.dev/p/hello/",
  ]);

  const pendingSecret = { kind: "site" as const, hostHandle: "notes-host", tier: "secret" as const, expiresAt: null };
  const transitioned = publicationSiteLines([site({ pending: { ...candidate, requestedScope: pendingSecret } })]);
  t.check(transitioned, [
    "notes — card notes/Notes.publication.card; live; serving audience public at /notes/; active aaaaaaaaaaaa; prepared aaaaaaaaaaaa; publication: https://notes.example.workers.dev/p/notes/; prepared audience secret; candidate URL: https://notes.example.workers.dev/s/abcdefghijklmnopqrstuvwxyz/",
  ]);
});

// A matching audience can advance the active release immediately; a pending
// candidate remains explicitly gated by member approval.
void test("A matching audience can advance the active release immediately; a pending can...", async (t) => {
  t.check(publicationPreparedLines(candidate, site()), [
    "Notes (notes)",
    "  publication id: abcdefghijklmnopqrstuvwxyz",
    "  requested audience: public",
    "  release: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "  files: 1; scan findings: 0; skipped binaries: 0",
    "  publication URL: https://notes.example.workers.dev/p/notes/",
    "  approval: open the publication card /box-a/views/notes/Notes.publication.card in this box's app.",
    "    index.html  42 bytes  sha256:cccccccccccccccc…",
    "  content is live under the already approved audience; within-scope updates take effect immediately.",
  ]);

  t.check(publicationPreparedLines(candidate, site({ activeReleaseId: null, approved: null, pending: { ...candidate, requestedScope: candidate.requestedScope } })), [
    "Notes (notes)",
    "  publication id: abcdefghijklmnopqrstuvwxyz",
    "  requested audience: public",
    "  release: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "  files: 1; scan findings: 0; skipped binaries: 0",
    "  candidate URL (awaiting member approval): https://notes.example.workers.dev/p/notes/",
    "  approval: open the publication card /box-a/views/notes/Notes.publication.card in this box's app.",
    "    index.html  42 bytes  sha256:cccccccccccccccc…",
    "  waiting for a signed-in box member to approve and enable this release.",
  ]);

  t.check(publicationPreparedLines(candidate, site({ remoteStatus: { status: "unavailable", reason: "cloudflare-unavailable" } })), [
    "Notes (notes)",
    "  publication id: abcdefghijklmnopqrstuvwxyz",
    "  requested audience: public",
    "  release: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "  files: 1; scan findings: 0; skipped binaries: 0",
    "  publication URL: https://notes.example.workers.dev/p/notes/",
    "  approval: open the publication card /box-a/views/notes/Notes.publication.card in this box's app.",
    "    index.html  42 bytes  sha256:cccccccccccccccc…",
    "  serving state is unknown; check the publication card _content/publications/abcdefghijklmnopqrstuvwxyz.publication.card before describing it as live or disabled.",
  ]);
});

// Publication links preserve the tier route, and the approval link uses the
// configured app origin and box slug rather than guessing a host.
void test("Publication links preserve the tier route, and the approval link uses the con...", async (t) => {
  t.check(publicationDestinationUrl({ hostname: "example.workers.dev", pubId: candidate.pubId, scope: { tier: "secret" } }), "https://example.workers.dev/s/abcdefghijklmnopqrstuvwxyz/");

  t.check(publicationDestinationUrl({ hostname: "example.workers.dev", pubId: candidate.pubId, scope: { tier: "accounts" } }), "https://example.workers.dev/a/abcdefghijklmnopqrstuvwxyz/");

  t.check(publicationDestinationUrl({ hostname: "example.workers.dev", pubId: candidate.pubId, scope: { tier: "public", slug: "notes" } }), "https://example.workers.dev/p/notes/");

  t.check(publicationDestinationUrl({ hostname: null, pubId: candidate.pubId, scope: { tier: "public", slug: "hello", sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: "/hello/" } } }), "https://publish.example.org/hello/");

  t.check(publicationSharedHostLines(null), ["Shared publication host: not configured; a member must set it up in Admin before new publications can be prepared."]);

  t.check(publicationSharedHostLines({ hostname: "publish.example.org", connectionName: "primary", status: "pending" }), ["Shared publication host: https://publish.example.org/ (setup pending; member should retry in Admin; connection primary)"]);

  t.check(publicationSharedHostLines({ hostname: "publish.example.org", connectionName: "primary", status: "attached" }), ["Shared publication host: https://publish.example.org/ (ready; connection primary)"]);

  t.check(
    publicationSiteLines([site({
      requested: { kind: "site", hostHandle: "notes-host", tier: "public", expiresAt: null, customHostname: "www.example.org" },
      approved: { tier: "public", status: "live", customHostname: "www.example.org", expiresAt: null },
    })]),
    [
      "notes — card notes/Notes.publication.card; live; serving audience public; active aaaaaaaaaaaa; no prepared update; publication: https://www.example.org/; legacy workers.dev URL: https://notes.example.workers.dev/",
    ],
  );

  t.check(
    publicationSiteLines([site({
      approved: { tier: "public", status: "live", slug: "notes", expiresAt: null, sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: "/notes/" } },
      sharedRoute: { hostname: "publish.example.org", path: "/notes/" },
    })]),
    [
      "notes — card notes/Notes.publication.card; live; serving audience public at /notes/; active aaaaaaaaaaaa; no prepared update; publication: https://publish.example.org/notes/; legacy workers.dev URL: https://notes.example.workers.dev/p/notes/",
    ],
  );

  t.check(
    publicationSiteLines([site({
      hostname: null,
      approved: { tier: "public", status: "live", slug: "notes", expiresAt: null, sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: "/notes/" } },
      sharedRoute: { hostname: "publish.example.org", path: "/notes/" },
    })]),
    [
      "notes — card notes/Notes.publication.card; live; serving audience public at /notes/; active aaaaaaaaaaaa; no prepared update; publication: https://publish.example.org/notes/",
    ],
  );

  t.check(
    publicationApprovalUrl({ serverUrl: "https://boxes.example", approvalPath: candidate.approvalUrl })
    ,
    "https://boxes.example/box-a/views/notes/Notes.publication.card",
  );

  t.check(publicationApprovalUrl({ serverUrl: undefined, approvalPath: candidate.approvalUrl }), null);
});

// `files` and `cat` resolve the card to its publication through the list rows.
// The card path is normalized; an unknown card gets a clear error.
void test("files and cat resolve the card to its publication through the list rows.", async (t) => {
  const row = site();
  t.check(publicationForCard([row], "./notes/./Notes.publication.card"), is(row));

  await t.check(Promise.resolve().then(() => publicationForCard([site()], "notes/Other.publication.card")).catch((error) => error.message), "No prepared publication has card notes/Other.publication.card. Run `bbx pub prepare notes/Other.publication.card` first, or check that it is a <Name>.publication.card.");
});

// `files` lists the active release, then a pending candidate that differs from it.
void test("files lists the active release, then a pending candidate that differs from it.", async (t) => {
  const pendingId = "d".repeat(64);
  await t.checkText(publicationFilesLines(site({ pending: { revision: "b".repeat(64), releaseId: pendingId, preparedAt: candidate.preparedAt, requestedScope: candidate.requestedScope, preview: [{ path: "index.html", bytes: 50, sha256: "e".repeat(64) }, { path: "style.css", bytes: 7, sha256: "f".repeat(64) }], scan: candidate.scan } })).join("\n"), `active release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:
  index.html  42 bytes
pending release dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd:
  index.html  50 bytes
  style.css  7 bytes`);

  t.check(publicationFilesLines(site({ activeReleaseId: null, activeFiles: [], approved: null })), [
    "active release: none",
  ]);
});

// A pending candidate identical to the active release is not repeated.
void test("A pending candidate identical to the active release is not repeated.", async (t) => {
  t.check(publicationFilesLines(site({ pending: { revision: "b".repeat(64), releaseId, preparedAt: candidate.preparedAt, requestedScope: candidate.requestedScope, preview: candidate.preview, scan: candidate.scan } })), [
    "active release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:",
    "  index.html  42 bytes",
  ]);
});
