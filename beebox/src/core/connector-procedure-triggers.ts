/** Run procedure requests emitted by connector syncs. */

import type { ConnectorProcedureTrigger } from "../connectors.js";
import { errorMessage } from "../lib/error-guards.js";
import type { CommandContext } from "./command-types.js";
import { procedureRunCommand } from "./commands/procedure.js";

export async function runConnectorProcedureTriggers(
  ctx: CommandContext,
  procedures: ConnectorProcedureTrigger[],
): Promise<number> {
  let errors = 0;
  for (const procedure of procedures) {
    ctx.writeLine(`Running procedure ${procedure.procedureRef}...`);
    try {
      // Dispatches to the procedure-run command directly (not through
      // `runCommand` by name) — that would need `command-runner.ts`, which
      // imports the registry that `commands.ts` builds from
      // `commands/connector-sync.ts`, which reaches this module, a cycle.
      const result = await procedureRunCommand.execute(ctx, {
        name: procedure.procedureRef,
        directive: procedure.directive,
      });
      if (result.success) continue;
      ctx.writeLine(`  Procedure failed: ${result.error}`);
      errors += 1;
    } catch (error) {
      ctx.writeLine(`  Procedure failed: ${errorMessage(error)}`);
      errors += 1;
    }
  }
  return errors;
}
