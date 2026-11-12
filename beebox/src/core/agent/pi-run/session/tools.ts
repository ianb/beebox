/**
 * Which pi tools a run may use, and the shell those tools run in.
 *
 * pi runs inside the box server's process, so its bash tool would inherit
 * the server's environment, secrets included. The bash tool here gets the
 * environment every other box agent gets (`buildScriptEnv`) instead.
 */

import { createBashToolDefinition, defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * The built-in tools a pi run may have. `grep` and `find` are left out: with
 * no local ripgrep/fd binary, pi downloads one from GitHub on first use. The
 * agent has `rg` through bash.
 */
export const PI_BUILTIN_TOOLS = ["read", "bash", "edit", "write", "ls"] as const;

/** The session variables pi's bash tool sets for the model to inspect (`tools/bash.js`). */
const PI_SESSION_VARIABLES = ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"];

/**
 * pi's tool allowlist for an invocation's `tools` (`AgentInvokeOptions.tools`):
 * omitted means every built-in above, `[]` none, and a list keeps only names
 * that are built-ins above. pi's allowlist filters custom tools too, so their
 * names are always added.
 */
export function piToolAllowlist(tools: readonly string[] | undefined, customToolNames: readonly string[]): string[] {
  const builtins: readonly string[] = PI_BUILTIN_TOOLS;
  const chosen = tools === undefined ? builtins : builtins.filter((name) => tools.includes(name));
  return [...new Set([...chosen, ...customToolNames])];
}

/**
 * pi's bash tool with its environment replaced by `scriptEnv`, keeping only
 * pi's own session variables from the environment pi built. Registered as a
 * custom tool named `bash`, it takes the place of the built-in one.
 */
export function piBashTool(cwd: string, scriptEnv: NodeJS.ProcessEnv): ToolDefinition {
  return defineTool(createBashToolDefinition(cwd, {
    spawnHook: (context) => {
      const sessionVariables = Object.fromEntries(PI_SESSION_VARIABLES.flatMap((name) => {
        const value = context.env[name];
        return value === undefined ? [] : [[name, value]];
      }));
      return { ...context, env: { ...scriptEnv, ...sessionVariables } };
    },
  }));
}
