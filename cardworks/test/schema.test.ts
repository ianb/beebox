import { test } from "tap";
import { z } from "zod";
import { element, ElementNodeSchema } from "../src/schema/element.js";
import type { ElementNode } from "../src/parser/provenance.js";
import { emptyLocation } from "../src/parser/provenance.js";

function makeNode(partial: Partial<ElementNode> & { tagName: string }): ElementNode {
  return {
    attrs: {},
    comments: {},
    children: [],
    location: emptyLocation("test"),
    dirty: false,
    ...partial,
  };
}

test("element() creates a schema with correct tagName", (t) => {
  const audienceSchema = element("audience", {
    attrs: {
      version: z.string(),
    },
  });

  const validNode = makeNode({
    tagName: "audience",
    attrs: { version: "1.0.0" },
  });

  const result = audienceSchema.safeParse(validNode);
  t.ok(result.success, "should parse valid node");

  const invalidNode = makeNode({
    tagName: "wrong-tag",
    attrs: { version: "1.0.0" },
  });

  const invalidResult = audienceSchema.safeParse(invalidNode);
  t.notOk(invalidResult.success, "should reject wrong tagName");

  t.end();
});

test("element() validates required attributes", (t) => {
  const schema = element("card", {
    attrs: {
      version: z.string(),
      id: z.string(),
    },
  });

  const validNode = makeNode({
    tagName: "card",
    attrs: { version: "1.0.0", id: "test-id" },
  });

  t.ok(schema.safeParse(validNode).success, "accepts node with all attrs");

  const missingAttr = makeNode({
    tagName: "card",
    attrs: { version: "1.0.0" },
  });

  t.notOk(schema.safeParse(missingAttr).success, "rejects node missing required attr");

  t.end();
});

test("element() handles optional attributes", (t) => {
  const schema = element("card", {
    attrs: {
      version: z.string(),
      optional: z.string().optional(),
    },
  });

  const withOptional = makeNode({
    tagName: "card",
    attrs: { version: "1.0.0", optional: "value" },
  });

  t.ok(schema.safeParse(withOptional).success, "accepts node with optional attr");

  const withoutOptional = makeNode({
    tagName: "card",
    attrs: { version: "1.0.0" },
  });

  t.ok(schema.safeParse(withoutOptional).success, "accepts node without optional attr");

  t.end();
});

test("element() validates text content", (t) => {
  const schema = element("description", {
    text: z.string().min(1),
  });

  const validNode = makeNode({
    tagName: "description",
    text: "Some description text",
  });

  t.ok(schema.safeParse(validNode).success, "accepts node with text");

  const emptyText = makeNode({
    tagName: "description",
    text: "",
  });

  t.notOk(schema.safeParse(emptyText).success, "rejects node with empty text");

  t.end();
});

test("element() validates children", (t) => {
  const childSchema = element("item", {
    text: z.string(),
  });

  const parentSchema = element("list", {
    children: z.array(childSchema),
  });

  const validNode = makeNode({
    tagName: "list",
    children: [
      makeNode({ tagName: "item", text: "one" }),
      makeNode({ tagName: "item", text: "two" }),
    ],
  });

  t.ok(parentSchema.safeParse(validNode).success, "accepts node with valid children");

  const invalidChild = makeNode({
    tagName: "list",
    children: [
      makeNode({ tagName: "wrong", text: "one" }),
    ],
  });

  t.notOk(parentSchema.safeParse(invalidChild).success, "rejects node with invalid children");

  t.end();
});

test("element() returns type-inferred schema", (t) => {
  const schema = element("card", {
    attrs: {
      version: z.string(),
    },
    text: z.string().optional(),
  });

  // Type should infer properly
  type CardType = z.infer<typeof schema>;

  const node: CardType = {
    tagName: "card",
    attrs: { version: "1.0.0" },
    comments: {},
    children: [],
    location: emptyLocation("test"),
    dirty: false,
  };

  t.ok(schema.safeParse(node).success);
  t.equal(node.attrs.version, "1.0.0");

  t.end();
});

test("ElementNodeSchema validates basic element structure", (t) => {
  const validNode = makeNode({
    tagName: "anything",
  });

  t.ok(ElementNodeSchema.safeParse(validNode).success, "accepts valid element");

  const invalid = {
    tagName: 123, // Should be string
    attrs: {},
    comments: {},
    children: [],
  };

  t.notOk(ElementNodeSchema.safeParse(invalid).success, "rejects invalid element");

  t.end();
});

test("element() with mixed content", (t) => {
  const schema = element("paragraph", {
    mixed: true,
    children: z.array(element("link", {})).optional(),
  });

  const validNode = makeNode({
    tagName: "paragraph",
    textSegments: [
      { text: "Some ", position: 0 },
      { text: " text", position: 2 },
    ],
    children: [
      makeNode({ tagName: "link" }),
    ],
  });

  t.ok(schema.safeParse(validNode).success, "accepts mixed content");

  t.end();
});

test("element() handles empty attrs and children", (t) => {
  const schema = element("empty", {});

  const node = makeNode({
    tagName: "empty",
  });

  t.ok(schema.safeParse(node).success, "accepts element with defaults");

  t.end();
});
