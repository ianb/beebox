/**
 * Gmail Connector — Pulls emails via the Gmail REST API and creates
 * email-thread/email-message cards.
 *
 * Auth: shared Google OAuth2 credentials (same as Calendar/Drive).
 * Honors the per-box "gmail" service toggle in box-config.
 *
 * Configuration:
 *   config/connectors/gmail.json - { "query": "label:inbox", "labels": [] }
 *
 * State stored in:
 *   config/connectors/gmail-state.json    - { "seenMessageIds": [...] }
 *   config/connectors/gmail.state.json    - { "lastPullDate": "..." } (gitignored)
 *
 * Each Gmail thread becomes a directory in box/inbox/email/:
 *   thread-Subject_Line-abc123/
 *     thread.email-thread.card
 *     msg-001.email-message.card
 *     msg-001.body.txt
 *     msg-002.email-message.card
 *     msg-002.body.txt
 *     attachments/
 *       document.pdf
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerConnector,
  type Connector,
  type SyncResult,
} from "./index.js";
import { uploadPendingDrafts } from "./gmail-drafts.js";
import { stageFiles, commit } from "../cli/lib/git.js";
import { loadTransientState, saveTransientState } from "./transient-state.js";
import { getGoogleAuth } from "./google-auth.js";
import { isGoogleServiceAllowed } from "../webapp/box-config.js";
import { createGoogleAuthService } from "../services/google-auth.js";
import {
  createGoogleGmailService,
  type GoogleGmailService,
} from "../services/google-gmail.js";
import {
  type FetchedMessage,
  parseGmailMessage,
  messageIdFor,
} from "./gmail-mime.js";
import { buildGmailCommitMessage, type ThreadNote } from "./gmail-commit.js";
import { writeThreadCards } from "./gmail-threads.js";

interface GmailConfig {
  /** Gmail search query (uses Gmail search syntax) */
  query?: string;
  /** Filter to specific labels — joined as label:foo OR label:bar if no query */
  labels?: string[];
}

interface GmailState {
  seenMessageIds: string[];
}

interface GmailTransientState {
  lastPullDate?: string;
}

class GmailConnector implements Connector {
  name = "gmail";
  produces = ["email-thread", "email-message", "email-outbound"];
  inboxPaths = ["box/inbox/email"];
  triggeredBy?: string;

  private boxRoot: string;
  private injectedService?: GoogleGmailService | undefined;

  constructor(boxRoot: string, service?: GoogleGmailService) {
    this.boxRoot = boxRoot;
    this.injectedService = service;
  }

  private configPath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail.json");
  }

  private statePath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail-state.json");
  }

  private legacySecretPath(): string {
    return path.join(this.boxRoot, "config/connectors/gmail.secret.json");
  }

  private async loadConfig(): Promise<GmailConfig> {
    try {
      const content = await fs.readFile(this.configPath(), "utf-8");
      return JSON.parse(content);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.debug("Gmail: no connector config found, using defaults:", e);
      }
      return {};
    }
  }

  private async loadState(): Promise<GmailState> {
    try {
      const content = await fs.readFile(this.statePath(), "utf-8");
      return JSON.parse(content);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        console.debug("Gmail: no prior state found, starting fresh:", e);
      }
      return { seenMessageIds: [] };
    }
  }

  private async saveState(state: GmailState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath()), { recursive: true });
    await fs.writeFile(this.statePath(), JSON.stringify(state, null, 2));
  }

  private async getService(): Promise<GoogleGmailService | null> {
    if (this.injectedService) return this.injectedService;

    const auth = await getGoogleAuth(this.boxRoot);
    if (!auth) return null;

    const authService = createGoogleAuthService(auth);
    return createGoogleGmailService(authService);
  }

  /** Best-effort cleanup of the legacy IMAP app-password file. */
  private async cleanupLegacySecret(): Promise<void> {
    try {
      await fs.unlink(this.legacySecretPath());
    } catch (_e) {
      // Best-effort cleanup: the legacy IMAP secret almost always doesn't
      // exist (already removed or never present). A failure here carries no
      // actionable info and must not interrupt the sync — safe to ignore.
    }
  }

  private buildQuery(config: GmailConfig, lastPullDate: string | undefined): string {
    let base: string;
    // A label-based or user-authored query is naturally bounded — applying
    // an `after:` floor would hide messages that were *labeled* recently
    // but received earlier, which breaks labeling-as-routing. Pagination +
    // seenMessageIds dedup handle re-listing cheaply when the set is
    // bounded. The bare `label:inbox` fallback is unbounded, so we keep
    // the date filter there to protect the seenMessageIds cap.
    let bounded: boolean;
    if (config.query) {
      base = config.query;
      bounded = true;
    } else if (config.labels && config.labels.length > 0) {
      base = config.labels.map((l) => `label:${l}`).join(" OR ");
      bounded = true;
    } else {
      base = "label:inbox";
      bounded = false;
    }

    if (!bounded && lastPullDate) {
      const datePart = lastPullDate.split("T")[0];
      return `${base} after:${datePart}`;
    }
    return base;
  }

  /** List every message id matching the query, paginating through results. */
  private async listMatchingRefs(
    service: GoogleGmailService,
    query: string,
  ): Promise<Array<{ id: string; threadId: string }>> {
    const refs: Array<{ id: string; threadId: string }> = [];
    let pageToken: string | undefined;
    do {
      const listOpts: { q: string; pageToken?: string; maxResults: number } = {
        q: query,
        maxResults: 100,
      };
      if (pageToken) listOpts.pageToken = pageToken;
      const result = await service.listMessages(listOpts);
      refs.push(...result.messages);
      pageToken = result.nextPageToken;
    } while (pageToken);
    return refs;
  }

  /** Build the label-id → label-name map (non-fatal: falls back to ids). */
  private async loadLabelMap(service: GoogleGmailService): Promise<Map<string, string>> {
    const labelMap = new Map<string, string>();
    try {
      const labels = await service.listLabels();
      for (const l of labels) labelMap.set(l.id, l.name);
    } catch (e) {
      console.warn("Gmail: could not list labels, cards will use label IDs:", e);
    }
    return labelMap;
  }

  /** Fetch and parse every not-yet-seen message referenced by `refs`. */
  private async fetchNewMessages(opts: {
    service: GoogleGmailService;
    refs: Array<{ id: string; threadId: string }>;
    seenMessageIds: string[];
    labelMap: Map<string, string>;
  }): Promise<FetchedMessage[]> {
    const { service, refs, seenMessageIds, labelMap } = opts;
    const messages: FetchedMessage[] = [];
    for (const ref of refs) {
      const raw = await service.getMessage(ref.id);
      if (seenMessageIds.includes(messageIdFor(raw))) {
        continue;
      }
      const fetched = await parseGmailMessage(raw, { service, labelMap });
      if (fetched) messages.push(fetched);
    }
    return messages;
  }

  private async commitPulled(opts: {
    created: string[];
    updated: string[];
    threadNotes: ThreadNote[];
  }): Promise<void> {
    const { created, updated, threadNotes } = opts;
    const stateRelPath = path.relative(this.boxRoot, this.statePath());
    await stageFiles(this.boxRoot, [...created, ...updated, stateRelPath]);
    await commit(this.boxRoot, {
      message: buildGmailCommitMessage(threadNotes, created.length + updated.length),
      trailers: {
        "Pulled-By": "gmail-connector",
        ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
      },
    });
  }

  private async saveTransient(): Promise<void> {
    await saveTransientState({
      boxRoot: this.boxRoot,
      connectorName: "gmail",
      data: { lastPullDate: new Date().toISOString() },
    });
  }

  async sync(): Promise<SyncResult> {
    // Skip policy check when a fake service is injected (tests)
    if (!this.injectedService) {
      const allowed = await isGoogleServiceAllowed(this.boxRoot, "gmail");
      if (!allowed) {
        return { success: true, created: [], updated: [] };
      }
    }

    const service = await this.getService();
    if (!service) {
      // No tokens — silently skip (matches calendar's behavior for unconfigured boxes)
      return { success: true, created: [], updated: [] };
    }

    await this.cleanupLegacySecret();

    const config = await this.loadConfig();
    const state = await this.loadState();
    const transient = await loadTransientState<GmailTransientState>({
      boxRoot: this.boxRoot,
      connectorName: "gmail",
      defaultValue: {},
    });

    let created: string[] = [];
    let updated: string[] = [];
    const threadNotes: ThreadNote[] = [];

    try {
      const labelMap = await this.loadLabelMap(service);
      const query = this.buildQuery(config, transient.lastPullDate);
      const refs = await this.listMatchingRefs(service, query);
      const messages = await this.fetchNewMessages({
        service,
        refs,
        seenMessageIds: state.seenMessageIds,
        labelMap,
      });

      const written = await writeThreadCards({ boxRoot: this.boxRoot, messages });
      created = written.created;
      updated = written.updated;
      threadNotes.push(...written.notes);
      for (const id of written.seenMessageIds) {
        if (!state.seenMessageIds.includes(id)) {
          state.seenMessageIds.push(id);
        }
      }
    } catch (err) {
      await this.saveTransient();
      await this.saveState(state);

      return {
        success: false,
        created,
        updated,
        error: `Gmail pull failed: ${(err as Error).message}`,
      };
    }

    await this.saveTransient();
    if (state.seenMessageIds.length > 5000) {
      state.seenMessageIds = state.seenMessageIds.slice(-5000);
    }
    await this.saveState(state);

    if (created.length > 0 || updated.length > 0) {
      await this.commitPulled({ created, updated, threadNotes });
    }

    // Upload any agent-authored draft cards that haven't been uploaded yet.
    // Stamps each card with gmail-draft-id and gmail-draft-url and commits
    // the stamps as a separate commit so the inbound-pull diff stays clean.
    const draftResult = await uploadPendingDrafts({
      boxRoot: this.boxRoot,
      service,
    });
    if (draftResult.updated.length > 0) {
      await stageFiles(this.boxRoot, draftResult.updated);
      await commit(this.boxRoot, {
        message: `Upload ${draftResult.updated.length} draft${draftResult.updated.length === 1 ? "" : "s"} to Gmail`,
        trailers: {
          "Pushed-By": "gmail-connector",
          ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
        },
      });
      updated.push(...draftResult.updated);
    }

    return { success: true, created, updated };
  }
}

/**
 * Create and register the Gmail connector for a box.
 */
export function createGmailConnector(
  boxRoot: string,
  service?: GoogleGmailService,
): Connector {
  const connector = new GmailConnector(boxRoot, service);
  registerConnector(connector);
  return connector;
}
