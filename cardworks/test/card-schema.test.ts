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

test("extractRefs walks declared ref paths", (t) => {
  const schema = cardSchema("email-thread", {
    fields: {
      messages: z.array(z.string()),
    },
    refs: ["messages[]"],
  });
  const refs = extractRefs(schema, {
    type: "email-thread",
    messages: ["attach/msg-001.email-message.card", "attach/msg-002.email-message.card"],
  });
  t.equal(refs.length, 2);
  t.equal(refs[0]?.path, "messages[0]");
  t.equal(refs[0]?.ref, "attach/msg-001.email-message.card");
  t.equal(refs[1]?.path, "messages[1]");
  t.end();
});

test("extractRefs follows nested object paths", (t) => {
  const schema = cardSchema("with-nested", {
    fields: {
      attachments: z.array(z.object({ ref: z.string() })),
    },
    refs: ["attachments[].ref"],
  });
  const refs = extractRefs(schema, {
    type: "with-nested",
    attachments: [{ ref: "a.card" }, { ref: "b.card" }],
  });
  t.equal(refs.length, 2);
  t.equal(refs[0]?.path, "attachments[0].ref");
  t.equal(refs[1]?.ref, "b.card");
  t.end();
});

test("extractRefs skips missing/undefined ref values", (t) => {
  const schema = cardSchema("optional-refs", {
    fields: {
      maybe: z.string().optional(),
    },
    refs: ["maybe"],
  });
  t.equal(extractRefs(schema, { type: "optional-refs" }).length, 0);
  t.equal(extractRefs(schema, { type: "optional-refs", maybe: "x.card" }).length, 1);
  t.end();
});
