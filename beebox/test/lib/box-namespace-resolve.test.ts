// # `resolveBoxNamespacePath` — the box namespace fence, checked on the resolved path
//
// Every fenced HTTP/tRPC route resolves a client-supplied box path through
// `resolveBoxNamespacePath` (`src/lib/box-namespace-resolve.ts`), which checks
// the box namespace fence (`isInBoxNamespace`, Track B,
// `docs/implemented-plans/one-root-box-layout.md`) against the RESOLVED filesystem path —
// not the raw request string. Checking the raw string is a traversal bypass:
// `_content/../package.json` starts with `_content` (passes a naive raw-string
// check) but *resolves* to `package.json`, outside the namespace.
//
// `resolveBoxNamespacePath` returns a `BoxNamespaceResult`, not a bare `null`:
// `{ ok: true, resolved, relativePath }` on success, or `{ ok: false, reason:
// "escaped" }` / `{ ok: false, reason: "display-form", message }` on failure —
// the two failure reasons are distinguished so a caller can respond
// differently (`docs/plans/display-path-guard.subplan.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { BoxNamespaceResult } from "../../src/lib/box-namespace-resolve.js";
import { resolveBoxNamespacePath } from "../../src/lib/box-namespace-resolve.js";
import { symlink, mkdir, rm } from "node:fs/promises";
import {
  resolveBoxNamespacePathOnDisk,
  verifyBoxNamespaceOnDisk,
} from "../../src/lib/box-namespace-resolve.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

/** Compact rendering of a result for string-comparison assertions below. */
function describe(result: BoxNamespaceResult): string {
  if (result.ok) return result.relativePath;
  return result.reason === "display-form" ? `display-form: ${result.message}` : "escaped";
}

// ## On-disk verification — the lexical check alone is not enough
//
// `resolveBoxNamespacePath` above is purely lexical (string/segment manipulation)
// — it never touches the filesystem. In the one-root box layout the box root is
// ALSO the npm package root (`package.json`, `node_modules/`, `src/`,
// `.git/` all live right there beside the underscore areas), so a SYMLINK
// anywhere along an otherwise-valid-looking `_content/...` path can walk the
// fence straight into the package internals even though every lexical segment
// looked fine. `resolveBoxNamespacePathOnDisk` (and its building block
// `verifyBoxNamespaceOnDisk`) is the async filesystem-sink layer every
// consuming route calls in addition to the lexical check — it `realpath`s the
// target (or the walk to reach it) and re-verifies both box-root containment
// and namespace membership against the RESOLVED path.

// An ordinary in-namespace path resolves normally:
void test("An ordinary in-namespace path resolves normally:", async (t) => {
  // doctest:L31
  t.check(resolveBoxNamespacePath("/box", "_content/inbox/x.doc.card"), {
    ok: true,
    resolved: "/box/_content/inbox/x.doc.card",
    relativePath: "_content/inbox/x.doc.card",
  });
});

// A path outside every underscore area is rejected:
void test("A path outside every underscore area is rejected:", async (t) => {
  // doctest:L38
  t.check(describe(resolveBoxNamespacePath("/box", "package.json")), "escaped");

  // doctest:L41
  t.check(describe(resolveBoxNamespacePath("/box", "src/lib/paths/core.ts")), "escaped");

  // doctest:L44
  t.check(describe(resolveBoxNamespacePath("/box", "node_modules/foo/index.js")), "escaped");
});

// A nested reserved area name (`box-reserved-segments.ts`) is refused like any
// other out-of-vocabulary path — the loud, named error lives at the creation
// surfaces; the template-updates mirror and nested `_tmp` stay legal:
void test("A nested reserved area name (box-reserved-segments.ts) is refused like any ot...", async (t) => {
  // doctest:L53
  t.check(describe(resolveBoxNamespacePath("/box", "_content/recipes/_config/x.card")), "escaped");

  // doctest:L56
  t.check(describe(resolveBoxNamespacePath("/box", "_config/_template-updates/_content/briefing.md")), "_config/_template-updates/_content/briefing.md");

  // doctest:L59
  t.check(describe(resolveBoxNamespacePath("/box", "_content/scratch/_tmp/x.txt")), "_content/scratch/_tmp/x.txt");
});

// The box root itself (empty relative path) is never in-namespace:
void test("The box root itself (empty relative path) is never in-namespace:", async (t) => {
  // doctest:L66
  t.check(describe(resolveBoxNamespacePath("/box", "")), "escaped");
});

// A genuine escape outside the box root entirely is rejected:
void test("A genuine escape outside the box root entirely is rejected:", async (t) => {
  // doctest:L73
  t.check(describe(resolveBoxNamespacePath("/box", "../outside.txt")), "escaped");

  // doctest:L76
  t.check(describe(resolveBoxNamespacePath("/box", "../box-other/secret.txt")), "escaped");
});

// **The bypass this fixes**: a traversal form that starts inside an underscore
// area but resolves outside the namespace once normalized. A raw-string check
// on `isInBoxNamespace` alone would pass every one of these (each starts with
// `_content`); checking the RESOLVED path catches them all:
void test("The bypass this fixes:", async (t) => {
  // doctest:L86
  t.check(describe(resolveBoxNamespacePath("/box", "_content/../package.json")), "escaped");

  // doctest:L89
  t.check(describe(resolveBoxNamespacePath("/box", "_content/./../src/x")), "escaped");

  // doctest:L92
  t.check(describe(resolveBoxNamespacePath("/box", "_content/../../box-other/secret.txt")), "escaped");

  // doctest:L95
  t.check(describe(resolveBoxNamespacePath("/box", "_content/foo/../../package.json")), "escaped");
});

// A traversal form that stays inside the SAME underscore area after
// normalizing is still fine — only the resolved location matters, not whether
// the raw string contained dots:
void test("A traversal form that stays inside the SAME underscore area after normalizing...", async (t) => {
  // doctest:L104
  t.check(resolveBoxNamespacePath("/box", "_content/inbox/../drafts/x.doc.card"), {
    ok: true,
    resolved: "/box/_content/drafts/x.doc.card",
    relativePath: "_content/drafts/x.doc.card",
  });
});

// ## A boxholder DISPLAY-FORM path is a distinct rejection reason
//
// `Config:box.json` (the boxholder's CONVERSATION vocabulary — never a
// canonical path) is rejected before any escape/namespace check, with a
// caller-VISIBLE message naming the canonical form — an HTTP route maps this
// to 400, a tRPC procedure to `TRPCError({ code: "BAD_REQUEST" })`
// (`docs/plans/display-path-guard.subplan.md`):
void test("Config:box.json (the boxholder's CONVERSATION vocabulary — never a canonical...", async (t) => {
  // doctest:L117
  t.check(describe(resolveBoxNamespacePath("/box", "Config:box.json")), "display-form: `Config:box.json` is the boxholder's display form; write `/_config/box.json`");

  // doctest:L120
  t.check(describe(resolveBoxNamespacePath("/box", "Bookkeeping:jobs/x.job.card")), "display-form: `Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`");
});

// `content:` is never a display form (it's a real URI scheme, and `_content`
// displays bare) — it falls through to the ordinary escape check like any
// other unrecognized top-level segment:
void test("content: is never a display form (it's a real URI scheme, and content display...", async (t) => {
  // doctest:L129
  t.check(describe(resolveBoxNamespacePath("/box", "content:box.json")), "escaped");
});

// An ordinary in-namespace path with no symlinks involved resolves the same way
// under both modes:
void test("An ordinary in-namespace path with no symlinks involved resolves the same way...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L160
  const box = await makeTmpBox();
  await box.write("_content/inbox/x.doc.card", "hello");

  // doctest:L163
  const ordinaryRead = await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/inbox/x.doc.card", mode: "read" });
  t.check(describe(ordinaryRead), "_content/inbox/x.doc.card");

  // doctest:L167
  const ordinaryWrite = await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/inbox/x.doc.card", mode: "write" });
  t.check(describe(ordinaryWrite), "_content/inbox/x.doc.card");

  // ### The `_content/pkg` → package-root symlink escape (the adversarial probe)
  //
  // A box where `_content/pkg` is a symlink pointing back at `..` (the box root
  // itself, which in the one-root layout IS the npm package root) tries to reach
  // `package.json` through it. Plain box-root containment would pass this (the
  // symlink resolves to somewhere still inside `boxRoot`) — it's the NAMESPACE
  // re-check on the resolved path that catches it, since the real relative path
  // comes out as `package.json`, outside every underscore area:

  // doctest:L182
  await symlink("..", box.path("_content/pkg"));

  // doctest:L184
  t.check(describe(await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg/package.json", mode: "read" })), "escaped");

  // doctest:L187
  t.check(describe(await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg/package.json", mode: "write" })), "escaped");

  // Browsing the symlinked directory itself (its own leaf IS the symlink) is
  // refused too — the leaf-symlink allowance below only exempts a leaf that
  // resolves to a non-directory, so a directory-listing route stays safe even
  // under `mode: "read"`:

  // doctest:L197
  t.check(describe(await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg", mode: "read" })), "escaped");

  // Reaching further into the package internals (`src/`, `node_modules/`)
  // through the same symlink is refused identically:

  // doctest:L205
  t.check(describe(await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg/src/lib/paths.ts", mode: "read" })), "escaped");

  // doctest:L208
  t.check(describe(await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_content/pkg/node_modules/foo", mode: "read" })), "escaped");

  // ### The area segment itself being a symlink is refused before walking deeper

  // doctest:L215
  await mkdir(box.path("elsewhere/_content"), { recursive: true });
  await box.write("elsewhere/_content/x.doc.card", "hi");
  // `bbx init` scaffolds `_config/` as a real directory (migrations manifest,
  // transcription config) — remove it first so the symlink can take its place.
  await rm(box.path("_config"), { recursive: true, force: true });
  await symlink(box.path("elsewhere/_content"), box.path("_config"));

  // doctest:L222
  t.check(describe(await resolveBoxNamespacePathOnDisk({ boxRoot: box.root, rawPath: "_config/x.doc.card", mode: "read" })), "escaped");
});

// ### Annex-style leaf symlinks — allowed on read, refused on write/delete
//
// A leaf symlink whose target is a plain FILE outside `boxRoot` entirely (the
// git-annex shape: the visible box path is a symlink into
// `.git/annex/objects/...`) still serves on a read — only the WALK to its
// containing directory is re-checked, not the leaf's own target:
void test("A leaf symlink whose target is a plain FILE outside boxRoot entirely (the git...", async (t) => {
  t.teardown(async () => {
    try {
      await annexBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L238
  const annexBox = await makeTmpBox();
  await mkdir(annexBox.path("_content/photos.attach"), { recursive: true });
  await mkdir(annexBox.path(".git/annex/objects/xx/yy"), { recursive: true });
  await annexBox.write(".git/annex/objects/xx/yy/realbytes.jpg", "fake-jpeg-bytes");
  await symlink(
    annexBox.path(".git/annex/objects/xx/yy/realbytes.jpg"),
    annexBox.path("_content/photos.attach/img.jpg"),
  );

  // doctest:L247
  const annexRead = await resolveBoxNamespacePathOnDisk({
    boxRoot: annexBox.root,
    rawPath: "_content/photos.attach/img.jpg",
    mode: "read",
  });
  t.check(describe(annexRead), "_content/photos.attach/img.jpg");

  // The same leaf symlink is refused for a write or delete — an existing leaf
  // symlink resolving outside the box root is never writable through it:

  // doctest:L260
  t.check(describe(await resolveBoxNamespacePathOnDisk({ boxRoot: annexBox.root, rawPath: "_content/photos.attach/img.jpg", mode: "write" })), "escaped");

  // A leaf symlink that resolves INSIDE the box (a same-directory relative
  // symlink) is still fine on write — only an out-of-box target is refused:

  // doctest:L268
  await annexBox.write("_content/photos.attach/real.jpg", "real-bytes");
  await symlink("real.jpg", annexBox.path("_content/photos.attach/alias.jpg"));

  // doctest:L271
  const aliasWrite = await resolveBoxNamespacePathOnDisk({
    boxRoot: annexBox.root,
    rawPath: "_content/photos.attach/alias.jpg",
    mode: "write",
  });
  t.check(describe(aliasWrite), "_content/photos.attach/alias.jpg");
});

// ### A leaf symlink to a NON-annex external file is refused on read too (finding 2, round 3 hardening)
//
// Before this fix, ANY leaf symlink resolving to a non-directory target was
// served on read — not just an annex object under `.git/annex/`. A leaf
// pointing at `package.json` (nothing to do with annex) must 403 exactly like
// the directory-symlink probes above, even though the leaf itself is a
// non-directory:
void test("Before this fix, ANY leaf symlink resolving to a non-directory target was ser...", async (t) => {
  t.teardown(async () => {
    try {
      await nonAnnexBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L293
  const nonAnnexBox = await makeTmpBox();
  await mkdir(nonAnnexBox.path("_content/photos.attach"), { recursive: true });
  await nonAnnexBox.write("package.json", '{"name":"secret-marker"}');
  await symlink(
    nonAnnexBox.path("package.json"),
    nonAnnexBox.path("_content/photos.attach/pkg.json"),
  );

  // doctest:L301
  t.check(
    describe(await resolveBoxNamespacePathOnDisk({
      boxRoot: nonAnnexBox.root,
      rawPath: "_content/photos.attach/pkg.json",
      mode: "read",
    })),
    "escaped",
  );

  // A RELATIVE non-annex target that still resolves outside the box entirely
  // (`../package.json`-shaped) is refused the same way:

  // doctest:L313
  await symlink("../../../package.json", nonAnnexBox.path("_content/photos.attach/relative-escape.json"));
  t.check(
    describe(await resolveBoxNamespacePathOnDisk({
      boxRoot: nonAnnexBox.root,
      rawPath: "_content/photos.attach/relative-escape.json",
      mode: "read",
    })),
    "escaped",
  );

  // A leaf under a REAL `.git/annex/` directory but pointing OUTSIDE it (e.g.
  // back at `.git/annex/../../package.json`) is refused too — "under
  // `.git/annex/`" means the resolved target, not merely a box that happens to
  // have annex initialized:

  // doctest:L328
  await mkdir(nonAnnexBox.path(".git/annex/objects/xx/yy"), { recursive: true });
  await symlink(
    nonAnnexBox.path("package.json"),
    nonAnnexBox.path("_content/photos.attach/not-really-annex.json"),
  );
  t.check(
    describe(await resolveBoxNamespacePathOnDisk({
      boxRoot: nonAnnexBox.root,
      rawPath: "_content/photos.attach/not-really-annex.json",
      mode: "read",
    })),
    "escaped",
  );
});

// ### `verifyBoxNamespaceOnDisk` — the lower-level building block
//
// Callers that already have a lexically-resolved `BoxNamespacePath` (e.g. one
// derived from a card's own ref, not the raw request path) can call this
// directly instead of re-resolving from a raw string:
void test("Callers that already have a lexically-resolved BoxNamespacePath (e.g.", async (t) => {
  t.teardown(async () => {
    try {
      await directBox.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L352
  const directBox = await makeTmpBox();
  await directBox.write("_content/note.doc.card", "hi");
  const ns = resolveBoxNamespacePath(directBox.root, "_content/note.doc.card");
  if (!ns.ok) throw new Error("expected an ok resolution");
  t.check(await verifyBoxNamespaceOnDisk({ boxRoot: directBox.root, ns, mode: "read" }), true);

  // doctest:L359
  await symlink("..", directBox.path("_content/pkg"));
  const escapedNs = resolveBoxNamespacePath(directBox.root, "_content/pkg/package.json");
  if (!escapedNs.ok) throw new Error("expected an ok resolution");
  t.check(await verifyBoxNamespaceOnDisk({ boxRoot: directBox.root, ns: escapedNs, mode: "read" }), false);
});
