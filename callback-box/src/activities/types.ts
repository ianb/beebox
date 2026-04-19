export interface ActivityMetadata {
  title: string;
  description: string;
  iconDescription: string;
  singleton: boolean;
}

export interface InstanceSummary {
  name: string;
  displayName: string;
  createdAt: string;
}

export interface MCPServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface CreateInstanceCtx {
  boxRoot: string;
  name: string;
  displayName: string;
}

export interface ListInstancesCtx {
  boxRoot: string;
}
