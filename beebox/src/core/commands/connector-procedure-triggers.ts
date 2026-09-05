/** Run procedure requests emitted by connector syncs. */

import type { ConnectorProcedureTrigger } from "../../connectors/index.js";
import { errorMessage } from "../../lib/error-guards.js";
import { runCommand, type CommandContext } from "../command-runner.js";

export async function runConnectorProcedureTriggers(
  ctx: CommandContext,
  procedures: ConnectorProcedureTrigger[],
): Promise<number> {
  let errors = 0;
  for (const procedure of procedures) {
    ctx.writeLine(`Running procedure ${procedure.procedureRef}...`);
    try {
      const result = await runCommand({
        name: "procedure-run",
        args: { name: procedure.procedureRef, directive: procedure.directive },
        ctx,
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
