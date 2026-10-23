// decodeXmlAttr: an attribute value written by the chat tag encoders reads back
// as the original text. `&amp;` decodes last, so an escaped entity such as
// `&amp;lt;` stays the literal text `&lt;` instead of decoding twice.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { decodeXmlAttr } from "../../src/shared/self-note.js";

void test("decodes the predefined entities once", async (t) => {
  t.check(decodeXmlAttr("&quot;a&quot; &lt;b&gt; c &amp; d"), "\"a\" <b> c & d");
  t.check(decodeXmlAttr("&amp;lt;"), "&lt;");
});
