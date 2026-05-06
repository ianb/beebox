import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

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

/**
 * In-process MCP server config — what `ActivityMode.mcpServer()` returns.
 * Built by `createSdkMcpServer({ name, tools })` from
 * `@anthropic-ai/claude-agent-sdk`. Tools live in the callback-box server
 * process and close over the `ActivityInstance`/`box` state directly,
 * with no subprocess hop or env-var passing.
 */
export type ActivityMcpConfig = McpSdkServerConfigWithInstance;

export interface CreateInstanceCtx {
  boxRoot: string;
  name: string;
  displayName: string;
}

export interface ListInstancesCtx {
  boxRoot: string;
}
