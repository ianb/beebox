// # History's triggered-by axis over real commits
//
// The facet builder and the `--grep` builder have to agree on one vocabulary: the
// dropdown offers ids the filter can select, and selecting one finds every commit
// that run made. This exercises both ends against a real repository, including
// the retired `Workflow:` spelling a box's older commits still carry.

import { test } from "tap";
import "agent-doctest/tap";
import { getLogPaginated, getTrailerFacets, stageAndCommitPaths } from "../../src/lib/git/core/operations.js";
import { buildGreps } from "../../src/webapp/trpc/routers/history.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

void test("line 14", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L15
  const box = await makeTmpBox({ git: true });

  // doctest:L17
  // The real writer path, so these commits carry trailers exactly as the
  // procedure engine, trick runner and connectors write them.
  let nth = 0;
  const commit = async (message: string, trailers: Record<string, string>) => {
    const path = `_content/notes/Note-${++nth}.doc.card`;
    await box.write(path, `---\ntype: doc\ntitle: Note ${nth}\n---\n`);
    await stageAndCommitPaths(box.root, { paths: [path], message, trailers });
  };

  // doctest:L26
  await commit("[procedure] refresh the map index", { Procedure: "refresh-maps", Step: "refresh" });
  await commit("[procedure] triage the inbox", { Procedure: "refresh-maps", Step: "triage" });
  await commit("[workflow] fetch the news", { Workflow: "refresh-maps" });
  await commit("tidy the inbox", { "Run-By": "trick/tidy-inbox" });
  await commit("sync the calendar", {
    "Triggered-By": "bbx wakeup",
    "Pulled-By": "google-calendar-connector",
  });
  await commit("fix a typo by hand", {});

  // ## The dropdown offers every trigger in the history, grouped by kind
  //
  // Commands, procedures and tricks all appear on one axis; the connector axis is
  // separate and unchanged.

  // doctest:L43
  const facets = await getTrailerFacets(box.root);
  t.check(facets.triggers.map((trigger) => `${trigger.kind}: ${trigger.id}`).join(" | "), "procedure: procedure/refresh-maps | trick: trick/tidy-inbox | command: command/bbx wakeup");

  // doctest:L47
  t.check(facets.connectors.join(" | "), "google-calendar-connector");

  // The retired spelling does not become a second entry — `Workflow: refresh-maps`
  // and `Procedure: refresh-maps` are the same run under two names.

  // doctest:L55
  await t.checkText(facets.triggers.filter((trigger) => trigger.name === "refresh-maps").length, "1");

  // ## Selecting a procedure run finds its commits, pre-rename ones included
  //
  // This is "show me what that procedure run changed" — three commits, two written
  // with `Procedure:` and one with the older `Workflow:`.

  // doctest:L65
  const byProcedure = await getLogPaginated({
    boxRoot: box.root,
    filter: { greps: buildGreps({ triggers: ["procedure/refresh-maps"] }) },
  });
  await t.checkText(byProcedure.map((c) => c.subject).join(" | "), "[workflow] fetch the news | [procedure] triage the inbox | [procedure] refresh the map index");

  // A trick selection matches only the trick, and a command selection only the
  // command — the kinds do not bleed into each other.

  // doctest:L77
  const byTrick = await getLogPaginated({
    boxRoot: box.root,
    filter: { greps: buildGreps({ triggers: ["trick/tidy-inbox"] }) },
  });
  const byCommand = await getLogPaginated({
    boxRoot: box.root,
    filter: { greps: buildGreps({ triggers: ["command/bbx wakeup"] }) },
  });
  t.check(`${byTrick.map((c) => c.subject).join(",")} / ${byCommand.map((c) => c.subject).join(",")}`, "tidy the inbox / sync the calendar");

  // Selecting several triggers ORs within the axis, and the hand edit is in none of
  // them — which is the distinction the History page exists to make.

  // doctest:L93
  const several = await getLogPaginated({
    boxRoot: box.root,
    filter: { greps: buildGreps({ triggers: ["trick/tidy-inbox", "command/bbx wakeup"] }) },
  });
  t.check(several.map((c) => c.subject).join(" | "), "sync the calendar | tidy the inbox");

  // Axes AND together: one trigger plus one connector selects the commit carrying
  // both.

  // doctest:L105
  const both = await getLogPaginated({
    boxRoot: box.root,
    filter: {
      greps: buildGreps({
        triggers: ["command/bbx wakeup"],
        connectors: ["google-calendar-connector"],
      }),
    },
  });
  t.check(both.map((c) => c.subject).join(" | "), "sync the calendar");
});
