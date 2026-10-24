/**
 * Read `--name value` pairs for the flags in `names`, consuming the next
 * argument UNCONDITIONALLY. These values are often a person's own words, and a
 * parser that skips a value beginning with `--` would drop a comment body of
 * "-- actually, no". A flag given twice keeps its last value; a trailing flag
 * with no value reads as "".
 */
export function valueFlags(args: readonly string[], names: ReadonlySet<string>): Map<string, string> {
  const found = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (!names.has(name)) continue;
    found.set(name, args[i + 1] ?? "");
    i += 1;
  }
  return found;
}
