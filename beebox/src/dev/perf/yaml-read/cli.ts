/**
 * `pnpm perf:yaml-read` — check and time the read-only YAML parser.
 *
 *   pnpm perf:yaml-read                          # the worktree test1 clone
 *   pnpm perf:yaml-read -- <dir> [<dir> ...]     # other boxes or source trees
 *
 * `parseYaml` (`src/lib/read-yaml.ts`) parses with js-yaml and hands `yaml`
 * any text the two could read differently, so it must return exactly what
 * `yaml.parse` returns. This reads every `.card`/`.md` frontmatter block and
 * every `.yaml`/`.yml` file under the given directories, compares the two
 * parsers' values and errors, and times each over all inputs. It prints
 * differing paths only, never content (box content is private), and exits 1
 * on any difference. Run it after upgrading js-yaml or `yaml`, or after
 * editing the fallback pattern. See `docs/development/performance.md`.
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { parse } from "yaml";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { parseYaml } from "../../../lib/read-yaml.js";
import { errorMessage } from "../../../shared/error-guards.js";
import { ensurePerfBox } from "../local-hub.js";
import { median } from "../report.js";

const SKIP = new Set([".git", "node_modules", ".beebox", "dist"]);
const MAX_BYTES = 2_000_000;

async function* yamlInputs(dir: string): AsyncGenerator<{ file: string; text: string }> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* yamlInputs(file);
    } else if (entry.isFile() && /\.(?:card|md|ya?ml)$/.test(entry.name)) {
      const content = await readFile(file, "utf8");
      if (content.length > MAX_BYTES) continue;
      if (/\.ya?ml$/.test(entry.name)) {
        yield { file, text: content };
      } else {
        const split = splitCardContent(content);
        if (split.hasFrontmatter) yield { file, text: split.frontmatterText };
      }
    }
  }
}

type Outcome = { value: unknown } | { error: string };

function outcome(parser: (text: string) => unknown, text: string): Outcome {
  try {
    return { value: parser(text) };
  } catch (e) {
    return { error: `${e instanceof Error ? e.name : "thrown"}: ${errorMessage(e)}` };
  }
}

function timeAll(parser: (text: string) => unknown, texts: string[]): number {
  const started = performance.now();
  for (const text of texts) outcome(parser, text);
  return Math.round(performance.now() - started);
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true });
  const box = positionals.length > 0 ? undefined : await ensurePerfBox(false);
  const roots = positionals.length > 0 ? positionals : box === undefined ? [] : [box];
  if (roots.length === 0) {
    console.error("no worktree test box clone; pass directories to read");
    process.exit(1);
  }
  // `yaml` reports an unresolved tag as a process warning; the comparison is
  // of values and errors, so the warning is not part of the output.
  process.removeAllListeners("warning");
  const texts: string[] = [];
  const differing: string[] = [];
  for (const root of roots) {
    for await (const { file, text } of yamlInputs(path.resolve(root))) {
      texts.push(text);
      if (!isDeepStrictEqual(outcome(parse, text), outcome(parseYaml, text))) differing.push(file);
    }
  }
  const runs = [0, 1, 2];
  const yamlMs = median(runs.map(() => timeAll(parse, texts)));
  const readMs = median(runs.map(() => timeAll(parseYaml, texts)));
  console.log(`${texts.length} inputs, ${differing.length} differing`);
  console.log(`yaml.parse ${yamlMs} ms, parseYaml ${readMs} ms (median of ${runs.length} passes)`);
  for (const file of differing) console.log(`differs: ${file}`);
  if (differing.length > 0) process.exit(1);
}

await main();
