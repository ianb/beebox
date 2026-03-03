/**
 * Tests for schema definitions.
 */

import { test } from "tap";
import "../src/test-lib/tap-check.js";
import {
  MemoSchema,
  QuestionSchema,
  createMemoTemplate,
  createSelectQuestionTemplate,
  createSchemaRegistry,
  getCardTypes,
} from "../src/schemas/index.js";

test("Schema registry contains expected types", async (t) => {
  const types = getCardTypes();
  t.ok(types.includes("memo"));
  t.ok(types.includes("question"));
});

test("createSchemaRegistry returns valid registry", async (t) => {
  const registry = await createSchemaRegistry();
  t.ok(registry.get("memo"));
  t.ok(registry.get("question"));
});

test("MemoSchema has correct tag name", async (t) => {
  t.equal(MemoSchema.tagName, "memo");
});

test("QuestionSchema has correct tag name", async (t) => {
  t.equal(QuestionSchema.tagName, "question");
});

test("createMemoTemplate generates valid XML structure", async (t) => {
  const template = createMemoTemplate("Test content", "test-source");

  t.check(template, `<memo status="new">
  <created>«date»</created>
  <content>Test content</content>
  <source>test-source</source>
</memo>
`);
});

test("createMemoTemplate escapes special characters", async (t) => {
  const template = createMemoTemplate("Test <content> & more");
  t.check(template, `<memo status="new">
  <created>«date»</created>
  <content>Test &lt;content&gt; &amp; more</content>
</memo>
`);
});

test("createMemoTemplate works without source", async (t) => {
  const template = createMemoTemplate("Just content");
  t.check(template, `<memo status="new">
  <created>«date»</created>
  <content>Just content</content>
</memo>
`);
});

test("createSelectQuestionTemplate generates valid XML structure", async (t) => {
  const template = createSelectQuestionTemplate({
    memo: "Context here",
    prompt: "What do you want?",
    options: [
      { id: "a", label: "Choice A" },
      { id: "b", label: "Choice B" },
    ],
  });

  t.check(template, `<question status="pending">
  <memo>Context here</memo>
  <prompt>What do you want?</prompt>
  <input type="select">
    <option id="a">Choice A</option>
    <option id="b">Choice B</option>
  </input>
</question>
`);
});

test("createSelectQuestionTemplate escapes special characters", async (t) => {
  const template = createSelectQuestionTemplate({
    memo: "Context with <special> & chars",
    prompt: "What's \"this\"?",
    options: [{ id: "a", label: "Option <A>" }],
  });

  t.check(template, `<question status="pending">
  <memo>Context with &lt;special&gt; &amp; chars</memo>
  <prompt>What's "this"?</prompt>
  <input type="select">
    <option id="a">Option &lt;A&gt;</option>
  </input>
</question>
`);
});
