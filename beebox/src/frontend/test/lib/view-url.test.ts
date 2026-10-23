// # view-url helpers
//
// Parse, classify, and resolve the box-path URLs that markdown links/images use to reference files inside the box. Markdown authors plain paths (`_content/x.card`, `/_content/x.card?view=source`); the retired `view:` scheme survives only as an internal serialization marker (companion-pane URL persistence), which `parseViewUrl` still tolerates.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  parseViewUrl,
  serializeViewUrl,
  resolveContentTarget,
  classifyMarkdownHref,
  isExternalUrl,
  normalizeMarkdownLink,
  resolveImageSrc,
  externalImageProxyUrl,
  apiFileUrl,
  apiImageUrl,
  validateViewState,
} from "../../src/lib/view-url.js";
import { apiRawFileUrl } from "../../src/api-core.js";
import { decideViewHistoryUpdate } from "../../../shared/view-state.js";
import type { ViewState } from "../../../shared/view-state.js";

class CustomState { value = "x"; }

// ## parseViewUrl
//
// Pulls a file path, viewer override (`?view=`), and other params out of a serialized target (the `view:` prefix is optional and tolerated for internal callers). There is no `zoom` flag — a plain link opening the companion pane replaced it.
void test("Pulls a file path, viewer override (?view=), and other params out of a serial...", async (t) => {
  t.check(parseViewUrl("view:_content/docs/report.md"), {
    path: "_content/docs/report.md",
    viewer: null,
    params: {},
    viewState: null,
  });

  t.check(parseViewUrl("_content/docs/report.md?view=source&k=v"), {
    path: "_content/docs/report.md",
    viewer: "source",
    params: {
      k: "v",
    },
    viewState: null,
  });

  t.check(parseViewUrl("_content/docs/report.md?k=v&viewState=%7B%22page%22%3A%22gallery%22%2C%22index%22%3A2%7D&view=source"), {
    path: "_content/docs/report.md",
    viewer: "source",
    params: {
      k: "v",
    },
    viewState: {
      page: "gallery",
      index: 2,
    },
  });
});

// A leading `/` is stripped — `ViewTarget.path` is box-root-relative, and consumers compare it for exact equality against the file watcher's relative paths (which have no leading slash). Card refs are conventionally written `/_content/…`, so the slash is normalized away here:
void test("A leading / is stripped — ViewTarget.path is box-root-relative, and consumers...", async (t) => {
  t.check(parseViewUrl("view:/_bookkeeping/archive/Foo.doc.card"), {
    path: "_bookkeeping/archive/Foo.doc.card",
    viewer: null,
    params: {},
    viewState: null,
  });
});

// `serializeViewUrl` is the round-trip inverse (without the `view:` prefix):
void test("serializeViewUrl is the round-trip inverse (without the view: prefix):", async (t) => {
  t.check(serializeViewUrl({ path: "a/b.md", viewer: "source", params: { k: "v" }, viewState: { page: "gallery" } }), "a/b.md?view=source&viewState=%7B%22page%22%3A%22gallery%22%7D&k=v");

  t.check(serializeViewUrl({ path: "a/b.md", viewer: null, params: {}, viewState: {} }), "a/b.md");

  t.check(validateViewState({ page: "gallery", filters: ["open", null], count: 2 }), true);

  t.check(validateViewState({ count: Number.NaN }), false);

  t.check(validateViewState({ when: new Date("2026-01-01") }), false);

  t.check(validateViewState({ filters: new Map([["status", "open"]]) }), false);

  t.check(validateViewState({ custom: new CustomState() }), false);

  const cyclic: ViewState = {};
  cyclic.self = cyclic;
  t.check(validateViewState(cyclic), false);

  // The type admits a cycle, so the runtime boundary is what rejects it for authored JavaScript callers.
  await t.checkThrows(
    async () => (serializeViewUrl({ path: "a/b.md", viewer: null, params: {}, viewState: cyclic })),
    "InvalidViewStateError: Authored view state must be a JSON-safe object",
  );

  t.check(serializeViewUrl({ path: "a/b.md", viewer: "source", params: { k: "v" }, viewState: null }), "a/b.md?view=source&k=v");

  t.check(decideViewHistoryUpdate({ state: { page: "gallery" }, requested: "push", canPush: true }), "push");

  t.check(decideViewHistoryUpdate({ state: { page: "gallery" }, requested: "push", canPush: false }), "replace");

  t.check(decideViewHistoryUpdate({ state: { count: Number.POSITIVE_INFINITY }, requested: "replace", canPush: true }), "rejected");
});

// ## resolveRelativePath
//
// A one-line wrapper over `resolveRefPath`; the path rules (relative, leading `/`,
// trailing-slash directory base, no base) are proved in `test/shared/ref-path.test.ts`.
// Its fail-closed containment is what the wrapper must pass through: a path that climbs above
// the box root is `null`, never clamped back to the root. Callers degrade visibly
// — a link renders as a broken marker, an image gets an empty (broken) src.
void test("resolveRelativePath passes ref-path containment through: a climb above the box root is null", async (t) => {
  t.check(resolveContentTarget("_content/docs/report.md", "../../../etc/passwd?view=source"), null);
});

// ## resolveContentTarget
//
// Turns a markdown link/image href into a `ViewTarget`, splitting the `?view=`/params query off **before** resolving so a leading slash stays meaningful (absolute vs document-relative). This is what the renderers hand to `onNavigate`.
//
// A relative path resolves against the document's dir; the query becomes viewer + params:
void test("Turns a markdown link/image href into a ViewTarget, splitting the ?view=/para...", async (t) => {
  t.check(resolveContentTarget("_content/docs/report.md", "chart.figure.card?size=300"), {
    path: "_content/docs/chart.figure.card",
    viewer: null,
    params: {
      size: "300",
    },
    viewState: null,
  });
});

// A leading `/` is box-root-absolute and ignores `basePath` — and `?view=` selects a card-attached viewer:
void test("A leading / is box-root-absolute and ignores basePath — and ?view= selects a...", async (t) => {
  t.check(resolveContentTarget("_content/docs/report.md", "/_content/x.bill.card?view=ledger"), {
    path: "_content/x.bill.card",
    viewer: "ledger",
    params: {},
    viewState: null,
  });
});

// ### Chat messages pass no base
//
// Chat message markdown (`chat/markdown-rendering.tsx`) renders with
// `basePath: undefined` for links, embeds, and images alike — a chat has no
// "current document," and a directory-bound chat's context directory is the
// agent's *working directory* for its file tools, not a link base. So in a chat
// bound to `notes`, a bare `sibling.card` link and a bare `Foo.doc.card` embed
// both name the box-root file, identically to the leading-`/` form (this is the
// resolution seam; the wiring itself is React rendering, which has no test
// tier):
void test("Chat message markdown (chat/markdown-rendering.tsx) renders with basePath:", async (t) => {
  t.check(
    [
      resolveContentTarget(undefined, "_content/sibling.card")?.path,
      resolveContentTarget(undefined, "/_content/sibling.card")?.path,
      resolveContentTarget(undefined, "_content/Foo.doc.card")?.path,
    ],
    [
    "_content/sibling.card",
    "_content/sibling.card",
    "_content/Foo.doc.card",
  ],
  );
});

// An image in that same chat message resolves the same way — `basePath: undefined`
// sends a bare `photo.png` to the box root, not to `notes/photo.png`:
void test("An image in that same chat message resolves the same way — basePath:", async (t) => {
  t.check(resolveImageSrc("_content/photo.png", { boxSlug: "test1", basePath: undefined }), "/test1/api/image/_content/photo.png");
});

// ## classifyMarkdownHref
//
// Splits an href into the cases the Markdown renderer cares about. A plain relative/absolute path is a box reference; anything with a scheme or anchor is external; the retired `view:` scheme is `legacy-view` so renderers can draw a visibly-broken marker:
void test("Splits an href into the cases the Markdown renderer cares about.", async (t) => {
  t.check(classifyMarkdownHref("view:_content/a.md"), {
    kind: "legacy-view",
    raw: "view:_content/a.md",
  });

  t.check(classifyMarkdownHref("notes.md"), {
    kind: "relative",
    path: "notes.md",
  });

  t.check(classifyMarkdownHref("/_content/a.card?view=ledger"), {
    kind: "relative",
    path: "/_content/a.card?view=ledger",
  });

  t.check(
    classifyMarkdownHref("https://example.com")
    ,
    {
    kind: "external",
  },
  );

  t.check(
    classifyMarkdownHref("//cdn.example.com/a.png")
    ,
    {
    kind: "external",
  },
  );

  t.check(classifyMarkdownHref("#anchor"), {
    kind: "external",
  });
});

// ### control: pointers
//
// `control:` points at a control in the running interface rather than at content, so it is recognised before the generic scheme test that would otherwise make it `external`. The address is a `bbx-` DOM id; `action` and `description` ride in a query string parsed with `URLSearchParams`.
void test("control: points at a control in the running interface rather than at content,...", async (t) => {
  t.check(classifyMarkdownHref("control:bbx-composer-mic"), {
    kind: "control",
    id: "bbx-composer-mic",
    action: "point",
    description: null,
    unknownAction: null,
  });

  t.check(classifyMarkdownHref("control:bbx-composer-mic?action=point&description=Tap%20and%20talk"), {
    kind: "control",
    id: "bbx-composer-mic",
    action: "point",
    description: "Tap and talk",
    unknownAction: null,
  });

  t.check(classifyMarkdownHref("control:bbx-composer-add?action=reveal"), {
    kind: "control",
    id: "bbx-composer-add",
    action: "reveal",
    description: null,
    unknownAction: null,
  });
});

// An action the app does not know degrades to `point` and reports the word it did not understand, so the pointer still works — and says so in its tooltip — rather than the whole link dying over a typo:
void test("An action the app does not know degrades to point and reports the word it did...", async (t) => {
  t.check(classifyMarkdownHref("control:bbx-composer-send?action=jump"), {
    kind: "control",
    id: "bbx-composer-send",
    action: "point",
    description: null,
    unknownAction: "jump",
  });
});

// An empty id names nothing to point at, so it falls through to the malformed-input path — `external`, exactly like an empty href:
void test("An empty id names nothing to point at, so it falls through to the malformed-i...", async (t) => {
  t.check(
    [
      classifyMarkdownHref("control:"),
      classifyMarkdownHref("control:?action=reveal"),
    ],
    [
    {
      kind: "external",
    },
    {
      kind: "external",
    },
  ],
  );
});

// An ill-formed id is *not* rejected here. Classification does not touch the document, and whether an address resolves is live state — `resolveControl` rejects a non-`bbx-` id at the point of use and the pointer renders broken with the reason in its tooltip:
void test("An ill-formed id is not rejected here.", async (t) => {
  t.check(classifyMarkdownHref("control:composer-mic"), {
    kind: "control",
    id: "composer-mic",
    action: "point",
    description: null,
    unknownAction: null,
  });
});

// ## normalizeMarkdownLink
//
// markdown-it percent-encodes every link destination, so a link to
// `<Beach walk.md>` would reach the in-box resolver as `Beach%20walk.md`.
// `normalizeMarkdownLink` hands an in-box link's path over decoded; its query
// stays as written, because `URLSearchParams` decodes it once later. An
// external URL goes to markdown-it's own encoder (stood in for here by
// `encodeURI`). A malformed escape is kept as written:
void test("markdown-it percent-encodes every link destination, so a link to <Beach walk....", async (t) => {
  const encode = (url: string) => encodeURI(url);
  t.check(
    [
      normalizeMarkdownLink("/_content/Beach%20walk.attach/p.jpg", encode),
      normalizeMarkdownLink("Beach%20walk.doc.card?k=%2526", encode),
      normalizeMarkdownLink("100%.md", encode),
      normalizeMarkdownLink("https://example.com/a b", encode),
    ],
    [
    "/_content/Beach walk.attach/p.jpg",
    "Beach walk.doc.card?k=%2526",
    "100%.md",
    "https://example.com/a%20b",
  ],
  );
});

// ## isExternalUrl
//
// True for anything with a URL scheme or a protocol-relative `//host` — used to tell an image/external link from an in-box embed path:
void test("True for anything with a URL scheme or a protocol-relative //host — used to t...", async (t) => {
  t.check(
    [
      isExternalUrl("https://example.com/x.png"),
      isExternalUrl("//cdn.example.com/y.jpg"),
      isExternalUrl("_content/x.figure.card"),
      isExternalUrl("/_content/x.card"),
    ],
    [
    true,
    true,
    false,
    false,
  ],
  );
});

// ## resolveImageSrc
//
// Rewrites a markdown image `src` into a URL that doesn't depend on the page URL — so an image written into `dossiers/annika.md` renders the same whether it's opened in chat or browsed at a deep URL. Output goes through the canonical `/api/image/` route, which serves a raw image file directly and dereferences an `.image.card` to its attached binary.
//
// A leading `/` means box-root-relative:
void test("Rewrites a markdown image src into a URL that doesn't depend on the page URL...", async (t) => {
  t.check(resolveImageSrc("/_content/images/front.png", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" }), "/test1/api/image/_content/images/front.png");
});

// A bare path is document-relative — resolved against `basePath`:
void test("A bare path is document-relative — resolved against basePath:", async (t) => {
  t.check(resolveImageSrc("images/front.png", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" }), "/test1/api/image/_content/dossiers/images/front.png");
});

// An `.image.card` embed resolves through the same route — the backend reads `filename.ref` and serves the attached binary, so `![](…/foo.image.card)` renders instead of 404ing on the card file:
void test("An .image.card embed resolves through the same route — the backend reads file...", async (t) => {
  t.check(resolveImageSrc("images/aya-intake.image.card", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" }), "/test1/api/image/_content/dossiers/images/aya-intake.image.card");
});

// The legacy `api/files/<path>` form (and the `api/image/<path>` form) is accepted as a hint that the path is already box-root-relative; both re-emit through `/api/image/`:
void test("The legacy api/files/<path> form (and the api/image/<path> form) is accepted...", async (t) => {
  t.check(resolveImageSrc("api/files/_content/images/front.png", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" }), "/test1/api/image/_content/images/front.png");
});

// A src that escapes the box root names no servable file, so it resolves to an
// empty src — the browser draws its broken-image affordance and the alt text
// instead of the clamped-to-root image the old resolver would have shown:
void test("A src that escapes the box root names no servable file, so it resolves to an...", async (t) => {
  t.check(resolveImageSrc("../../../etc/passwd", { boxSlug: "test1", basePath: "_content/dossiers/annika.md" }), "");
});

// External URLs pass through untouched:
void test("External URLs pass through untouched:", async (t) => {
  t.check(
    resolveImageSrc("https://example.com/x.png", { boxSlug: "test1", basePath: "_content/a.md" })
    ,
    "https://example.com/x.png",
  );
});

// ## externalImageProxyUrl
//
// External http(s) images get a box `/api/proxy-image` fallback URL (the original is URL-encoded into `?url=`). Under the Node test runner Vite's `BASE_URL` is unset, so the base prefix is empty.
void test("External http(s) images get a box /api/proxy-image fallback URL (the original...", async (t) => {
  t.check(
    externalImageProxyUrl("https://example.com/x.png", "test1")
    ,
    "/test1/api/proxy-image?url=https%3A%2F%2Fexample.com%2Fx.png",
  );
});

// Protocol-relative URLs are assumed https (the proxy needs an absolute scheme):
void test("Protocol-relative URLs are assumed https (the proxy needs an absolute scheme):", async (t) => {
  t.check(
    externalImageProxyUrl("//cdn.example.com/y.jpg", "test1")
    ,
    "/test1/api/proxy-image?url=https%3A%2F%2Fcdn.example.com%2Fy.jpg",
  );
});

// In-box URLs have no proxy — they return undefined:
void test("In-box URLs have no proxy — they return undefined:", async (t) => {
  t.check(externalImageProxyUrl("/test1/api/files/_content/a.png", "test1"), undefined);
});

// ## apiFileUrl / apiImageUrl / apiRawFileUrl
//
// These build the URLs the file/image renderers embed a box-relative path into — `apiFileUrl`/`apiImageUrl` prefix the Vite base and box slug themselves (for an `<img src>` or link target built without an already box-scoped API base in hand); `apiRawFileUrl` takes an already-computed `apiBase` (as returned by `getApiBase()`) and builds the raw `/files/<path>` download/fetch URL. All three route every path segment through `encodePathForUrl`, so a filename containing `#`, `?`, `%`, or a space survives — a URL built by plain concatenation would otherwise get truncated at `#`/`?` or have a literal `%` reinterpreted as a percent-escape.
//
// A path segment with `#`, `?`, `%`, or a space is percent-encoded — but the `/` separators between segments are preserved, not escaped into `%2F`:
void test("These build the URLs the file/image renderers embed a box-relative path into...", async (t) => {
  t.check(apiFileUrl("test1", "_content/Q&A #3 100% done?.md"), "/test1/api/files/_content/Q%26A%20%233%20100%25%20done%3F.md");

  t.check(apiImageUrl("test1", "_content/Q&A #3 100% done?.png"), "/test1/api/image/_content/Q%26A%20%233%20100%25%20done%3F.png");

  t.check(apiRawFileUrl("/test1/api", "_content/Q&A #3 100% done?.md"), "/test1/api/files/_content/Q%26A%20%233%20100%25%20done%3F.md");
});
