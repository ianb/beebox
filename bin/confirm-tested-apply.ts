/**
 * `node --import tsx bin/confirm-tested-apply.ts <checkout> <issue>` — the
 * file step of `bin/workstreams confirm-tested` (`bin/lib/manual-testing.sh`):
 * apply the confirmation to `<issue>` (relative to `<checkout>`) and print
 * `{ close, workstream, stage }` as JSON for the shell to stage and commit.
 * Notices go to stderr. Every refusal exits 1 before any write.
 */

import { applyConfirmTested, ConfirmTestedError } from "./confirm-tested.js";
import { DocMoveError } from "./lib/doc-move-errors.js";

class ConfirmApplyUsageError extends Error {
  constructor() {
    super("usage: confirm-tested-apply.ts <checkout> <issue>");
    this.name = "ConfirmApplyUsageError";
  }
}

try {
  const [checkout, issue, ...extra] = process.argv.slice(2);
  if (checkout === undefined || issue === undefined || extra.length > 0) throw new ConfirmApplyUsageError();
  const applied = applyConfirmTested({ repoRoot: checkout, issue, date: new Date().toISOString().slice(0, 10) });
  for (const n of applied.notices) process.stderr.write(`confirm-tested: check by hand: ${n.path}${n.line === null ? "" : `:L${String(n.line)}`}: ${n.message}\n`);
  process.stdout.write(`${JSON.stringify({ close: applied.close, workstream: applied.workstream, stage: applied.stage })}\n`);
} catch (error) {
  if (!(error instanceof DocMoveError || error instanceof ConfirmTestedError || error instanceof ConfirmApplyUsageError)) throw error;
  process.stderr.write(`confirm-tested: ${error.message}\n`);
  process.exitCode = 1;
}
