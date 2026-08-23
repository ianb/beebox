/**
 * Codex sandbox settings for a box agent.
 *
 * A box is a Git repository and committing is part of the agent's normal state
 * transition, not an optional capability. Codex's workspace-write sandbox
 * force-mounts `.git` read-only even when the repository root is an explicit
 * writable root, so it cannot satisfy that contract. This matches the Claude
 * backend's `bypassPermissions` posture and the Codex worktree launcher.
 */
export const CODEX_BOX_SANDBOX = "danger-full-access" as const;

export function codexBoxThreadSettings(): {
  approvalPolicy: "never";
  sandbox: typeof CODEX_BOX_SANDBOX;
} {
  return { approvalPolicy: "never", sandbox: CODEX_BOX_SANDBOX };
}

export function codexBoxTurnSettings(): {
  approvalPolicy: "never";
  sandboxPolicy: { type: "dangerFullAccess" };
} {
  return {
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  };
}
