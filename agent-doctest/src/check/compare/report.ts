/**
 * `checkValue`: compare a whole value with a typed expected value and build
 * the failure report. The tap method `t.check` (src/tap-check/tap.ts) is a
 * thin wrapper that reports the outcome as a test point.
 */

import { buildDiff } from "../../tap-check/diff.js";
import { matchValue, proposeValue, type Mismatch } from "./match.js";
import { view } from "./data.js";
import { Pattern } from "../patterns.js";
import { render } from "./render.js";

/** Passed for `expected` when the caller gave none. */
export const NO_EXPECTED: unique symbol = Symbol("no expected value");

export type CheckValueOutcome =
  | { pass: true }
  | {
      pass: false;
      /** One line saying why. */
      message: string;
      /** Each mismatch: path, constraint, and actual value. */
      mismatches?: string;
      /** Line diff of actual against expected, where matched patterns show the actual value. */
      diff?: string;
      /** A paste-ready expected value. */
      suggested: string;
      /** Paths the suggestion generalized, which the author should confirm. */
      generalized?: string;
    };

/** How many mismatches the report lists before summarizing the rest. */
const MAX_LISTED = 20;

function describe(m: Mismatch): string {
  const lines = [`${m.path}: ${m.problem}`];
  if (m.expected !== "") lines.push(`  expected: ${m.expected.replaceAll("\n", "\n  ")}`);
  if ("actual" in m) lines.push(`  actual: ${render(view(m.actual)).replaceAll("\n", "\n  ")}`);
  return lines.join("\n");
}

function listMismatches(mismatches: Mismatch[]): string {
  const listed = mismatches.slice(0, MAX_LISTED).map(describe);
  if (mismatches.length > MAX_LISTED) listed.push(`… ${mismatches.length - MAX_LISTED} more; the diff shows all of them`);
  return listed.join("\n");
}

function generalizedNote(generalized: string[]): { generalized?: string } {
  return generalized.length === 0 ? {} : { generalized: generalized.join("\n") };
}

/** Compare `actual` with `expected`, or suggest an expected value when there is none. */
export function checkValue(actual: unknown, expected: unknown): CheckValueOutcome {
  if (expected === NO_EXPECTED) {
    const proposal = proposeValue(actual);
    return {
      pass: false,
      message: "check() has no expected value; read the suggested value, then pass it as the second argument",
      suggested: render(proposal.suggested),
      ...generalizedNote(proposal.generalized),
    };
  }
  if (expected instanceof Pattern && expected.source === "anything()") {
    return { pass: false, message: "check(x, anything()) checks nothing; write the expected value", suggested: render(proposeValue(actual).suggested) };
  }
  const result = matchValue(actual, expected);
  if (result.mismatches.length === 0) return { pass: true };
  const count = result.mismatches.length;
  return {
    pass: false,
    message: `check failed: ${count} ${count === 1 ? "mismatch" : "mismatches"}`,
    mismatches: listMismatches(result.mismatches),
    diff: buildDiff(render(view(actual)), render(view(result.shown))),
    suggested: render(result.suggested),
    ...generalizedNote(result.generalized),
  };
}
