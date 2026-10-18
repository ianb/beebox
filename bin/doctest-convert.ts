/**
 * The doctest conversion driver (plan beebox/docs/plans/retire-doctest.md,
 * track 3). Temporary: track 6 deletes it with `bin/doctest-convert/`.
 *
 *   node --import tsx bin/doctest-convert.ts prepare <dir>
 *       Convert the directory's doctests, record them in
 *       bin/doctest-convert/state/<dir>.json, delete the doctests, and verify.
 *   node --import tsx bin/doctest-convert.ts verify <dir|file>...
 *       Check converted files: static and runtime fidelity, lint, typecheck.
 *   node --import tsx bin/doctest-convert.ts progress
 *       Rewrite bin/doctest-convert/PROGRESS.md.
 *
 * Paths are repo-relative. Exits 1 when a verified file has problems.
 */

import { relative, resolve } from "node:path";
import { DriverError, NothingConvertedError, PrepareArgsError, UnknownCommandError, VerifyArgsError } from "./doctest-convert/errors.ts";
import { prepare } from "./doctest-convert/prepare.ts";
import { loadAll, writeProgress } from "./doctest-convert/state.ts";
import { REPO } from "./doctest-convert/tools.ts";
import { select, verify, type Selected } from "./doctest-convert/verify.ts";

function report(selected: readonly Selected[]): boolean {
  let clean = 0;
  for (const s of selected) {
    if (s.file.problems.length === 0) clean++;
    else console.log(`${s.file.test}\n${s.file.problems.map((p) => `  ${p}`).join("\n")}`);
    for (const c of s.file.changedActuals) console.log(`${s.file.test}: changed actual ${c}`);
  }
  console.log(`verified ${clean} of ${selected.length}`);
  return clean === selected.length;
}

function main(argv: readonly string[]): boolean {
  const [command, ...rest] = argv;
  const paths = rest.map((p) => relative(REPO, resolve(p)));
  switch (command) {
    case "prepare": {
      const [dir] = paths;
      if (dir === undefined || paths.length > 1) throw new PrepareArgsError();
      const state = prepare(dir, (s) => console.log(s));
      const converted = select(Object.keys(state.files).filter((d) => state.files[d]?.status === "converted"));
      if (converted.length > 0) verify(converted);
      writeProgress(loadAll());
      return report(converted);
    }
    case "verify": {
      if (paths.length === 0) throw new VerifyArgsError();
      const selected = select(paths);
      if (selected.length === 0) throw new NothingConvertedError(paths);
      verify(selected);
      writeProgress(loadAll());
      return report(selected);
    }
    case "progress": {
      writeProgress(loadAll());
      return true;
    }
    default: {
      throw new UnknownCommandError(command);
    }
  }
}

try {
  process.exitCode = main(process.argv.slice(2)) ? 0 : 1;
} catch (error) {
  if (!(error instanceof DriverError)) throw error;
  console.error(`doctest-convert: ${error.message}`);
  process.exitCode = 2;
}
