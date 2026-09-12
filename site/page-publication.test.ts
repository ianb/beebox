import assert from "node:assert/strict";
import { test } from "node:test";
import { publishedPageBody } from "./page-publication.js";

const id = "Parent.attach/Aside.doc.card";
const fields = {
  title: "Aside",
  summary: "Aside",
  authorship: {
    people: [{ name: "Ian Bicking", role: "author", contribution: "Directed the card." }],
    ai: { transcription: "none", drafting: "none", editing: "none" },
  },
};

test("pending author doc attachments cannot publish their draft body", () => {
  const result = publishedPageBody({ id, frontmatter: { ...fields, kind: "author", status: "pending" }, body: "PRIVATE DRAFT {% nugget slug=\"hidden\" /%}" });
  assert.match(result, /the author's words go here/);
  assert.doesNotMatch(result, /PRIVATE DRAFT|hidden/);
});

test("attached documents must declare their voice and publication state", () => {
  assert.throws(() => publishedPageBody({ id, frontmatter: fields, body: "Text" }), /require kind and status/);
  assert.throws(() => publishedPageBody({ id, frontmatter: { ...fields, kind: "generated", status: "ready" }, body: " " }), /empty body/);
});

test("published attachments carry automatic provenance into HTML and Markdown inputs", () => {
  assert.match(publishedPageBody({ id, frontmatter: { ...fields, kind: "generated", status: "ready" }, body: "# Note\n\nText" }), /\*generated from the repository\*/);
});
