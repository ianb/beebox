/**
 * Run the scan-import command directly, for `upload`'s scan destination.
 *
 * Not through `runCommand` by name: that needs `command-runner.ts`, which
 * imports the registry `commands.ts` builds from `commands/upload.ts` — a
 * cycle. Lives flat at `core/` (outside `commands/`) rather than inside the
 * set directory, since it's reachable from both the `upload` member and the
 * `scan-import` member itself, and a set directory holds only the registry's
 * own members (rule 4).
 */

import { errorMessage } from "../shared/error-guards.js";
import type { CommandContext, CommandResult } from "./command-types.js";
import { scanImportCommand } from "./commands/scan-import/command.js";

export async function runScanImportCommand(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  try {
    return await scanImportCommand.execute(ctx, args);
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
