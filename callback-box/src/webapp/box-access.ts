/**
 * Per-box access predicate: the fail-closed "owner-only when
 * `allowedEmails` is missing/empty" rule. Factored out (Track D, chunk D3 —
 * `docs/implemented-plans/boxes-as-packages-v2.md`) so it lives in exactly one place
 * instead of being copied at each call site: the box's own ACL check
 * (`server-box-scope.ts`'s `addBoxAuthHook`), its `/auth/me`
 * accessible-boxes list (`routes/auth.ts`), the root `/api/boxes` listing
 * (`server-root.ts`), and the hub's box picker (`src/hub/box-picker.ts`).
 */

import { loadBoxConfig } from "../core/box/config.js";
import { canonicalizeEmail } from "./local-users.js";
import { normalizeAllowedEmails } from "./box-config-write.js";

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
  const canonicalEmail = canonicalizeEmail(email);
  if (ownerEmail && canonicalEmail === canonicalizeEmail(ownerEmail)) return true;
  const config = await loadBoxConfig(boxRoot);
  const allowedEmails = normalizeAllowedEmails(config.allowedEmails ?? []);
  return allowedEmails.includes(canonicalEmail);
}

/**
 * Filter `boxes` down to the ones `email` may access, via `canAccessBox`.
 * The one place that loop is written -- shared by the root `/api/boxes`
 * listing (`server-root.ts`), the hub's `/api/boxes` (`src/hub/hub-server.ts`),
 * and the hub's box picker (`src/hub/box-picker.ts`) so they can't drift into
 * three different filtering rules.
 */
export async function filterAccessibleBoxes<T extends { boxRoot: string }>({
  boxes,
  email,
  ownerEmail,
}: {
  boxes: T[];
  email: string;
  ownerEmail: string | null;
}): Promise<T[]> {
  const accessible: T[] = [];
  for (const box of boxes) {
    if (await canAccessBox({ boxRoot: box.boxRoot, email, ownerEmail })) accessible.push(box);
  }
  return accessible;
}
