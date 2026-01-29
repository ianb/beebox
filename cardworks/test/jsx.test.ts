import { test } from "tap";
import { createElement, defineCardJSX, JSXValidationError } from "../src/jsx/index.js";
import { element } from "../src/schema/element.js";
import { z } from "zod";
import { MemoryCardLoader } from "../src/loader/loader.js";

// Test schemas
const TitleSchema = element("title", { text: z.string() });
const StepSchema = element("step", {
  attrs: { technique: z.string().optional() },
  text: z.string(),
});
const RecipeSchema = element("recipe", {
  attrs: { servings: z.string().optional() },
  children: z.array(z.union([TitleSchema, StepSchema])),
});

const schemas = {
  recipe: RecipeSchema,
  title: TitleSchema,
  step: StepSchema,
} as const;

// Basic createElement tests

test("createElement: creates element with tag name", (t) => {
  const el = createElement("foo", null);
  t.equal(el.tagName, "foo");
  t.same(el.attrs, {});
  t.same(el.children, []);
  t.equal(el.text, undefined);
  t.end();
});

test("createElement: creates element with attributes", (t) => {
  const el = createElement("foo", { bar: "baz", num: 42 });
  t.equal(el.tagName, "foo");
  t.equal(el.attrs["bar"], "baz");
  t.equal(el.attrs["num"], "42"); // Numbers converted to strings
  t.end();
});

test("createElement: handles string child as text", (t) => {
  const el = createElement("foo", { children: "hello" });
  t.equal(el.text, "hello");
  t.same(el.children, []);
  t.end();
});

test("createElement: handles element child", (t) => {
  const child = createElement("bar", null);
  const el = createElement("foo", { children: child });
  t.equal(el.children.length, 1);
  t.equal(el.children[0]?.tagName, "bar");
  t.equal(el.text, undefined);
  t.end();
});

test("createElement: handles array of element children", (t) => {
  const child1 = createElement("a", null);
  const child2 = createElement("b", null);
  const el = createElement("foo", { children: [child1, child2] });
  t.equal(el.children.length, 2);
  t.equal(el.children[0]?.tagName, "a");
  t.equal(el.children[1]?.tagName, "b");
  t.end();
});

test("createElement: handles mixed content (strings and elements)", (t) => {
  const child = createElement("b", { children: "bold" });
  const el = createElement("p", { children: ["Hello ", child, " world"] });
  t.ok(el.mixed);
  t.equal(el.mixed?.length, 3);
  t.equal(el.mixed?.[0], "Hello ");
  t.equal((el.mixed?.[1] as { tagName: string }).tagName, "b");
  t.equal(el.mixed?.[2], " world");
  // Element children are also in children array
  t.equal(el.children.length, 1);
  t.equal(el.children[0]?.tagName, "b");
  t.end();
});

test("createElement: handles array of strings as joined text", (t) => {
  const el = createElement("foo", { children: ["a", "b", "c"] });
  t.equal(el.text, "abc");
  t.same(el.children, []);
  t.end();
});

test("createElement: filters null/undefined children", (t) => {
  const child = createElement("a", null);
  const el = createElement("foo", { children: [null, child, undefined] });
  t.equal(el.children.length, 1);
  t.equal(el.children[0]?.tagName, "a");
  t.end();
});

test("createElement: has synthetic location", (t) => {
  const el = createElement("foo", null);
  t.equal(el.location.source, "<jsx>");
  t.equal(el.location.startLine, 0);
  t.equal(el.location.startColumn, 0);
  t.end();
});

test("createElement: ignores undefined/null attributes", (t) => {
  const el = createElement("foo", { bar: undefined, baz: null, qux: "val" });
  t.equal(el.attrs["qux"], "val");
  t.notOk("bar" in el.attrs);
  t.notOk("baz" in el.attrs);
  t.end();
});

// defineCardJSX tests

test("defineCardJSX: jsx creates element", (t) => {
  const { jsx } = defineCardJSX(schemas);
  const el = jsx("recipe", { servings: "4" });
  t.equal(el.tagName, "recipe");
  t.equal(el.attrs["servings"], "4");
  t.end();
});

test("defineCardJSX: jsxs creates element with children", (t) => {
  const { jsx, jsxs } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Pasta" });
  const recipe = jsxs("recipe", { children: [title] });
  t.equal(recipe.tagName, "recipe");
  t.equal(recipe.children.length, 1);
  t.equal(recipe.children[0]?.tagName, "title");
  t.end();
});

test("defineCardJSX: Fragment returns array", (t) => {
  const { jsx, Fragment } = defineCardJSX(schemas);
  const a = jsx("title", { children: "A" });
  const b = jsx("title", { children: "B" });
  const result = Fragment({ children: [a, b] });
  t.ok(Array.isArray(result));
  t.equal(result.length, 2);
  t.end();
});

test("defineCardJSX: Fragment with single child", (t) => {
  const { jsx, Fragment } = defineCardJSX(schemas);
  const a = jsx("title", { children: "A" });
  const result = Fragment({ children: a });
  t.ok(Array.isArray(result));
  t.equal(result.length, 1);
  t.end();
});

test("defineCardJSX: Fragment with no children", (t) => {
  const { Fragment } = defineCardJSX(schemas);
  const result = Fragment({});
  t.ok(Array.isArray(result));
  t.equal(result.length, 0);
  t.end();
});

// createCard tests

test("defineCardJSX: createCard creates new card", (t) => {
  const { jsx, jsxs, createCard } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Pasta Alfredo" });
  const step = jsx("step", { children: "Boil water" });
  const recipe = jsxs("recipe", { servings: "4", children: [title, step] });

  const card = createCard("/project/Recipe.card", recipe);

  t.equal(card.path, "/project/Recipe.card");
  t.equal(card.element.tagName, "recipe");
  t.equal(card.isNew, true);
  t.equal(card.loadedAt, undefined);
  t.end();
});

test("defineCardJSX: createCard adds default version", (t) => {
  const { jsx, createCard } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Test" });
  const recipe = jsx("recipe", { children: title });

  const card = createCard("/project/Recipe.card", recipe);

  t.equal(card.version, "1.0.0");
  t.equal(card.element.attrs["version"], "1.0.0");
  t.end();
});

test("defineCardJSX: createCard preserves explicit version", (t) => {
  const { jsx, createCard } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Test" });
  const recipe = jsx("recipe", { version: "2.0.0", children: title });

  const card = createCard("/project/Recipe.card", recipe);

  t.equal(card.version, "2.0.0");
  t.end();
});

test("defineCardJSX: createCard validates against schema", (t) => {
  const StrictTitleSchema = element("title", {
    text: z.string().min(5),
  });
  const strictSchemas = { title: StrictTitleSchema };
  const { jsx, createCard } = defineCardJSX(strictSchemas);

  const title = jsx("title", { children: "Hi" }); // Too short

  t.throws(
    () => createCard("/project/Title.card", title),
    JSXValidationError,
    "Should throw JSXValidationError for invalid content"
  );
  t.end();
});

test("defineCardJSX: createCard skips validation for unknown tags", (t) => {
  const { jsx, createCard } = defineCardJSX(schemas);
  const unknown = jsx("unknown", { foo: "bar", children: "content" });

  // Should not throw - no schema for "unknown"
  const card = createCard("/project/Unknown.card", unknown);
  t.equal(card.element.tagName, "unknown");
  t.end();
});

// New card behavior tests

test("New card: isDirty returns true", (t) => {
  const { jsx, createCard } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Test" });
  const recipe = jsx("recipe", { children: title });

  const card = createCard("/project/Recipe.card", recipe);

  t.equal(card.isDirty(), true);
  t.end();
});

test("New card: isStale returns false", async (t) => {
  const { jsx, createCard } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Test" });
  const recipe = jsx("recipe", { children: title });

  const card = createCard("/project/Recipe.card", recipe);

  t.equal(await card.isStale(), false);
});

test("New card: getMedia returns empty without fs", async (t) => {
  const { jsx, createCard } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Test" });
  const recipe = jsx("recipe", { children: title });

  const card = createCard("/project/Recipe.card", recipe);

  const media = await card.getMedia();
  t.same(media, {});
});

// Integration with CardLoader

test("JSX card can be saved via CardLoader", async (t) => {
  const { jsx, jsxs, createCard } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Pasta Alfredo" });
  const step1 = jsx("step", { children: "Boil water" });
  const step2 = jsx("step", { technique: "saute", children: "Cook garlic" });
  const recipe = jsxs("recipe", { servings: "4", children: [title, step1, step2] });

  const card = createCard("/project/Recipe.card", recipe);

  const loader = new MemoryCardLoader("/project");
  await loader.save(card);

  // Reload and verify
  const reloaded = await loader.load("/project/Recipe.card");
  t.equal(reloaded.element.tagName, "recipe");
  t.equal(reloaded.element.attrs["servings"], "4");
  t.equal(reloaded.element.children.length, 3);
  t.equal(reloaded.element.children[0]?.text, "Pasta Alfredo");
  t.equal(reloaded.isNew, false); // Loaded cards are not new
  t.ok(reloaded.loadedAt instanceof Date);
});

test("JSX card: element has card reference", (t) => {
  const { jsx, createCard } = defineCardJSX(schemas);
  const title = jsx("title", { children: "Test" });
  const recipe = jsx("recipe", { children: title });

  const card = createCard("/project/Recipe.card", recipe);

  // Card reference is attached to elements
  const elementWithCard = card.element as { card?: unknown };
  t.equal(elementWithCard.card, card);

  // Also attached to children
  const childWithCard = card.element.children[0] as { card?: unknown };
  t.equal(childWithCard.card, card);

  t.end();
});

// Complex nesting tests

test("JSX: deeply nested elements", (t) => {
  const { jsx, jsxs, createCard } = defineCardJSX(schemas);

  const step1 = jsx("step", { children: "Step 1" });
  const step2 = jsx("step", { technique: "boil", children: "Step 2" });
  const step3 = jsx("step", { children: "Step 3" });
  const title = jsx("title", { children: "Complex Recipe" });

  const recipe = jsxs("recipe", {
    version: "1.0.0",
    servings: "6",
    children: [title, step1, step2, step3],
  });

  const card = createCard("/project/Complex.card", recipe);

  t.equal(card.element.children.length, 4);
  t.equal(card.element.children[1]?.text, "Step 1");
  t.equal(card.element.children[2]?.attrs["technique"], "boil");
  t.end();
});
