export interface WorktreeContext {
  repoDir: string;
  worktree: string;
  box: string;
  port: number;
  routerBase: string;
}

export function detectWorktreeContext(): WorktreeContext {
  const repoDir = process.env["BROWSE_REPO_DIR"];
  if (repoDir === undefined || repoDir === "") {
    throw new BrowseConfigError("BROWSE_REPO_DIR is not set. Invoke via bin/browse, not directly.");
  }
  const explicit = process.env["BROWSE_WORKTREE"];
  const worktreeMatch = repoDir.match(/\/callback-worktrees\/([^/]+)/);
  const worktree = explicit !== undefined && explicit !== ""
    ? explicit
    : (worktreeMatch !== null && worktreeMatch[1] !== undefined ? worktreeMatch[1] : "main");
  // Box slug is just "test1" — the dev router clones the base test1 box
  // into a per-worktree copy and registers it under that slug.
  const box = process.env["BROWSE_BOX"] !== undefined && process.env["BROWSE_BOX"] !== ""
    ? process.env["BROWSE_BOX"]
    : "test1";
  const portStr = process.env["ROUTER_PORT"];
  const port = portStr !== undefined && portStr !== "" ? Number.parseInt(portStr, 10) : 3210;
  if (!Number.isFinite(port) || port <= 0) {
    throw new BrowseConfigError(`ROUTER_PORT is not a valid port: ${String(portStr)}`);
  }
  const routerBase = `http://localhost:${String(port)}/${worktree}/${box}`;
  return { repoDir, worktree, box, port, routerBase };
}

export function rewriteOpenUrl(url: string, ctx: WorktreeContext): string {
  if (url.startsWith("//")) return url;
  if (url.startsWith("/")) return `${ctx.routerBase}${url}`;
  return url;
}

/**
 * The box agent-token (`.callback-box/agent-token`, 0600 — see
 * callback-box's `src/core/agent/token.ts`), when `bin/browse` found one
 * for this worktree's box and exported it as `BROWSE_AGENT_TOKEN`. Auth is
 * on by default in dev, and the box's per-request auth preHandler already
 * accepts this bearer as box-scoped authentication
 * (`server-box-scope.ts` `verifyAgentBearer`) for every in-box request,
 * page navigations included.
 */
function agentToken(): string | undefined {
  const token = process.env["BROWSE_AGENT_TOKEN"];
  return token !== undefined && token !== "" ? token : undefined;
}

/**
 * `true` when `url` (already run through `rewriteOpenUrl`) targets this
 * worktree's own dev origin. Guards the bearer injection below so the
 * token — which authenticates as this box — never rides along to an
 * unrelated host a browse invocation happens to navigate to.
 */
export function isOwnOrigin(url: string, ctx: WorktreeContext): boolean {
  return url === ctx.routerBase || url.startsWith(`${ctx.routerBase}/`) || url.startsWith(`${ctx.routerBase}?`);
}

/**
 * The `Authorization` header to attach for `url`, or `null` when there's
 * no token to inject (no agent-token file yet — not every target needs
 * auth) or `url` isn't this worktree's own origin. Callers pass the result
 * straight to agent-browser's origin-scoped `open <url> --headers <json>`.
 */
export function authHeaderFor(url: string, ctx: WorktreeContext): Record<string, string> | null {
  const token = agentToken();
  if (token === undefined || !isOwnOrigin(url, ctx)) return null;
  return { Authorization: `Bearer ${token}` };
}

export class BrowseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowseConfigError";
  }
}
