// Argument shapes `parseArgs` cannot read on its own.

/**
 * `--scene` takes an optional value: alone it outlines every captured frame,
 * `--scene first` only the first one. Rewritten to `--scene=all` and
 * `--scene=first` so `parseArgs` reads it as a string option.
 */
export function sceneArgs(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (const [i, arg] of argv.entries()) {
    if (arg === "first" && argv[i - 1] === "--scene") continue;
    out.push(arg !== "--scene" ? arg : argv[i + 1] === "first" ? "--scene=first" : "--scene=all");
  }
  return out;
}
