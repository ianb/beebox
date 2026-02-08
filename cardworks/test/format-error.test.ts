import { test } from "tap";
import { z } from "zod";
import { element } from "../src/schema/element.js";
import { formatValidationError } from "../src/schema/format-error.js";
import { emptyLocation } from "../src/parser/provenance.js";
import type { ElementNode } from "../src/parser/provenance.js";
import { MemoryCardLoader, ValidationError } from "../src/loader/loader.js";

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

test("formatValidationError: unexpected child tag in union", (t) => {
  const ItemA = element("alpha", { text: z.string() });
  const ItemB = element("beta", { text: z.string() });
  const Parent = element("parent", {
    children: z.array(z.union([ItemA, ItemB])),
  });

  const node = makeNode({
    tagName: "parent",
    children: [makeNode({ tagName: "gamma", text: "hello" })],
  });

  const result = Parent.safeParse(node);
  t.notOk(result.success);
  if (!result.success) {
    const msg = formatValidationError(result.error, node);
    t.match(msg, /Unexpected element <gamma>/);
    t.match(msg, /expected one of: <alpha>, <beta>/);
    // Should NOT contain hundreds of lines of union branch dumps
    t.ok(msg.split("\n").length < 5, `Message should be concise, got: ${msg}`);
  }
  t.end();
});

test("formatValidationError: matching tag with attribute error", (t) => {
  const ItemA = element("alpha", {
    attrs: { required: z.string() },
    text: z.string(),
  });
  const ItemB = element("beta", { text: z.string() });
  const Parent = element("parent", {
    children: z.array(z.union([ItemA, ItemB])),
  });

  const node = makeNode({
    tagName: "parent",
    children: [makeNode({ tagName: "alpha", text: "hello" })],
    // alpha is missing required "required" attr
  });

  const result = Parent.safeParse(node);
  t.notOk(result.success);
  if (!result.success) {
    const msg = formatValidationError(result.error, node);
    // Should show the actual attribute error, not "unexpected tag"
    t.match(msg, /required/i);
    t.notMatch(msg, /Unexpected element/);
    t.ok(msg.split("\n").length < 5, `Message should be concise, got: ${msg}`);
  }
  t.end();
});

test("formatValidationError: simple non-union error", (t) => {
  const Schema = element("card", {
    attrs: { version: z.string() },
  });

  const node = makeNode({
    tagName: "card",
    // missing version attr
  });

  const result = Schema.safeParse(node);
  t.notOk(result.success);
  if (!result.success) {
    const msg = formatValidationError(result.error, node);
    t.match(msg, /version/i);
    t.ok(msg.split("\n").length < 5, `Message should be concise, got: ${msg}`);
  }
  t.end();
});

test("formatValidationError: wrong root tagName", (t) => {
  const Schema = element("card", {});

  const node = makeNode({ tagName: "wrong" });

  const result = Schema.safeParse(node);
  t.notOk(result.success);
  if (!result.success) {
    const msg = formatValidationError(result.error, node);
    t.match(msg, /tagName/);
  }
  t.end();
});

test("formatValidationError: integration with loader", async (t) => {
  const ItemA = element("alpha", { text: z.string() });
  const ItemB = element("beta", { text: z.string() });
  const CardSchema = element("card", {
    children: z.array(z.union([ItemA, ItemB])),
  });

  const loader = new MemoryCardLoader("/project", {
    files: {
      "/project/test.card": `<card><gamma>hello</gamma></card>`,
    },
    schemas: [CardSchema],
  });

  try {
    await loader.load("/project/test.card");
    t.fail("Should have thrown");
  } catch (e) {
    t.ok(e instanceof ValidationError);
    if (e instanceof ValidationError) {
      t.match(e.message, /Unexpected element <gamma>/);
      t.match(e.message, /expected one of: <alpha>, <beta>/);
      // The key test: message should NOT be the raw Zod dump
      t.ok(
        e.message.split("\n").length < 10,
        `Error should be concise, got ${e.message.split("\n").length} lines: ${e.message}`
      );
    }
  }
});

test("formatValidationError: news-brief-like schema with deep union", (t) => {
  // Simulates the actual news-brief structure
  const Expando = element("expando", {
    attrs: { title: z.string() },
    text: z.string(),
  });
  const Query = element("query", {
    attrs: { prompt: z.string() },
  });
  const Excerpt = element("excerpt", {
    attrs: { source: z.string() },
    text: z.string(),
  });
  const Section = element("section", {
    attrs: { heading: z.string().optional() },
    children: z.array(z.union([Expando, Query, Excerpt])).optional(),
    text: z.string().optional(),
  });
  const Content = element("content", {
    children: z.array(z.union([Section, Expando, Query, Excerpt])).optional(),
  });
  const Title = element("title", { text: z.string() });
  const Sources = element("sources", { children: z.array(z.unknown()) });
  const Brief = element("news-brief", {
    children: z.array(z.union([Title, Content, Sources])),
  });

  // A brief with a <bogus> child
  const node = makeNode({
    tagName: "news-brief",
    children: [
      makeNode({ tagName: "title", text: "Test" }),
      makeNode({ tagName: "bogus", text: "Bad" }),
    ],
  });

  const result = Brief.safeParse(node);
  t.notOk(result.success);
  if (!result.success) {
    const msg = formatValidationError(result.error, node);
    t.match(msg, /Unexpected element <bogus>/);
    t.match(msg, /expected one of: <title>, <content>, <sources>/);
    // Should be very concise
    t.ok(msg.split("\n").length < 5, `Message should be concise, got: ${msg}`);
  }
  t.end();
});
