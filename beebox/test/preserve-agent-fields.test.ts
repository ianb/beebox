// # preserve-agent-fields: connector rebuilds keep agent-owned fields
//
// Connector sync rebuilds cards from templates; `preserveAgentFields`
// re-injects the agent-owned `contains:` from the existing on-disk card so
// it survives the rebuild.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { preserveAgentFields } from "../src/preserve-agent-fields.js";
import { makeTmpBox } from "./helpers/test-helpers.js";

const TEMPLATED = "---\nthread-id: t1\nsubject: Pricing\nstatus: new\n---\n";

// ## contains carries over from the existing card
void test("contains carries over from the existing card", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L17
  const box = await makeTmpBox();
  await box.write("_content/inbox/email/t.email-thread.card", "---\nthread-id: t1\nsubject: Pricing\ncontains: Metricly demo offer; no action needed.\n---\n");
  const preserved = await preserveAgentFields(TEMPLATED, { existingPath: box.path("_content/inbox/email/t.email-thread.card") });
  t.checkText(preserved, `---
thread-id: t1
subject: Pricing
status: new
contains: Metricly demo offer; no action needed.
---`);

  // ## No existing card (first sync): template passes through untouched

  // doctest:L30
  await t.checkText(await preserveAgentFields(TEMPLATED, { existingPath: box.path("_content/inbox/email/new.email-thread.card") }), `---
thread-id: t1
subject: Pricing
status: new
---`);

  // ## The template wins when it carries its own value

  // doctest:L42
  const withOwn = "---\nthread-id: t1\ncontains: from-template\n---\n";
  const result = await preserveAgentFields(withOwn, { existingPath: box.path("_content/inbox/email/t.email-thread.card") });
  t.checkText(result, `---
thread-id: t1
contains: from-template
---`);

  // ## A hand-mangled existing card contributes nothing (sync never breaks)

  // doctest:L51
  await box.write("_content/inbox/email/broken.email-thread.card", "no frontmatter here");
  t.check(await preserveAgentFields(TEMPLATED, { existingPath: box.path("_content/inbox/email/broken.email-thread.card") }), TEMPLATED);
});
