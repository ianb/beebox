// # markdown-link-rules: BBX001 no-legacy-view-links + BBX002 no-broken-internal-links

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { lint as markdownlint } from "markdownlint/promise";
import { noBrokenInternalLinks, noLegacyViewLinks } from "../../src/core/markdown-lint-rules.js";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// ## BBX001 no-legacy-view-links
//
// The `view:` URL scheme is retired: cards/files are referenced by a plain box
// path. BBX001 flags any surviving `view:` — in a link URL, an image (embed) URL, or
// the old `[view:path]` reference-label mistake — and names the fix. Plain paths are
// NOT flagged.
async function lintView(file: string): Promise<string[]> {
  const results = await markdownlint({
    files: [file],
    config: { default: false, "no-legacy-view-links": true },
    customRules: [noLegacyViewLinks],
  });
  return (results[file] ?? []).map((e) => `${e.ruleNames[0]}: ${e.errorDetail}`);
}

// ## BBX002 no-broken-internal-links
//
// `noBrokenInternalLinks` (BBX002) checks that internal markdown links point to a
// file or directory that exists **inside the box**. It is box-root-aware: a
// leading-`/` link resolves against the box root (not the OS filesystem root), and
// a link that escapes the box is flagged even if the target happens to exist.
// Lint one markdown file with only BBX002 enabled and the given boxRoot, and
// return each finding as "rule: detail" for compact assertions.
async function lintLinks(boxRoot: string, file: string): Promise<string[]> {
  const results = await markdownlint({
    files: [file],
    config: { default: false, "no-broken-internal-links": { boxRoot } },
    customRules: [noBrokenInternalLinks],
  });
  return (results[file] ?? []).map((e) => `${e.ruleNames[0]}: ${e.errorDetail}`);
}

void test("BBX001 no-legacy-view-links", async (t) => {
  // doctest:L30
  const vbox = await makeTmpBox();
  const vdoc = join(vbox.root, "doc.md");
  await writeFile(
    vdoc,
    [
      "A link [the plan](view:store/notes/Plan.doc.card) and embed ![fig](view:store/figures/F.figure.card?size=300).",
      "Old label form [view:store/x.card].",
      "Fine: [plan](store/notes/Plan.doc.card) and ![fig](/store/figures/F.figure.card).",
      "",
    ].join("\n"),
  );

  // doctest:L42
  t.check(await lintView(vdoc), [
    "BBX001: Drop the `view:` prefix — reference the plain box path instead of ](view:store/notes/Plan.doc.card)",
    "BBX001: Drop the `view:` prefix — reference the plain box path instead of ](view:store/figures/F.figure.card?size=300)",
    "BBX001: Drop the `view:` prefix — reference the plain box path instead of [view:store/x.card]",
  ]);

  // doctest:L52
  await vbox.cleanup();
});

// A box with one real target file (`store/images/a.webp`) and a dossier that mixes
// valid and broken links. Valid box-root-absolute and relative links are NOT
// flagged; broken ones are; a `..`-escape out of the box is flagged even though
// `/etc/hosts` exists:
void test("A box with one real target file (store/images/a.webp) and a dossier that mixe...", async (t) => {
  // doctest:L82
  const box = await makeTmpBox();
  await mkdir(join(box.root, "_content/store/images"), { recursive: true });
  await writeFile(join(box.root, "_content/store/images/a.webp"), "x");

  // doctest:L86
  const doc = join(box.root, "_content/store/docs/saoirse.md");
  await mkdir(dirname(doc), { recursive: true });
  await writeFile(
    doc,
    [
      "![ok abs](/_content/store/images/a.webp)",
      "![broken abs](/_content/store/images/missing.webp)",
      "![ok rel](../images/a.webp)",
      "![broken rel](./nope.webp)",
      "![escape](../../../../../../../../etc/hosts)",
      "",
    ].join("\n"),
  );

  // doctest:L100
  t.check(await lintLinks(box.root, doc), [
    "BBX002: Broken link: /_content/store/images/missing.webp",
    "BBX002: Broken link: ./nope.webp",
    "BBX002: Link points outside the box: ../../../../../../../../etc/hosts",
  ]);

  // doctest:L110
  await box.cleanup();
});

// ### A destination with a space uses angle brackets
//
// A bare link destination ends at the first space, so a path with a space or a
// parenthesis is written in CommonMark's angle-bracket form. BBX002 checks the
// path inside the brackets:
void test("A bare link destination ends at the first space, so a path with a space or a...", async (t) => {
  // doctest:L120
  const sbox = await makeTmpBox();
  await mkdir(join(sbox.root, "_content/Beach walk.attach"), { recursive: true });
  await writeFile(join(sbox.root, "_content/Beach walk.attach/p.jpg"), "x");
  const sdoc = join(sbox.root, "_content/trip.md");
  await writeFile(join(sbox.root, "_content/notes (old).md"), "x");
  await writeFile(sdoc, "![ok](<Beach walk.attach/p.jpg>) ![broken](<Beach walk.attach/q.jpg>) [ok](<notes (old).md>)\n");
  t.check(await lintLinks(sbox.root, sdoc), [
    "BBX002: Broken link: Beach walk.attach/q.jpg",
  ]);

  // doctest:L131
  await sbox.cleanup();
});

// ### Suffixes, and `attach/` in a `.md`
//
// A link may carry a `?query` or `#fragment` addressing a location *within* the
// target (`?view=ledger` picks a view, `#risks` an anchor) — the existence check
// runs on the path part, so those links are not broken. And a `.md` dossier owns
// no `<basename>.attach/` scope, so `attach/…` is a plain subdirectory of the
// dossier's own directory: it resolves there and is flagged only when that file is
// missing.
void test("A link may carry a ?query or #fragment addressing a location within the targe...", async (t) => {
  // doctest:L144
  const sbox = await makeTmpBox();
  await mkdir(join(sbox.root, "_content/store/figures"), { recursive: true });
  await writeFile(join(sbox.root, "_content/store/figures/F.figure.card"), "---\n---\n");

  // doctest:L148
  const sdoc = join(sbox.root, "_content/store/docs/saoirse.md");
  await mkdir(join(sbox.root, "_content/store/docs/attach"), { recursive: true });
  await writeFile(join(sbox.root, "_content/store/docs/attach/photo.webp"), "x");
  await writeFile(
    sdoc,
    [
      "[view](/_content/store/figures/F.figure.card?view=ledger)",
      "[anchor](/_content/store/figures/F.figure.card#risks)",
      "[both](../figures/F.figure.card?view=ledger#risks)",
      "![literal attach](attach/photo.webp)",
      "![no card scope](attach/missing.webp)",
      "[gone](/_content/store/figures/Missing.figure.card?view=ledger)",
      "",
    ].join("\n"),
  );

  // doctest:L164
  t.check(await lintLinks(sbox.root, sdoc), [
    "BBX002: Broken link: attach/missing.webp",
    "BBX002: Broken link: /_content/store/figures/Missing.figure.card?view=ledger",
  ]);

  // doctest:L173
  await sbox.cleanup();
});

// ### A display-form path is a distinct error, not silently skipped
//
// `Config:box.json` (the boxholder's display form) matches the external-scheme
// pattern `resolveInternalLink` classifies as "not internal" — before this
// guard, such a link was silently never checked at all. It is now flagged
// BEFORE that classification, with a message naming the canonical form
// (`docs/plans/display-path-guard.subplan.md`):
void test("Config:box.json (the boxholder's display form) matches the external-scheme pa...", async (t) => {
  // doctest:L185
  const dbox = await makeTmpBox();
  const ddoc = join(dbox.root, "_content/store/docs/saoirse.md");
  await mkdir(dirname(ddoc), { recursive: true });
  await writeFile(
    ddoc,
    ["[config](Config:box.json)", "[jobs](Bookkeeping:jobs/x.job.card)", ""].join("\n"),
  );

  // doctest:L193
  t.check(await lintLinks(dbox.root, ddoc), [
    "BBX002: `Config:box.json` is the boxholder's display form; write `/_config/box.json`",
    "BBX002: `Bookkeeping:jobs/x.job.card` is the boxholder's display form; write `/_bookkeeping/jobs/x.job.card`",
  ]);

  // doctest:L202
  await dbox.cleanup();
});

// boxRoot is required: enabling the rule without it (e.g. `true`) is a caller error
// and throws rather than silently mis-resolving every box-root link:
void test("boxRoot is required:", async (t) => {
  // doctest:L209
  const box2 = await makeTmpBox();
  const doc2 = join(box2.root, "x.md");
  await writeFile(doc2, "![broken](/_content/store/nope.webp)\n");

  // doctest:L213
  let thrown = "none";
  try {
    await markdownlint({
      files: [doc2],
      config: { default: false, "no-broken-internal-links": true },
      customRules: [noBrokenInternalLinks],
    });
  } catch (e) {
    thrown = e instanceof Error ? e.name : String(e);
  }
  await box2.cleanup();
  t.check(thrown, "MissingBoxRootError");
});
