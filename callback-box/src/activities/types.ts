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

/**
 * @deprecated Use `ActivityMcpConfig`. Retained as a type alias so
 * existing imports compile. The shape is the SDK's in-process server
 * config, NOT the old subprocess `{ command, args, env }` config.
 */
export type MCPServerConfig = ActivityMcpConfig;

export interface CreateInstanceCtx {
  boxRoot: string;
  name: string;
  displayName: string;
}

export interface ListInstancesCtx {
  boxRoot: string;
}
