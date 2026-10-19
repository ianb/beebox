// # external-url-fetch: extraction + checkability
//
// The pure half of `bbx validate --urls`: pull http(s) URLs out of card/markdown
// text, and decide which are worth a network check. Network (`checkUrl`) is not
// exercised here.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { extractExternalUrls, isCheckableUrl } from "../../../../src/core/external/url-check/fetch.js";

// `extractExternalUrls` pulls every distinct URL out of a blob, whether it's a
// markdown link target, an autolink, or bare prose. It strips the fragment and
// trailing sentence punctuation, and dedupes — so the same URL written three ways
// collapses to one:
void test("extractExternalUrls pulls every distinct URL out of a blob, whether it's a ma...", async (t) => {
  const text = [
    "See [the docs](https://example.org/guide#install) for setup.",
    "Bare: https://example.org/guide, and again https://example.org/guide#top.",
    "Autolink <https://other.test/x>.",
    "Internal [card](/store/a.card) and [rel](../b.md) are ignored.",
  ].join("\n");

  t.check([...extractExternalUrls(text)].toSorted(), [
    "https://example.org/guide",
    "https://other.test/x",
  ]);
});

// `isCheckableUrl` keeps only real external http(s) targets — non-http schemes and
// RFC-2606 reserved doc domains (`example.com/.org/.net`, `.test`, `.invalid`,
// `localhost`) are skipped so a placeholder link never triggers a network hit:
void test("isCheckableUrl keeps only real external http(s) targets — non-http schemes an...", async (t) => {
  await t.checkText(
    JSON.stringify(
      [
        "https://en.wikipedia.org/wiki/Foo",
        "http://my-real-site.com/page",
        "https://example.com/placeholder",
        "https://docs.example.org/x",
        "https://foo.test/x",
        "ftp://files.example/x",
        "https://api.localhost/x",
      ].map((u) => `${u} -> ${String(isCheckableUrl(u))}`),
      null,
      2,
    ),
    `[
  "https://en.wikipedia.org/wiki/Foo -> true",
  "http://my-real-site.com/page -> true",
  "https://example.com/placeholder -> false",
  "https://docs.example.org/x -> false",
  "https://foo.test/x -> false",
  "ftp://files.example/x -> false",
  "https://api.localhost/x -> false"
]`,
  );
});

// </content>
