/**
 * Tests for schema registry (type registration, lookup).
 *
 * Template generation tests are in schemas.doctest.md.
 */

import { test } from "tap";
import {
  MemoSchema,
  QuestionSchema,
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
