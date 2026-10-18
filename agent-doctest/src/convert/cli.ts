/**
 * doctest-to-ts: convert `.doctest.md` files to `.test.ts` files.
 *
 *   doctest-to-ts [--manifest-dir DIR] [--force] [--upgrade [--differential]]
 *                 [--text-only FILE] [--awaited FILE] <file.doctest.md>...
 *
 * Writes `<name>.test.ts` beside each doctest. With `--manifest-dir`, also
 * writes each manifest there as `<cwd-relative path>.json`. An existing
 * `.test.ts` is an error unless `--force`. Prints one line per file that
 * fails to convert, and exits 1 when any did.
 *
 * `--upgrade` emits `t.check` for expected text that reads as a value;
 * `--differential` emits the differential probes instead (scratch runs
 * only). `--text-only` and `--awaited` name JSON files mapping a
 * cwd-relative doctest path to doctest lines: checks to keep as text, and
 * checks whose value is a promise.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { convertDoctest } from "./test-file.ts";

interface Args {
  manifestDir: string | null;
  force: boolean;
  upgrade: boolean;
  differential: boolean;
  textOnly: Record<string, number[]>;
  awaited: Record<string, number[]>;
  files: string[];
}

/** A JSON file mapping doctest paths to line numbers. */
function readLines(file: string): Record<string, number[]> {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error(`${file}: expected an object of line lists`);
  const out: Record<string, number[]> = {};
  for (const [path, lines] of Object.entries(parsed)) {
    if (!Array.isArray(lines) || !lines.every((l) => typeof l === "number")) throw new Error(`${file}: ${path} is not a list of line numbers`);
    out[path] = lines;
  }
  return out;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { manifestDir: null, force: false, upgrade: false, differential: false, textOnly: {}, awaited: {}, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--manifest-dir") args.manifestDir = resolve(argv[++i] ?? "");
    else if (arg === "--force") args.force = true;
    else if (arg === "--upgrade") args.upgrade = true;
    else if (arg === "--differential") args.differential = true;
    else if (arg === "--text-only") args.textOnly = readLines(argv[++i] ?? "");
    else if (arg === "--awaited") args.awaited = readLines(argv[++i] ?? "");
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
    const rel = relative(process.cwd(), file);
    const { source, manifest } = convertDoctest(readFileSync(file, "utf8"), {
      filePath: file,
      upgrade: args.upgrade,
      differential: args.differential,
      textOnly: new Set(args.textOnly[rel]),
      awaited: new Set(args.awaited[rel]),
    });
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
