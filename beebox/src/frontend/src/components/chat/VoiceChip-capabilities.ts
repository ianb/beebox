/**
 * `voice.capabilities` query wiring — split out of VoiceChip.tsx to keep
 * that file under the 300-line cap.
 *
 * `ownerProcedure`: gated on `enabled` (the caller passes `canManageDefaults`
 * == isOwner, same gate `hqPreferences` uses) rather than fetched and its
 * FORBIDDEN suppressed. Undefined `.data` (loading, or gated off for a
 * non-owner) means the picker treats every option as usable — it never
 * blocks on this query. `staleTime` is generous since a grant added on the
 * Admin page won't invalidate this query itself; `refetchCapabilities` lets
 * the caller refresh on menu open instead.
 */

import { trpc } from "../../lib/trpc";
import type { RouterOutput } from "../../lib/trpc";

export function useVoiceCapabilities(enabled: boolean): {
  data: RouterOutput["voice"]["capabilities"] | undefined;
  refetch: () => void;
} {
  const query = trpc.voice.capabilities.useQuery(undefined, { enabled, staleTime: 30_000 });
  return { data: query.data, refetch: () => { void query.refetch(); } };
}
