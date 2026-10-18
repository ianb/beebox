/**
 * Patterns: the positions of an expected value that match more than one
 * actual value. Each pattern knows its own source text, so a failure can
 * name the constraint that failed and a suggestion can print the pattern
 * back as code.
 *
 * A pattern is typed by the value it stands in for: `any(String)` is a
 * `Pattern<string>`, so the type checker rejects it in a number position.
 */

/** The result of testing one value against one pattern. */
export type PatternResult =
  | { ok: true }
  | {
      ok: false;
      /** The part of the pattern that failed, e.g. `.between(1, 5)`. */
      failed: string;
    };

const OK: PatternResult = { ok: true };

/** A pattern that stands in for a value of type `T`. */
export class Pattern<out T> {
  /** Carries `T` for assignability only; never set. */
  declare private readonly stands?: T;

  constructor(
    /** The pattern as source code, e.g. `any(Number).int()`. */
    readonly source: string,
    private readonly test: (value: unknown) => PatternResult,
  ) {}

  /** Test one value. */
  match(value: unknown): PatternResult {
    return this.test(value);
  }

  toString(): string {
    return this.source;
  }

}

function fail(failed: string): PatternResult {
  return { ok: false, failed };
}

/** A `Pattern<string>` with chainable refinements. */
export class StringPattern extends Pattern<string> {
  constructor(source: string, test: (value: string) => PatternResult) {
    super(source, (value) => (typeof value === "string" ? test(value) : fail("a string")));
  }

  private refine(step: string, accepts: (value: string) => boolean): StringPattern {
    return new StringPattern(`${this.source}${step}`, (value) => {
      const base = this.match(value);
      if (!base.ok) return base;
      return accepts(value) ? OK : fail(step);
    });
  }

  startsWith(prefix: string): StringPattern {
    return this.refine(`.startsWith(${JSON.stringify(prefix)})`, (v) => v.startsWith(prefix));
  }

  endsWith(suffix: string): StringPattern {
    return this.refine(`.endsWith(${JSON.stringify(suffix)})`, (v) => v.endsWith(suffix));
  }

  includes(part: string): StringPattern {
    return this.refine(`.includes(${JSON.stringify(part)})`, (v) => v.includes(part));
  }

  matches(re: RegExp): StringPattern {
    return this.refine(`.matches(${String(re)})`, (v) => {
      re.lastIndex = 0;
      return re.test(v);
    });
  }
}

/** A `Pattern<number>` with chainable refinements. */
export class NumberPattern extends Pattern<number> {
  constructor(source: string, test: (value: number) => PatternResult) {
    super(source, (value) => (typeof value === "number" ? test(value) : fail("a number")));
  }

  private refine(step: string, accepts: (value: number) => boolean): NumberPattern {
    return new NumberPattern(`${this.source}${step}`, (value) => {
      const base = this.match(value);
      if (!base.ok) return base;
      return accepts(value) ? OK : fail(step);
    });
  }

  int(): NumberPattern {
    return this.refine(".int()", (v) => Number.isInteger(v));
  }

  /** Inclusive at both ends. */
  between(min: number, max: number): NumberPattern {
    return this.refine(`.between(${min}, ${max})`, (v) => v >= min && v <= max);
  }

  positive(): NumberPattern {
    return this.refine(".positive()", (v) => v > 0);
  }

  /** Within `tolerance` of `target`, for computed floating-point values. */
  closeTo(target: number, tolerance: number): NumberPattern {
    return this.refine(`.closeTo(${target}, ${tolerance})`, (v) => Number.isFinite(v) && Math.abs(v - target) <= tolerance);
  }
}

type PrimitiveConstructor = StringConstructor | NumberConstructor | BooleanConstructor;

/** The pattern `any(type)` returns for each constructor. */
export type AnyOf<C extends PrimitiveConstructor> =
  C extends StringConstructor ? StringPattern
  : C extends NumberConstructor ? NumberPattern
  : Pattern<boolean>;

/** Any value of one primitive type: `any(String)`, `any(Number)`, `any(Boolean)`. */
export function any<C extends PrimitiveConstructor>(type: C): AnyOf<C> {
  const pattern = type === String ? new StringPattern("any(String)", () => OK)
    : type === Number ? new NumberPattern("any(Number)", () => OK)
    : new Pattern<boolean>("any(Boolean)", (v) => (typeof v === "boolean" ? OK : fail("a boolean")));
  // TS cannot narrow a generic constructor parameter; each branch above is
  // the AnyOf member for the constructor it tested.
  return pattern as AnyOf<C>;
}

/**
 * Any value except `undefined`, as Jest's `expect.anything()`. A key whose
 * value turned `undefined` is a change worth failing on; `optional()` is for
 * a key that may be absent. A check whose whole expected value is
 * `anything()` is refused.
 */
export function anything(): Pattern<never> {
  return new Pattern<never>("anything()", (v) => (v === undefined ? fail("a value (not undefined; use optional() for a key that may be absent)") : OK));
}

export const UUID_RE = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** A UUID string. */
export function uuid(): StringPattern {
  return new StringPattern("uuid()", (v) => (UUID_RE.test(v) ? OK : fail("uuid()")));
}

/** An ISO 8601 date or timestamp string, or a valid `Date`. */
export function isoDate(): Pattern<string> {
  return new Pattern<string>("isoDate()", (v) => {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? fail("a valid Date") : OK;
    return typeof v === "string" && ISO_DATE_RE.test(v) ? OK : fail("isoDate()");
  });
}

type Literal = string | number | boolean | null | undefined;

function literalSource(value: Literal): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

/** One of the given literal values. */
export function oneOf<const L extends readonly Literal[]>(...values: L): Pattern<L[number]> {
  const source = `oneOf(${values.map(literalSource).join(", ")})`;
  return new Pattern<L[number]>(source, (v) => (values.some((x) => Object.is(x, v)) ? OK : fail(source)));
}

/**
 * An object property that may be absent; when present, its value must match
 * `inner`. It is not a `Pattern`, so the type checker accepts it only on a
 * property that is optional in the actual value's type.
 */
export class Optional<out T> {
  /** Carries `T` for assignability only; never set. */
  declare private readonly stands?: T;
  readonly source: string;
  constructor(readonly inner: Pattern<T> | T) {
    this.source = `optional(${inner instanceof Pattern ? inner.source : literalSource(inner as Literal)})`;
  }
}

export function optional<T>(inner: Pattern<T> | T): Optional<T> {
  return new Optional(inner);
}

/**
 * The key for "keys not listed here" in an expected object:
 * `{ id: uuid(), [others]: any(Number) }`. Without it, an unlisted key fails.
 */
export const others: unique symbol = Symbol("others");

/** No other keys: the default for every expected object, written out. */
export function notAllowed(): Pattern<never> {
  return new Pattern<never>("notAllowed()", () => fail("notAllowed()"));
}

/**
 * A pattern that records the value it matched, for use in a later check:
 *
 *     const noteId = capture(uuid());
 *     t.check(note, { id: noteId, title: "Draft" });
 *     t.check(list, [{ id: noteId.value, title: "Draft" }]);
 */
export class Capture<out T> extends Pattern<T> {
  private matched: { value: T } | null = null;

  constructor(readonly inner: Pattern<T>) {
    super(`capture(${inner.source})`, (v) => inner.match(v));
  }

  /** Called by the matcher when this pattern matched `value`. */
  record(value: T): void {
    this.matched = { value };
  }

  /** The value this pattern last matched. Throws if it has not matched. */
  get value(): T {
    if (this.matched === null) throw new Error(`${this.source} has not matched a value yet; run the check that uses it first`);
    return this.matched.value;
  }
}

/** Capture the value `pattern` matches; read it afterwards as `.value`. */
export function capture<T>(pattern: Pattern<T>): Capture<T> {
  return new Capture(pattern);
}

type Hole = Pattern<string> | string;

/**
 * Find a split of `value` into the literal parts and the holes between them
 * where every hole matches. Tries every split (holes are not greedy), so a
 * refined hole never rejects a split that a later hole could absorb.
 */
function splitMatch(value: string, template: { parts: readonly string[]; holes: readonly Hole[] }): string[] | null {
  const { parts, holes } = template;
  const first = parts[0] ?? "";
  if (!value.startsWith(first)) return null;
  const search = (pos: number, i: number): string[] | null => {
    if (i === holes.length) return pos === value.length ? [] : null;
    const next = parts[i + 1] ?? "";
    const hole = holes[i];
    for (let end = pos; end <= value.length; end++) {
      if (!value.startsWith(next, end)) continue;
      const run = value.slice(pos, end);
      const fits = hole instanceof Pattern ? hole.match(run).ok : run === hole;
      if (!fits) continue;
      const rest = search(end + next.length, i + 1);
      if (rest !== null) return [run, ...rest];
    }
    return null;
  };
  return search(first.length, 0);
}

/**
 * A string with patterns inside: ``str`/box/${any(String)}/notes` ``. The
 * string matches when some split of it puts a matching run in every hole.
 * A `capture(...)` hole keeps its run.
 */
export function str(parts: TemplateStringsArray, ...holes: Hole[]): StringPattern {
  let body = parts.raw[0] ?? "";
  for (const [i, hole] of holes.entries()) {
    body += `\${${hole instanceof Pattern ? hole.source : JSON.stringify(hole)}}${parts.raw[i + 1] ?? ""}`;
  }
  const source = `str\`${body}\``;
  return new StringPattern(source, (v) => {
    const runs = splitMatch(v, { parts, holes });
    if (runs === null) return fail(source);
    for (const [i, hole] of holes.entries()) if (hole instanceof Capture) hole.record(runs[i] ?? "");
    return OK;
  });
}
