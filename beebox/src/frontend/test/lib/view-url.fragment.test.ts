// ViewTarget.fragment: a place inside the target, carried as the reserved
// `fragment` query key wherever a target is serialized, and read from a
// markdown link's `#…` suffix.
import { test } from "tap";
import { parseViewUrl, resolveContentTarget, serializeViewUrl, withoutFragment, type ViewTarget } from "../../src/lib/view-url.js";
import { workspaceRouteTarget } from "../../src/lib/system-card-navigation.js";

const base = "_content/notes/Plan.doc.card";
const plain: ViewTarget = { path: "_content/x.doc.card", viewer: null, params: {}, viewState: null };

test("serialize and parse round-trip both fragment forms", (t) => {
  for (const fragment of ["where-things-stand", "/Weekly plan/Notes~2"]) {
    const target = { ...plain, fragment };
    t.check(parseViewUrl(serializeViewUrl(target)), target); // fragment
  }
  t.end();
});

test("a target without a fragment serializes as before", (t) => {
  t.check(serializeViewUrl(plain), "_content/x.doc.card");
  t.check(serializeViewUrl({ ...plain, viewer: "source", params: { k: "v" } }), "_content/x.doc.card?view=source&k=v");
  t.check(withoutFragment({ ...plain, fragment: "a" }), plain);
  t.end();
});

test("fragment is a reserved key, never a passthrough param", (t) => {
  t.check(parseViewUrl("_content/x.doc.card?fragment=a&k=v"), { ...plain, params: { k: "v" }, fragment: "a" });
  t.check(parseViewUrl("_content/x.doc.card?fragment="), plain); // an empty value is no fragment
  t.end();
});

test("a # in a file name stays in the path", (t) => {
  t.check(parseViewUrl("_content/C# notes.md").path, "_content/C# notes.md");
  const stored = new URLSearchParams({ card: serializeViewUrl({ ...plain, path: "_content/C# notes.md", fragment: "h" }) }).toString();
  t.check(parseViewUrl(new URLSearchParams(stored).get("card") ?? ""), { ...plain, path: "_content/C# notes.md", fragment: "h" }); // through a card= value
  t.end();
});

test("markdown hrefs split off and decode the #fragment", (t) => {
  const at = (href: string) => resolveContentTarget(base, href);
  t.check(at("Other.doc.card#h"), { path: "_content/notes/Other.doc.card", viewer: null, params: {}, viewState: null, fragment: "h" });
  t.check(at("Other.doc.card?view=source#h"), { path: "_content/notes/Other.doc.card", viewer: "source", params: {}, viewState: null, fragment: "h" });
  t.check(at("/_content/x.card#h")?.fragment, "h");
  t.check(at("Other.doc.card#"), { path: "_content/notes/Other.doc.card", viewer: null, params: {}, viewState: null }); // an empty fragment is none
  t.check(at("Other.doc.card?fragment=a#b")?.fragment, "b"); // # wins over ?fragment=
  t.check(at("Other.doc.card#notes%2D1")?.fragment, "notes-1");
  t.check(at("Other.doc.card#/Weekly%20plan/Notes")?.fragment, "/Weekly plan/Notes");
  t.check(at("Other.doc.card#100%")?.fragment, "100%"); // a malformed escape stays as written
  t.check(at("../../../etc.card#h"), null); // an escaping path is still null
  t.end();
});

test("a link href reaches the route with its fragment", (t) => {
  for (const fragment of ["notes-1", "/Weekly plan/Notes"]) {
    const target = resolveContentTarget(base, `Other.doc.card#${encodeURIComponent(fragment)}`);
    if (target === null) { t.fail("resolved"); continue; }
    // link.tsx builds `/<box>/views/<serializeViewUrl(target)>`.
    const url = new URL(`http://box.test/test1/views/${serializeViewUrl(target)}`);
    t.check(workspaceRouteTarget({ pathname: url.pathname, searchStr: url.search, search: {} }), target); // fragment
  }
  t.end();
});
