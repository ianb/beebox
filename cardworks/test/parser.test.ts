import { test } from "tap";
import { parseXml } from "../src/parser/parse.js";

test("parseXml parses a simple card", async (t) => {
  const xml = `<audience version="1.0.0">
  <selection-text>Test audience</selection-text>
  <short-description>A simple test card</short-description>
</audience>`;

  const result = await parseXml(xml, "test.card");

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
  const xml = `<root>
  <child>content</child>
</root>`;

  const result = await parseXml(xml, "test.card");

  t.ok(result.location);
  t.equal(result.location.source, "test.card");
  t.equal(result.location.startLine, 1);

  const child = result.children[0];
  t.ok(child?.location);
  t.equal(child?.location.startLine, 2);
});

test("parseXml applies dedent to text content", async (t) => {
  const xml = `<root>
  <content>
    Line one
    Line two
  </content>
</root>`;

  const result = await parseXml(xml, "test.card");
  const content = result.children[0];

  // Text should be dedented
  t.equal(content?.text, "Line one\nLine two");
});

test("parseXml preserves comments", async (t) => {
  const xml = `<root>
  <!-- Before comment -->
  <child>content</child>
  <!-- After comment -->
</root>`;

  const result = await parseXml(xml, "test.card");
  const child = result.children[0];

  t.equal(child?.comments.start?.trim(), "Before comment");
  t.equal(child?.comments.end?.trim(), "After comment");
});

test("parseXml handles attributes", async (t) => {
  const xml = `<element attr1="value1" attr2="value2">text</element>`;

  const result = await parseXml(xml, "test.card");

  t.equal(result.attrs["attr1"], "value1");
  t.equal(result.attrs["attr2"], "value2");
});

test("parseXml handles nested children", async (t) => {
  const xml = `<root>
  <parent>
    <child1>one</child1>
    <child2>two</child2>
  </parent>
</root>`;

  const result = await parseXml(xml, "test.card");

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
    await parseXml(xml, "malformed.card");
  });
});

test("parseXml handles empty elements", async (t) => {
  const xml = `<root><empty/></root>`;

  const result = await parseXml(xml, "test.card");

  t.equal(result.children.length, 1);
  t.equal(result.children[0]?.tagName, "empty");
  t.equal(result.children[0]?.text, undefined);
  t.equal(result.children[0]?.children.length, 0);
});

test("parseXml handles mixed content (text and children)", async (t) => {
  const xml = `<root>Some text <child>nested</child> more text</root>`;

  const result = await parseXml(xml, "test.card");

  // Should have both text segments and child
  t.ok(result.textSegments);
  t.equal(result.children.length, 1);
  t.equal(result.children[0]?.tagName, "child");
});

test("parseXml sets dirty flag to false initially", async (t) => {
  const xml = `<root><child>content</child></root>`;

  const result = await parseXml(xml, "test.card");

  t.equal(result.dirty, false);
  t.equal(result.children[0]?.dirty, false);
});
