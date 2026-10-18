/**
 * The doctest conversion driver (plan beebox/docs/plans/retire-doctest.md,
 * track 3). Temporary: track 6 deletes it with `bin/doctest-convert/`.
 *
 *   node --import tsx bin/doctest-convert.ts prepare <dir>
 *       Convert the directory's doctests, record them in
 *       bin/doctest-convert/state/<dir>.json, delete the doctests, and verify.
 *   node --import tsx bin/doctest-convert.ts verify <dir|file>...
 *       Check converted files: static and runtime fidelity, lint, typecheck.
 *       Records the result in the state files.
 *   node --import tsx bin/doctest-convert.ts check <dir|file>...
 *       The same checks, recording nothing: the command a worker runs.
 *   node --import tsx bin/doctest-convert.ts slots
 *       Create the worker slots (git worktrees with node_modules) in
 *       $DOCTEST_CONVERT_SLOTS, by default <tmpdir>/doctest-convert-slots.
 *   node --import tsx bin/doctest-convert.ts dispatch <dir|file>... --model luna|haiku
 *       Run one worker on the batch's unverified files in a free slot, then
 *       apply and verify its edits here. Exits 1 when the batch is rejected.
 *       With --trial, check the edits in the slot and apply nothing.
 *   node --import tsx bin/doctest-convert.ts progress
 *       Rewrite bin/doctest-convert/PROGRESS.md.
 *
 * Paths are repo-relative. Exits 1 when a verified file has problems.
 */

import { relative, resolve } from "node:path";
import { dispatch, initSlots, type Model } from "./doctest-convert/dispatch.ts";
import { stateLockPath, withLock } from "./doctest-convert/locks.ts";
import { DriverError, ModelArgError, NothingConvertedError, PrepareArgsError, UnknownCommandError, VerifyArgsError } from "./doctest-convert/errors.ts";
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
  const modelAt = rest.indexOf("--model");
  const model = modelAt === -1 ? undefined : rest[modelAt + 1];
  const trial = rest.includes("--trial");
  const paths = rest
    .filter((a, i) => a !== "--trial" && (modelAt === -1 || (i !== modelAt && i !== modelAt + 1)))
    .map((p) => relative(REPO, resolve(p)));
  switch (command) {
    case "prepare": {
      const [dir] = paths;
      if (dir === undefined || paths.length > 1) throw new PrepareArgsError();
      return withLock(stateLockPath(), () => {
        const state = prepare(dir, (s) => console.log(s));
        const converted = select(Object.keys(state.files).filter((d) => state.files[d]?.status === "converted"));
        if (converted.length > 0) verify(converted, { save: true });
        writeProgress(loadAll());
        return report(converted);
      });
    }
    case "verify":
    case "check": {
      if (paths.length === 0) throw new VerifyArgsError();
      const save = command === "verify";
      const run = (): boolean => {
        // Selected inside the lock, so the entries are current when saved.
        const selected = select(paths);
        if (selected.length === 0) throw new NothingConvertedError(paths);
        verify(selected, { save });
        if (save) writeProgress(loadAll());
        return report(selected);
      };
      return save ? withLock(stateLockPath(), run) : run();
    }
    case "slots": {
      initSlots((s) => console.log(s));
      return true;
    }
    case "dispatch": {
      if (model !== "luna" && model !== "haiku") throw new ModelArgError(model);
      const result = dispatch({ paths, model: model satisfies Model, trial }, (s) => console.log(s));
      if (result.checkOutput === undefined) report(result.selected);
      else console.log(result.checkOutput);
      for (const r of result.reasons) console.log(`rejected: ${r}`);
      return result.accepted;
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
