# `extendSchema`: a box completes an exported base

A plugin exports a *base*: a `CardSchemaConfig` with no type name. A box stub
completes it with `cardSchema(type, extendSchema(base, delta))`
(`src/cards/extend-schema.ts`, exported through `beebox/cards`;
`docs/plans/plugins.md`, Track 4). The delta is typed on its own, so adding one
field does not restate the base's, and the merged field map is what
`summarize` and `InferCardFields` see.

```ts setup
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { z } from "zod";
import {
  body,
  cardSchema,
  extendSchema,
  RedeclaredFieldError,
  type CardSchemaConfig,
  type CardValidateInput,
  type LintIssue,
} from "../../src/exports/cards.js";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

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
```

## `fields` merge by key

```ts
const merged = extendSchema(progressBase, { fields: { mood: z.string().optional() } });
Object.keys(merged.fields)
=> ["score", "status", "body", "mood"]
```

A delta with no `fields` carries the base's map through:

```ts
Object.keys(extendSchema(progressBase, { brief: "Only a brief" }).fields)
=> ["score", "status", "body"]
```

## `validate` runs base then delta and concatenates

```ts
const schema = cardSchema("progress", extendSchema(progressBase, {
  validate: ({ fields }) => (fields["status"] === "open" ? [issue("delta: still open")] : []),
}));
schema.validate?.({ fields: { score: 0, status: "open" } }).map((i) => i.message)
=> ["base: score is zero", "delta: still open"]
```

A delta without `validate` keeps the base's hook as-is:

```ts
cardSchema("progress", extendSchema(progressBase, {})).validate === progressBase.validate
=> true
```

## `superRefine` runs both, base first

A card that violates the base's parse-time invariant still fails
`frontmatterSchema.safeParse` after extension; the delta's refinement is
reported after it.

```ts
const schema = cardSchema("progress", extendSchema(progressBase, {
  fields: { mood: z.string().optional() },
  superRefine: (fields, ctx) => {
    if (fields["mood"] === "grim" && fields["status"] === "done") {
      ctx.addIssue({ code: "custom", path: ["mood"], message: "a done card is not grim" });
    }
  },
}));
const result = schema.frontmatterSchema.safeParse({ type: "progress", score: 40, status: "done", mood: "grim" });
result.success ? "parsed" : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
=> ["score: done requires score 100", "mood: a done card is not grim"]

const ok = schema.frontmatterSchema.safeParse({ type: "progress", score: 100, status: "done", mood: "fine" });
ok.success
=> true
```

## `summarize` runs the delta with the base's result as `base`

The delta sees the merged fields (`card.mood`) and the base's summary
(`detail`, `attrs`), and may extend or replace parts of it.

```ts
const schema = cardSchema("progress", extendSchema(progressBase, {
  fields: { mood: z.string().optional() },
  summarize: (card, base) => ({ ...base, detail: `${base.detail ?? ""}, mood ${card.mood ?? "unset"}` }),
}));
schema.summarize?.({ type: "progress", score: 7, status: "open", body: "", mood: "bright" }, sampleBase)
=> { title: "T", detail: "score 7, mood bright", attrs: { score: 7 } }
```

With no base `summarize`, the delta receives the engine's summary as `base`:

```ts
const bare: CardSchemaConfig<string, typeof progressFields> = { fields: progressFields };
const schema = cardSchema("progress", extendSchema(bare, {
  summarize: (card, base) => ({ ...base, detail: `status ${card.status}` }),
}));
schema.summarize?.({ type: "progress", score: 7, status: "open", body: "" }, sampleBase)
=> { title: "T", detail: "status open" }
```

A delta without `summarize` keeps the base's behaviour:

```ts
const schema = cardSchema("progress", extendSchema(progressBase, { fields: { mood: z.string().optional() } }));
schema.summarize?.({ type: "progress", score: 3, status: "open", body: "" }, sampleBase)
=> { title: "T", detail: "score 3", attrs: { score: 3 } }
```

## `instructions` concatenate with a blank line

```ts
extendSchema(progressBase, { instructions: "Delta instructions." }).instructions
=> Base instructions.
«blankline»
Delta instructions.

extendSchema(progressBase, {}).instructions
=> Base instructions.

extendSchema({ fields: progressFields }, { instructions: "Only the delta." }).instructions
=> Only the delta.
```

## `description`, `brief`, `prominence`, `theme` are delta-wins; the rest is carried

```ts
const merged = extendSchema(progressBase, {
  description: "Delta description",
  brief: "Delta brief",
  prominence: "primary",
  theme: "plain",
});
const { fields: _fields, validate: _v, superRefine: _r, summarize: _s, ...rest } = merged;
rest
=>
{
  description: "Delta description",
  brief: "Delta brief",
  category: "synced",
  prominence: "primary",
  theme: "plain",
  searchable: false,
  instructions: "Base instructions."
}

const { fields: _f2, validate: _v2, superRefine: _r2, summarize: _s2, ...untouched } = extendSchema(progressBase, {});
untouched
=>
{
  description: "Base description",
  brief: "Base brief",
  category: "synced",
  prominence: "background",
  searchable: false,
  instructions: "Base instructions."
}
```

## A redeclared field fails at runtime

Box schemas run under type stripping, so the rule holds without `tsc` too.

```ts
function redeclare(): string {
  try {
    extendSchema(progressBase, { fields: { score: z.string() } });
    return "no error";
  } catch (e) {
    return e instanceof RedeclaredFieldError ? `${e.name}: ${e.message} (field=${e.field})` : "other";
  }
}
redeclare()
=> RedeclaredFieldError: extendSchema: delta redeclares base field "score" (field=score)
```

## Compile-time checks

Doctest fences are not type-checked, so the type-level claims are verified by
compiling a fixture with the package's own `tsconfig.json` options (the same
strictness as `pnpm typecheck`), as a virtual file under `test/cards/`.

```ts setup
const FIXTURE_PATH = join(PACKAGE_ROOT, "test/cards/extend-schema.fixture.ts");
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
  const config = ts.readConfigFile(join(PACKAGE_ROOT, "tsconfig.json"), (p) => readFileSync(p, "utf8"));
  if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PACKAGE_ROOT);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false };
  delete options.rootDir;
  delete options.tsBuildInfoFile;
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (f) => f === FIXTURE_PATH || fileExists.call(host, f);
  host.readFile = (f) => (f === FIXTURE_PATH ? source : readFile.call(host, f));
  host.getSourceFile = (f, lang, onError, should) =>
    f === FIXTURE_PATH ? ts.createSourceFile(f, source, lang) : getSourceFile.call(host, f, lang, onError, should);
  const program = ts.createProgram([FIXTURE_PATH], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === FIXTURE_PATH)
    .map((d) => {
      const file = d.file!;
      const { line } = file.getLineAndCharacterOfPosition(d.start ?? 0);
      const text = file.text.split("\n")[line]?.trim() ?? "";
      return `${text}\n  ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
    });
}
```

### Adding `mood` keeps `summarize` and `InferCardFields` typed over the merged fields

`card.mood` and `card.score` both type-check in the delta's `summarize`; a
field neither side declares does not. `InferCardFields` on the completed
schema carries the added field too.

```ts timeout=120s
typecheckFixture(`${FIXTURE_HEAD}
const Progress = cardSchema("progress", extendSchema(progressBase, {
  fields: { mood: z.string().optional() },
  summarize: (card, base) => ({ ...base, detail: \`\${card.score} \${card.mood ?? ""} \${card.nope}\` }),
}));
type Fields = InferCardFields<typeof Progress>;
const typed: Fields = { type: "progress", score: 1, status: "open", mood: "bright" };
const missingBaseField: Fields = { type: "progress", mood: "bright" };
void typed;
`)
=>
[
  "summarize: (card, base) => ({ ...base, detail: `${card.score} ${card.mood ?? \"\"} ${card.nope}` }),\n  Property 'nope' does not exist on type 'CardFieldsOf<string, { score: ZodNumber; status: ZodEnum<{ open: \"open\"; done: \"done\"; }>; } & { mood: ZodOptional<ZodString>; }>'.",
  "const missingBaseField: Fields = { type: \"progress\", mood: \"bright\" };\n  Type '{ type: \"progress\"; mood: string; }' is not assignable to type 'CardFieldsOf<\"progress\", { score: ZodNumber; status: ZodEnum<{ open: \"open\"; done: \"done\"; }>; } & { mood: ZodOptional<ZodString>; }>'.\n  Type '{ type: \"progress\"; mood: string; }' is missing the following properties from type '{ status: \"open\" | \"done\"; score: number; }': status, score"
]
```

### A duplicate field key fails type checking

```ts timeout=120s
typecheckFixture(`${FIXTURE_HEAD}
extendSchema(progressBase, { fields: { score: z.string() } });
extendSchema(progressBase, { fields: { mood: z.string() } });
`)
=>
[
  "extendSchema(progressBase, { fields: { score: z.string() } });\n  «*»redeclares a base field«*»"
]
```
