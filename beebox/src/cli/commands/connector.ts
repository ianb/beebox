/**
 * `bbx connector` commands for connector-specific operations.
 *
 * `gmail track` and `gmail gws` need the Google credential, so they follow the
 * one credentialed-verb rule (`cli/lib/credentialed-verb.ts`): in-process only
 * under `BBX_SPAWN_PROFILE=tooling`, otherwise this box's own server does the
 * credentialed half and hands back the same typed result. `gmail pending` reads
 * the box's transient state and needs nothing from Google, so it stays
 * in-process in every profile (`docs/plans/agent-capability-delegation.md`).
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import {
  resolveGmailService,
  resolveGoogleAuth,
} from "../../connectors/google-access.js";
import { trackGmailThread, type TrackGmailThreadResult } from "../../connectors/gmail-track.js";
import type { GoogleGmailService } from "../../services/google-gmail.js";
import type { GoogleAuthService } from "../../services/google-auth.js";
import { loadTransientState } from "../../connectors/transient-state.js";
import { parseGmailTransientState } from "../../connectors/gmail-state.js";
import {
  runReadOnlyGws,
  UnsafeGwsCommandError,
  type GwsRunResult,
} from "../../connectors/gmail-gws.js";
import {
  CredentialGapError,
  dispatchCredentialed,
  jsonFlag,
  runCredentialedVerb,
} from "../lib/credentialed-verb.js";

/** The Gmail client for an in-process run; the two gates throw as one refusal. */
export async function localGmailService(boxRoot: string): Promise<GoogleGmailService> {
  const resolved = await resolveGmailService(boxRoot);
  if (!resolved.ok) throw new CredentialGapError(resolved.error);
  return resolved.value;
}

/** The authorized client `gws` mints its short-lived token from. */
async function localGmailAuth(boxRoot: string): Promise<GoogleAuthService> {
  const resolved = await resolveGoogleAuth(boxRoot, "gmail");
  if (!resolved.ok) throw new CredentialGapError(resolved.error);
  return resolved.value;
}

export const connectorCommand = new Command("connector")
  .description("Manage external-service connectors");

const gmailCommand = new Command("gmail")
  .description("Search and track Gmail threads");

const gmailTrackCommand = gmailCommand
  .command("track <thread-id>")
  .description("Track one Gmail API thread as a synchronized card")
  .option("--json", "Print the result as one JSON object")
  .action(async (threadId: string) => {
    const boxRoot = await requireBoxRoot();
    await runCredentialedVerb({
      json: jsonFlag(gmailTrackCommand),
      run: () =>
        dispatchCredentialed<TrackGmailThreadResult>({
          local: async () =>
            trackGmailThread({
              boxRoot,
              service: await localGmailService(boxRoot),
              threadId,
              trackedBy: "explicit-command",
            }),
          remote: (client) => client.gmail.track.mutate({ threadId }),
        }),
      print: (result) => {
        console.log(result.cardPath);
      },
    });
  });

gmailCommand
  .command("pending [rule]")
  .description("Print bounded summaries of untracked Gmail rule matches")
  .action(async (rule: string | undefined) => {
    const boxRoot = await requireBoxRoot();
    const raw = await loadTransientState<unknown>({
      boxRoot,
      connectorName: "gmail",
      defaultValue: {},
    });
    const state = parseGmailTransientState(raw);
    if (rule === undefined) {
      console.log(JSON.stringify(state.rules ?? {}, null, 2));
      return;
    }
    const selected = state.rules?.[rule];
    if (selected === undefined) {
      console.error(`Gmail rule has no state: ${rule}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(selected, null, 2));
  });

gmailCommand
  .command("gws")
  .description("Run a read-only Gmail command through Google Workspace CLI")
  .argument("[args...]", "Arguments in the upstream gws vocabulary")
  .allowUnknownOption(true)
  .action(async (args: string[]) => {
    const boxRoot = await requireBoxRoot();
    await runCredentialedVerb({
      // `--json` would be read as a gws argument here (unknown options are
      // passed through to the upstream vocabulary), so this verb has only the
      // one form: the child's own streams, printed as it printed them.
      json: false,
      run: () =>
        dispatchCredentialed<GwsRunResult>({
          local: async () => runReadOnlyGws({ args, auth: await localGmailAuth(boxRoot) }),
          remote: (client) => client.gmail.gws.mutate({ args }),
          callerFault: (error) => error instanceof UnsafeGwsCommandError,
        }),
      print: (result) => {
        if (result.stdout !== "") process.stdout.write(result.stdout);
        if (result.stderr !== "") process.stderr.write(result.stderr);
        // The child's own exit code, not a collapsed 1: a caller scripting
        // around gws distinguishes them, and this command has always passed
        // them through (`docs/connectors/gmail.md`).
        process.exitCode = result.exitCode;
      },
    });
  });

connectorCommand.addCommand(gmailCommand);
