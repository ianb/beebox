/**
 * doctest-to-ts: convert `.doctest.md` files to `.test.ts` files.
 *
 *   doctest-to-ts [--manifest-dir DIR] [--force] <file.doctest.md>...
 *
 * Writes `<name>.test.ts` beside each doctest. With `--manifest-dir`, also
 * writes each manifest there as `<repo-relative path>.json`. An existing
 * `.test.ts` is an error unless `--force`. Prints one line per file that
 * fails to convert, and exits 1 when any did.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { convertDoctest } from "../doctest-hooks/hooks.ts";

interface Args {
  manifestDir: string | null;
  force: boolean;
  files: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { manifestDir: null, force: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--manifest-dir") args.manifestDir = resolve(argv[++i] ?? "");
    else if (arg === "--force") args.force = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else args.files.push(resolve(arg));
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
let failed = 0;
for (const file of args.files) {
  const target = file.replace(/\.doctest\.md$/, ".test.ts");
  try {
    if (target === file) throw new Error("not a .doctest.md file");
    if (existsSync(target) && !args.force) throw new Error(`${relative(process.cwd(), target)} already exists`);
    const { source, manifest } = convertDoctest(readFileSync(file, "utf8"), { filePath: file });
    writeFileSync(target, source);
    if (args.manifestDir !== null) {
      const out = join(args.manifestDir, `${relative(process.cwd(), file)}.json`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify({ ...manifest, doctest: relative(process.cwd(), file) }, null, 2)}\n`);
    }
  } catch (e) {
    failed++;
    const message = e instanceof Error ? `${e.name}: ${e.message.split("\n")[0]}` : String(e);
    console.log(`FAIL ${relative(process.cwd(), file)}: ${message}`);
  }
}
console.log(`converted ${args.files.length - failed} of ${args.files.length}`);
process.exitCode = failed > 0 ? 1 : 0;
