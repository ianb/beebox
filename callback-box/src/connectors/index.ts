/**
 * Connector registry and types
 *
 * Connectors bridge external services to the filesystem.
 * Each connector:
 * - Pulls external state into the repo
 * - Executes commands by pushing actions back out
 * - Transforms between external formats and cards
 */

export interface Connector {
  /** Unique name for this connector */
  name: string;

  /** Command card types this connector can execute */
  handles: string[];

  /** Card types this connector creates on pull */
  produces: string[];

  /** Pull external state into the repo */
  pull(): Promise<PullResult>;

  /** Execute a command card */
  execute(cardPath: string, dryRun: boolean): Promise<ExecuteResult>;
}

export interface PullResult {
  success: boolean;
  created: string[];
  updated: string[];
  /** Cards that were pushed to the remote service (two-way sync) */
  pushed?: string[];
  error?: string;
}

export interface ExecuteResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
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

export function getConnectorForCardType(cardType: string): Connector | undefined {
  for (const connector of registry.values()) {
    if (connector.handles.includes(cardType)) {
      return connector;
    }
  }
  return undefined;
}
