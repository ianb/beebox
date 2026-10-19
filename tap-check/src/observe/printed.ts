/**
 * `printed()`: the `print()` of a doctest, for a converted test. Lines
 * printed since the last check are joined, with the checked value, into
 * the text that check compares (doctest-runtime.ts `__doctest_withPrints`).
 *
 *   const out = printed();
 *   const print = out.print;
 *   print("first");
 *   await t.checkText(out.with(value), `first
 *   value`);
 *
 * A new test should check values with `t.check` instead.
 */

export interface Printed {
  print(this: void, line: unknown): void;
  /** The printed lines plus `value`, joined with newlines; the lines are consumed. */
  with(this: void, value: string): string;
}

export function printed(): Printed {
  const lines: string[] = [];
  return {
    print: (line) => void lines.push(String(line)),
    with: (value) => [...lines.splice(0), value.replace(/\n+$/, "")].join("\n"),
  };
}
