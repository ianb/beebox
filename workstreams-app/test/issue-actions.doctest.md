# Issue next actions

The issue browser exposes every documented next-action value. Provisional
hypotheses keep question marks; a developer's manual confirmation is asserted
without one.

```ts setup
import { issueNextActionSchema } from "../src/shared/documents.js";
import { ISSUE_NEXT_ACTION_OPTIONS } from "../src/frontend/components/IssueControls.js";
```

```ts
JSON.stringify({
  schema: ["verify-without-me", "manually-confirmed"].map((value) => issueNextActionSchema.parse(value)),
  options: ISSUE_NEXT_ACTION_OPTIONS.filter((option) => option.value === "fixed" || option.value.includes("confirm") || option.value === "verify-without-me"),
})
=> {"schema":["verify-without-me","manually-confirmed"],"options":[{"value":"reconfirm","label":"Reconfirm?"},{"value":"fixed","label":"Fixed?"},{"value":"manually-confirmed","label":"Manually confirmed"},{"value":"verify-without-me","label":"Verify without me"}]}
```
