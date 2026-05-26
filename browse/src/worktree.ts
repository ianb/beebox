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

export class BrowseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowseConfigError";
  }
}
