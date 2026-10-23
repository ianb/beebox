// # XML attribute escaping for app tags
//
// `escapeXmlAttr` writes a value into a double-quoted attribute of an app tag
// (`<self-note ref="...">`, `<external-capture source-ref="...">`) and
// `decodeXmlAttr` reads it back. See `src/shared/self-note.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { decodeXmlAttr, escapeXmlAttr } from "../../src/shared/self-note.js";

void test("Escapes & \" < > (not ') and decodes back to the original", async (t) => {
  const raw = "notes/a&b \"q\" <x> it's";
  t.check(escapeXmlAttr(raw), "notes/a&amp;b &quot;q&quot; &lt;x&gt; it's");
  t.check(decodeXmlAttr(escapeXmlAttr(raw)), raw);
});
