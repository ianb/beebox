/**
 * The differential test for the typed upgrade (plan retire-doctest.md, track
 * V item 2), as a preload for a scratch run of converted tests:
 *
 *   tap --node-arg=--import=tsx \
 *     --node-arg=--import=<repo>/bin/doctest-convert/differential.ts <files>
 *
 * (tsx first: tap puts command-line node args ahead of .taprc's.)
 *
 * A file converted with `differential` calls `__doctestDifferential(actual,
 * probe)` for each check that has a typed form. The probe runs the doctest's
 * own text check as the test's assertion, so the run passes or fails as the
 * doctest did. It then records, as one JSON line in
 * $DOCTEST_DIFFERENTIAL_OUT:
 *
 * - whether the typed check passes on the real value (if not, the check
 *   stays text: the converter's `textOnly`);
 * - whether the value was a promise (the converter's `awaited`);
 * - for mutated copies of the value, each case where the text check fails
 *   but the typed check passes. Each such case is a typed check looser than
 *   the doctest's, which the phase 1 gate forbids.
 *
 * Temporary: deleted with the rest of bin/doctest-convert/ in track 6.
 */

import { appendFileSync } from "node:fs";
import { checkValue, inspect } from "agent-doctest/check";

interface Probe {
  t: { checkText(actual: unknown, expected: string): unknown };
  where: string;
  text: string;
  expected: unknown;
}

interface Mutant {
  op: string;
  path: string;
  value: unknown;
}

const OUT = process.env.DOCTEST_DIFFERENTIAL_OUT;
const MAX_LEAVES = 3;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

type Step = string | number;

/** Paths to the scalar leaves inside arrays and plain objects, depth first. */
function leaves(root: unknown): Step[][] {
  const out: Step[][] = [];
  const walk = (v: unknown, path: Step[]): void => {
    if (out.length > 500) return;
    if (Array.isArray(v)) {
      for (const [i, item] of v.entries()) walk(item, [...path, i]);
    } else if (isPlainObject(v)) {
      for (const [k, item] of Object.entries(v)) walk(item, [...path, k]);
    } else if (v === null || typeof v !== "object") {
      out.push(path);
    }
  };
  walk(root, []);
  return out;
}

/** The path to the first container `want` accepts, depth first. */
function firstContainer(root: unknown, want: (c: unknown) => boolean): Step[] | null {
  const walk = (v: unknown, path: Step[]): Step[] | null => {
    if (want(v)) return path;
    const entries: Array<[Step, unknown]> = Array.isArray(v) ? [...v.entries()] : isPlainObject(v) ? Object.entries(v) : [];
    for (const [k, item] of entries) {
      const found = walk(item, [...path, k]);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root, []);
}

function get(root: unknown, path: Step[]): unknown {
  let cur = root;
  for (const step of path) {
    if (Array.isArray(cur) && typeof step === "number") cur = cur[step];
    else if (isPlainObject(cur) && typeof step === "string") cur = cur[step];
    else return undefined;
  }
  return cur;
}

/** `root` rebuilt with the value at `path` replaced by `edit(old)`; the original is not changed. */
function edited(root: unknown, change: { path: Step[]; edit: (old: unknown) => unknown }): unknown {
  const [step, ...rest] = change.path;
  if (step === undefined) return change.edit(root);
  const inner = { path: rest, edit: change.edit };
  if (Array.isArray(root) && typeof step === "number") return root.map((item, i) => (i === step ? edited(item, inner) : item));
  if (isPlainObject(root) && typeof step === "string") return { ...root, [step]: edited(root[step], inner) };
  return root;
}

function changedLeaf(v: unknown): unknown {
  if (typeof v === "string") return `${v}x`;
  if (typeof v === "number") return Number.isNaN(v) ? 0 : v + 1;
  if (typeof v === "boolean") return !v;
  if (typeof v === "bigint") return v + 1n;
  if (v === null) return 0;
  return null;
}

const addKey = (o: unknown): unknown => (isPlainObject(o) ? { ...o, mutantKey: 1 } : o);
const dropKey = (o: unknown): unknown => (isPlainObject(o) ? Object.fromEntries(Object.entries(o).slice(1)) : o);
const dropItem = (a: unknown): unknown => (Array.isArray(a) ? a.slice(0, -1) : a);
const addItem = (a: unknown): unknown => (Array.isArray(a) ? [...a, a[0]] : a);
const swapFirstTwo = (a: unknown): unknown => (Array.isArray(a) ? [a[1], a[0], ...a.slice(2)] : a);

function mutants(actual: unknown): Mutant[] {
  const out: Mutant[] = [];
  const all = leaves(actual);
  const picks = [...new Set([0, Math.floor(all.length / 2), all.length - 1])].slice(0, MAX_LEAVES);
  for (const i of picks) {
    const path = all[i];
    if (path === undefined) continue;
    const label = path.join(".");
    out.push({ op: "change leaf", path: label, value: edited(actual, { path, edit: changedLeaf }) });
    const leaf = get(actual, path);
    if (typeof leaf === "number" || typeof leaf === "boolean") {
      out.push({ op: "leaf as string", path: label, value: edited(actual, { path, edit: String }) });
    }
  }
  const obj = firstContainer(actual, isPlainObject);
  if (obj !== null) {
    out.push({ op: "add key", path: obj.join("."), value: edited(actual, { path: obj, edit: addKey }) });
    const target = get(actual, obj);
    if (isPlainObject(target) && Object.keys(target).length > 0) {
      out.push({ op: "drop key", path: obj.join("."), value: edited(actual, { path: obj, edit: dropKey }) });
    }
  }
  const arr = firstContainer(actual, (c) => Array.isArray(c) && c.length > 0);
  if (arr !== null) {
    out.push({ op: "drop item", path: arr.join("."), value: edited(actual, { path: arr, edit: dropItem }) });
    out.push({ op: "add item", path: arr.join("."), value: edited(actual, { path: arr, edit: addItem }) });
    const items = get(actual, arr);
    if (Array.isArray(items) && items.length > 1 && JSON.stringify(items[0]) !== JSON.stringify(items[1])) {
      out.push({ op: "reorder", path: arr.join("."), value: edited(actual, { path: arr, edit: swapFirstTwo }) });
    }
  }
  return out;
}

/** The text check as `t.checkText` makes it: a string's trailing newlines are not compared. */
async function textPasses(value: unknown, text: string): Promise<boolean> {
  const v = typeof value === "string" ? value.replace(/\n+$/, "") : value;
  if (typeof v === "function") return false;
  const result = await inspect(v, text);
  return result.pass;
}

function typedPasses(value: unknown, expected: unknown): { pass: boolean; message?: string } {
  try {
    const outcome = checkValue(value, expected);
    // The first mismatch says why: the counts by kind are the API's gaps.
    const first = outcome.pass ? "" : (outcome.mismatches ?? "").split("\n").slice(0, 3).join(" | ");
    return outcome.pass ? { pass: true } : { pass: false, message: `${outcome.message}: ${first}` };
  } catch (e) {
    return { pass: false, message: `threw: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function differential(actualIn: unknown, probe: Probe): Promise<void> {
  const isPromise = actualIn instanceof Promise;
  const actual = isPromise ? await actualIn : actualIn;
  await probe.t.checkText(actual, probe.text);
  if (OUT === undefined) return;
  const textPass = await textPasses(actual, probe.text);
  const typed = typedPasses(actual, probe.expected);
  const looser: Array<{ op: string; path: string }> = [];
  let stricter = 0;
  let tried = 0;
  if (textPass && typed.pass) {
    for (const m of mutants(actual)) {
      tried++;
      const textFails = !(await textPasses(m.value, probe.text));
      const typedFails = !typedPasses(m.value, probe.expected).pass;
      if (textFails && !typedFails) looser.push({ op: m.op, path: m.path });
      if (!textFails && typedFails) stricter++;
    }
  }
  const record = { where: probe.where, isPromise, textPass, typedPass: typed.pass, typedMessage: typed.message, tried, looser, stricter };
  appendFileSync(OUT, `${JSON.stringify(record)}\n`);
}

Object.assign(globalThis, { __doctestDifferential: differential });
