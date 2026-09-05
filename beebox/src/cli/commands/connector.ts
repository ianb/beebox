/** `bbx connector` commands for connector-specific operations. */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { getGoogleAuth } from "../../connectors/google-auth.js";
import { trackGmailThread } from "../../connectors/gmail-track.js";
import { createGoogleAuthService } from "../../services/google-auth.js";
import { createGoogleGmailService, type GoogleGmailService } from "../../services/google-gmail.js";
import { loadTransientState } from "../../connectors/transient-state.js";
import { parseGmailTransientState } from "../../connectors/gmail-state.js";
import { runReadOnlyGws } from "../../connectors/gmail-gws.js";

async function requireGmailService(boxRoot: string): Promise<GoogleGmailService> {
  const auth = await getGoogleAuth(boxRoot);
  if (!auth) {
    console.error("Google auth is not configured. Run: bbx google-auth");
    process.exit(1);
  }
  return createGoogleGmailService(createGoogleAuthService(auth, { boxRoot }));
}

export const connectorCommand = new Command("connector")
  .description("Manage external-service connectors");

const gmailCommand = new Command("gmail")
  .description("Search and track Gmail threads");

gmailCommand
  .command("track <thread-id>")
  .description("Track one Gmail API thread as a synchronized card")
  .action(async (threadId: string) => {
    const boxRoot = await requireBoxRoot();
    const service = await requireGmailService(boxRoot);
    const result = await trackGmailThread({
      boxRoot,
      service,
      threadId,
      trackedBy: "explicit-command",
    });
    console.log(result.cardPath);
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
    const auth = await getGoogleAuth(boxRoot);
    if (!auth) {
      console.error("Google auth is not configured. Run: bbx google-auth");
      process.exitCode = 1;
      return;
    }
    const service = createGoogleAuthService(auth, { boxRoot });
    process.exitCode = await runReadOnlyGws({ args, auth: service });
  });

connectorCommand.addCommand(gmailCommand);
