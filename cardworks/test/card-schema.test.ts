import { test } from "tap";
import { z } from "zod";
import { cardSchema, body, isBodyField, extractRefs } from "../src/schema/card-schema.js";

test("body() marks a Zod schema as a body field", (t) => {
  const field = body(z.string());
  t.equal(isBodyField(field), true);
  t.equal(field.kind, "markdown");
  t.end();
});

test("body() accepts an xml kind", (t) => {
  const field = body(z.string(), { kind: "xml" });
  t.equal(field.kind, "xml");
  t.end();
});

test("isBodyField returns false for plain schemas and non-objects", (t) => {
  t.equal(isBodyField(z.string()), false);
  t.equal(isBodyField(null), false);
  t.equal(isBodyField("not a body field"), false);
  t.end();
});

test("cardSchema with all frontmatter fields produces a bodyless shape", (t) => {
  const schema = cardSchema("email-thread", {
    fields: {
      "thread-id": z.string(),
      status: z.enum(["new", "read"]).optional(),
      subject: z.string(),
    },
  });
  t.equal(schema.type, "email-thread");
  t.equal(schema.bodyField, null);
  t.equal(schema.bodyFieldName, null);
  const ok = schema.frontmatterSchema.safeParse({
    type: "email-thread",
    "thread-id": "abc",
    subject: "hello",
  });
  t.equal(ok.success, true);
  t.end();
});

test("cardSchema with one body field extracts it from the frontmatter shape", (t) => {
  const schema = cardSchema("doc", {
    fields: {
      "drive-id": z.string(),
      title: z.string(),
      content: body(z.string()),
    },
  });
  t.equal(schema.bodyFieldName, "content");
  t.equal(schema.bodyField?.kind, "markdown");
  // Frontmatter shape should NOT include "content" — that's the body.
  const ok = schema.frontmatterSchema.safeParse({
    type: "doc",
    "drive-id": "x",
    title: "Notes",
  });
  t.equal(ok.success, true);
  // Frontmatter shape should require `type` to match.
  const wrongType = schema.frontmatterSchema.safeParse({
    type: "other",
    "drive-id": "x",
    title: "Notes",
  });
  t.equal(wrongType.success, false);
  t.end();
});

test("cardSchema rejects two body fields", (t) => {
  t.throws(() =>
    cardSchema("twobody", {
      fields: {
        a: body(z.string()),
        b: body(z.string()),
      },
    }),
    /multiple body fields/
  );
  t.end();
});

test("cardSchema rejects empty field set", (t) => {
  t.throws(() => cardSchema("empty", { fields: {} }), /at least one field/);
  t.end();
});

test("cardSchema injects global fields as optional frontmatter", (t) => {
  const schema = cardSchema("memo-like", {
    fields: { status: z.string() },
  });
  t.strictSame([...schema.globalFieldNames].sort(), ["contains", "title"]);
  const ok = schema.frontmatterSchema.safeParse({
    type: "memo-like",
    status: "new",
    title: "A title",
    contains: "Dentist moved to June 17; confirmation in this email.",
  });
  t.equal(ok.success, true);
  // Globals are optional — absence is fine.
  const bare = schema.frontmatterSchema.safeParse({ type: "memo-like", status: "new" });
  t.equal(bare.success, true);
  // Still typed: a non-string `contains` fails.
  const bad = schema.frontmatterSchema.safeParse({
    type: "memo-like",
    status: "new",
    contains: ["a", "list"],
  });
  t.equal(bad.success, false);
  t.end();
});

test("a schema's own declaration wins over the global field", (t) => {
  const schema = cardSchema("titled", {
    fields: { title: z.string() }, // required, unlike the optional global
  });
  t.strictSame([...schema.globalFieldNames], ["contains"]);
  const missingTitle = schema.frontmatterSchema.safeParse({ type: "titled" });
  t.equal(missingTitle.success, false);
  t.end();
});

test("a body field of a global name suppresses the global injection", (t) => {
  const schema = cardSchema("body-titled", {
    fields: { title: body(z.string()) },
  });
  t.strictSame([...schema.globalFieldNames], ["contains"]);
  t.equal(schema.bodyFieldName, "title");
  t.end();
});

test("cardSchema searchable defaults true and is settable", (t) => {
  const on = cardSchema("content", { fields: { status: z.string() } });
  t.equal(on.searchable, true);
  const off = cardSchema("job-like", {
    fields: { status: z.string() },
    searchable: false,
  });
  t.equal(off.searchable, false);
  t.end();
});

test("extractRefs picks up `ref` keys inside arrays of objects", (t) => {
  const refs = extractRefs({
    type: "email-thread",
    messages: [
      { ref: "attach/msg-001.email-message.card" },
      { ref: "attach/msg-002.email-message.card" },
    ],
  });
  t.equal(refs.length, 2);
  t.equal(refs[0]?.path, "messages[0].ref");
  t.equal(refs[0]?.ref, "attach/msg-001.email-message.card");
  t.equal(refs[1]?.path, "messages[1].ref");
  t.end();
});

test("extractRefs handles top-level single ref fields", (t) => {
  const refs = extractRefs({
    type: "email-message",
    "body-file": { ref: "attach/msg-001.body.txt" },
  });
  t.equal(refs.length, 1);
  t.equal(refs[0]?.path, "body-file.ref");
  t.equal(refs[0]?.ref, "attach/msg-001.body.txt");
  t.end();
});

test("extractRefs picks up `refs` arrays of strings", (t) => {
  const refs = extractRefs({
    type: "x",
    items: { refs: ["a.card", "b.card"] },
  });
  t.equal(refs.length, 2);
  t.equal(refs[0]?.path, "items.refs[0]");
  t.equal(refs[1]?.ref, "b.card");
  t.end();
});

test("extractRefs ignores non-string `ref` values and unrelated keys", (t) => {
  const refs = extractRefs({
    type: "x",
    ref: 42, // not a string — skipped
    title: "not a ref",
    nested: { description: "also not a ref" },
  });
  t.equal(refs.length, 0);
  t.end();
});
