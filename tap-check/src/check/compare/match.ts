/**
 * The structural matcher behind `t.check`: compares an actual value with an
 * expected value, exactly by default.
 *
 * One walk produces four things:
 * - every mismatch, with its path and the constraint that failed;
 * - the expected side of the diff, where each matched pattern shows the
 *   actual value, so the diff shows only real differences;
 * - a suggested expected value, which keeps the patterns that matched and
 *   puts the actual value where something did not.
 *
 * Comparison rules:
 * - An object matches by its own enumerable data, whatever its class.
 *   Function-valued keys are not compared, on either side. A key whose
 *   value is `undefined` is compared: list it as `k: undefined`.
 * - An `Error` compares `name`, `message`, and its own enumerable data.
 * - An unlisted key fails unless the expected object has `[others]`.
 * - Arrays, `Map`s (entry order) and `Set`s (member order) compare by
 *   position; `unordered([...])` compares an array as a multiset, and
 *   `containing([...])` as a sub-multiset.
 * - A `Date` matches an equal `Date` or its ISO string.
 * - Functions, promises, `WeakMap` and `WeakSet` cannot be compared.
 */

import { Unordered } from "../expected.js";
import { REORDERED_PROBLEM, missingKeyProblem, notEqualProblem, sameItemsReordered } from "./hints.js";
import { Capture, ISO_DATE_RE, Optional, Pattern, UUID_RE, others } from "../patterns.js";
import { Call, OTHERS_KEY, Source, render } from "./render.js";
import { dataOf, expectedView, hasKey, hiddenStateProblem, isPlainData, isUncomparable, view } from "./data.js";

/** One place where the actual value does not match. */
export interface Mismatch {
  /** Where, from the root: `$.items[2].id`. */
  path: string;
  /** What was expected there, as source. */
  expected: string;
  /** What is there; absent for a missing key or item. */
  actual?: unknown;
  /** The constraint that failed, in words. */
  problem: string;
}

export interface MatchResult {
  mismatches: Mismatch[];
  /** Paths the suggestion generalized (a UUID string printed as `uuid()`). */
  generalized: string[];
  /** The expected side of the diff, ready for `render`. */
  shown: unknown;
  /** The suggested expected value, ready for `render`. */
  suggested: unknown;
}

const IDENT = /^[$A-Z_a-z][\w$]*$/;

function childPath(path: string, key: string): string {
  return IDENT.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

interface Node {
  shown: unknown;
  suggested: unknown;
}

/** `Object.is`: NaN equals NaN, and -0 does not equal 0. */
function equalPrimitive(actual: unknown, expected: unknown): boolean {
  return Object.is(actual, expected);
}

/** One position being compared. */
interface At<E = unknown> {
  actual: unknown;
  expected: E;
  path: string;
}

function source(value: unknown): string {
  return render(value);
}

class Walker {
  readonly mismatches: Mismatch[] = [];
  readonly generalized: string[] = [];
  /** Objects on the current propose path, so a circular value prints as `[Circular]`. */
  private readonly proposing = new Set<object>();

  private miss(m: Mismatch): void {
    this.mismatches.push(m);
  }

  /** A suggestion for a position with no usable expected value: the actual value, volatile strings generalized. */
  propose(actual: unknown, path: string): unknown {
    if (typeof actual === "string") {
      if (UUID_RE.test(actual)) {
        this.generalized.push(`${path} — UUID string`);
        return new Source("uuid()");
      }
      if (actual.includes("T") && ISO_DATE_RE.test(actual)) {
        this.generalized.push(`${path} — ISO timestamp`);
        return new Source("isoDate()");
      }
      return actual;
    }
    if (actual instanceof Date) {
      this.generalized.push(`${path} — Date`);
      return new Source("isoDate()");
    }
    if (actual === null || typeof actual !== "object" || isUncomparable(actual) || ArrayBuffer.isView(actual)) return view(actual);
    if (this.proposing.has(actual)) return new Source("[Circular]");
    this.proposing.add(actual);
    try {
      if (Array.isArray(actual)) return actual.map((v, i) => this.propose(v, `${path}[${i}]`));
      if (actual instanceof Map) return new Map([...actual].map(([k, v]) => [k, this.propose(v, `${path}.get(${source(k)})`)]));
      if (actual instanceof Set) return new Set([...actual].map((v, i) => this.propose(v, `${path}[${i}]`)));
        const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [k, v] of Object.entries(dataOf(actual))) out[k] = this.propose(v, childPath(path, k));
      return out;
    } finally {
      this.proposing.delete(actual);
    }
  }

  walk(at: At): Node {
    const { actual, expected } = at;
    if (expected instanceof Optional) return this.walk({ ...at, expected: expected.inner });
    if (expected instanceof Pattern) return this.pattern({ ...at, expected });
    if (expected instanceof Unordered) return this.unordered({ ...at, expected });
    if (isUncomparable(actual)) {
      this.miss({ path: at.path, expected: "", actual, problem: "cannot compare a function, promise, WeakMap, or WeakSet; check a projection of it, or use checkText" });
      return { shown: expectedView(expected), suggested: expectedView(expected) };
    }
    if (expected === null || typeof expected !== "object") return this.primitive(at);
    if (expected instanceof Date) return this.date({ ...at, expected });
    if (expected instanceof RegExp) return this.regexp({ ...at, expected });
    if (Array.isArray(expected)) return this.array({ ...at, expected });
    if (expected instanceof Map) return this.map({ ...at, expected });
    if (expected instanceof Set) return this.set({ ...at, expected });
    return this.object({ ...at, expected });
  }

  private typeMismatch(at: At, kind: string): Node {
    this.miss({ path: at.path, expected: kind, actual: at.actual, problem: `expected ${kind}` });
    return { shown: expectedView(at.expected), suggested: this.propose(at.actual, at.path) };
  }

  private pattern({ actual, expected, path }: At<Pattern<unknown>>): Node {
    const result = expected.match(actual);
    if (result.ok) {
      if (expected instanceof Capture) expected.record(actual);
      // A capture is a variable in the test; suggest the pattern it wraps.
      return { shown: actual, suggested: new Source(expected instanceof Capture ? expected.inner.source : expected.source) };
    }
    this.miss({ path, expected: expected.source, actual, problem: `does not match ${result.failed}` });
    return { shown: new Source(expected.source), suggested: this.propose(actual, path) };
  }

  private primitive({ actual, expected, path }: At): Node {
    if (equalPrimitive(actual, expected)) return { shown: expected, suggested: expected };
    if (typeof expected === "string" && actual instanceof Date && !Number.isNaN(actual.getTime()) && actual.toISOString() === expected) {
      return { shown: actual, suggested: expected };
    }
    this.miss({ path, expected: source(expected), actual, problem: notEqualProblem(actual, expected) });
    return { shown: expected, suggested: view(actual) };
  }

  private date({ actual, expected, path }: At<Date>): Node {
    if (actual instanceof Date && Object.is(actual.getTime(), expected.getTime())) return { shown: actual, suggested: expected };
    this.miss({ path, expected: source(expected), actual, problem: "not the same time" });
    return { shown: expected, suggested: view(actual) };
  }

  private regexp({ actual, expected, path }: At<RegExp>): Node {
    if (actual instanceof RegExp && String(actual) === String(expected)) return { shown: actual, suggested: expected };
    this.miss({ path, expected: String(expected), actual, problem: "not the same regular expression" });
    return { shown: expected, suggested: view(actual) };
  }

  private set(at: At<Set<unknown>>): Node {
    if (!(at.actual instanceof Set)) return this.typeMismatch(at, "a Set");
    const node = this.items({ actual: [...at.actual], expected: [...at.expected], path: at.path });
    return { shown: new Set(node.shown), suggested: new Set(node.suggested) };
  }

  private array(at: At<readonly unknown[]>): Node {
    if (!Array.isArray(at.actual)) return this.typeMismatch(at, "an array");
    return this.items({ actual: at.actual, expected: at.expected, path: at.path });
  }

  private items({ actual, expected, path }: { actual: readonly unknown[]; expected: readonly unknown[]; path: string }): { shown: unknown[]; suggested: unknown[] } {
    const shown: unknown[] = [];
    const suggested: unknown[] = [];
    const missesBefore = this.mismatches.length;
    const length = Math.max(actual.length, expected.length);
    for (let i = 0; i < length; i++) {
      const at = `${path}[${i}]`;
      if (i >= actual.length) {
        this.miss({ path: at, expected: source(expectedView(expected[i])), problem: "missing item" });
        shown.push(expectedView(expected[i]));
      } else if (i >= expected.length) {
        this.miss({ path: at, expected: "", actual: actual[i], problem: "unexpected item" });
        suggested.push(this.propose(actual[i], at));
      } else {
        const node = this.walk({ actual: actual[i], expected: expected[i], path: at });
        shown.push(node.shown);
        suggested.push(node.suggested);
      }
    }
    // Only after a real positional mismatch: the hint's comparison is by JSON
    // text, which sees key order the walk does not.
    if (this.mismatches.length > missesBefore && sameItemsReordered(actual, expected)) {
      this.mismatches.splice(missesBefore, 0, { path, expected: "", problem: REORDERED_PROBLEM });
    }
    return { shown, suggested };
  }

  private map(at: At<Map<unknown, unknown>>): Node {
    if (!(at.actual instanceof Map)) return this.typeMismatch(at, "a Map");
    const a = [...at.actual];
    const e = [...at.expected];
    const shown = new Map<unknown, unknown>();
    const suggested = new Map<unknown, unknown>();
    for (let i = 0; i < Math.max(a.length, e.length); i++) {
      const actualEntry = a[i];
      const expectedEntry = e[i];
      if (actualEntry === undefined && expectedEntry !== undefined) {
        this.miss({ path: `${at.path}.get(${source(expectedEntry[0])})`, expected: "", problem: "missing entry" });
        shown.set(expectedEntry[0], expectedView(expectedEntry[1]));
      } else if (actualEntry !== undefined && expectedEntry === undefined) {
        const path = `${at.path}.get(${source(actualEntry[0])})`;
        this.miss({ path, expected: "", actual: actualEntry[1], problem: "unexpected entry" });
        suggested.set(actualEntry[0], this.propose(actualEntry[1], path));
      } else if (actualEntry !== undefined && expectedEntry !== undefined) {
        const path = `${at.path}.get(${source(actualEntry[0])})`;
        if (Object.is(actualEntry[0], expectedEntry[0])) {
          const node = this.walk({ actual: actualEntry[1], expected: expectedEntry[1], path });
          shown.set(expectedEntry[0], node.shown);
          suggested.set(actualEntry[0], node.suggested);
        } else {
          this.miss({ path, expected: source(expectedEntry[0]), actual: actualEntry[0], problem: "different key at this position" });
          shown.set(expectedEntry[0], expectedView(expectedEntry[1]));
          suggested.set(actualEntry[0], this.propose(actualEntry[1], path));
        }
      }
    }
    return { shown, suggested };
  }

  private object(at: At<object>): Node {
    const { actual, expected, path } = at;
    if (actual === null || typeof actual !== "object" || !isPlainData(actual)) return this.typeMismatch(at, "an object");
    const hidden = hiddenStateProblem(actual);
    if (hidden !== null) {
      this.miss({ path, expected: "", actual, problem: `this value ${hidden}` });
      return { shown: expectedView(expected), suggested: expectedView(expected) };
    }
    const data = dataOf(actual);
    const listed = dataOf(expected);
    const rest = (expected as { [others]?: unknown })[others];
    const shown: Record<PropertyKey, unknown> = Object.create(null) as Record<PropertyKey, unknown>;
    const suggested: Record<PropertyKey, unknown> = Object.create(null) as Record<PropertyKey, unknown>;
    // Actual's key order first, so key order never shows as a difference.
    for (const [k, v] of Object.entries(data)) {
      const keyPath = childPath(path, k);
      if (hasKey(listed, k)) {
        const node = this.walk({ actual: v, expected: listed[k], path: keyPath });
        shown[k] = node.shown;
        suggested[k] = node.suggested;
      } else if (rest instanceof Pattern) {
        const before = this.mismatches.length;
        const node = this.pattern({ actual: v, expected: rest, path: keyPath });
        shown[k] = node.shown;
        if (this.mismatches.length > before) suggested[k] = node.suggested;
      } else {
        this.miss({ path: keyPath, expected: "", actual: v, problem: "unexpected key; matching is exact (list it, or add [others])" });
        suggested[k] = this.propose(v, keyPath);
      }
    }
    for (const [k, v] of Object.entries(listed)) {
      if (hasKey(data, k)) continue;
      if (v instanceof Optional) {
        suggested[k] = expectedView(v);
        continue;
      }
      const unlisted = Object.keys(data).filter((key) => !hasKey(listed, key));
      this.miss({ path: childPath(path, k), expected: source(expectedView(v)), problem: missingKeyProblem(k, unlisted) });
      shown[k] = expectedView(v);
    }
    if (rest instanceof Pattern) suggested[OTHERS_KEY] = new Source(rest.source);
    return { shown, suggested };
  }

  private unordered({ actual, expected, path }: At<Unordered<unknown>>): Node {
    if (!Array.isArray(actual)) return this.typeMismatch({ actual, expected, path }, "an array");
    const items = expected.items;
    const name = expected.allowsOthers ? "containing" : "unordered";
    const missesBefore = this.mismatches.length;
    const fits = items.map((item) => actual.map((a, j) => {
      const trial = new Walker();
      trial.walk({ actual: a, expected: item, path: `${path}[${j}]` });
      return trial.mismatches.length === 0;
    }));
    const pairOfActual = maximumMatching(fits, actual.length);
    const shown: unknown[] = [];
    const suggested: unknown[] = [];
    const matchedExpected = new Set<number>();
    for (const [j, a] of actual.entries()) {
      const i = pairOfActual[j];
      if (i === undefined && expected.allowsOthers) {
        shown.push(a);
        // Kept in the suggestion: a failed containing() must not suggest a
        // shorter list that matches anything.
        suggested.push(this.propose(a, `${path}[${j}]`));
        continue;
      }
      if (i === undefined) {
        this.miss({ path: `${path}[${j}]`, expected: "", actual: a, problem: `${name}: no expected item matches this actual item` });
        suggested.push(this.propose(a, `${path}[${j}]`));
        continue;
      }
      matchedExpected.add(i);
      const node = this.walk({ actual: a, expected: items[i], path: `${path}[${j}]` });
      shown.push(node.shown);
      suggested.push(node.suggested);
    }
    for (const [i, item] of items.entries()) {
      if (matchedExpected.has(i)) continue;
      this.miss({ path, expected: source(expectedView(item)), problem: `${name}: no actual item matches this expected item` });
      shown.push(expectedView(item));
    }
    // A failed containing() with nothing to keep suggests the actual empty
    // array, never containing([]), which matches any array.
    if (expected.allowsOthers && suggested.length === 0 && this.mismatches.length > missesBefore) return { shown, suggested };
    return { shown, suggested: new Call(name, suggested) };
  }
}

/**
 * Maximum bipartite matching (augmenting paths): `fits[i][j]` says expected
 * item `i` can match actual item `j`. Returns, per actual index, the expected
 * index matched to it.
 */
function maximumMatching(fits: boolean[][], actualCount: number): Array<number | undefined> {
  const pairOfActual = Array.from<number | undefined>({ length: actualCount });
  const tryAssign = (i: number, visited: Set<number>): boolean => {
    for (let j = 0; j < actualCount; j++) {
      if (!fits[i]?.[j] || visited.has(j)) continue;
      visited.add(j);
      const current = pairOfActual[j];
      if (current === undefined || tryAssign(current, visited)) {
        pairOfActual[j] = i;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < fits.length; i++) tryAssign(i, new Set());
  return pairOfActual;
}

/** Compare `actual` with `expected`. */
export function matchValue(actual: unknown, expected: unknown): MatchResult {
  const walker = new Walker();
  const node = walker.walk({ actual, expected, path: "$" });
  return { mismatches: walker.mismatches, generalized: walker.generalized, shown: node.shown, suggested: node.suggested };
}

/** A suggestion for `actual` when there is no expected value at all. */
export function proposeValue(actual: unknown): { suggested: unknown; generalized: string[] } {
  const walker = new Walker();
  const suggested = walker.propose(actual, "$");
  return { suggested, generalized: walker.generalized };
}
