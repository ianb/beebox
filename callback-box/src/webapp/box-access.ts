/**
 * Per-box access predicate: the fail-closed "owner-only when
 * `allowedEmails` is missing/empty" rule. Factored out (Track D, chunk D3 —
 * `docs/plans/boxes-as-packages-v2.md`) so it lives in exactly one place
 * instead of being copied at each call site: the box's own ACL check
 * (`server-box-scope.ts`'s `addBoxAuthHook`), its `/auth/me`
 * accessible-boxes list (`routes/auth.ts`), the root `/api/boxes` listing
 * (`server-root.ts`), and the hub's box picker (`src/hub/box-picker.ts`).
 */

import { loadBoxConfig } from "./box-config.js";

/**
 * True when `email` may access the box at `boxRoot`: always true for the
 * configured owner, otherwise true only when the box's `allowedEmails`
 * explicitly lists it. Missing/empty `allowedEmails` means owner-only —
 * fail closed, not open to any authenticated user.
 */
export async function canAccessBox({
  boxRoot,
  email,
  ownerEmail,
}: {
  boxRoot: string;
  email: string;
  ownerEmail: string | null;
}): Promise<boolean> {
  if (ownerEmail && email === ownerEmail) return true;
  const config = await loadBoxConfig(boxRoot);
  return !!(config.allowedEmails?.length && config.allowedEmails.includes(email));
}
