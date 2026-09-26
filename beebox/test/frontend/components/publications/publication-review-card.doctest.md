# Publication card review controls

The reference card renders current publication state from the server-returned
site record. The card's `pubId` only selects that record; actions use the
publication id and current candidate revision supplied by the server.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicationReviewCard, type Publication } from "../../../../src/frontend/src/components/publications/PublicationReviewCard.js";

globalThis.React = React;

const site = {
  pubId: "pub-reference-1",
  name: "notes",
  title: "Notes",
  hostname: "notes.example.workers.dev",
  sharedRoute: null,
  assignedCustomHostname: null,
  customHostnameStatus: null,
  requested: null,
  approved: { tier: "public", status: "disabled", slug: "notes", expiresAt: null },
  activeReleaseId: "a".repeat(64),
  remoteStatus: { status: "available" },
  pending: null,
  connection: { name: "publishing", status: "active", capabilities: { accessLive: "verified" } },
} as Publication;

const markup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site,
  sharedHost: null,
  pending: false,
  onPrepare: () => undefined,
  onApprove: () => undefined,
  onEnable: () => undefined,
  onDisable: () => undefined,
}));
```

The disabled serving state exposes the enable action and preserves the audience
boundary explanation. No candidate means there is no approval action.

```ts
markup.includes("disabled")
  && markup.includes("Enable site")
  && markup.includes("Audience changes always need your approval.")
  && !markup.includes("Current release")
  && !markup.includes("a".repeat(64))
  && !markup.includes("Approve audience and publish")
=> true
```

```ts setup
const preparedSite = {
  ...site,
  approved: { tier: "secret", status: "live", expiresAt: null },
  requested: { kind: "site", hostHandle: "host", tier: "secret", expiresAt: null },
  sharedRoute: null,
  pending: {
    revision: "c".repeat(64),
    releaseId: "b".repeat(64),
    preparedAt: "2026-09-25T12:00:00.000Z",
    requestedScope: { kind: "site", hostHandle: "host", tier: "secret", expiresAt: null },
    preview: [{ path: "release/very-long-generated-filename-that-should-wrap-on-mobile.html", bytes: 2048, sha256: "d".repeat(64) }],
    scan: { total: 0, byKind: {}, skippedBinaries: 0, sample: [] },
  },
} as Publication;
const preparedMarkup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site: preparedSite,
  sharedHost: { hostname: "publish.example.com", connectionName: "publishing", status: "attached" },
  pending: false,
  onPrepare: () => undefined,
  onApprove: () => undefined,
  onEnable: () => undefined,
  onDisable: () => undefined,
}));
```

Prepared review keeps its useful summary and file list, with no active or
candidate content hashes exposed in the primary view.

```ts
preparedMarkup.includes("Potential sensitive content")
  && preparedMarkup.includes("Files: 1 · findings: 0 · binary files not inspected: 0")
  && preparedMarkup.includes("No matches from the automated text checks.")
  && preparedMarkup.includes("Anyone with the link can view this without signing in. It is unlisted, not private to named people.")
  && preparedMarkup.includes("release/very-long-generated-filename-that-should-wrap-on-mobile.html")
  && preparedMarkup.includes("Prepare a new candidate here")
  && preparedMarkup.includes("Prepare update for review")
  && preparedMarkup.includes("Publish prepared update")
  && preparedMarkup.includes("/s/pub-reference-1/")
  && !preparedMarkup.includes("a".repeat(64))
  && !preparedMarkup.includes("b".repeat(64))
  && !preparedMarkup.includes("c".repeat(64))
=> true
```

An unchanged scope and active release needs no repeated approval. A disabled
site keeps the enable action for that existing approved release.

```ts setup
const alreadyApprovedSite = {
  ...preparedSite,
  approved: { tier: "secret", status: "disabled", expiresAt: null },
  activeReleaseId: "b".repeat(64),
  pending: { ...preparedSite.pending, releaseId: "b".repeat(64), requestedScope: { ...preparedSite.pending.requestedScope } },
};
const alreadyApprovedMarkup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site: alreadyApprovedSite as Publication,
  sharedHost: null,
  pending: false,
  onPrepare: () => undefined,
  onApprove: () => undefined,
  onEnable: () => undefined,
  onDisable: () => undefined,
}));
const destinationChangeMarkup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site: {
    ...preparedSite,
    pending: {
      ...preparedSite.pending,
      requestedScope: {
        ...preparedSite.pending.requestedScope,
        sharedHost: { hostname: "publish.example.com", hostHandle: "host", path: "/s/pub-reference-1/" },
      },
    },
  } as Publication,
  sharedHost: { hostname: "publish.example.com", connectionName: "publishing", status: "attached" },
  pending: false,
  onPrepare: () => undefined,
  onApprove: () => undefined,
  onEnable: () => undefined,
  onDisable: () => undefined,
}));
```

```ts
alreadyApprovedMarkup.includes("Enable site")
  && !alreadyApprovedMarkup.includes("Approve audience and publish")
  && !alreadyApprovedMarkup.includes("Publish prepared update")
  && destinationChangeMarkup.includes("Approve destination and publish")
=> true
```
