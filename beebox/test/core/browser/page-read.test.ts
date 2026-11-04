// # Reading a page from the box browser's output
//
// docs/plans/webpage-capture-tools.md, Track C. `eval` prints a JSON string
// holding JSON. Cut-off output must never become a saved page.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { parsePageRead } from "../../../src/core/browser/page-read.js";

const whole = JSON.stringify(JSON.stringify({ url: "https://a.example/", html: "<html></html>" }));

void test("Whole output is the page; anything else is nothing", (t) => {
  t.check(parsePageRead(`${whole}\n`), { url: "https://a.example/", html: "<html></html>" });
  t.check(parsePageRead(`${whole.slice(0, 20)}\n[truncated: showing 60000 of 1173758 chars. Use --max-output to adjust]\n`), null);
  t.check(parsePageRead(`${whole}\n[bbx browser: stdout truncated at 20 MB]\n`), null);
  t.check(parsePageRead('"not json inside"'), null);
  t.check(parsePageRead(JSON.stringify(JSON.stringify({ url: "https://a.example/" }))), null);
  t.end();
});
