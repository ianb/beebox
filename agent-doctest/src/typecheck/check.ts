/**
 * Typecheck `.doctest.md` files through the module the loader generates.
 *
 * tsx/esbuild strip types without checking them, so a doctest that calls a
 * changed API with the wrong shape fails only when it runs. Checking each
 * fenced block alone would not work: a `continue` block uses names from the
 * block before it. The generated module has the real scope, and its line map
 * puts each diagnostic back on the markdown line.
 *
 * The consumer names the tsconfig. This package never learns a consumer's
 * paths or aliases (the same rule as resolve-rules.ts).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { generateTypecheckModule, DoctestSyntaxError, type GeneratedModule } from "../doctest-hooks/hooks.ts";

export interface DoctestDiagnostic {
  /** Absolute path of the `.doctest.md`. */
  file: string;
  /** 1-based markdown line and column. */
  line: number;
  column: number;
  /** `TS2345`, or `doctest` for a file the loader could not generate. */
  code: string;
  message: string;
  /** The diagnostic fell on code the generator wrote, not on the author's. */
  generated: boolean;
}

export interface TypecheckOptions {
  /** The tsconfig whose compiler options and paths the doctests run under. */
  tsconfig: string;
  /** Absolute `.doctest.md` paths. */
  files: string[];
}

/**
 * Unused-binding diagnostics. On a generated line they name the runner's own
 * bindings (`t`, `print`, `eventually`), which a doctest need not use.
 */
const UNUSED_CODES = new Set([6133, 6138, 6192, 6196, 6198, 6199, 6205]);

/** Declares `t.check()` and `t.checkThrows()` on tap's tests; the runner `--import`s it. */
const TAP_AUGMENTATION = fileURLToPath(new URL("../tap-check/tap.ts", import.meta.url));

/** The virtual TypeScript file that stands for a doctest, beside it so relative imports resolve. */
function virtualPath(mdPath: string): string {
  return `${mdPath}.ts`;
}

function readCompilerOptions(tsconfig: string): { options: ts.CompilerOptions; packageFiles: string[] } {
  const config = ts.readConfigFile(tsconfig, (p) => ts.sys.readFile(p));
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(tsconfig), undefined, tsconfig);
  // TS18003 "no inputs found" does not matter: the doctests are the inputs.
  const first = parsed.errors.find((d) => d.category === ts.DiagnosticCategory.Error && d.code !== 18003);
  if (first) throw new Error(`${tsconfig}: ${ts.flattenDiagnosticMessageText(first.messageText, "\n")}`);
  // Emit settings only: doctests sit outside a package's rootDir (TS6059),
  // and nothing here is emitted. Every checking option is kept as written.
  const { rootDir: _rootDir, outDir: _outDir, declarationDir: _declarationDir, tsBuildInfoFile: _tsBuildInfoFile, ...rest } = parsed.options;
  const options: ts.CompilerOptions = {
    ...rest,
    noEmit: true,
    declaration: false,
    declarationMap: false,
    composite: false,
    incremental: false,
    sourceMap: false,
  };
  // The package's whole program, not just what the doctests import: a
  // `declare module` augmentation or ambient `.d.ts` changes types only when
  // its file is in the program. Only the doctests' own diagnostics are read.
  return { options, packageFiles: parsed.fileNames };
}

interface Generated {
  md: string;
  mod: GeneratedModule;
}

/** The markdown position of a generated position, and whether it was the author's code. */
function mapPosition(mod: GeneratedModule, at: ts.LineAndCharacter): { line: number; column: number; generated: boolean } {
  const { line, character } = at;
  const md = mod.lineMap.md[line];
  if (md !== null && md !== undefined) {
    return { line: md, column: Math.max(0, character - (mod.lineMap.col[line] ?? 0)) + 1, generated: false };
  }
  for (let i = line - 1; i >= 0; i--) {
    const above = mod.lineMap.md[i];
    if (above !== null && above !== undefined) return { line: above, column: 1, generated: true };
  }
  return { line: 1, column: 1, generated: true };
}

/** Typecheck doctests under one tsconfig; diagnostics are on markdown lines, sorted. */
export function typecheckDoctests({ tsconfig, files }: TypecheckOptions): DoctestDiagnostic[] {
  const { options, packageFiles } = readCompilerOptions(resolve(tsconfig));
  const diagnostics: DoctestDiagnostic[] = [];
  const generated = new Map<string, Generated>();
  for (const md of files) {
    try {
      generated.set(virtualPath(md), { md, mod: generateTypecheckModule(readFileSync(md, "utf8"), md) });
    } catch (e) {
      if (!(e instanceof DoctestSyntaxError)) throw e;
      const [first = "", ...rest] = e.message.split("\n");
      const line = Number.parseInt(/:(\d+): /.exec(first)?.[1] ?? "1", 10);
      diagnostics.push({ file: md, line, column: 1, code: "doctest", message: [first.replace(/^\S+:\d+: /, ""), ...rest].join("\n"), generated: false });
    }
  }

  const host = ts.createCompilerHost(options, true);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (p) => generated.has(p) || fileExists.call(host, p);
  host.readFile = (p) => generated.get(p)?.mod.source ?? readFile.call(host, p);
  host.getSourceFile = (...args: Parameters<typeof getSourceFile>) => {
    const [p, languageVersion] = args;
    const virtual = generated.get(p);
    if (virtual) return ts.createSourceFile(p, virtual.mod.source, languageVersion, true);
    return getSourceFile.apply(host, args);
  };

  const program = ts.createProgram({
    rootNames: [...generated.keys(), ...packageFiles, TAP_AUGMENTATION],
    options,
    host,
  });
  for (const optionDiagnostic of program.getOptionsDiagnostics()) {
    throw new Error(`${tsconfig}: ${ts.flattenDiagnosticMessageText(optionDiagnostic.messageText, "\n")}`);
  }

  for (const [path, { md, mod }] of generated) {
    const sourceFile = program.getSourceFile(path);
    if (!sourceFile) throw new Error(`typecheck: ${path} is not in the program`);
    for (const d of [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)]) {
      if (d.category !== ts.DiagnosticCategory.Error) continue;
      const start = d.start ?? 0;
      const at = sourceFile.getLineAndCharacterOfPosition(start);
      const position = mapPosition(mod, at);
      if (position.generated && UNUSED_CODES.has(d.code)) continue;
      diagnostics.push({
        file: md,
        ...position,
        code: `TS${d.code}`,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      });
    }
  }

  return diagnostics.toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
}
