/**
 * Which box instance this page is talking to, as a browser-storage key segment.
 *
 * Every browser-storage key for per-box state is scoped by this. The reason is
 * the dev router: it serves every checkout from ONE origin at
 * `/<main|worktree>/<box>/…`, so two worktrees can each have a `test1` and a
 * bare box slug does not tell them apart. Keying by slug alone let one
 * checkout's state reach another's — including temporary attachment paths owned
 * by the other clone, which the receiving clone then reports as expired.
 *
 * In production `apiBase` is `/api`, so the scope is the empty string and a
 * caller can keep writing exactly the key it wrote before. That is deliberate:
 * a boxholder's unsent draft must not be orphaned by a dev-only fix.
 *
 * The name follows the `storageScope` variable and prop this is threaded
 * through. It was `conversationStorageScope`, after its first caller, and then
 * grew a second definition — but the value is about the box instance, not
 * conversations, and drafts want the same one.
 */
export function storageScopeFor(apiBase: string): string {
  return apiBase.replace(/^\//, "").replace(/\/api\/?$/, "");
}
