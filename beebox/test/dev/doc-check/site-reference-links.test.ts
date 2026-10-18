// # Site links into generated reference pages
//
// `site/docs/` pages link to `reference/cards/<type>.md` and other `reference/`
// pages. The site build generates those pages from the engine's docs, so they
// exist in no commit. When a card type moved into a plugin, its page disappeared
// and the links to it broke on main. Nothing noticed until a later, unrelated
// finish ran the site build (twice in October 2026). doc-check now resolves
// these links at commit time.

import { test } from "tap";
import "agent-doctest/tap";
import { findSiteReferenceLinkProblems, referencePublishPath } from "../../../src/dev/doc-check/site-reference-links.js";

/** The generated set for these examples: two card types and one other reference page. */
const referencePaths = new Set(["reference/cards/audio.md", "reference/cards/index.md", "reference/triage.md"]);
const check = (rel: string, content: string) => findSiteReferenceLinkProblems({ rel, content, referencePaths });

// ## Where a generated page is published
//
// The engine exports flat filenames. A `card-<type>.md` becomes a page under
// `reference/cards/`, and every other file goes straight under `reference/`, as
// in `site/docs-generated.ts`.
void test("The engine exports flat filenames.", async (t) => {
  // doctest:L25
  t.check([referencePublishPath("card-audio.md"), referencePublishPath("triage.md")], [
    "reference/cards/audio.md",
    "reference/triage.md",
  ]);
});

// ## A link to a removed card page is a problem
//
// The courseware case: `capabilities/courses.md` linked to the `course` card's
// page after the type moved into a plugin. Links resolve against the page's
// published directory, so `../reference/cards/course.md` from `capabilities/` is
// `reference/cards/course.md`.
void test("The courseware case:", async (t) => {
  // doctest:L37
  t.check(check("site/docs/capabilities/courses.md", "See [course](../reference/cards/course.md) and [audio](../reference/cards/audio.md#fields).\n"), [
    {
      line: 1,
      href: "../reference/cards/course.md",
      resolved: "reference/cards/course.md",
    },
  ]);
});

// A top-level page links without `../`, and the line number counts from 1.
void test("A top-level page links without ../, and the line number counts from 1.", async (t) => {
  // doctest:L44
  t.check(check("site/docs/02-uses.md", "intro\n- [briefing](reference/cards/briefing.md)\n"), [
    {
      line: 2,
      href: "reference/cards/briefing.md",
      resolved: "reference/cards/briefing.md",
    },
  ]);
});

// ## What it leaves alone
//
// The site build already checks links between authored pages; this rule covers
// only `reference/`. Code spans, fenced blocks, images, external URLs and pure
// anchors are not links into the generated set.
//
// ````ts
// check(
//   "site/docs/capabilities/x.md",
//   [
//     "[other](../concepts/missing.md)",
//     "`[example](../reference/cards/gone.md)`",
//     "![icon](../reference/cards/gone.png)",
//     "[site](https://example.com/reference/cards/gone.md) [top](#top)",
//     "```",
//     "[fenced](../reference/cards/gone.md)",
//     "```",
//   ].join("\n"),
// )
// => []
// ````
