// # Browse's compact/raw listing modes
//
// `BrowseSidebarList`'s `mode` prop (`docs/implemented-plans/card-prominence.md`, Track C):
// compact leads with `foldListing`'s `lead` tier and folds the rest behind one
// "N more" disclosure; raw ignores prominence and renders today's flat
// listing. A listing with nothing prominent renders identically in both
// modes — no disclosure appears.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowseSidebarList } from "../../../../../src/pages/browse/components/BrowseSidebarBody/BrowseSidebarList.js";

type BrowseData = Parameters<typeof BrowseSidebarList>[0]["data"];

globalThis.React = React;

const mixedData: BrowseData = {
  path: "",
  background: false,
  dirs: [
    {
      name: "Cookbook",
      fileCount: 2,
      summary: { hasEntryPoint: false, primaryCount: 1, background: false, cardCount: 2 },
      landmark: { label: "Cookbook", symbol: { glyph: "🍳" } },
      seeded: false,
    },
    { name: "Logs", fileCount: 3, summary: { hasEntryPoint: false, primaryCount: 0, background: true, cardCount: 3 }, seeded: false },
  ],
  cards: [
    { relativePath: "Plan.doc.card", name: "Plan", type: "doc", hasAttachments: false, prominence: "entry-point" },
    { relativePath: "Notes.doc.card", name: "Notes", type: "doc", hasAttachments: false, prominence: "ordinary" },
    { relativePath: "Scratch.doc.card", name: "Scratch", type: "doc", hasAttachments: false, prominence: "background" },
  ],
  files: [{ relativePath: "readme.txt", name: "readme.txt" }],
};

function renderList(data: BrowseData, options: { mode: "compact" | "raw"; dirPath?: string }): string {
  const { mode, dirPath } = options;
  return renderToStaticMarkup(React.createElement(BrowseSidebarList, {
    data,
    dirPath: dirPath ?? "",
    loading: false,
    onNavigate: () => {},
    selectedFilePath: null,
    onFileContextMenu: () => {},
    mode,
  }));
}

// ## Compact: the entry-point card and the primary-carrying directory lead, with its landmark identity; everything else folds behind "4 more"
void test("Compact: the entry-point card and the primary-carrying directory lead, with its landmark identity; everything else folds behind \"4 more\"", async (t) => {
  const compact = renderList(mixedData, { mode: "compact" });
  t.check(
    [
      compact.includes(">Plan<"),
      compact.includes("Cookbook"),
      compact.includes("🍳"),
      compact.includes("4 more"),
      // The disclosure is collapsed by default — folded rows aren't in the
      // initial markup at all, not merely hidden.
      compact.includes(">Notes<"),
    ].join(" "),
    "true true true true false",
  );
});

// ## Raw: every item renders flat, prominence ignored, no disclosure
void test("Raw: every item renders flat, prominence ignored, no disclosure", async (t) => {
  const raw = renderList(mixedData, { mode: "raw" });
  t.check(
    [
      raw.includes(">Plan<"),
      raw.includes(">Notes<"),
      raw.includes(">Scratch<"),
      raw.includes("Cookbook"),
      raw.includes("Logs"),
      raw.includes("readme.txt"),
      raw.includes("more"),
    ].join(" "),
    "true true true true true true false",
  );
});

// ## Nothing prominent: compact renders identically to raw, no disclosure
void test("Nothing prominent: compact renders identically to raw, no disclosure", async (t) => {
  const plainData: BrowseData = {
    path: "",
    background: false,
    dirs: [{ name: "Sub", fileCount: 0, summary: { hasEntryPoint: false, primaryCount: 0, background: false, cardCount: 0 }, seeded: false }],
    cards: [{ relativePath: "X.doc.card", name: "X", type: "doc", hasAttachments: false, prominence: "ordinary" }],
    files: [],
  };
  const plainCompact = renderList(plainData, { mode: "compact" });
  t.check(
    [
      plainCompact.includes(">X<"),
      plainCompact.includes("Sub"),
      plainCompact.includes("more"),
    ].join(" "),
    "true true false",
  );
});

// ## The content root ends with a quiet "Whole box" row; other folders do not
//
// `docs/implemented-plans/front-door.md`, Track D: Browse opens on `_content`, and the box
// root's areas are one row away at the bottom, in both modes. Seeded empty
// folders fold behind "N more" while the cards lead.
void test("The content root ends with a quiet Whole box row; other folders do not", async (t) => {
  const contentRoot: BrowseData = {
    path: "_content",
    background: false,
    dirs: [{ name: "recipes", fileCount: 0, summary: { hasEntryPoint: false, primaryCount: 0, background: false, cardCount: 0 }, seeded: true }],
    cards: [{ relativePath: "_content/X.doc.card", name: "X", type: "doc", hasAttachments: false, prominence: "ordinary" }],
    files: [],
  };
  const compact = renderList(contentRoot, { mode: "compact", dirPath: "_content" });
  const raw = renderList(contentRoot, { mode: "raw", dirPath: "_content" });
  const nested = renderList(contentRoot, { mode: "compact", dirPath: "_content/projects" });
  t.check(
    [
      compact.includes(">Whole box<"),
      compact.includes(">X<"),
      compact.includes("1 more"),
      compact.includes("recipes"),
      raw.includes(">Whole box<"),
      nested.includes("Whole box"),
    ].join(" "),
    "true true true false true false",
  );
});
