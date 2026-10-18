/**
 * Type-check one tsconfig project with the TypeScript 7 compiler, in its Go
 * process (`docs/implemented-plans/typescript-7.md`, Track C). One API instance per call:
 * a check is a one-shot command, not a hot path.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { API, DiagnosticCategory, type Diagnostic } from "@typescript/native/unstable/sync";

export interface CompilerError {
  /** Absolute path of the file the error is in (the tsconfig for a config error); undefined for a global error. */
  fileName: string | undefined;
  code: number;
  /** 1-based line of the error's start in `fileName`; undefined for a global error or a file not on disk. */
  line: number | undefined;
  /** That line's text, trimmed; undefined exactly when `line` is. */
  lineText: string | undefined;
  /** The message with its chained detail lines, indented as `tsc` prints them. */
  message: string;
}

/** The project's tsconfig did not load (the API returned no project for it). */
class ProjectNotLoadedError extends Error {
  readonly configPath: string;
  constructor(configPath: string) {
    super(`TypeScript did not load the project ${configPath}`);
    this.name = "ProjectNotLoadedError";
    this.configPath = configPath;
  }
}

function flatten(diagnostic: Diagnostic, depth: number): string {
  const lines = [`${"  ".repeat(depth)}${diagnostic.text}`];
  for (const child of diagnostic.messageChain ?? []) lines.push(flatten(child, depth + 1));
  return lines.join("\n");
}

/** A file's text, or undefined when it is not on disk (a library file bundled with the compiler). */
function readIfPresent(fileName: string): string | undefined {
  try {
    return fs.readFileSync(fileName, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** The 1-based line holding the diagnostic's start, with its trimmed text. */
function locate(
  at: { fileName: string | undefined; pos: number },
  cache: Map<string, string | undefined>,
): { line: number; lineText: string } | undefined {
  const { fileName, pos } = at;
  if (fileName === undefined) return undefined;
  if (!cache.has(fileName)) cache.set(fileName, readIfPresent(fileName));
  const text = cache.get(fileName);
  if (text === undefined) return undefined;
  const before = text.slice(0, pos);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = text.indexOf("\n", pos);
  return {
    line: before.split("\n").length,
    lineText: text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
  };
}

/**
 * Every error `tsc --noEmit -p <configPath>` would report: config, program,
 * syntactic, global, and semantic diagnostics, errors only.
 */
export function typecheckProject(configPath: string): CompilerError[] {
  const api = new API({ cwd: path.dirname(configPath) });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    try {
      const project = snapshot.getProject(configPath);
      if (project === undefined) throw new ProjectNotLoadedError(configPath);
      const { program } = project;
      const diagnostics = [
        ...program.getConfigFileParsingDiagnostics(),
        ...program.getProgramDiagnostics(),
        ...program.getSyntacticDiagnostics(),
        ...program.getGlobalDiagnostics(),
        ...program.getSemanticDiagnostics(),
      ];
      const sources = new Map<string, string | undefined>();
      return diagnostics
        .filter((d) => d.category === DiagnosticCategory.Error)
        .map((d) => {
          const at = locate({ fileName: d.fileName, pos: d.pos }, sources);
          return {
            fileName: d.fileName,
            code: d.code,
            line: at?.line,
            lineText: at?.lineText,
            message: flatten(d, 0),
          };
        });
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

/**
 * The errors `tsc --noEmit` reports in one in-memory source file, checked as if
 * it sat at `relativePath` under the directory of `baseConfigPath`, with that
 * config's options. The native API has no in-memory overlay, so the source is
 * written to a temp directory whose `rootDirs` merge it with the real tree
 * (relative imports resolve as from `relativePath`). The directory sits under
 * the base directory's `node_modules/.cache`, so bare imports resolve through
 * the same `node_modules` chain as the real files. Errors in other files are not reported.
 */
export function typecheckSource(args: { baseConfigPath: string; relativePath: string; source: string }): CompilerError[] {
  const { baseConfigPath, relativePath, source } = args;
  const baseDir = path.dirname(baseConfigPath);
  const cacheDir = path.join(baseDir, "node_modules", ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(cacheDir, "bbx-srctc-"));
  try {
    const filePath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source, "utf8");
    const configPath = path.join(tmpDir, "tsconfig.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        extends: baseConfigPath,
        compilerOptions: { noEmit: true, incremental: false, rootDir: "/", rootDirs: [tmpDir, baseDir] },
        include: [],
        files: [relativePath],
      }),
      "utf8",
    );
    return typecheckProject(configPath).filter((d) => d.fileName === filePath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
