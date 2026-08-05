/** Gmail connector: discover remotely, materialize only the tracked working set. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isGoogleServiceAllowed } from "../core/box/config.js";
import { errorMessage, errnoCode } from "../lib/error-guards.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { createGoogleAuthService } from "../services/google-auth.js";
import {
  createGoogleGmailService,
  type GmailMessage,
  type GoogleGmailService,
} from "../services/google-gmail.js";
import { buildGmailCommitMessage, type ThreadNote } from "./gmail-commit.js";
import { parseGmailConnectorConfig, type GmailConnectorConfig } from "./gmail-config.js";
import { discoverGmailChanges } from "./gmail-discovery.js";
import { uploadPendingDrafts } from "./gmail-drafts.js";
import { getGoogleAuth } from "./google-auth.js";
import { evaluateGmailRules } from "./gmail-rules.js";
import { parseGmailTransientState, type GmailTransientState } from "./gmail-state.js";
import {
  fetchGmailThreadMessages,
  gmailLabelMap,
  withGmailTrackingLock,
} from "./gmail-track.js";
import { findTrackedGmailThreads } from "./gmail-tracking.js";
import { writeThreadCards, type WriteThreadsResult } from "./gmail-threads.js";
import { registerConnector, type Connector, type SyncResult } from "./index.js";
import { loadTransientState, updateTransientState } from "./transient-state.js";

interface SyncWork {
  config: GmailConnectorConfig;
  state: GmailTransientState;
  service: GoogleGmailService;
}

async function readConfig(boxRoot: string): Promise<GmailConnectorConfig> {
  const configPath = path.join(boxRoot, "config/connectors/gmail.json");
  try {
    return parseGmailConnectorConfig(JSON.parse(await fs.readFile(configPath, "utf-8")));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return parseGmailConnectorConfig({});
    throw error;
  }
}

async function readState(boxRoot: string): Promise<GmailTransientState> {
  const raw = await loadTransientState<unknown>({
    boxRoot,
    connectorName: "gmail",
    defaultValue: {},
  });
  return parseGmailTransientState(raw);
}

function resetRuleBaselines(state: GmailTransientState): GmailTransientState {
  if (state.rules === undefined) return state;
  return {
    ...state,
    rules: Object.fromEntries(Object.entries(state.rules).map(([name, ruleState]) => [
      name,
      { ...ruleState, baselineAt: undefined },
    ])),
  };
}

async function fetchCandidates(opts: {
  service: GoogleGmailService;
  refs: Array<{ id: string; threadId: string }>;
}): Promise<GmailMessage[]> {
  const messages: GmailMessage[] = [];
  const refsById = new Map(opts.refs.map((ref) => [ref.id, ref]));
  for (const ref of refsById.values()) {
    messages.push(await opts.service.getMessage(ref.id));
  }
  return messages;
}

function appendWriteResult(target: WriteThreadsResult, source: WriteThreadsResult): void {
  target.created.push(...source.created);
  target.updated.push(...source.updated);
  target.notes.push(...source.notes);
  target.seenMessageIds.push(...source.seenMessageIds);
}

async function refreshThreadSnapshots(opts: {
  boxRoot: string;
  service: GoogleGmailService;
  threadIds: Iterable<string>;
  createThreadIds: ReadonlySet<string>;
  labelMap: Map<string, string>;
}): Promise<WriteThreadsResult> {
  const result: WriteThreadsResult = { created: [], updated: [], notes: [], seenMessageIds: [] };
  for (const threadId of new Set(opts.threadIds)) {
    const messages = await fetchGmailThreadMessages({
      service: opts.service,
      threadId,
      labelMap: opts.labelMap,
    });
    appendWriteResult(result, await writeThreadCards({
      boxRoot: opts.boxRoot,
      messages,
      createThreadIds: opts.createThreadIds,
    }));
  }
  return result;
}

async function persistState(boxRoot: string, state: GmailTransientState): Promise<void> {
  await updateTransientState<unknown>({
    boxRoot,
    connectorName: "gmail",
    defaultValue: {},
    update: () => state,
  });
}

class GmailConnector implements Connector {
  name = "gmail";
  produces = ["email-thread", "email-message", "email-outbound"];
  inboxPaths = ["box/inbox/email"];
  triggeredBy?: string;

  constructor(
    private readonly boxRoot: string,
    private readonly injectedService?: GoogleGmailService,
  ) {}

  private async getService(): Promise<GoogleGmailService | null> {
    if (this.injectedService !== undefined) return this.injectedService;
    const auth = await getGoogleAuth(this.boxRoot);
    if (!auth) return null;
    return createGoogleGmailService(createGoogleAuthService(auth, { boxRoot: this.boxRoot }));
  }

  private async cleanupLegacySecret(): Promise<void> {
    try {
      await fs.unlink(path.join(this.boxRoot, "config/connectors/gmail.secret.json"));
    } catch (_error) {
      // Best-effort removal of the obsolete IMAP credential file.
    }
  }

  private async commitInbound(written: WriteThreadsResult): Promise<void> {
    const paths = [...written.created, ...written.updated];
    if (paths.length === 0) return;
    await stageAndCommitPaths(this.boxRoot, {
      paths,
      message: buildGmailCommitMessage(written.notes satisfies ThreadNote[], paths.length),
      trailers: {
        "Pulled-By": "gmail-connector",
        ...(this.triggeredBy === undefined ? {} : { "Triggered-By": this.triggeredBy }),
      },
    });
  }

  private async syncWorkingSet(work: SyncWork): Promise<SyncResult> {
    if (work.config.legacy) {
      console.warn(
        "Gmail: legacy query/labels config now uses a bounded track rule; migrate to named rules",
      );
    }
    if (work.config.gc !== undefined || work.config.gcIntervalHours !== undefined) {
      console.warn(
        "Gmail: gc settings are obsolete; card deletion now controls untracking",
      );
    }
    const tracked = await findTrackedGmailThreads(this.boxRoot);
    const changes = await discoverGmailChanges({
      service: work.service,
      startHistoryId: work.state.historyId,
      resume: work.state.historyResume,
    });
    const state = changes.historyExpired ? resetRuleBaselines(work.state) : work.state;
    if (changes.historyExpired) {
      console.warn("Gmail: history cursor expired; rule counts were refreshed without importing mail");
    }
    const labelMap = await gmailLabelMap(work.service);
    const trackedThreadIds = new Set(tracked.keys());
    const candidates = work.config.rules.length === 0
      ? []
      : await fetchCandidates({
          service: work.service,
          refs: changes.refs,
        });
    const evaluated = await evaluateGmailRules({
      service: work.service,
      config: work.config,
      state,
      candidates,
      trackedThreadIds,
      labelMap,
      now: new Date(),
    });
    const createThreadIds = new Set(evaluated.trackRequests.map((request) => request.threadId));
    const changedTrackedThreadIds = changes.refs
      .map((ref) => ref.threadId)
      .filter((threadId) => trackedThreadIds.has(threadId));
    const written = await refreshThreadSnapshots({
      boxRoot: this.boxRoot,
      service: work.service,
      threadIds: [...changedTrackedThreadIds, ...createThreadIds],
      createThreadIds,
      labelMap,
    });
    await this.commitInbound(written);
    await persistState(this.boxRoot, {
      ...evaluated.state,
      historyId: changes.historyId,
      historyResume: changes.historyResume,
    });
    return {
      success: true,
      created: written.created,
      updated: written.updated,
      procedures: evaluated.procedures,
    };
  }

  private async uploadDrafts(service: GoogleGmailService, result: SyncResult): Promise<void> {
    const drafts = await uploadPendingDrafts({ boxRoot: this.boxRoot, service });
    if (drafts.updated.length === 0) return;
    await stageAndCommitPaths(this.boxRoot, {
      paths: drafts.updated,
      message: `Upload ${drafts.updated.length} draft${drafts.updated.length === 1 ? "" : "s"} to Gmail`,
      trailers: {
        "Pushed-By": "gmail-connector",
        ...(this.triggeredBy === undefined ? {} : { "Triggered-By": this.triggeredBy }),
      },
    });
    result.updated.push(...drafts.updated);
  }

  private async syncUnderLock(service: GoogleGmailService): Promise<SyncResult> {
    const result = await this.syncWorkingSet({
      config: await readConfig(this.boxRoot),
      state: await readState(this.boxRoot),
      service,
    });
    await this.uploadDrafts(service, result);
    return result;
  }

  async sync(): Promise<SyncResult> {
    if (this.injectedService === undefined && !await isGoogleServiceAllowed(this.boxRoot, "gmail")) {
      return { success: true, created: [], updated: [] };
    }
    const service = await this.getService();
    if (service === null) return { success: true, created: [], updated: [] };
    try {
      await this.cleanupLegacySecret();
      return await withGmailTrackingLock({
        boxRoot: this.boxRoot,
        purpose: "gmail-sync",
        action: () => this.syncUnderLock(service),
      });
    } catch (error) {
      return {
        success: false,
        created: [],
        updated: [],
        error: `Gmail sync failed: ${errorMessage(error)}`,
      };
    }
  }
}

export function createGmailConnector(
  boxRoot: string,
  service?: GoogleGmailService,
): Connector {
  const connector = new GmailConnector(boxRoot, service);
  registerConnector(connector);
  return connector;
}
