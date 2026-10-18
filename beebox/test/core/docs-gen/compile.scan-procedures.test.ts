// # scanProcedures — procedure index for the agent guide
//
// `scanProcedures` reads `_config/procedures/*.procedure.card` and returns the
// `name` + a one-line `description` for the procedures index in the generated
// agent docs.
//
// It reads each card's YAML **frontmatter** (`name`, `description`). This
// regressed once: it parsed the cards with the XML `parseCard`, which throws on a
// frontmatter card, so every procedure was indexed as `"(could not parse)"`.

import { test } from "tap";
import "agent-doctest/tap";
import { scanProcedures } from "../../../src/core/docs-gen/compile/core.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

// ## Reads name + first-line description from frontmatter
void test("Reads name + first-line description from frontmatter", async (t) => {
  // doctest:L19
  const box = await makeTmpBox();
  await box.write(
    "_config/procedures/process-news.procedure.card",
    "---\nname: process-news\ndescription: Process news items from RSS feeds into a curated brief.\nsteps: []\n---\n",
  );
  await box.write(
    "_config/procedures/triage.procedure.card",
    "---\nname: triage-inbox\ndescription: |-\n  Sort inbox items into destinations.\n  Second line is dropped from the compact index.\nsteps: []\n---\n",
  );

  // doctest:L29
  const out = await scanProcedures(box.root);
  t.check(out, [
    {
      name: "process-news",
      filename: "process-news.procedure.card",
      description: "Process news items from RSS feeds into a curated brief.",
    },
    {
      name: "triage-inbox",
      filename: "triage.procedure.card",
      description: "Sort inbox items into destinations.",
    },
  ]);
});

// ## Missing name falls back to the filename; missing description is empty
void test("Missing name falls back to the filename; missing description is empty", async (t) => {
  // doctest:L37
  const box = await makeTmpBox();
  await box.write(
    "_config/procedures/orphan.procedure.card",
    "---\nsteps: []\n---\n",
  );

  // doctest:L43
  const out = await scanProcedures(box.root);
  t.check(out, [
    {
      name: "orphan",
      filename: "orphan.procedure.card",
      description: "",
    },
  ]);
});

// ## A card with no readable frontmatter is indexed with a placeholder, not dropped
void test("A card with no readable frontmatter is indexed with a placeholder, not dropped", async (t) => {
  // doctest:L51
  const box = await makeTmpBox();
  await box.write("_config/procedures/bad.procedure.card", "not a frontmatter card\n");

  // doctest:L54
  const out = await scanProcedures(box.root);
  t.check(out, [
    {
      name: "bad",
      filename: "bad.procedure.card",
      description: "(could not parse)",
    },
  ]);
});

// ## No procedures directory returns an empty list
void test("No procedures directory returns an empty list", async (t) => {
  // doctest:L62
  const box = await makeTmpBox();
  const out = await scanProcedures(box.root);
  await t.checkText(out.length, "0");
});
