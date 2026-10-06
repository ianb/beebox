# Agent-facing managed publication commands

The managed commands use the box server's agent bearer. `sites` reports
serving status without Cloudflare credentials, while `prepare` reports whether
the returned release became live immediately under the already approved
audience or is waiting for a signed-in member.

```ts setup
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
  approvalUrl: "/box-a/browse/notes/Notes.publication.card",
  commitWarning: null,
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
    cardPath: "notes/Notes.publication.card",
    duplicateCardPaths: [],
    hostname: "notes.example.workers.dev",
    requested: { tier: "public", slug: "notes" },
    approved: { tier: "public", status: "live", slug: "notes", expiresAt: null },
    activeReleaseId: releaseId,
    activeFiles: [{ path: "index.html", bytes: 42, sha256: "c".repeat(64) }],
    pending: null,
    sharedRoute: null,
    remoteStatus: { status: "available" },
    connection: { name: "primary", status: "active", capabilities: { tokenForAccount: "verified", r2ObjectWrite: "verified", workerDeploy: "verified", accessLive: "not-ready" } },
    ...overrides,
  };
}
```

`bbx pub` carries only the server-managed commands.

```ts
JSON.stringify(sites)
=> ["prepare","id","status","files","cat"]
```

A remote outage must not read as disabled, even when the last observed edge
manifest had been live.

```ts
publicationSiteLines([site({ remoteStatus: { status: "unavailable", reason: "cloudflare-unavailable" } })])[0].includes("serving state unknown")
=> true

publicationSiteLines([site({ pending: { ...candidate, requestedScope: candidate.requestedScope } })])[0].includes(`prepared ${releaseId.slice(0, 12)}`)
=> true

publicationSiteLines([site({ approved: { tier: "public", status: "live", slug: "hello", expiresAt: null } })])[0].includes("serving audience public at /hello/")
=> true

const pendingSecret = { kind: "site" as const, hostHandle: "notes-host", tier: "secret" as const, expiresAt: null };
const transitioned = publicationSiteLines([site({ pending: { ...candidate, requestedScope: pendingSecret } })])[0];
JSON.stringify({ servingAudience: transitioned.includes("serving audience public"), preparedAudience: transitioned.includes("prepared audience secret"), oldUrl: transitioned.includes("https://notes.example.workers.dev/p/notes/"), candidateUrl: transitioned.includes("https://notes.example.workers.dev/s/abcdefghijklmnopqrstuvwxyz/") })
=> {"servingAudience":true,"preparedAudience":true,"oldUrl":true,"candidateUrl":true}
```

A matching audience can advance the active release immediately; a pending
candidate remains explicitly gated by member approval.

```ts
publicationPreparedLines(candidate, site()).at(-1)
=>   content is live under the already approved audience; within-scope updates take effect immediately.

publicationPreparedLines(candidate, site({ activeReleaseId: null, approved: null, pending: { ...candidate, requestedScope: candidate.requestedScope } })).at(-1)
=>   waiting for a signed-in box member to approve and enable this release.

publicationPreparedLines(candidate, site({ remoteStatus: { status: "unavailable", reason: "cloudflare-unavailable" } })).at(-1)
=>   serving state is unknown; check the publication card _content/publications/abcdefghijklmnopqrstuvwxyz.publication.card before describing it as live or disabled.
```

Publication links preserve the tier route, and the approval link uses the
configured app origin and box slug rather than guessing a host.

```ts
publicationDestinationUrl({ hostname: "example.workers.dev", pubId: candidate.pubId, scope: { tier: "secret" } })
=> https://example.workers.dev/s/abcdefghijklmnopqrstuvwxyz/

publicationDestinationUrl({ hostname: "example.workers.dev", pubId: candidate.pubId, scope: { tier: "accounts" } })
=> https://example.workers.dev/a/abcdefghijklmnopqrstuvwxyz/

publicationDestinationUrl({ hostname: "example.workers.dev", pubId: candidate.pubId, scope: { tier: "public", slug: "notes" } })
=> https://example.workers.dev/p/notes/

publicationDestinationUrl({ hostname: null, pubId: candidate.pubId, scope: { tier: "public", slug: "hello", sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: "/hello/" } } })
=> https://publish.example.org/hello/

publicationSharedHostLines(null)[0]
=> Shared publication host: not configured; a member must set it up in Admin before new publications can be prepared.

publicationSharedHostLines({ hostname: "publish.example.org", connectionName: "primary", status: "pending" })[0]
=> Shared publication host: https://publish.example.org/ (setup pending; member should retry in Admin; connection primary)

publicationSharedHostLines({ hostname: "publish.example.org", connectionName: "primary", status: "attached" })[0]
=> Shared publication host: https://publish.example.org/ (ready; connection primary)

publicationSiteLines([site({
  requested: { tier: "public", customHostname: "www.example.org" },
  approved: { tier: "public", status: "live", customHostname: "www.example.org", expiresAt: null },
})])[0].includes("publication: https://www.example.org/")
=> true

publicationSiteLines([site({
  approved: { tier: "public", status: "live", slug: "notes", expiresAt: null, sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: "/notes/" } },
  sharedRoute: { hostname: "publish.example.org", path: "/notes/" },
})])[0].includes("publication: https://publish.example.org/notes/; legacy workers.dev URL: https://notes.example.workers.dev/p/notes/")
=> true

publicationSiteLines([site({
  hostname: null,
  approved: { tier: "public", status: "live", slug: "notes", expiresAt: null, sharedHost: { hostname: "publish.example.org", hostHandle: "box-handle", path: "/notes/" } },
  sharedRoute: { hostname: "publish.example.org", path: "/notes/" },
})])[0].includes("legacy workers.dev URL")
=> false

publicationApprovalUrl({ serverUrl: "https://boxes.example", boxName: "family" })
=> https://boxes.example/family/publications

publicationApprovalUrl({ serverUrl: "https://boxes.example", boxName: "family", approvalPath: candidate.approvalUrl })
=> https://boxes.example/box-a/browse/notes/Notes.publication.card

publicationApprovalUrl({ serverUrl: undefined, boxName: "family" })
=> null
```

`files` and `cat` resolve the card to its publication through the list rows.
The card path is normalized; an unknown card gets a clear error.

```ts
publicationForCard([site()], "./notes/./Notes.publication.card").pubId === candidate.pubId
=> true

Promise.resolve().then(() => publicationForCard([site()], "notes/Other.publication.card")).catch((error) => error.message)
=> No prepared publication has card notes/Other.publication.card. Run `bbx pub prepare notes/Other.publication.card` first, or check that it is a <Name>.publication.card.
```

`files` lists the active release, then a pending candidate that differs from it.

```ts
const pendingId = "d".repeat(64);
publicationFilesLines(site({ pending: { revision: "b".repeat(64), releaseId: pendingId, preparedAt: candidate.preparedAt, requestedScope: candidate.requestedScope, preview: [{ path: "index.html", bytes: 50, sha256: "e".repeat(64) }, { path: "style.css", bytes: 7, sha256: "f".repeat(64) }], scan: candidate.scan } })).join("\n")
=> active release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:
  index.html  42 bytes
pending release dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd:
  index.html  50 bytes
  style.css  7 bytes

publicationFilesLines(site({ activeReleaseId: null, activeFiles: [], approved: null }))
=> ["active release: none"]
```

A pending candidate identical to the active release is not repeated.

```ts
publicationFilesLines(site({ pending: { revision: "b".repeat(64), releaseId, preparedAt: candidate.preparedAt, requestedScope: candidate.requestedScope, preview: candidate.preview, scan: candidate.scan } })).length
=> 2
```
