/**
 * Collect the numbers behind the project size report (`dev/project-size/`).
 *
 * Every tracked file is classified once (code, tests, docs of several kinds,
 * config, lockfile, binary) and counted in non-blank lines. The result is a
 * set of named datasets, each a small table the report page can place
 * anywhere with a ```dataset <name>``` block, plus a flat `values` map for
 * single numbers written inline as `{{name}}`. A dated snapshot is kept so the
 * `history` dataset can show growth over time.
 *
 *   pnpm project-size          write dev/project-size/data/latest.json
 *
 * To add a dataset: compute it below and add it to `datasets`. The page needs
 * no change; the commentary in `dev/project-size/report.markdown` decides where it
 * appears.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { addToBranch, newBranch, toTreeNode, type Tree, type TreeCategory } from "./lib/project-size-tree.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(repoRoot, "dev", "project-size", "data");
const historyDir = path.join(outDir, "history");

type Category =
  | "code"
  | "tests"
  | "docs: plans & reports"
  | "docs: issues"
  | "docs: guides & other"
  | "docs: research"
  | "docs: agent instructions"
  | "config & data"
  | "lockfiles"
  | "binary";

type TestKind = "doctest (markdown)" | "*.test.ts code" | "test helper code" | "test fixtures & data";

interface Column {
  key: string;
  label: string;
  /** Numbers are right-aligned and grouped; the bar column draws a bar. */
  numeric?: boolean;
  /** Round shown values to this unit (line counts use 1000). */
  round?: number;
}

interface Dataset {
  title: string;
  columns: Column[];
  rows: Record<string, string | number>[];
  /** The numeric column the page draws bars for, when any. */
  bar?: string;
}

interface Snapshot {
  collectedAt: string;
  commit: string;
  values: Record<string, number>;
  datasets: Record<string, Dataset>;
  trees: Record<string, Tree>;
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".swift", ".css", ".sh", ".html", ".py"]);
const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json"]);

function isTestPath(file: string): boolean {
  const base = path.basename(file);
  return file.endsWith(".doctest.md") || base.includes(".test.") || `/${file}`.includes("/test/") || `/${file}`.includes("/tests/");
}

function categorize(file: string): Category {
  const base = path.basename(file);
  const ext = path.extname(file);
  if (LOCKFILES.has(base)) return "lockfiles";
  if (isTestPath(file)) return "tests";
  if (ext === ".md") {
    if (file.startsWith("issues/")) return "docs: issues";
    if (file.startsWith("research/")) return "docs: research";
    if (base === "CLAUDE.md" || base === "AGENTS.md" || base === "SKILL.md" || file.startsWith(".claude/")) return "docs: agent instructions";
    if (/(^|\/)(plans|implemented-plans|unimplemented-plans|reports)\//.test(file)) return "docs: plans & reports";
    return "docs: guides & other";
  }
  if (CODE_EXTENSIONS.has(ext)) return "code";
  return "config & data";
}

function testKind(file: string): TestKind {
  if (file.endsWith(".md")) return "doctest (markdown)";
  if (path.basename(file).includes(".test.")) return "*.test.ts code";
  if (CODE_EXTENSIONS.has(path.extname(file))) return "test helper code";
  return "test fixtures & data";
}

/** Non-blank lines, or null for a binary file (a NUL in the first 2 KB). */
function countLines(file: string): number | null {
  const data = fs.readFileSync(path.join(repoRoot, file));
  if (data.subarray(0, 2048).includes(0)) return null;
  let lines = 0;
  for (const line of data.toString("utf8").split("\n")) if (line.trim() !== "") lines += 1;
  return lines;
}

/** A doctest's non-blank lines, split into fenced code (fence markers included) and the prose around it. */
function splitDoctest(file: string): { code: number; prose: number } {
  let inFence = false;
  let code = 0;
  let prose = 0;
  for (const line of fs.readFileSync(path.join(repoRoot, file), "utf8").split("\n")) {
    if (line.trim() === "") continue;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      code += 1;
      continue;
    }
    if (inFence) code += 1;
    else prose += 1;
  }
  return { code, prose };
}

/**
 * Keep the rows whose `measure` is at least `min`; fold the rest into one
 * "other" row, so small directories and rare extensions do not crowd the table
 * while totals stay whole.
 */
function foldSmall(rows: Record<string, string | number>[], options: { label: string; measure: string; min: number }): Record<string, string | number>[] {
  const { label, measure, min } = options;
  const kept = rows.filter((row) => Number(row[measure]) >= min);
  const small = rows.filter((row) => Number(row[measure]) < min);
  if (small.length === 0) return kept;
  const other: Record<string, string | number> = { [label]: `other (${String(small.length)} small)` };
  for (const row of small) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number") other[key] = Number(other[key] ?? 0) + value;
    }
  }
  return [...kept, other];
}

function treeCategory(category: Category): TreeCategory | null {
  if (category === "code" || category === "tests") return category;
  return category.startsWith("docs") ? "docs" : null;
}

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return out.split("\0").filter((file) => file !== "" && fs.statSync(path.join(repoRoot, file), { throwIfNoEntry: false })?.isFile() === true);
}

/** Count one more file of `lines` lines under `key`. */
function bump<K>(map: Map<K, { files: number; lines: number }>, { key, lines }: { key: K; lines: number }): void {
  const entry = map.get(key) ?? { files: 0, lines: 0 };
  entry.files += 1;
  entry.lines += lines;
  map.set(key, entry);
}

function readHistory(): Snapshot[] {
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir)
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .map((name) => {
      // eslint-disable-next-line no-restricted-syntax -- this script is the only writer of these files, in the Snapshot shape
      return JSON.parse(fs.readFileSync(path.join(historyDir, name), "utf8")) as Snapshot;
    });
}

function collect(): Snapshot {
  const byCategory = new Map<Category, { files: number; lines: number }>();
  const byTestKind = new Map<TestKind, { files: number; lines: number }>();
  const byLanguage = new Map<string, { files: number; lines: number }>();
  const byPackage = new Map<string, Map<string, number>>();
  const testFilesByPackage = new Map<string, number>();
  const doctestSplit = { code: 0, prose: 0 };
  const repoTree = newBranch();
  const beeboxTree = newBranch();

  for (const file of trackedFiles()) {
    const counted = countLines(file);
    const category: Category = counted === null ? "binary" : categorize(file);
    const lines = counted ?? 0;
    bump(byCategory, { key: category, lines });
    const pkg = file.includes("/") ? file.slice(0, file.indexOf("/")) : "(root)";
    const group = category.startsWith("docs") ? "docs" : category;
    const pkgCounts = byPackage.get(pkg) ?? new Map<string, number>();
    pkgCounts.set(group, (pkgCounts.get(group) ?? 0) + lines);
    byPackage.set(pkg, pkgCounts);
    if (category === "tests") {
      bump(byTestKind, { key: testKind(file), lines });
      if (path.basename(file).includes(".test.")) testFilesByPackage.set(pkg, (testFilesByPackage.get(pkg) ?? 0) + 1);
      if (file.endsWith(".md")) {
        const split = splitDoctest(file);
        doctestSplit.code += split.code;
        doctestSplit.prose += split.prose;
      }
    }
    if (category === "code") bump(byLanguage, { key: path.extname(file), lines });
    const treeCat = treeCategory(category);
    if (treeCat !== null && lines > 0) {
      const dirs = path.dirname(file).split("/").filter((segment) => segment !== ".");
      addToBranch(repoTree, { segments: dirs.slice(0, 2), category: treeCat, lines });
      // A nested `src/` (beebox/src/frontend/src) would spend a level on nothing.
      const inner = dirs.slice(1).filter((segment, i) => i === 0 || segment !== "src");
      if (dirs[0] === "beebox") addToBranch(beeboxTree, { segments: inner.slice(0, 3), category: treeCat, lines });
    }
  }

  const total = [...byCategory.values()].reduce((sum, entry) => ({ files: sum.files + entry.files, lines: sum.lines + entry.lines }), { files: 0, lines: 0 });
  const get = <K>(map: Map<K, { files: number; lines: number }>, key: K) => map.get(key) ?? { files: 0, lines: 0 };
  const docsLines = [...byCategory].filter(([category]) => category.startsWith("docs")).reduce((sum, [, entry]) => sum + entry.lines, 0);
  const testLines = get(byCategory, "tests").lines;

  const values: Record<string, number> = {
    "files": total.files,
    "lines": total.lines,
    "code.lines": get(byCategory, "code").lines,
    "code.files": get(byCategory, "code").files,
    "tests.lines": testLines,
    "tests.files": get(byCategory, "tests").files,
    "docs.lines": docsLines,
    "doctest.lines": get(byTestKind, "doctest (markdown)").lines,
    "doctest.files": get(byTestKind, "doctest (markdown)").files,
    "testts.files": get(byTestKind, "*.test.ts code").files,
    "testts.lines": get(byTestKind, "*.test.ts code").lines,
    "doctest.percent": testLines === 0 ? 0 : Math.round((100 * get(byTestKind, "doctest (markdown)").lines) / testLines),
    "doctest.code.lines": doctestSplit.code,
    "doctest.prose.lines": doctestSplit.prose,
    "doctest.prose.percent": doctestSplit.code + doctestSplit.prose === 0 ? 0 : Math.round((100 * doctestSplit.prose) / (doctestSplit.code + doctestSplit.prose)),
    "tests.codeOnly.lines": testLines - doctestSplit.prose,
    "tests.codeOnly.percentOfCode": get(byCategory, "code").lines === 0 ? 0 : Math.round((100 * (testLines - doctestSplit.prose)) / get(byCategory, "code").lines),
  };

  const countRows = <K extends string>(map: Map<K, { files: number; lines: number }>, label: string) =>
    [...map].toSorted(([, a], [, b]) => b.lines - a.lines).map(([key, entry]) => ({ [label]: key, files: entry.files, lines: entry.lines }));
  const lines = (key: string, label: string): Column => ({ key, label, numeric: true, round: 1000 });
  const filesAndLines = (first: Column): Column[] => [first, { key: "files", label: "Files", numeric: true }, lines("lines", "Non-blank lines")];

  const packageRows = [...byPackage]
    .map(([pkg, counts]) => ({
      package: pkg,
      code: counts.get("code") ?? 0,
      tests: counts.get("tests") ?? 0,
      docs: counts.get("docs") ?? 0,
    }))
    .map((row) => ({ ...row, total: row.code + row.tests + row.docs }))
    .filter((row) => row.total > 0)
    .toSorted((a, b) => b.total - a.total);

  const beeboxTotal = packageRows.find((row) => row.package === "beebox")?.total ?? 0;
  values["beebox.percent"] = total.lines === 0 ? 0 : Math.round((100 * beeboxTotal) / total.lines);
  const history = readHistory();
  const datasets: Record<string, Dataset> = {
    byCategory: {
      title: "Tracked files by category",
      columns: filesAndLines({ key: "category", label: "Category" }),
      rows: countRows(byCategory, "category"),
      bar: "lines",
    },
    byPackage: {
      title: "Non-blank lines by package",
      columns: [
        { key: "package", label: "Package" },
        lines("code", "Code"),
        lines("tests", "Tests"),
        lines("docs", "Docs"),
        lines("total", "Total"),
      ],
      rows: foldSmall(packageRows, { label: "package", measure: "total", min: 5000 }),
      bar: "total",
    },
    testsByKind: {
      title: "Tests by kind (doctests split into fenced code and prose)",
      columns: filesAndLines({ key: "kind", label: "Kind" }),
      rows: [
        { kind: "doctest code (inside fences)", files: get(byTestKind, "doctest (markdown)").files, lines: doctestSplit.code },
        { kind: "doctest prose", files: 0, lines: doctestSplit.prose },
        ...countRows(byTestKind, "kind").filter((row) => row.kind !== "doctest (markdown)"),
      ],
      bar: "lines",
    },
    testTsByPackage: {
      title: "*.test.ts files by package",
      columns: [{ key: "package", label: "Package" }, { key: "files", label: "Files", numeric: true }],
      rows: foldSmall([...testFilesByPackage].toSorted(([, a], [, b]) => b - a).map(([pkg, files]) => ({ package: pkg, files })), { label: "package", measure: "files", min: 3 }),
      bar: "files",
    },
    codeByExtension: {
      title: "Code by file extension",
      columns: filesAndLines({ key: "extension", label: "Extension" }),
      rows: foldSmall(countRows(byLanguage, "extension"), { label: "extension", measure: "lines", min: 1000 }),
      bar: "lines",
    },
    history: {
      title: "Size over time (one snapshot per collection day)",
      columns: [
        { key: "date", label: "Date" },
        lines("code", "Code"),
        lines("tests", "Tests"),
        lines("docs", "Docs"),
        lines("lines", "All lines"),
      ],
      rows: history.map((snapshot) => ({
        date: snapshot.collectedAt.slice(0, 10),
        code: snapshot.values["code.lines"] ?? 0,
        tests: snapshot.values["tests.lines"] ?? 0,
        docs: snapshot.values["docs.lines"] ?? 0,
        lines: snapshot.values["lines"] ?? 0,
      })),
      bar: "lines",
    },
  };

  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot }).toString("utf8").trim();
  const trees: Record<string, Tree> = {
    repo: { title: "The monorepo: packages and their top-level directories", root: toTreeNode("monorepo", { branch: repoTree, min: 4000 }) },
    beebox: { title: "Inside beebox/: three directory levels", root: toTreeNode("beebox", { branch: beeboxTree, min: 1500 }) },
  };
  return { collectedAt: new Date().toISOString(), commit, values, datasets, trees };
}

function main(): void {
  fs.mkdirSync(historyDir, { recursive: true });
  const first = collect();
  // The history dataset reads the snapshots on disk, so write today's first
  // and collect again: today's row then appears in its own report.
  const day = first.collectedAt.slice(0, 10);
  const { history: _history, ...withoutHistory } = first.datasets;
  fs.writeFileSync(path.join(historyDir, `${day}.json`), `${JSON.stringify({ ...first, datasets: withoutHistory, trees: {} }, null, 1)}\n`);
  const snapshot = collect();
  fs.writeFileSync(path.join(outDir, "latest.json"), `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`project-size: ${String(snapshot.values["files"])} files, ${String(snapshot.values["lines"])} non-blank lines (${snapshot.commit}) → dev/project-size/data/latest.json`);
}

main();
