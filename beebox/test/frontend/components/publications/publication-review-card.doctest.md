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
  activeReleaseId: "release-1",
  remoteStatus: { status: "available" },
  pending: null,
  connection: { name: "publishing", status: "active", capabilities: { accessLive: "verified" } },
} as Publication;

const markup = renderToStaticMarkup(React.createElement(PublicationReviewCard, {
  site,
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
  && !markup.includes("Approve audience and publish")
=> true
```
