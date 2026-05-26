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
   * Subdirectories under box/inbox/ that this connector owns. Used by
   * `cb wakeup --connector <name>` to scope inbox scanning and to tag
   * any intake jobs it creates with `source="<name>"`. Empty if the
   * connector creates job cards directly without staging inbox items.
   */
  inboxPaths: string[];

  /**
   * How this connector was triggered. Set by the caller before sync().
   * Included as a "Triggered-By" trailer on commits.
   * Examples: "cb wakeup", "cb wakeup --connector rss", "cb finalize"
   */
  triggeredBy?: string;

  /** Sync external state with the repo */
  sync(): Promise<SyncResult>;
}

export interface SyncResult {
  success: boolean;
  created: string[];
  updated: string[];
  /** Cards that were pushed to the remote service (two-way sync) */
  pushed?: string[];
  /** Job cards created during sync */
  jobs?: string[];
  error?: string;
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
