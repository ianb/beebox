// One builder turns a search hit into where it opens: a section hit opens at
// its section, a card hit at the top, and a gdoc hit (sections indexed from
// its synced attachment) promises no section.
import { test } from "tap";
import { searchResultTarget, sectionDestination } from "../../../src/components/search/target.js";

const path = "_content/Friends.doc.card";

test("a section hit carries its section path", (t) => {
  const hit = { path, kind: "doc", fragment: "/Reconnecting with friends/Where things stand" };
  t.same(searchResultTarget(hit), { path, viewer: null, params: {}, viewState: null, fragment: hit.fragment });
  t.end();
});

test("a card hit opens at the top", (t) => {
  const target = searchResultTarget({ path, kind: "doc", fragment: "" });
  t.notOk("fragment" in target);
  t.end();
});

test("a gdoc section hit has no section destination", (t) => {
  const hit = { path: "_content/drive/Notes.gdoc.card", kind: "gdoc", fragment: "/Agenda" };
  t.equal(sectionDestination(hit), null);
  t.notOk("fragment" in searchResultTarget(hit));
  t.end();
});
