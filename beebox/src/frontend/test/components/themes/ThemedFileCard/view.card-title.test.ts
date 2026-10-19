// # The card header
//
// The header shows the card's title (`cardTitle`, `test/lib/card-title.doctest.md`)
// and, under it, the type's summary line.
//
// ## The card type's summary line sits under the title

import { test } from "tap";
import "@ianbicking/tap-check/tap";

// The card page shows the line the card's type writes about itself
// (`card.get` `detail`) under the title, inside the header; without one, the
// header holds the title alone.
void test("The card page shows the line the card's type writes about itself (card.get de...", async (t) => {
  // doctest:L13
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { resolveCardTheme } = await import("@shared/card-theme/core");
  const { CardThemeSurface } = await import("../../../../src/components/themes/ThemedFileCard/CardThemeSurface.js");

  // doctest:L18
  globalThis.React = React;
  const theme = resolveCardTheme({ path: "_content/Solder.record.card", type: "record", cardChoice: undefined, typeDefault: undefined, presentation: { status: "absent" } });
  const header = (detail: string | undefined) => {
    const html = renderToStaticMarkup(React.createElement(CardThemeSurface, {
      theme, title: "Solder", detail, symbol: null, boxSlug: "test1", mode: "companion", properties: null,
      children: React.createElement("p", null, "Front"),
    }));
    return /<header[^>]*>(.*?)<\/header>/s.exec(html)?.[1]?.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");
  };
  t.check([header("Tray 3 · 2 spools"), header(undefined)], [
    "|Solder|Tray 3 · 2 spools|",
    "|Solder|",
  ]);
});
