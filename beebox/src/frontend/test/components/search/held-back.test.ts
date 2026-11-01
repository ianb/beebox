// When search holds back a configured area, the person sees how many matches
// it held and the Search card stops saying "all paths"
// (`docs/plans/knowledge-base-tools.md`, Track A).
import { test } from "tap";
import { heldBackText, pathsBadgeText } from "../../../src/components/search/held-back.js";

test("the held-back line names each area and its count", (t) => {
  t.check(heldBackText([{ area: "archive", count: 38 }, { area: "mail", count: 2 }]), "38 more in archive, 2 more in mail (held back from this search)");
  t.check(heldBackText([]), null);
  t.end();
});

test("the path badge says what is left out", (t) => {
  t.check(pathsBadgeText({ paths: [], heldBack: [{ area: "archive", count: 38 }] }), "all paths except archive");
  t.check(pathsBadgeText({ paths: [], heldBack: [] }), "all paths");
  t.check(pathsBadgeText({ paths: ["_content/archive"], heldBack: [] }), "paths: _content/archive");
  t.end();
});
