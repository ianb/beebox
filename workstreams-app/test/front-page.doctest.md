# Workstreams front-page header

The account quota control belongs on the universal recent-changes front door,
not on the workstream inventory subpage.

```ts setup
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

Object.assign(globalThis, { React });

import { RecentView, recentRowTarget } from "../src/frontend/pages/RecentPage.js";
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

## An issue in the feed opens in the issue viewer

The feed addresses every entry by repository path, but an issue is not read as
markdown source — it has a viewer that knows about frontmatter, related items,
and actions. A worktree's row goes there too: the viewer resolves an issue
through the worktree overlay before main, so it opens that branch's copy — the
case worth clicking on most. A file under `issues/` that is not an issue (no
category directory) keeps the browser.

```ts
const recentFile = (relPath, workstream) => ({
  relPath,
  kind: "markdown",
  at: 1_779_999_000,
  workstream,
  inProgress: false,
});
JSON.stringify([
  recentFile("issues/bugs/2026-08-25-a-real-issue.md", null),
  recentFile("issues/closed/features/2026-08-01-a-closed-issue.md", null),
  recentFile("issues/bugs/2026-08-25-a-worktree-issue.md", "some-stream"),
  recentFile("issues/CLAUDE.md", null),
  recentFile("beebox/docs/plans/a-plan.md", null),
].map(recentRowTarget), null, 2)
=> [
  {
    "to": "/issues",
    "search": {
      "issue": "bugs/2026-08-25-a-real-issue.md"
    }
  },
  {
    "to": "/issues",
    "search": {
      "issue": "closed/features/2026-08-01-a-closed-issue.md"
    }
  },
  {
    "to": "/issues",
    "search": {
      "issue": "bugs/2026-08-25-a-worktree-issue.md"
    }
  },
  {
    "to": "/browse",
    "search": {
      "file": "issues/CLAUDE.md"
    }
  },
  {
    "to": "/browse",
    "search": {
      "file": "beebox/docs/plans/a-plan.md"
    }
  }
]
```
