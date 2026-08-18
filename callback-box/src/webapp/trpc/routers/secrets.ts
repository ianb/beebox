/**
 * The boxholder's management surface for the machine secret store
 * (`docs/plans/secret-custody.md`, Track 2's management-surface bullet).
 *
 * Owner-gated throughout, and **no procedure here returns a secret value** —
 * not on a read, not as an echo after a write, not in an error message. Every
 * shape below is metadata: whether a slot holds a value, when it was last used,
 * what the last verification concluded. That is the whole point of a custody
 * store; a "just show me the key" affordance would hand every credential on the
 * machine to any browser session that reaches an owner's admin page.
 *
 * Two views, because the store is machine-level while a box's page is not
 * (Decision 8): `boxStatus` is this box's own situation — what it can resolve,
 * what it asked for and is still waiting on, which grants went stale — and
 * `machineView` is the whole store, reachable from any box's admin page since
 * there is no separate hub UI to put it in.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listSecretFormats, secretFormatWarnings } from "../../../core/secrets/format-registry.js";
import { SecretLifecycleError } from "../../../core/secrets/errors.js";
import {
  boxSecretStatus,
  grantSecret,
  listSecrets,
  removeSecret,
  revokeSecret,
  setSecret,
  type SecretListing,
} from "../../../core/secrets/lifecycle.js";
import { describeSecretProbe, probeSecret, type SecretVerified } from "../../../core/secrets/probe-registry.js";
import { loadSecretStore, secretAccessLevelSchema } from "../../../core/secrets/store.js";
import { boxSlug } from "../../../lib/box-slug.js";
import { router, ownerProcedure } from "../trpc.js";

/** Store names are flat identifiers; `name/<box>` is the per-box form. */
const secretNameSchema = z.string().min(1).max(200);

/**
 * Run a lifecycle mutation, turning its refusal into a client error that keeps
 * the store's own explanation. `SecretNotShareableError` in particular says WHY
 * a Telegram token cannot be shared — replacing that with "Bad Request" would
 * leave the boxholder staring at a button that does nothing.
 */
async function lifecycle<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    if (e instanceof SecretLifecycleError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    }
    throw e;
  }
}

/** One row of the machine-wide table — metadata only, never a value. */
function machineRow(listing: SecretListing): SecretListing & { probe: string | null } {
  return {
    ...listing,
    probe: describeSecretProbe({ name: listing.name, owningBox: listing.owningBox, shareable: listing.shareable }),
  };
}

export const secretsRouter = router({
  /**
   * This box's own situation. `suspect` is surfaced per name rather than left
   * for the reader to derive from `verified`, because it is the one piece of
   * state that means "act now": the last probe or the last real use was
   * rejected, so this key is probably expired.
   */
  boxStatus: ownerProcedure.query(async ({ ctx }) => {
    const slug = await boxSlug(ctx.boxRoot);
    const status = await boxSecretStatus(slug);
    const listings = new Map((await listSecrets()).map((entry) => [entry.name, entry]));
    return {
      slug,
      granted: status.granted.map((grant) => {
        const listing = listings.get(grant.name);
        return {
          ...grant,
          note: listing?.note ?? undefined,
          updated: listing?.updated ?? undefined,
          verified: listing?.verified ?? undefined,
          suspect: listing?.verified?.status === "failed",
          lastUsed: listing?.lastUsed?.[slug] ?? undefined,
          shareable: listing?.shareable ?? undefined,
          owningBox: listing?.owningBox ?? undefined,
          probe: describeSecretProbe({ name: grant.name, owningBox: listing?.owningBox, shareable: listing?.shareable }),
        };
      }),
      emptySlots: status.emptySlots,
      danglingGrants: status.danglingGrants,
      declaredHere: status.declaredHere,
    };
  }),

  /**
   * Every name on the machine with its grants across every box. Owner-gated and
   * name-only: the plan accepts that names are owner-visible across boxes (a
   * grant has to be makeable from somewhere), which is exactly why a name must
   * never itself carry sensitive content.
   */
  machineView: ownerProcedure.query(async ({ ctx }) => {
    const slug = await boxSlug(ctx.boxRoot);
    const secrets = (await listSecrets()).map(machineRow);
    const store = await loadSecretStore();
    const boxes = store.ok ? Object.keys(store.value.grants).toSorted() : [];
    return { thisBox: slug, boxes, secrets };
  }),

  /** The soft-format registry, fetched once so the UI can warn as the user types. */
  formatHints: ownerProcedure.query(() => listSecretFormats()),

  /**
   * Store or rotate a value, then verify it.
   *
   * Format warnings are returned WITH the success, never instead of it: the
   * plan is explicit that format checks warn and never block, because provider
   * formats drift and a hard gate would brick key entry on a prefix change. The
   * probe is awaited here — unlike the fire-and-forget one every other write
   * path uses — so the boxholder finds out in the same interaction whether the
   * key they just pasted actually works.
   */
  setValue: ownerProcedure
    .input(
      z.object({
        name: secretNameSchema,
        value: z.string().min(1),
        note: z.string().max(500).optional(),
        formatHint: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ input }): Promise<{ warnings: string[]; verified: SecretVerified }> => {
      const warnings = secretFormatWarnings({ name: input.name, value: input.value, formatHint: input.formatHint });
      await lifecycle(() =>
        setSecret({
          name: input.name,
          value: input.value,
          note: input.note,
          formatHint: input.formatHint,
        }),
      );
      const verified = await probeSecret({ name: input.name });
      return { warnings, verified };
    }),

  /** Grant a name to a box, or raise/lower an existing grant's access level. */
  grant: ownerProcedure
    .input(z.object({ box: z.string().min(1), name: secretNameSchema, access: secretAccessLevelSchema }))
    .mutation(async ({ input }) => {
      await lifecycle(() => grantSecret({ slug: input.box, name: input.name, access: input.access }));
      return { success: true };
    }),

  /**
   * Change an existing grant's access level. Same write as {@link grant}, but
   * it refuses when there is no grant to change — raising access is a different
   * decision from making a box able to resolve a secret at all, and a "raise"
   * that silently created a grant would be the wrong kind of surprise.
   */
  setAccess: ownerProcedure
    .input(z.object({ box: z.string().min(1), name: secretNameSchema, access: secretAccessLevelSchema }))
    .mutation(async ({ input }) => {
      const store = await loadSecretStore();
      if (!store.ok) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `The secret store could not be read: ${store.error}` });
      }
      if (store.value.grants[input.box]?.[input.name] === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Box "${input.box}" has no grant for "${input.name}" to change. Grant it first.`,
        });
      }
      await lifecycle(() => grantSecret({ slug: input.box, name: input.name, access: input.access }));
      return { success: true };
    }),

  revoke: ownerProcedure
    .input(z.object({ box: z.string().min(1), name: secretNameSchema }))
    .mutation(async ({ input }) => {
      await lifecycle(() => revokeSecret({ slug: input.box, name: input.name }));
      return { success: true };
    }),

  /** Drop an entry machine-wide. Grants naming it survive as dangling grants,
   *  which every view reports as such — a removal the boxholder can see. */
  remove: ownerProcedure.input(z.object({ name: secretNameSchema })).mutation(async ({ input }) => {
    await lifecycle(() => removeSecret(input.name));
    return { success: true };
  }),
});
