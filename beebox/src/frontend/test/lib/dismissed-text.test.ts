// A line hidden "until it changes": hidden while the current text, trimmed,
// equals the stored text; storage that throws reads as not hidden.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { isDismissed, readDismissedText, writeDismissedText, type TextStorage } from "../../src/lib/dismissed-text.js";

void test("hidden only while the stored text equals the current trimmed text", async (t) => {
  t.check([
    isDismissed({ stored: null, text: "Finish the post" }),
    isDismissed({ stored: "Finish the post", text: "  Finish the post \n" }),
    isDismissed({ stored: "Finish the post", text: "Finish the post and the ending" }),
    // Blank text is never hidden, even against a blank stored value.
    isDismissed({ stored: "", text: "  " }),
  ], [false, true, false, false]);
});

void test("a write stores the trimmed text under the key", async (t) => {
  const items = new Map<string, string>();
  const storage: TextStorage = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } };
  const entry = { storage: () => storage, key: "bbx:intention-dismissed:test1:_content/w/W.landmark.card" };
  writeDismissedText(entry, " Finish the post ");
  t.check({ stored: readDismissedText(entry), items: Object.fromEntries(items) }, {
    stored: "Finish the post",
    items: { "bbx:intention-dismissed:test1:_content/w/W.landmark.card": "Finish the post" },
  });
});

void test("storage that is absent or throws reads as nothing stored", async (t) => {
  const throwing: TextStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  writeDismissedText({ storage: () => throwing, key: "k" }, "text");
  t.check([
    readDismissedText({ storage: () => throwing, key: "k" }),
    readDismissedText({ storage: () => { throw new Error("SecurityError"); }, key: "k" }),
    readDismissedText({ storage: () => null, key: "k" }),
  ], [null, null, null]);
});
