// # figure-params helpers
//
// A figure card declares its accepted parameters in frontmatter; the embed link
// supplies values as query strings. These helpers parse the declaration and coerce
// supplied string values to the declared types.

import { test } from "tap";
import "agent-doctest/tap";
import {
  parseDeclaredParams,
  coerceFigureParams,
} from "../../src/lib/figure-params.js";
import type { FigureParamDecl } from "../../src/lib/figure-params.js";

// ## parseDeclaredParams
//
// Reads a frontmatter `params` array, keeping well-formed entries and dropping
// malformed ones. A dropped entry is a **visible degradation**: it warns (naming
// the offender) rather than vanishing silently, so we capture `console.warn` to
// keep the assertions — and the test output — clean:
void test("Reads a frontmatter params array, keeping well-formed entries and dropping ma...", async (t) => {
  // doctest:L23
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };
  const parsed = parseDeclaredParams([
    { name: "molecule", type: "string" },
    { name: "size", type: "number", default: 300 },
    { name: "bad", type: "color" },
    { name: 123, type: "string" },
    "nonsense",
  ]);
  console.warn = origWarn;
  t.check(parsed, [
    {
      name: "molecule",
      type: "string",
    },
    {
      name: "size",
      type: "number",
      default: 300,
    },
  ]);

  // Each of the three malformed entries produced one warning, and the unknown-type
  // warning names the param and the bad type (the module→card mapping trap — a
  // module `select`/`trigger` written as a card type is silently ignored otherwise):

  // doctest:L43
  t.check(warnings, [
    'figure params: dropping param "bad" — unknown card type "color" (card params are string|number|boolean; map a module select→string, trigger is not embed-controllable)',
    "figure params: dropping a param declaration with no string `name` [object Object]",
    "figure params: dropping a non-object param declaration nonsense",
  ]);
});

// A non-array (or absent) declaration yields an empty list:
void test("A non-array (or absent) declaration yields an empty list:", async (t) => {
  // doctest:L53
  t.check(parseDeclaredParams(undefined), []);
});

// ## coerceFigureParams
//
// Supplied values are coerced to the declared type:
void test("Supplied values are coerced to the declared type:", async (t) => {
  // doctest:L62
  const declared: FigureParamDecl[] = [
    { name: "label", type: "string" },
    { name: "size", type: "number" },
    { name: "wireframe", type: "boolean" },
  ];
  t.check(coerceFigureParams(declared, { label: "H2O2", size: "500", wireframe: "true" }), {
    label: "H2O2",
    size: 500,
    wireframe: true,
  });

  // Booleans accept `true`/`1` and `false`/`0`:

  // doctest:L74
  t.check(coerceFigureParams(declared, { wireframe: "0" }), {
    wireframe: false,
  });
});

// A declared default fills in when the embed omits the value:
void test("A declared default fills in when the embed omits the value:", async (t) => {
  // doctest:L81
  const declared: FigureParamDecl[] = [{ name: "size", type: "number", default: 300 }];
  t.check(coerceFigureParams(declared, {}), {
    size: 300,
  });
});

// A param with neither a supplied value nor a default is omitted entirely, so the
// sketch's own fallback runs (`figure.params.x` is `undefined`):
void test("A param with neither a supplied value nor a default is omitted entirely, so t...", async (t) => {
  // doctest:L90
  const declared: FigureParamDecl[] = [{ name: "size", type: "number" }];
  t.check(coerceFigureParams(declared, {}), {});
});

// An uncoercible value (e.g. `?size=abc`) falls back to the declared default, or is
// omitted when there is none:
void test("An uncoercible value (e.g.", async (t) => {
  // doctest:L99
  t.check(coerceFigureParams([{ name: "size", type: "number", default: 300 }], { size: "abc" }), {
    size: 300,
  });

  // doctest:L102
  t.check(coerceFigureParams([{ name: "size", type: "number" }], { size: "abc" }), {});
});

// Undeclared embed params are ignored — only declared params reach the sketch:
void test("Undeclared embed params are ignored — only declared params reach the sketch:", async (t) => {
  // doctest:L109
  t.check(coerceFigureParams([{ name: "size", type: "number" }], { size: "400", rogue: "x" }), {
    size: 400,
  });
});
