/**
 * Connector registry and types
 *
 * Connectors bridge external services to the filesystem.
 * Each connector:
 * - Syncs external state with the repo (pull + push)
 * - Transforms between external formats and cards
 */

export interface Connector {
  /** Unique name for this connector */
  name: string;

  /** Card types this connector creates on sync */
  produces: string[];

  /**
   * Subdirectories under _content/inbox/ that this connector owns. Used by
   * `bbx wakeup --connector <name>` to scope inbox scanning and to tag
   * any intake jobs it creates with `source="<name>"`. Empty if the
   * connector creates job cards directly without staging inbox items.
   */
  inboxPaths: string[];

  /**
   * How this connector was triggered. Set by the caller before sync().
   * Included as a "Triggered-By" trailer on commits.
   * Examples: "bbx wakeup", "bbx wakeup --connector gmail", "bbx finalize"
   */
  triggeredBy?: string;

  /** Sync external state with the repo */
  sync(): Promise<SyncResult>;
}

/**
 * Why a sync ran but deliberately did nothing.
 *
 * A connector whose service is unavailable used to report a bare empty success
 * (Gmail, Calendar) or a failure (Drive), so a caller could not tell "nothing
 * changed" from "nothing was even attempted" — the invisible
 * nothing-happened failure the 2026-09-14 Drive incident exposed. A skipped
 * result says which of the two it is, and `detail` is written for RELAY: the
 * box agent reads it out to the boxholder.
 *
 * - `not-allowed` — the box's own policy has the service switched off. The
 *   boxholder flips it; no credential is involved.
 * - `not-configured` — the credential this process needs is not reachable.
 *   `detail` carries `explainGoogleAuthGap`'s account of which piece is
 *   missing and where this process looked.
 */
export interface SyncSkipped {
  reason: "not-configured" | "not-allowed";
  detail: string;
}

export interface SyncResult {
  success: boolean;
  created: string[];
  updated: string[];
  /**
   * Set when the sync did no work on purpose. A skipped result is a success
   * (nothing failed), so callers must check this before reporting "up to
   * date" — see {@link SyncSkipped}.
   */
  skipped?: SyncSkipped;
  /** Cards that were pushed to the remote service (two-way sync) */
  pushed?: string[];
  /** Job cards created during sync */
  jobs?: string[];
  /** Procedures requested by a connector, run after connector writes complete. */
  procedures?: ConnectorProcedureTrigger[];
  error?: string;
}

export interface ConnectorProcedureTrigger {
  procedureRef: string;
  directive: string;
}

/**
 * A connector MISCONFIGURATION, as opposed to a sync that failed.
 *
 * The wakeup connector loop deliberately absorbs sync failures — one flaky
 * service should not stop the cycle — but that absorbing is wrong for a
 * configuration that must never run at all (the `BBX_FAKE_GMAIL` gate is the
 * first case: fake mail aimed at a real box). Throwing this subclass instead
 * makes the loop rethrow, so the wakeup aborts rather than printing a line and
 * carrying on into intake, the reactor and push.
 */
export class ConnectorFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorFatalError";
  }
}

const registry = new Map<string, Connector>();

export function registerConnector(connector: Connector): void {
  registry.set(connector.name, connector);
}

export function getConnector(name: string): Connector | undefined {
  return registry.get(name);
}

export function getAllConnectors(): Connector[] {
  return Array.from(registry.values());
}
