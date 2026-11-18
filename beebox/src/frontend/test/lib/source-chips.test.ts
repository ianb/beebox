// # A card's source chips
//
// `sourceChips` turns a card's `sources:` list into the chips its header
// shows, one per entry, in order (plan:card-source-chips). A file or card ref
// opens in the app; an http(s) `href` opens a new tab; an entry with nothing
// to open shows as text.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { cardShowsSourcesSection, sourceChips, sourcesHaveDetails } from "../../src/lib/source-chips.js";

const card = "_content/house/Deed.record.card";

// A file ref reads as its file name and opens the file. The note is the
// tooltip. A card ref is marked as a card and reads as the card's name.
void test("A file ref reads as its file name; a card ref as the card's name", async (t) => {
  t.check(sourceChips([
    { ref: "/_content/shop/deed-scan.pdf", note: "County copy" },
    { ref: "/_content/house/Water_Bill.record.card" },
  ], card), [
    {kind: "file", text: "deed-scan.pdf", title: "County copy", target: { path: "_content/shop/deed-scan.pdf", viewer: null, params: {}, viewState: null }, href: null, pos: null, note: "County copy" },
    { kind: "card", text: "Water Bill", title: "/_content/house/Water_Bill.record.card", target: { path: "_content/house/Water_Bill.record.card", viewer: null, params: {}, viewState: null }, href: null, pos: null, note: null },
  ]);
});

// The `?query` and `#fragment` stay in the target, so the chip opens the
// place inside the source; they are not part of the name or the kind test.
void test("A ref's query and fragment stay in the target, not the label", async (t) => {
  t.check(sourceChips([{ ref: "Report.pdf.card?view=Original#p4" }], card), [
    { kind: "card", text: "Report", title: "Report.pdf.card?view=Original#p4", target: { path: "_content/house/Report.pdf.card", viewer: "Original", params: {}, viewState: null, fragment: "p4" }, href: null, pos: null, note: null },
  ]);
});

// `attach/` resolves into the card's own attach scope (`Deed.attach/`, by
// `attachDirFor`), as everywhere else.
void test("An attach/ ref resolves into the card's attach scope", async (t) => {
  t.check(sourceChips([{ ref: "attach/survey.jpg", pos: "page 2" }], card), [
    { kind: "file", text: "survey.jpg", title: "attach/survey.jpg", target: { path: "_content/house/Deed.attach/survey.jpg", viewer: null, params: {}, viewState: null }, href: null, pos: "page 2", note: null },
  ]);
});

// A label wins over the derived name.
void test("A label wins over the file name and the host", async (t) => {
  t.check(sourceChips([
    { ref: "/_content/shop/IMG_2041.jpg", label: "Back of the deed" },
    { href: "https://example.org/recorder", label: "County recorder" },
  ], card).map((chip) => chip.text), ["Back of the deed", "County recorder"]);
});

// A web source reads as its host. An `href` that is not an http(s) URL
// cannot be linked: it shows as text, and the entries around it still work.
void test("A bad href becomes text and leaves its neighbours alone", async (t) => {
  t.check(sourceChips([
    { href: "https://www.example.org/a/b?c=1" },
    { href: "not a url" },
    { href: "javascript:alert(1)" },
    { ref: "/_content/shop/deed-scan.pdf" },
  ], card), [
    { kind: "web", text: "www.example.org", title: "https://www.example.org/a/b?c=1", target: null, href: "https://www.example.org/a/b?c=1", pos: null, note: null },
    { kind: "text", text: "not a url", title: "not a url", target: null, href: null, pos: null, note: null },
    { kind: "text", text: "javascript:alert(1)", title: "javascript:alert(1)", target: null, href: null, pos: null, note: null },
    { kind: "file", text: "deed-scan.pdf", title: "/_content/shop/deed-scan.pdf", target: { path: "_content/shop/deed-scan.pdf", viewer: null, params: {}, viewState: null }, href: null, pos: null, note: null },
  ]);
});

// A ref that leaves the box has nothing to open.
void test("A ref that escapes the box shows as text", async (t) => {
  t.check(sourceChips([{ ref: "../../../../etc/passwd" }], card), [
    { kind: "text", text: "passwd", title: "../../../../etc/passwd (outside the box)", target: null, href: null, pos: null, note: null },
  ]);
});

// Two entries for the same file at different places are two chips.
void test("Entries are not merged", async (t) => {
  t.check(sourceChips([{ ref: "/_content/a.pdf", pos: "p. 1" }, { ref: "/_content/a.pdf", pos: "p. 9" }], card).map((chip) => chip.pos), ["p. 1", "p. 9"]);
});

// A recipe-style entry with only a label shows as text; a malformed value
// or an entry with nothing to show makes no chip.
void test("Malformed sources make no chips", async (t) => {
  t.check(sourceChips("not a list", card), []);
  t.check(sourceChips([null, 3, {}, { note: "only a note" }, { ref: "" }, { label: "Grandma" }], card), [
    { kind: "text", text: "Grandma", title: "Grandma", target: null, href: null, pos: null, note: null },
  ]);
});

// The toggle appears only when the full list can show more than the line:
// a second chip (a narrow card may not fit it), a note or pos, or a name
// long enough to truncate.
void test("The toggle appears only when the full list can show more", async (t) => {
  const short = { kind: "file" as const, text: "a.pdf", title: "a.pdf", target: null, href: null, pos: null, note: null };
  t.check(sourcesHaveDetails([short]), false);
  t.check(sourcesHaveDetails([short, short]), true);
  t.check(sourcesHaveDetails([{ ...short, note: "why" }]), true);
  t.check(sourcesHaveDetails([{ ...short, text: "a-very-long-scanned-file-name.pdf" }]), true);
});

// A webpage and a recipe draw their own sources at the top of their view.
void test("Webpage and recipe cards draw their own sources", async (t) => {
  t.check([undefined, "record", "doc", "pdf", "webpage", "recipe"].map(cardShowsSourcesSection), [true, true, true, true, false, false]);
});
