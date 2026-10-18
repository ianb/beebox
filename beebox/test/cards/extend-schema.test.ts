// # `extendSchema`: a box completes an exported base
//
// A plugin exports a *base*: a `CardSchemaConfig` with no type name. A box stub
// completes it with `cardSchema(type, extendSchema(base, delta))`
// (`src/cards/extend-schema.ts`, exported through `beebox/cards`;
// `docs/implemented-plans/plugins.md`, Track 4). The delta is typed on its own, so adding one
// field does not restate the base's, and the merged field map is what
// `summarize` and `InferCardFields` see.

import { test } from "tap";
import "agent-doctest/tap";
import { any, str } from "agent-doctest/check";
import { join } from "node:path";
import { z } from "zod";
import {
  body,
  cardSchema,
  extendSchema,
  RedeclaredFieldError,
  RedeclaredTagError,
  type CardSchemaConfig,
  type CardValidateInput,
  type FieldDecl,
  type LintIssue,
} from "../../src/exports/cards.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";
import { typecheckSource } from "../../src/lib/typescript/check.js";

const progressFields = {
  score: z.number(),
  status: z.enum(["open", "done"]),
  body: body(z.string()),
};

function issue(message: string): LintIssue {
  return { type: "validation", severity: "warning", message };
}

/** A base with every composable member set, so each rule has something to compose with. */
const progressBase: CardSchemaConfig<string, typeof progressFields> = {
  fields: progressFields,
  description: "Base description",
  brief: "Base brief",
  category: "synced",
  prominence: "background",
  searchable: false,
  instructions: "Base instructions.",
  validate: ({ fields }: CardValidateInput) => (fields["score"] === 0 ? [issue("base: score is zero")] : []),
  superRefine: (fields, ctx) => {
    if (fields["status"] === "done" && fields["score"] !== 100) {
      ctx.addIssue({ code: "custom", path: ["score"], message: "done requires score 100" });
    }
  },
  summarize: (card, base) => ({ ...base, detail: `score ${card.score}`, attrs: { score: card.score } }),
};

const sampleBase = { title: "T" };

// ## Compile-time checks
//
// Doctest fences are not type-checked, so the type-level claims are verified by
// compiling a fixture with the package's own `tsconfig.json` options (the same
// strictness as `pnpm typecheck`), as a virtual file under `test/cards/`.
const FIXTURE_HEAD = `
import { z } from "zod";
import { cardSchema, extendSchema, type CardSchemaConfig, type InferCardFields } from "../../src/exports/cards.js";
const progressFields = { score: z.number(), status: z.enum(["open", "done"]) };
const progressBase: CardSchemaConfig<string, typeof progressFields> = {
  fields: progressFields,
  summarize: (card, base) => ({ ...base, detail: \`score \${card.score}\` }),
};
`;

/** Diagnostics tsc reports in the fixture alone, with the source text of each offending line. */
function typecheckFixture(source: string): string[] {
  return typecheckSource({
    baseConfigPath: join(PACKAGE_ROOT, "tsconfig.json"),
    relativePath: "test/cards/extend-schema.fixture.ts",
    source,
  }).map((d) => `${d.lineText ?? ""}\n  ${d.message}`);
}

// ## `fields` merge by key
void test("`fields` merge by key", async (t) => {
  // doctest:L62
  const merged = extendSchema(progressBase, { fields: { mood: z.string().optional() } });
  t.check(Object.keys(merged.fields), [
    "score",
    "status",
    "body",
    "mood",
  ]);
});

// A delta with no `fields` carries the base's map through:
void test("A delta with no fields carries the base's map through:", async (t) => {
  // doctest:L70
  t.check(Object.keys(extendSchema(progressBase, { brief: "Only a brief" }).fields), [
    "score",
    "status",
    "body",
  ]);
});

// ## `validate` runs base then delta and concatenates
void test("`validate` runs base then delta and concatenates", async (t) => {
  // doctest:L77
  const schema = cardSchema("progress", extendSchema(progressBase, {
    validate: ({ fields }) => (fields["status"] === "open" ? [issue("delta: still open")] : []),
  }));
  t.check(schema.validate?.({ fields: { score: 0, status: "open" } }).map((i) => i.message), [
    "base: score is zero",
    "delta: still open",
  ]);
});

// A delta without `validate` keeps the base's hook as-is:
void test("A delta without validate keeps the base's hook as-is:", async (t) => {
  // doctest:L87
  await t.checkText(cardSchema("progress", extendSchema(progressBase, {})).validate === progressBase.validate, "true");
});

// ## `superRefine` runs both, base first
//
// A card that violates the base's parse-time invariant still fails
// `frontmatterSchema.safeParse` after extension; the delta's refinement is
// reported after it.
void test("A card that violates the base's parse-time invariant still fails frontmatterS...", async (t) => {
  // doctest:L98
  const schema = cardSchema("progress", extendSchema(progressBase, {
    fields: { mood: z.string().optional() },
    superRefine: (fields, ctx) => {
      if (fields["mood"] === "grim" && fields["status"] === "done") {
        ctx.addIssue({ code: "custom", path: ["mood"], message: "a done card is not grim" });
      }
    },
  }));
  const result = schema.frontmatterSchema.safeParse({ type: "progress", score: 40, status: "done", mood: "grim" });
  t.check(result.success ? "parsed" : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), [
    "score: done requires score 100",
    "mood: a done card is not grim",
  ]);

  // doctest:L110
  const ok = schema.frontmatterSchema.safeParse({ type: "progress", score: 100, status: "done", mood: "fine" });
  t.check(ok.success, true);
});

// ## `summarize` runs the delta with the base's result as `base`
//
// The delta sees the merged fields (`card.mood`) and the base's summary
// (`detail`, `attrs`), and may extend or replace parts of it.
void test("The delta sees the merged fields (card.mood) and the base's summary (detail,...", async (t) => {
  // doctest:L121
  const schema = cardSchema("progress", extendSchema(progressBase, {
    fields: { mood: z.string().optional() },
    // `base` is the base schema's result, which may carry `detail` and `attrs`.
    summarize: (card, base) => ({ ...base, detail: `${base.detail ?? ""}, mood ${card.mood ?? "unset"}` }),
  }));
  t.check(schema.summarize?.({ type: "progress", score: 7, status: "open", body: "", mood: "bright" }, sampleBase), {
    title: "T",
    detail: "score 7, mood bright",
    attrs: {
      score: 7,
    },
  });
});

// With no base `summarize`, the delta receives the engine's summary as `base`:
void test("With no base summarize, the delta receives the engine's summary as base:", async (t) => {
  // doctest:L133
  const bare: CardSchemaConfig<string, typeof progressFields> = { fields: progressFields };
  const schema = cardSchema("progress", extendSchema(bare, {
    summarize: (card, base) => ({ ...base, detail: `status ${card.status}` }),
  }));
  t.check(schema.summarize?.({ type: "progress", score: 7, status: "open", body: "" }, sampleBase), {
    title: "T",
    detail: "status open",
  });
});

// A delta without `summarize` keeps the base's behaviour:
void test("A delta without summarize keeps the base's behaviour:", async (t) => {
  // doctest:L144
  const schema = cardSchema("progress", extendSchema(progressBase, { fields: { mood: z.string().optional() } }));
  t.check(schema.summarize?.({ type: "progress", score: 3, status: "open", body: "" }, sampleBase), {
    title: "T",
    detail: "score 3",
    attrs: {
      score: 3,
    },
  });
});

// ## `instructions` concatenate with a blank line
void test("`instructions` concatenate with a blank line", async (t) => {
  // doctest:L152
  await t.checkText(extendSchema(progressBase, { instructions: "Delta instructions." }).instructions, `Base instructions.
«blankline»
Delta instructions.`);

  // doctest:L157
  t.check(extendSchema(progressBase, {}).instructions, "Base instructions.");

  // doctest:L160
  t.check(extendSchema({ fields: progressFields }, { instructions: "Only the delta." }).instructions, "Only the delta.");
});

// ## `description`, `brief`, `prominence`, `theme` are delta-wins; the rest is carried
void test("`description`, `brief`, `prominence`, `theme` are delta-wins; the rest is carried", async (t) => {
  // doctest:L167
  const merged = extendSchema(progressBase, {
    description: "Delta description",
    brief: "Delta brief",
    prominence: "primary",
    theme: { name: "plain" },
  });
  const { fields: _fields, validate: _v, superRefine: _r, summarize: _s, ...rest } = merged;
  t.check(rest, {
    description: "Delta description",
    brief: "Delta brief",
    category: "synced",
    prominence: "primary",
    theme: {
      name: "plain",
    },
    searchable: false,
    instructions: "Base instructions.",
  });

  // doctest:L186
  const { fields: _f2, validate: _v2, superRefine: _r2, summarize: _s2, ...untouched } = extendSchema(progressBase, {});
  t.check(untouched, {
    description: "Base description",
    brief: "Base brief",
    category: "synced",
    prominence: "background",
    searchable: false,
    instructions: "Base instructions.",
  });
});

// ## A redeclared field fails at runtime
//
// Box schemas run under type stripping, so the rule holds without `tsc` too.
void test("Box schemas run under type stripping, so the rule holds without tsc too.", async (t) => {
  // doctest:L204
  function redeclare(): string {
    try {
      // Widen the base's field map so the type-level rejection does not apply; the runtime check still must.
      const looseFields: Record<string, FieldDecl> = progressFields;
      extendSchema({ fields: looseFields }, { fields: { score: z.string() } });
      return "no error";
    } catch (e) {
      return e instanceof RedeclaredFieldError ? `${e.name}: ${e.message} (field=${e.field})` : "other";
    }
  }
  t.check(redeclare(), "RedeclaredFieldError: extendSchema: delta redeclares base field \"score\" (field=score)");
});

// ## `markdocTags` union, and a redeclared tag fails
//
// Scoped Markdoc tags merge like fields: the delta's tags are added to the
// base's, and a key the base already declares throws `RedeclaredTagError`.
void test("Scoped Markdoc tags merge like fields:", async (t) => {
  // doctest:L224
  const withBaseTag = extendSchema(progressBase, { markdocTags: { garnish: { render: "Garnish" } } });
  const extended = extendSchema(withBaseTag, { markdocTags: { plating: { render: "Plating" } } });
  t.check(Object.keys(extended.markdocTags ?? {}), [
    "garnish",
    "plating",
  ]);

  // doctest:L231
  function redeclareTag(): string {
    try {
      extendSchema(withBaseTag, { markdocTags: { garnish: { render: "Other" } } });
      return "no error";
    } catch (e) {
      return e instanceof RedeclaredTagError ? `${e.name} (tag=${e.tag})` : "other";
    }
  }
  t.check(redeclareTag(), "RedeclaredTagError (tag=garnish)");
});

// ## `cardSchema` rejects a tag the core table has, and carries the rest
//
// A scoped tag cannot shadow a core tag such as `quote`. A valid declaration
// appears on the resolved schema.
void test("A scoped tag cannot shadow a core tag such as quote.", async (t) => {
  // doctest:L249
  function declareQuote(): string {
    try {
      cardSchema("dish", { fields: { body: body(z.string()) }, markdocTags: { quote: { render: "Q" } } });
      return "no error";
    } catch (e) {
      return e instanceof RedeclaredTagError ? `${e.name} (tag=${e.tag})` : "other";
    }
  }
  t.check(declareQuote(), "RedeclaredTagError (tag=quote)");
});

void test("`cardSchema` rejects a tag the core table has, and carries the rest", async (t) => {
  // doctest:L262
  const dish = cardSchema("dish", { fields: { body: body(z.string()) }, markdocTags: { garnish: { render: "Garnish" } } });
  t.check(Object.keys(dish.markdocTags ?? {}), [
    "garnish",
  ]);
});

// ### Adding `mood` keeps `summarize` and `InferCardFields` typed over the merged fields
//
// `card.mood` and `card.score` both type-check in the delta's `summarize`; a
// field neither side declares does not. `InferCardFields` on the completed
// schema carries the added field too.
// The doctest gave each example 120s before a still-running notice.
void test("card.mood and card.score both type-check in the delta's summarize; a field ne...", async (t) => {
  // doctest:L318
  t.check(
    typecheckFixture(`${FIXTURE_HEAD}
const Progress = cardSchema("progress", extendSchema(progressBase, {
  fields: { mood: z.string().optional() },
  summarize: (card, base) => ({ ...base, detail: \`\${card.score} \${card.mood ?? ""} \${card.nope}\` }),
}));
type Fields = InferCardFields<typeof Progress>;
const typed: Fields = { type: "progress", score: 1, status: "open", mood: "bright" };
const missingBaseField: Fields = { type: "progress", mood: "bright" };
void typed;
`),
    [
    `summarize: (card, base) => ({ ...base, detail: \`\${card.score} \${card.mood ?? ""} \${card.nope}\` }),
  Property 'nope' does not exist on type 'CardFieldsOf<string, { score: ZodNumber; status: ZodEnum<{ done: "done"; open: "open"; }>; } & { mood: ZodOptional<ZodString>; }>'.`,
    `const missingBaseField: Fields = { type: "progress", mood: "bright" };
  Type '{ type: "progress"; mood: string; }' is not assignable to type 'CardFieldsOf<"progress", { score: ZodNumber; status: ZodEnum<{ done: "done"; open: "open"; }>; } & { mood: ZodOptional<ZodString>; }>'.
  Type '{ type: "progress"; mood: string; }' is missing the following properties from type '{ score: number; status: "done" | "open"; }': score, status`,
  ],
  );
});

// ### A duplicate field key fails type checking
// The doctest gave each example 120s before a still-running notice.
void test("A duplicate field key fails type checking", async (t) => {
  // doctest:L338
  t.check(
    typecheckFixture(`${FIXTURE_HEAD}
extendSchema(progressBase, { fields: { score: z.string() } });
extendSchema(progressBase, { fields: { mood: z.string() } });
`),
    [
    str`extendSchema(progressBase, { fields: { score: z.string() } });
  ${any(String)}redeclares a base field${any(String)}`,
  ],
  );
});
