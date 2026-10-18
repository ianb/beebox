/**
 * Syntax trees from the TypeScript 7 compiler, the only way beebox parses
 * TypeScript (`docs/implemented-plans/typescript-7.md`, Track C).
 *
 * TypeScript 7 parses in its Go process; `@typescript/native/unstable/sync`
 * talks to that process over a pipe and returns the tree as JS objects with the
 * same shape as 5.x nodes (`kind`, `parent`, `forEachChild`, `getText`). A
 * parser holds one such process. Its in-memory file system holds only a
 * `tsconfig.json` with `noLib` and `noResolve`, so each snapshot loads just the
 * file being parsed: without that config every snapshot builds an inferred
 * project and a parse costs ~20 ms instead of ~1 ms (measured 2026-10-17).
 *
 * 7.1 drops the `unstable/` prefix; this file and its siblings are the only
 * importers of `@typescript/native` (enforced in eslint.config.ts).
 */
import { API } from "@typescript/native/unstable/sync";
import type { SourceFile } from "@typescript/native/unstable/ast";

export * from "@typescript/native/unstable/ast";

/** `fileName` is the file asked for; `reason` says why it has no tree. */
export class ParseError extends Error {
  readonly fileName: string;
  constructor(fileName: string, reason: string) {
    super(`Cannot parse ${fileName}: ${reason}`);
    this.name = "ParseError";
    this.fileName = fileName;
  }
}

export type Parse = (params: { fileName: string; sourceText: string }) => SourceFile;

export interface Parser {
  parse: Parse;
  /** Stops the Go process. Trees already returned stay readable. */
  close(): void;
}

const ROOT = "/parse";
const CONFIG = `${ROOT}/tsconfig.json`;
const CONFIG_TEXT = JSON.stringify({
  compilerOptions: { noLib: true, noResolve: true, types: [], allowJs: true, jsx: "preserve" },
  include: ["*"],
});

/**
 * The in-memory name for one parse: a fresh name each time (reusing a name
 * returned the previous tree, measured 2026-10-17), lowercase, and keeping the
 * extension, which decides TS/TSX/JS and declaration parsing.
 */
function memoryName(index: number, fileName: string): string {
  const lower = fileName.toLowerCase();
  const suffix = [".d.ts", ".d.mts", ".d.cts", ".tsx", ".mts", ".cts", ".ts", ".jsx", ".mjs", ".cjs", ".js"].find((s) =>
    lower.endsWith(s),
  );
  if (suffix === undefined) throw new ParseError(fileName, "not a TypeScript or JavaScript file name");
  return `${ROOT}/f${String(index)}${suffix}`;
}

export function createParser(): Parser {
  const files = new Map<string, string>([[CONFIG, CONFIG_TEXT]]);
  const api = new API({
    cwd: ROOT,
    fs: {
      readFile: (path) => files.get(path),
      fileExists: (path) => files.has(path),
      directoryExists: (path) => path === "/" || path === ROOT,
      getAccessibleEntries: (path) =>
        path === ROOT
          ? { files: [...files.keys()].map((name) => name.slice(ROOT.length + 1)), directories: [] }
          : { files: [], directories: path === "/" ? [ROOT.slice(1)] : [] },
      realpath: (path) => path,
    },
  });
  let count = 0;
  return {
    parse({ fileName, sourceText }) {
      const name = memoryName(count, fileName);
      count += 1;
      files.set(name, sourceText);
      const snapshot = api.updateSnapshot({ openFiles: [name], fileChanges: { created: [name] } });
      try {
        const file = snapshot.getDefaultProjectForFile(name)?.program.getSourceFile(name);
        if (file === undefined) throw new ParseError(fileName, "TypeScript returned no syntax tree");
        return file;
      } finally {
        api.updateSnapshot({ closeFiles: [name], fileChanges: { deleted: [name] } }).dispose();
        snapshot.dispose();
        files.delete(name);
      }
    },
    close: () => {
      api.close();
    },
  };
}
