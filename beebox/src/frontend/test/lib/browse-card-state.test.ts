// # Browse card state
//
// Browse owns its directory and structured detail independently of route splats.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parseBrowseState, browseCardTarget, normalizeBrowseTarget, legacyBrowseTarget } from "../../src/lib/browse-card-state.js";
import { serializeViewUrl, parseViewUrl } from "../../src/lib/view-url.js";
import type { ViewTarget } from "../../src/lib/view-url.js";

/** The path of the detail target a Browse target keeps in its view state. */
function detailPath(target: ViewTarget): string | undefined {
  const detail = target.viewState?.detail;
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return undefined;
  const path = detail.path;
  return typeof path === "string" ? path : undefined;
}

// Root and explicit state take precedence over a directory seed. Invalid paths
// and mismatched detail are errors, never root fallbacks.
void test("Root and explicit state take precedence over a directory seed.", async (t) => {
  t.check(parseBrowseState({}), {
    ok: true,
    state: {
      directory: "",
    },
  });

  t.check(parseBrowseState({ params: { dir: "/_content/recipes/" } }), {
    ok: true,
    state: {
      directory: "_content/recipes",
    },
  });

  t.check(parseBrowseState({ params: { dir: "_content/old" }, viewState: { directory: "_content/new" } }), {
    ok: true,
    state: {
      directory: "_content/new",
    },
  });

  t.check(parseBrowseState({ params: { dir: "../../outside" } }).ok, false);

  t.check(parseBrowseState({ viewState: { directory: "_content/a", detail: { path: "_content/b/file.card", viewer: null, params: {}, viewState: null } } }).ok, false);

  t.check(parseBrowseState({ viewState: { directory: "_content?view=Source" } }).ok, false);
});

// A seed becomes owned state and disappears from params. Bare opens retain the
// absence of state so the workspace can preserve a previously open Browse tab.
void test("A seed becomes owned state and disappears from params.", async (t) => {
  const bare = { ...browseCardTarget({ directory: "" }), viewState: null };
  t.check(normalizeBrowseTarget(bare).viewState, null);

  t.check(normalizeBrowseTarget({ ...bare, params: { dir: "_content/recipes", extra: "yes" } }), {
    path: "_config/interface/browse.card",
    viewer: null,
    params: {
      extra: "yes",
    },
    viewState: {
      directory: "_content/recipes",
    },
  });
});

// Legacy conversion uses actual kinds, including extensionless files and dotted
// attachment directories. Nested state roundtrips without an embedded URL.
void test("Legacy conversion uses actual kinds, including extensionless files and dotted...", async (t) => {
  const file = { path: "_content/README", viewer: "Source", params: { zoom: "2" }, viewState: { selected: [1, 2] } };
  const converted = await legacyBrowseTarget(file, { lookupKind: async () => "file", missingKind: "file" });
  t.check(parseBrowseState(parseViewUrl(serializeViewUrl(converted))), {
    ok: true,
    state: {
      directory: "_content",
      detail: {
        path: "_content/README",
        viewer: "Source",
        params: {
          zoom: "2",
        },
        viewState: {
          selected: [
            1,
            2,
          ],
        },
      },
    },
  });

  t.check((await legacyBrowseTarget({ ...file, path: "_content/Photo.attach" }, { lookupKind: async () => "directory", missingKind: "directory" })).viewState, {
    directory: "_content/Photo.attach",
  });

  t.check((await legacyBrowseTarget({ ...file, path: "_content/gone" }, { lookupKind: async () => "missing", missingKind: "file" })).viewState, {
    directory: "_content",
    detail: {
      path: "_content/gone",
      viewer: "Source",
      params: {
        zoom: "2",
      },
      viewState: {
        selected: [
          1,
          2,
        ],
      },
    },
  });

  t.check((await legacyBrowseTarget({ ...file, path: "_content/Old.doc.card" }, { lookupKind: async () => "missing", missingKind: "file" })).viewState, {
    directory: "_content",
    detail: {
      path: "_content/Old.doc.card",
      viewer: "Source",
      params: {
        zoom: "2",
      },
      viewState: {
        selected: [
          1,
          2,
        ],
      },
    },
  });

  // Known directory navigation retains its directory-not-found error instead of
  // opening a missing file detail.

  await t.checkThrows(
    async () => (await legacyBrowseTarget(
      { ...file, path: "_content/gone-directory" },
      { lookupKind: async () => "missing", missingKind: "directory" },
    )),
    "BrowseLocationError: Browse location does not exist: _content/gone-directory",
  );
});

// A legacy Browse path without `_content/` resolves beneath `_content/` when that
// location exists:
void test("A legacy Browse path without content/ resolves beneath content/ when that loc...", async (t) => {
  const legacy = { path: "projects/Plan.doc.card", viewer: null, params: {}, viewState: null };
  const attempted: string[] = [];
  const redirected = await legacyBrowseTarget(legacy, { lookupKind: async (path) => { attempted.push(path); return "file"; }, missingKind: "file" });
  t.check({ attempted, state: redirected.viewState }, {
    attempted: [
      "_content/projects/Plan.doc.card",
    ],
    state: {
      directory: "_content/projects",
      detail: {
        path: "_content/projects/Plan.doc.card",
        viewer: null,
        params: {},
        viewState: null,
      },
    },
  });
});

// When the `_content/` location is missing, legacy file navigation retains that
// missing detail as the normal Browse behavior does:
void test("When the content/ location is missing, legacy file navigation retains that mi...", async (t) => {
  const legacy = { path: "projects/Plan.doc.card", viewer: null, params: {}, viewState: null };
  const missing = await legacyBrowseTarget(legacy, { lookupKind: async () => "missing", missingKind: "file" });
  t.check(detailPath(missing), "_content/projects/Plan.doc.card");
});
