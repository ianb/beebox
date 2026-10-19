// # Issue next actions
//
// The issue browser exposes every documented next-action value. Provisional
// hypotheses keep question marks; a developer's manual confirmation and a
// "just do it" authorization are asserted without one.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { issueNextActionSchema } from "../../../../src/shared/documents.js";
import { ISSUE_NEXT_ACTION_OPTIONS } from "../../../../src/frontend/components/IssuesPane/IssueControls.js";

void test("line 12", async (t) => {
  // doctest:L13
  t.check(
    {
      schema: ["verify-without-me", "manually-confirmed"].map((value) => issueNextActionSchema.parse(value)),
      options: ISSUE_NEXT_ACTION_OPTIONS.filter((option) => option.value === "fixed" || option.value.includes("confirm") || option.value === "verify-without-me" || option.value === "do-it"),
    },
    {
    schema: [
      "verify-without-me",
      "manually-confirmed",
    ],
    options: [
      {
        value: "reconfirm",
        label: "Reconfirm?",
      },
      {
        value: "fixed",
        label: "Fixed?",
      },
      {
        value: "manually-confirmed",
        label: "Manually confirmed",
      },
      {
        value: "verify-without-me",
        label: "Verify without me",
      },
      {
        value: "do-it",
        label: "Just do it",
      },
    ],
  },
  );
});
