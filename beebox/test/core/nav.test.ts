// # Nav card resolution
//
// `nav.card` at the box root drives the top navigation (docs/implemented-plans/nav-card.md).
// `resolveNav` loads and validates it: `absent` means "the box has no custom nav
// section" (the app bar's switch menu is builtin and shows regardless), `invalid`
// means the same plus a health warning, `ok` carries render-ready entries plus
// non-fatal `problems` (dangling refs) for the health check.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { resolveNav } from "../../src/core/nav.js";
import { parseNavFields } from "../../src/schemas/nav.js";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

// ## No nav.card → absent (no custom section, not a problem)
void test("No nav.card → absent (no custom section, not a problem)", async (t) => {
  // doctest:L20
  const box = await makeTmpBox();
  const result = await resolveNav(box.root);
  t.check(result.status, "absent");
});

// ## href entries resolve with builtin labels, overridable per entry
void test("href entries resolve with builtin labels, overridable per entry", async (t) => {
  // doctest:L29
  const box = await makeTmpBox();
  await box.write("nav.card", `---
entries:
  - { href: / }
  - { href: /chat, label: Recent }
  - { href: /questions }
---
`);
  const result = await resolveNav(box.root);
  t.check(result.status, "ok");

  // doctest:L41
  t.check(result.status === "ok" ? result.entries : null, [
    {
      kind: "href",
      target: "/",
      label: "Chat",
    },
    {
      kind: "href",
      target: "/chat",
      label: "Recent",
    },
    {
      kind: "href",
      target: "/questions",
      label: "Questions",
    },
  ]);
});

// ## ref entries get the target's title, and existence is checked
//
// A ref entry's label falls back to the target card's frontmatter `title`,
// then to a filename-derived title. A dangling ref still renders (with
// `exists: false`) and is reported in `problems` so the health check can
// surface it.
void test("A ref entry's label falls back to the target card's frontmatter title, then t...", async (t) => {
  // doctest:L70
  const box = await makeTmpBox();
  await box.write("_content/projects/Big_Refactor.doc.card", `---
title: The Big Refactor
contains: project notes
---
Notes.
`);
  await box.write("nav.card", `---
entries:
  - { href: /browse }
  - { ref: _content/projects/Big_Refactor.doc.card }
  - { ref: _content/gone/Missing.doc.card, label: Ghost }
---
`);
  const result = await resolveNav(box.root);
  t.check(result.status === "ok" ? result.entries.slice(1) : null, [
    {
      kind: "ref",
      target: "_content/projects/Big_Refactor.doc.card",
      label: "The Big Refactor",
      exists: true,
    },
    {
      kind: "ref",
      target: "_content/gone/Missing.doc.card",
      label: "Ghost",
      exists: false,
    },
  ]);

  // doctest:L102
  t.check(result.status === "ok" ? result.problems : null, [
    "ref \"_content/gone/Missing.doc.card\" does not point at an existing file",
  ]);
});

// ## A box path (leading `/`) is the canonical ref form
//
// `nav.card` sits at the box root, so the canonical leading-`/` form and the
// bare form name the same file. Both resolve; both emit the same normalized
// `target` (the shell builds `/<box>/browse/<target>` from it, so the slash
// must not survive into the entry).
void test("nav.card sits at the box root, so the canonical leading-/ form and the bare f...", async (t) => {
  // doctest:L114
  const box = await makeTmpBox();
  await box.write("_content/projects/Big_Refactor.doc.card", `---
title: The Big Refactor
contains: project notes
---
Notes.
`);
  await box.write("nav.card", `---
entries:
  - { ref: /_content/projects/Big_Refactor.doc.card }
  - { ref: _content/projects/Big_Refactor.doc.card, label: Bare }
---
`);
  const result = await resolveNav(box.root);
  t.check(result.status === "ok" ? result.entries : null, [
    {
      kind: "ref",
      target: "_content/projects/Big_Refactor.doc.card",
      label: "The Big Refactor",
      exists: true,
    },
    {
      kind: "ref",
      target: "_content/projects/Big_Refactor.doc.card",
      label: "Bare",
      exists: true,
    },
  ]);

  // doctest:L145
  t.check(result.status === "ok" ? result.problems : null, []);

  // A leading-`/` ref at a path that doesn't exist is a dangling ref like any
  // other — reported in `problems`, still rendered:

  // doctest:L153
  await box.write("nav.card", `---
entries:
  - { ref: /_content/gone/Missing.doc.card }
---
`);
  const missing = await resolveNav(box.root);
  t.check(missing.status === "ok" ? missing.problems : null, [
    "ref \"/_content/gone/Missing.doc.card\" does not point at an existing file",
  ]);

  // doctest:L162
  t.check(missing.status === "ok" ? missing.entries[0]?.target : null, "_content/gone/Missing.doc.card");
});

// ## An unknown href fails validation with the valid set enumerated
void test("An unknown href fails validation with the valid set enumerated", async (t) => {
  // doctest:L169
  const box = await makeTmpBox();
  await box.write("nav.card", `---
entries:
  - { href: /not-a-route }
---
`);
  const result = await resolveNav(box.root);
  t.check(result.status, "invalid");

  // doctest:L179
  t.check(result.status === "invalid" ? result.error.includes("href must be one of: /, /chat, /dashboard") : null, true);
});

// ## Malformed cards are invalid, never a crash
void test("Malformed cards are invalid, never a crash", async (t) => {
  // doctest:L186
  const box = await makeTmpBox();
  await box.write("nav.card", "just some text, no frontmatter\n");
  const result = await resolveNav(box.root);
  t.check(result.status === "invalid" ? result.error : null, "nav.card has no frontmatter block");

  // doctest:L192
  await box.write("nav.card", "---\nentries: []\n---\n");
  const empty = await resolveNav(box.root);
  t.check(empty.status, "invalid");
});

// ## Refs that could escape the box are rejected as problems
//
// A `..` that climbs out of the box is refused — including one hidden behind a
// leading `/` — and a ref that reaches outside via an in-box symlink is refused
// after the realpath check. Neither entry renders.
void test("A .. that climbs out of the box is refused — including one hidden behind a le...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      await rm(outsideDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L205
  const box = await makeTmpBox();
  const outsideDir = await mkdtemp(`${tmpdir()}/bbx-nav-outside-`);
  const outside = `${outsideDir}/Secret.doc.card`;
  await writeFile(outside, "---\ntitle: Secret\n---\n");
  await box.write("_content/.keep", "");
  await symlink(outside, box.path("_content/Leak.doc.card"));

  // doctest:L212
  await box.write("nav.card", `---
entries:
  - { href: / }
  - { ref: ../outside/Secret.doc.card }
  - { ref: /../outside/Secret.doc.card }
  - { ref: /_content/Leak.doc.card }
---
`);
  const result = await resolveNav(box.root);
  t.check(result.status === "ok" ? result.problems : null, [
    "ref \"../outside/Secret.doc.card\" must be box-relative (must not escape the box via ..)",
    "ref \"/../outside/Secret.doc.card\" must be box-relative (must not escape the box via ..)",
    "ref \"/_content/Leak.doc.card\" must be box-relative (must not escape the box via a symlink)",
  ]);

  // doctest:L229
  t.check(result.status === "ok" ? result.entries.length : null, 1);
});

// ## parseNavFields: an entry may be href or ref, not both
void test("parseNavFields: an entry may be href or ref, not both", async (t) => {
  // doctest:L241
  const bad = parseNavFields(`---
entries:
  - { href: /chat, ref: _content/x.doc.card }
---
`);
  t.check(bad.fields, null);
});
