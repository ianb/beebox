/**
 * Tests for schema definitions.
 */

import { test } from "tap";
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

  t.ok(template.includes("<memo status=\"new\">"));
  t.ok(template.includes("<content>Test content</content>"));
  t.ok(template.includes("<source>test-source</source>"));
  t.ok(template.includes("<created>"));
  t.ok(template.includes("</memo>"));
});

test("createMemoTemplate escapes special characters", async (t) => {
  const template = createMemoTemplate("Test <content> & more");
  t.ok(template.includes("&lt;content&gt;"));
  t.ok(template.includes("&amp;"));
});

test("createMemoTemplate works without source", async (t) => {
  const template = createMemoTemplate("Just content");
  t.ok(!template.includes("<source>"));
  t.ok(template.includes("<content>Just content</content>"));
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

  t.ok(template.includes("<question status=\"pending\">"));
  t.ok(template.includes("<memo>Context here</memo>"));
  t.ok(template.includes("<prompt>What do you want?</prompt>"));
  t.ok(template.includes('<option id="a">Choice A</option>'));
  t.ok(template.includes('<option id="b">Choice B</option>'));
  t.ok(template.includes('<input type="select">'));
  t.ok(template.includes("</question>"));
});

test("createSelectQuestionTemplate escapes special characters", async (t) => {
  const template = createSelectQuestionTemplate({
    memo: "Context with <special> & chars",
    prompt: "What's \"this\"?",
    options: [{ id: "a", label: "Option <A>" }],
  });

  t.ok(template.includes("&lt;special&gt;"));
  t.ok(template.includes("&amp;"));
  // Quotes in text content don't need escaping (only in attributes)
  t.ok(template.includes("\"this\""));
});
