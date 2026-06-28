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
 * Sync strategy (see gmail-pull.ts): incremental via the Gmail history API
 * from a stored checkpoint, with full query listing as the bootstrap/fallback
 * path. Dedup is by Gmail message id, checked BEFORE fetching, so re-listing
 * never re-fetches message bodies.
 *
 * State stored in:
 *   config/connectors/gmail-state.json - { "seenGmailIds": [...],     (committed)
 *                                          "seenMessageIds": [...] }  (legacy)
 *   config/connectors/gmail.state.json - { "historyId": "..." } (gitignored)
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
import { listCandidates, type GmailPullConfig } from "./gmail-pull.js";
import { reconcileOrphans } from "./gmail-gc.js";

interface GmailState {
  /**
   * Legacy dedup keys: RFC822 Message-ID headers recorded by pulls that
   * predate seenGmailIds. Read-only — checked after fetch so pre-upgrade
   * boxes don't re-import, never appended to.
   */
  seenMessageIds: string[];
  /** Primary dedup keys: Gmail API message ids, checked before fetch. Uncapped. */
  seenGmailIds?: string[];
}

interface GmailTransientState {
  /** History API checkpoint from the last successful sync. */
  historyId?: string;
  /** ISO timestamp of the last orphan-reconciliation (GC) pass. */
  lastReconcileAt?: string;
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

  private async loadConfig(): Promise<GmailPullConfig> {
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

  /**
   * Fetch and parse every not-yet-seen message referenced by `refs`.
   * Refs whose Gmail id is already seen are skipped without an API call;
   * the legacy Message-ID check (post-fetch) keeps pre-upgrade boxes from
   * re-importing — when it hits, the Gmail id is folded into seenGmailIds
   * so the next sync takes the cheap path.
   */
  private async fetchNewMessages(opts: {
    service: GoogleGmailService;
    refs: Array<{ id: string; threadId: string }>;
    seenGmailIds: Set<string>;
    legacySeenMessageIds: Set<string>;
    labelMap: Map<string, string>;
  }): Promise<{
    messages: FetchedMessage[];
    gmailIdByMessageId: Map<string, string>;
  }> {
    const { service, refs, seenGmailIds, legacySeenMessageIds, labelMap } = opts;
    const messages: FetchedMessage[] = [];
    const gmailIdByMessageId = new Map<string, string>();
    for (const ref of refs) {
      if (seenGmailIds.has(ref.id)) continue;
      const raw = await service.getMessage(ref.id);
      if (legacySeenMessageIds.has(messageIdFor(raw))) {
        seenGmailIds.add(ref.id);
        continue;
      }
      const fetched = await parseGmailMessage(raw, { service, labelMap });
      if (fetched) {
        messages.push(fetched);
        gmailIdByMessageId.set(fetched.messageId, ref.id);
      }
    }
    return { messages, gmailIdByMessageId };
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

  private async saveTransient(data: GmailTransientState): Promise<void> {
    await saveTransientState({
      boxRoot: this.boxRoot,
      connectorName: "gmail",
      data,
    });
  }

  /**
   * Run orphan reconciliation if enabled and the cadence has elapsed. Returns
   * the new lastReconcileAt to persist (unchanged when skipped). A GC failure
   * is logged and swallowed — the import already succeeded, and the next
   * interval retries.
   */
  private async maybeReconcile(opts: {
    service: GoogleGmailService;
    config: GmailPullConfig;
    lastReconcileAt: string | undefined;
  }): Promise<string | undefined> {
    const { service, config, lastReconcileAt } = opts;
    if (config.gc === false) return lastReconcileAt;
    const intervalMs = (config.gcIntervalHours ?? 24) * 3_600_000;
    const last = lastReconcileAt ? Date.parse(lastReconcileAt) : 0;
    if (Date.now() - last < intervalMs) return lastReconcileAt;
    try {
      await reconcileOrphans({ boxRoot: this.boxRoot, service, config });
      return new Date().toISOString();
    } catch (err) {
      console.warn("Gmail GC: reconciliation failed, will retry next interval:", err);
      return lastReconcileAt;
    }
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

    const seenGmailIds = new Set(state.seenGmailIds);
    const legacySeenMessageIds = new Set(state.seenMessageIds);

    let created: string[] = [];
    let updated: string[] = [];
    const threadNotes: ThreadNote[] = [];
    let checkpoint = transient.historyId;
    let baselineRan = false;

    try {
      const labelMap = await this.loadLabelMap(service);
      const candidates = await listCandidates({
        service,
        config,
        labelMap,
        startHistoryId: transient.historyId,
      });
      if (candidates.historyId) checkpoint = candidates.historyId;

      if (candidates.baseline) {
        // First sync of the bare-inbox default: record the current inbox as
        // seen without importing — only mail arriving (or labeled) from now
        // on flows into the box, instead of the user's whole inbox backlog.
        baselineRan = true;
        for (const ref of candidates.refs) seenGmailIds.add(ref.id);
        if (candidates.refs.length > 0) {
          console.warn(
            `Gmail: baseline sync — marked ${candidates.refs.length} existing messages as seen without importing`,
          );
        }
      } else {
        const fetched = await this.fetchNewMessages({
          service,
          refs: candidates.refs,
          seenGmailIds,
          legacySeenMessageIds,
          labelMap,
        });
        const written = await writeThreadCards({
          boxRoot: this.boxRoot,
          messages: fetched.messages,
        });
        created = written.created;
        updated = written.updated;
        threadNotes.push(...written.notes);
        for (const id of written.seenMessageIds) {
          const gmailId = fetched.gmailIdByMessageId.get(id);
          if (gmailId) seenGmailIds.add(gmailId);
        }
      }
    } catch (err) {
      // Keep ids gathered so far, but do NOT advance the history checkpoint:
      // the failed window replays next sync, and seen-id dedup makes the
      // overlap cheap.
      await this.saveState({ ...state, seenGmailIds: [...seenGmailIds] });

      return {
        success: false,
        created,
        updated,
        error: `Gmail pull failed: ${(err as Error).message}`,
      };
    }

    await this.saveState({ ...state, seenGmailIds: [...seenGmailIds] });

    if (created.length > 0 || updated.length > 0) {
      await this.commitPulled({ created, updated, threadNotes });
    }

    // Reconcile pending threads against Gmail (GC of upstream-unlabeled mail).
    // Skip right after a baseline sync — it just full-listed and imported
    // nothing, so there is nothing to orphan.
    const lastReconcileAt = baselineRan
      ? transient.lastReconcileAt
      : await this.maybeReconcile({
          service,
          config,
          lastReconcileAt: transient.lastReconcileAt,
        });

    const newTransient: GmailTransientState = {};
    if (checkpoint) newTransient.historyId = checkpoint;
    if (lastReconcileAt) newTransient.lastReconcileAt = lastReconcileAt;
    await this.saveTransient(newTransient);

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
