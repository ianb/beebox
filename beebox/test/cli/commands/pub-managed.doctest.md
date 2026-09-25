# Agent-facing managed publication commands

The managed commands use the box server's agent bearer. `sites` reports
serving status without Cloudflare credentials, while `prepare` reports whether
the returned release became live immediately under the already approved
audience or is waiting for a signed-in member.

```ts setup
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../src/webapp/trpc/router.js";
import { pubCommand } from "../../../src/cli/commands/pub.js";
import { publicationPreparedLines, publicationSiteLines } from "../../../src/cli/commands/pub-managed.js";

type Site = inferRouterOutputs<AppRouter>["publications"]["list"]["sites"][number];
type Candidate = inferRouterOutputs<AppRouter>["publications"]["prepare"];
const sites = pubCommand.commands.map((command) => command.name());
const releaseId = "a".repeat(64);
const candidate: Candidate = {
  pubId: "abcdefghijklmnopqrstuvwxyz",
  name: "notes",
  title: "Notes",
  revision: "b".repeat(64),
  releaseId,
  requestedScope: { kind: "site", hostHandle: "notes-host", tier: "public", expiresAt: null, slug: "notes" },
  preparedAt: "2026-09-24T17:00:00.000Z",
  preview: [{ path: "index.html", bytes: 42, sha256: "c".repeat(64) }],
  scan: { total: 0, byKind: {}, skippedBinaries: 0, sample: [] },
};
function site(overrides: Partial<Site> = {}): Site {
  return {
    pubId: candidate.pubId,
    name: "notes",
    title: "Notes",
    hostname: "notes.example.workers.dev",
    requested: { tier: "public", slug: "notes" },
    approved: { tier: "public", status: "live", slug: "notes", expiresAt: null },
    activeReleaseId: releaseId,
    pending: null,
    remoteStatus: { status: "available" },
    connection: { name: "primary", status: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "verified", workerDeploy: "verified", accessLive: "not-ready" } },
    ...overrides,
  };
}
```

The root commands coexist with the legacy Cloudflare `status` report.

```ts
JSON.stringify(sites)
=> ["setup","draft","ls","revoke","go","prepare","sites","id","status"]
```

A remote outage must not read as disabled, even when the last observed edge
manifest had been live.

```ts
publicationSiteLines([site({ remoteStatus: { status: "unavailable", reason: "cloudflare-unavailable" } })])[0].includes("serving state unknown")
=> true

publicationSiteLines([site({ pending: { ...candidate, requestedScope: candidate.requestedScope } })])[0].includes(`prepared ${releaseId.slice(0, 12)}`)
=> true
```

A matching audience can advance the active release immediately; a pending
candidate remains explicitly gated by member approval.

```ts
publicationPreparedLines(candidate, site())[6]
=>   content is live under the already approved audience; within-scope updates take effect immediately.

publicationPreparedLines(candidate, site({ activeReleaseId: null, approved: null, pending: { ...candidate, requestedScope: candidate.requestedScope } }))[6]
=>   waiting for a signed-in box member to approve and enable this release.
```
