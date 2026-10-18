/**
 * Type-check one tsconfig project with the TypeScript 7 compiler, in its Go
 * process (`docs/implemented-plans/typescript-7.md`, Track C). One API instance per call:
 * a check is a one-shot command, not a hot path.
 */
import * as path from "node:path";
import { API, DiagnosticCategory, type Diagnostic } from "@typescript/native/unstable/sync";

export interface CompilerError {
  /** Absolute path of the file the error is in (the tsconfig for a config error); undefined for a global error. */
  fileName: string | undefined;
  code: number;
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
      return diagnostics
        .filter((d) => d.category === DiagnosticCategory.Error)
        .map((d) => ({ fileName: d.fileName, code: d.code, message: flatten(d, 0) }));
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}
