# Workstreams front-page header

The account quota control belongs on the universal recent-changes front door,
not on the workstream inventory subpage.

```ts setup
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

Object.assign(globalThis, { React });

import { RecentView } from "../src/frontend/pages/RecentPage.js";
import { WorkstreamsHeader } from "../src/frontend/pages/WorkstreamsPage.js";
import type { Quota, RecentFeed } from "../src/frontend/types.js";

const feed: RecentFeed = {
  now: 1_780_000_000,
  files: [],
  distribution: [],
  unavailable: [],
  truncated: false,
};
const quotas: Quota[] = [{
  provider: "codex",
  status: "unavailable",
  fetchedAt: "2026-08-24T00:00:00Z",
  windows: [],
  message: "Quota probe unavailable.",
}];
```

```ts
const frontPage = renderToStaticMarkup(createElement(RecentView, {
  feed,
  quotas,
  workstream: null,
}));
const streamsHeader = renderToStaticMarkup(createElement(WorkstreamsHeader));
const failedQuota = renderToStaticMarkup(createElement(RecentView, {
  feed,
  quotas: [],
  quotaError: "Couldn’t load quotas: offline",
  workstream: null,
}));
JSON.stringify({
  frontPageHasQuota: frontPage.includes("Quotas · codex unavailable"),
  quotaFailureIsVisible: failedQuota.includes("Quotas · unavailable") && failedQuota.includes("Couldn’t load quotas: offline"),
  streamsPageHasQuota: streamsHeader.includes("Quotas"),
})
=> {"frontPageHasQuota":true,"quotaFailureIsVisible":true,"streamsPageHasQuota":false}
```
