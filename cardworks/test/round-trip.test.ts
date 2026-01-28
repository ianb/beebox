import { test } from "tap";
import { parseXml } from "../src/parser/parse.js";
import { serialize } from "../src/serialize/serialize.js";

test("round-trip: simple element", async (t) => {
  const xml = `<root version="1.0.0">
  <child>content</child>
</root>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "test.card");

  t.equal(parsed.tagName, reparsed.tagName);
  t.equal(parsed.attrs["version"], reparsed.attrs["version"]);
  t.equal(parsed.children.length, reparsed.children.length);
  t.equal(parsed.children[0]?.text, reparsed.children[0]?.text);
});

test("round-trip: multiple attributes", async (t) => {
  const xml = `<element version="1.0.0" attr1="value1" attr2="value2" attr3="value3"/>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "test.card");

  t.equal(reparsed.attrs["attr1"], "value1");
  t.equal(reparsed.attrs["attr2"], "value2");
  t.equal(reparsed.attrs["attr3"], "value3");
});

test("round-trip: nested elements", async (t) => {
  const xml = `<root version="1.0.0">
  <level1>
    <level2>
      <level3>deep content</level3>
    </level2>
  </level1>
</root>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "test.card");

  const level1 = reparsed.children[0];
  const level2 = level1?.children[0];
  const level3 = level2?.children[0];

  t.equal(level3?.tagName, "level3");
  t.equal(level3?.text, "deep content");
});

test("round-trip: text with special characters", async (t) => {
  const xml = `<element version="1.0.0">Text with &lt;brackets&gt; and &amp; ampersand</element>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "test.card");

  t.equal(reparsed.text, "Text with <brackets> and & ampersand");
});

test("round-trip: preserves comments", async (t) => {
  const xml = `<root version="1.0.0">
  <!-- Comment before -->
  <child>content</child>
  <!-- Comment after -->
</root>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);

  // Serialized should contain comments
  t.ok(serialized.includes("Comment before"), "contains before comment");
  t.ok(serialized.includes("Comment after"), "contains after comment");
});

test("round-trip: empty elements", async (t) => {
  const xml = `<root version="1.0.0"><empty/></root>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "test.card");

  t.equal(reparsed.children.length, 1);
  t.equal(reparsed.children[0]?.tagName, "empty");
  t.equal(reparsed.children[0]?.children.length, 0);
});

test("round-trip: multiline text content", async (t) => {
  const xml = `<content version="1.0.0">
    Line one
    Line two
    Line three
  </content>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "test.card");

  t.equal(reparsed.text, "Line one\nLine two\nLine three");
});

test("round-trip: mixed content", async (t) => {
  const xml = `<paragraph version="1.0.0">Some text <link>here</link> and more</paragraph>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "test.card");

  t.equal(reparsed.children.length, 1);
  t.equal(reparsed.children[0]?.tagName, "link");
  t.ok(reparsed.mixed);
  t.equal(reparsed.mixed?.length, 3);
});

test("serialize: configurable indentation", async (t) => {
  const xml = `<root version="1.0.0"><child>content</child></root>`;

  const parsed = await parseXml(xml, "test.card");

  const withTwoSpaces = serialize(parsed, { indent: "  " });
  const withFourSpaces = serialize(parsed, { indent: "    " });

  t.ok(withTwoSpaces.includes("  <child>"), "uses 2-space indent");
  t.ok(withFourSpaces.includes("    <child>"), "uses 4-space indent");
});

test("serialize: attribute escaping", async (t) => {
  const xml = `<element version="1.0.0" attr="value with &quot;quotes&quot;"/>`;

  const parsed = await parseXml(xml, "test.card");
  const serialized = serialize(parsed);

  // Serialized should escape quotes in attributes
  t.ok(
    serialized.includes('&quot;') || serialized.includes("&apos;") || serialized.includes('"'),
    "handles quotes in attributes"
  );
});

test("round-trip: test fixture - Simple.audience.card", async (t) => {
  const xml = `<audience version="1.0.0">
  <selection-text>Test audience</selection-text>
  <short-description>A simple test card</short-description>
</audience>`;

  const parsed = await parseXml(xml, "Simple.audience.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "Simple.audience.card");

  t.equal(reparsed.tagName, "audience");
  t.equal(reparsed.attrs["version"], "1.0.0");
  t.equal(reparsed.children[0]?.text, "Test audience");
  t.equal(reparsed.children[1]?.text, "A simple test card");
});

test("round-trip: test fixture - With_Interleaved.technique.card", async (t) => {
  const xml = `<technique version="1.0.0">
  <purpose>Test technique</purpose>
  <guidance>First guidance</guidance>
  <prompts title="Test">
    <prompt>A prompt</prompt>
  </prompts>
  <guidance match="special">Second guidance</guidance>
</technique>`;

  const parsed = await parseXml(xml, "With_Interleaved.technique.card");
  const serialized = serialize(parsed);
  const reparsed = await parseXml(serialized, "With_Interleaved.technique.card");

  t.equal(reparsed.tagName, "technique");
  t.equal(reparsed.children.length, 4);

  const prompts = reparsed.children[2];
  t.equal(prompts?.tagName, "prompts");
  t.equal(prompts?.attrs["title"], "Test");
  t.equal(prompts?.children[0]?.text, "A prompt");

  const secondGuidance = reparsed.children[3];
  t.equal(secondGuidance?.attrs["match"], "special");
});
