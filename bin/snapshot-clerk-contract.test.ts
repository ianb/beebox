import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { render, schemaToTs, UnsupportedSchemaError, OUT_PATH } from "./snapshot-clerk-contract.js";

test("render is deterministic — two runs are byte-identical", () => {
  assert.equal(render(), render());
});

test("the committed snapshot is up to date with the leaf schema", () => {
  // The runtime twin of the pre-commit staleness gate: if this fails, someone
  // changed the leaf without running `pnpm snapshot:clerk-contract`.
  const onDisk = readFileSync(OUT_PATH, "utf8");
  assert.equal(render(), onDisk);
});

test("the printer throws on constructs outside the whitelist", () => {
  // Tuples need positional array emission, which this deliberately small
  // printer does not support.
  assert.throws(
    () => schemaToTs(z.tuple([z.string(), z.number()]), "output"),
    UnsupportedSchemaError,
  );
  // catchall/passthrough: an open object would need an index signature we don't emit.
  assert.throws(
    () => schemaToTs(z.object({ k: z.string() }).catchall(z.string()), "output"),
    UnsupportedSchemaError,
  );
});

test("the printer renders the whitelisted constructs correctly", () => {
  assert.equal(
    schemaToTs(z.object({ a: z.string(), b: z.string().optional(), c: z.string().nullable() }), "output"),
    "{\n  a: string;\n  b?: string;\n  c: string | null;\n}",
  );
  assert.equal(schemaToTs(z.object({ list: z.array(z.string()) }), "output"), "{\n  list: string[];\n}");
  assert.equal(
    schemaToTs(z.object({ scope: z.enum(["one", "all"]), pinned: z.boolean(), index: z.number() }), "output"),
    '{\n  scope: "one" | "all";\n  pinned: boolean;\n  index: number;\n}',
  );
});

test("non-identifier property names are quoted, not emitted raw", () => {
  assert.equal(schemaToTs(z.object({ "x-tag": z.string() }), "output"), '{\n  "x-tag": string;\n}');
});
