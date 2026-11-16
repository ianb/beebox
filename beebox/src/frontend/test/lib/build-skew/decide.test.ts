// # Reload a stale tab, or show the banner
//
// The page runs build `old`; the server now serves `new`. The tab reloads by
// itself only when it was just shown, nothing would be lost, and it has not
// already reloaded for `new` (a reload that came back stale means a cache or a
// half-finished deploy, and reloading again would loop).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { decideBuildAction, type BuildDecisionInput } from "../../../src/lib/build-skew/decide.js";

const stale: BuildDecisionInput = { client: "old", server: "new", visible: true, freshShow: true, blockers: [], attempted: null };

void test("each rule, against a stale tab that was just shown with nothing at risk", (t) => {
  const cases: Array<[string, Partial<BuildDecisionInput>, string]> = [
    ["just shown, nothing at risk", {}, "reload"],
    ["same build", { server: "old" }, "none"],
    ["dev server page has no identity", { client: null }, "none"],
    ["no frame from the server yet", { server: null }, "none"],
    ["hidden", { visible: false }, "wait"],
    ["hidden, with a draft", { visible: false, blockers: ["composer"] }, "wait"],
    ["the person is already using the tab", { freshShow: false }, "banner"],
    ["a draft in the composer", { blockers: ["composer"] }, "banner"],
    ["a reply streaming and an upload", { blockers: ["streaming", "upload"] }, "banner"],
    ["already reloaded once for this build", { attempted: "new" }, "banner"],
    ["reloaded earlier for an older build", { attempted: "middle" }, "reload"],
    ["tab storage unavailable", { attempted: "unavailable" }, "banner"],
  ];
  t.check(cases.map(([name, over]) => [name, decideBuildAction({ ...stale, ...over })]), cases.map(([name, , expected]) => [name, expected]));
  t.end();
});
