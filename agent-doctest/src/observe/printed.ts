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
  /** The printed lines plus `value`, as one text; the lines are consumed. */
  with(this: void, value: unknown): unknown;
}

export function printed(): Printed {
  const lines: string[] = [];
  return {
    print: (line) => void lines.push(String(line)),
    with: (value) => {
      if (lines.length === 0) return value;
      const out = lines.splice(0);
      if (typeof value === "string") out.push(value.replace(/\n+$/, ""));
      else if (value !== undefined && value !== null) {
        try {
          out.push(JSON.stringify(value, null, 2));
        } catch {
          out.push(String(value));
        }
      }
      return out.join("\n");
    },
  };
}
