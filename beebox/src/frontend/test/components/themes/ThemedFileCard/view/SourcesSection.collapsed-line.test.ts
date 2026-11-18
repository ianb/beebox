// # The Sources line, collapsed
//
// `SourcesSection` draws a card's sources as one line of chips under the
// title (plan:card-source-chips). A file or card chip is a button that opens
// it in the app; a web chip is a link to a new tab; a label-only entry is
// text. With more than one source the toggle names the total, since a narrow
// card may fit only some chips on the line.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourcesSection } from "../../../../../src/components/themes/ThemedFileCard/view/SourcesSection.js";
import { sourceChips } from "../../../../../src/lib/source-chips.js";

globalThis.React = React;

function render(sources: unknown): string {
  const chips = sourceChips(sources, "_content/house/Deed.record.card");
  return renderToStaticMarkup(React.createElement(SourcesSection, { chips, onNavigate: () => {} }));
}

/** Each control or chip as "<tag>:<text>", in order. */
function controls(html: string): string[] {
  return [...html.matchAll(/<(button|a|span) [^>]*class="(?:group )?(?:cursor-pointer )?inline-flex[^"]*"[^>]*>(.*?)<\/\1>|<(button)[^>]*aria-expanded[^>]*>(.*?)<\/button>/gs)]
    .map((m) => `${m[1] ?? m[3] ?? ""}:${(m[2] ?? m[4] ?? "").replace(/<[^>]+>/g, "").replace(/[→↗]/g, "").trim()}`);
}

void test("Each source is a chip of its kind, and the toggle names the total", async (t) => {
  t.check(controls(render([
    { ref: "/_content/shop/deed-scan.pdf", note: "County copy" },
    { ref: "/_content/house/Water_Bill.record.card" },
    { href: "https://example.org/recorder", label: "County recorder" },
    { label: "Grandma" },
  ])), ["button:deed-scan.pdf", "button:Water Bill", "a:County recorder", "span:Grandma", "button:All 4"]);
});

// One short source with nothing more to say has no toggle.
void test("A lone short source has no toggle", async (t) => {
  t.check(controls(render([{ ref: "/_content/shop/deed.pdf" }])), ["button:deed.pdf"]);
});

// One source with a note offers "Details".
void test("A lone source with a note offers Details", async (t) => {
  t.check(controls(render([{ ref: "/_content/shop/deed.pdf", note: "County copy" }])), ["button:deed.pdf", "button:Details"]);
});

void test("No usable sources draw nothing", async (t) => {
  t.check(render([{ note: "only a note" }]), "");
});
