# Issue deep-link visibility

A deep link with no explicit status filter includes the selected issue alongside
the default open queue, so a closed issue has a rendered sidebar row for the
scroll effect to target. An explicit filter remains authoritative.

```ts setup
import { issuePassesStatusFilter } from "../src/frontend/components/IssuesPane.js";
```

```ts
JSON.stringify({
  selectedClosedDeepLink: issuePassesStatusFilter({ closed: true }, { status: undefined, selected: true }),
  otherClosedIssue: issuePassesStatusFilter({ closed: true }, { status: undefined, selected: false }),
  ordinaryOpenIssue: issuePassesStatusFilter({ closed: false }, { status: undefined, selected: false }),
  explicitOpen: issuePassesStatusFilter({ closed: true }, { status: "open", selected: true }),
  explicitClosed: issuePassesStatusFilter({ closed: true }, { status: "closed", selected: true }),
})
=> {"selectedClosedDeepLink":true,"otherClosedIssue":false,"ordinaryOpenIssue":true,"explicitOpen":false,"explicitClosed":true}
```
