#!/usr/bin/env node --import tsx
/**
 * `pnpm ui-check`: every component and hook exported from `components/ui/` is
 * named in `frontend.md`, and every `<Name>` its primitives section lists is
 * an export. Prints each breach and exits 1; prints nothing when clean.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseSourceFile } from "../layout/scan/imports.js";
import { docCoverageProblems, UI_INTERNALS, type UiExport, type UiImport } from "./doc-coverage.js";
import { ALL_EXPORTS, exportedValueNames, importedNames, isDocumentedKind } from "./exports.js";

const BEEBOX = resolve(import.meta.dirname, "../../..");
const COMPONENTS = join(BEEBOX, "src/frontend/src/components");
const UI = join(COMPONENTS, "ui");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function parse(path: string, sourceText: string) {
  return parseSourceFile({ fileName: path, sourceText });
}

function uiExports(): UiExport[] {
  return sourceFiles(UI).flatMap((path) =>
    exportedValueNames(parse(path, readFileSync(path, "utf8")))
      .filter(isDocumentedKind)
      .map((name) => ({ name, file: relative(UI, path) })),
  );
}

/** Imports of allow-listed names from `components/ui/`, in every frontend file that mentions one. */
function internalImports(): UiImport[] {
  const names = new Set(UI_INTERNALS.map((entry) => entry.name));
  const found: UiImport[] = [];
  for (const path of sourceFiles(join(BEEBOX, "src/frontend/src"))) {
    const text = readFileSync(path, "utf8");
    if (!text.includes("import * as") && ![...names].some((name) => text.includes(name))) continue;
    for (const use of importedNames(parse(path, text))) {
      if (!(names.has(use.name) || use.name === ALL_EXPORTS) || !use.specifier.startsWith(".")) continue;
      const target = resolve(dirname(path), use.specifier);
      if (target === UI || target.startsWith(`${UI}/`)) {
        for (const name of use.name === ALL_EXPORTS ? names : [use.name]) found.push({ name, file: relative(COMPONENTS, path) });
      }
    }
  }
  return found;
}

const problems = docCoverageProblems({
  exports: uiExports(),
  doc: readFileSync(join(BEEBOX, "frontend.md"), "utf8"),
  internalImports: internalImports(),
});
for (const problem of problems) process.stderr.write(`ui-check: ${problem}\n`);
process.exit(problems.length === 0 ? 0 : 1);
