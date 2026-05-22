import { test } from "tap";
import { parseXml, parseCard } from "../src/parser/parse.js";
import { splitCardContent } from "../src/parser/frontmatter.js";

test("parseXml parses a simple card", async (t) => {
  const xml = `<audience version="1.0.0">
  <selection-text>Test audience</selection-text>
  <short-description>A simple test card</short-description>
</audience>`;

  const result = await parseXml(xml, { source: "test.card" });

  t.equal(result.tagName, "audience");
  t.equal(result.attrs["version"], "1.0.0");
  t.equal(result.children.length, 2);

  const selectionText = result.children[0];
  t.equal(selectionText?.tagName, "selection-text");
  t.equal(selectionText?.text, "Test audience");

  const shortDesc = result.children[1];
  t.equal(shortDesc?.tagName, "short-description");
  t.equal(shortDesc?.text, "A simple test card");
});

test("parseXml tracks location (line numbers)", async (t) => {
  const xml = `<root version="1.0.0">
  <child>content</child>
</root>`;

  const result = await parseXml(xml, { source: "test.card" });

  t.ok(result.location);
  t.equal(result.location.source, "test.card");
  t.equal(result.location.startLine, 1);

  const child = result.children[0];
  t.ok(child?.location);
  t.equal(child?.location.startLine, 2);
});

test("parseXml shifts line numbers by lineOffset", async (t) => {
  const xml = `<root version="1.0.0">
  <child>content</child>
</root>`;

  const result = await parseXml(xml, { source: "test.card", lineOffset: 3 });

  t.equal(result.location.startLine, 4);
  t.equal(result.children[0]?.location.startLine, 5);
});

test("parseXml reports parse errors at offset-adjusted lines", async (t) => {
  const xml = "<root>\n  <unclosed>\n";

  try {
    await parseXml(xml, { source: "broken.card", lineOffset: 2 });
    t.fail("expected ParseError");
  } catch (e) {
    const err = e as Error & { location?: { startLine: number } };
    t.match(err.message, /broken\.card:/);
    t.ok((err.location?.startLine ?? 0) >= 3, "line should be shifted by offset");
  }
});

test("parseXml applies dedent to text content", async (t) => {
  const xml = `<root version="1.0.0">
  <content>
    Line one
    Line two
  </content>
</root>`;

  const result = await parseXml(xml, { source: "test.card" });
  const content = result.children[0];

  // Text should be dedented
  t.equal(content?.text, "Line one\nLine two");
});

test("parseXml preserves comments", async (t) => {
  const xml = `<root version="1.0.0">
  <!-- Before comment -->
  <child>content</child>
  <!-- After comment -->
</root>`;

  const result = await parseXml(xml, { source: "test.card" });
  const child = result.children[0];

  t.equal(child?.comments.start, "Before comment");
  t.equal(child?.comments.end, "After comment");
});

test("parseXml handles attributes", async (t) => {
  const xml = `<element version="1.0.0" attr1="value1" attr2="value2">text</element>`;

  const result = await parseXml(xml, { source: "test.card" });

  t.equal(result.attrs["attr1"], "value1");
  t.equal(result.attrs["attr2"], "value2");
});

test("parseXml handles nested children", async (t) => {
  const xml = `<root version="1.0.0">
  <parent>
    <child1>one</child1>
    <child2>two</child2>
  </parent>
</root>`;

  const result = await parseXml(xml, { source: "test.card" });

  t.equal(result.children.length, 1);
  const parent = result.children[0];
  t.equal(parent?.tagName, "parent");
  t.equal(parent?.children.length, 2);
  t.equal(parent?.children[0]?.tagName, "child1");
  t.equal(parent?.children[1]?.tagName, "child2");
});

test("parseXml throws on malformed XML", async (t) => {
  const xml = `<broken version="1.0.0">
  <unclosed>
</broken>`;

  await t.rejects(async () => {
    await parseXml(xml, { source: "malformed.card" });
  });
});

test("parseXml allows missing version", async (t) => {
  const xml = `<card><title>No version</title></card>`;

  const node = await parseXml(xml, { source: "test.card" });
  t.equal(node.tagName, "card");
  t.equal(node.attrs["version"], undefined);
});

test("parseXml throws on invalid version format", async (t) => {
  const xml = `<card version="1.0"><title>Bad version</title></card>`;

  await t.rejects(
    async () => {
      await parseXml(xml, { source: "test.card" });
    },
    { message: /Invalid version.*must be in X\.Y\.Z format/ }
  );
});

test("parseXml handles empty elements", async (t) => {
  const xml = `<root version="1.0.0"><empty/></root>`;

  const result = await parseXml(xml, { source: "test.card" });

  t.equal(result.children.length, 1);
  t.equal(result.children[0]?.tagName, "empty");
  t.equal(result.children[0]?.text, undefined);
  t.equal(result.children[0]?.children.length, 0);
});

test("parseXml handles mixed content (text and children)", async (t) => {
  const xml = `<root version="1.0.0">Some text <child>nested</child> more text</root>`;

  const result = await parseXml(xml, { source: "test.card" });

  // Should have mixed content array and children
  t.ok(result.mixed);
  t.equal(result.mixed?.length, 3);
  t.equal(result.mixed?.[0], "Some text ");
  t.equal(typeof result.mixed?.[1], "object"); // The child element
  t.equal(result.mixed?.[2], " more text");
  t.equal(result.children.length, 1);
  t.equal(result.children[0]?.tagName, "child");
});

test("parseXml handles mixed content with comments", async (t) => {
  const xml = `<root version="1.0.0">Some text <!-- inline comment --> more text</root>`;

  const result = await parseXml(xml, { source: "test.card" });

  // Should have mixed content array with comment
  t.ok(result.mixed);
  t.equal(result.mixed?.length, 3);
  t.equal(result.mixed?.[0], "Some text ");
  t.same(result.mixed?.[1], { comment: "inline comment" });
  t.equal(result.mixed?.[2], " more text");
});

test("parseXml sets dirty flag to false initially", async (t) => {
  const xml = `<root version="1.0.0"><child>content</child></root>`;

  const result = await parseXml(xml, { source: "test.card" });

  t.equal(result.dirty, false);
  t.equal(result.children[0]?.dirty, false);
});

test("splitCardContent returns input unchanged when no frontmatter", (t) => {
  const r = splitCardContent("<root/>");
  t.equal(r.hasFrontmatter, false);
  t.equal(r.body, "<root/>");
  t.equal(r.lineOffset, 0);
  t.end();
});

test("splitCardContent peels off a frontmatter block", (t) => {
  const r = splitCardContent("---\ncontent-type: application/x-card+xml\n---\n<root/>\n");
  t.equal(r.hasFrontmatter, true);
  t.equal(r.frontmatterText, "content-type: application/x-card+xml");
  t.equal(r.body, "<root/>\n");
  t.equal(r.lineOffset, 3);
  t.end();
});

test("parseCard handles a card with frontmatter and reports original-file lines", async (t) => {
  const text = "---\ncontent-type: application/x-card+xml\n---\n<root version=\"1.0.0\">\n  <child>hi</child>\n</root>\n";
  const result = await parseCard(text, { source: "frontmattered.card" });
  t.equal(result.tagName, "root");
  // Root <root> appears on line 4 of the original file
  t.equal(result.location.startLine, 4);
  // <child> is on line 5
  t.equal(result.children[0]?.location.startLine, 5);
});

test("parseCard is a no-op when there is no frontmatter", async (t) => {
  const text = "<root version=\"1.0.0\"><child>hi</child></root>";
  const result = await parseCard(text, { source: "plain.card" });
  t.equal(result.tagName, "root");
  t.equal(result.location.startLine, 1);
});
