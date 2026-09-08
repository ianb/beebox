/** Same-origin dev worktrees are distinct boxes. Keep production keys compatible. */
export function conversationStorageScope(apiBase: string): string {
  return apiBase.replace(/^\//, "").replace(/\/api\/?$/, "");
}
