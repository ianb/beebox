/**
 * "Share location" entry for the composer's Add menu. Opt-in, web-only: the
 * first enable prompts for browser geolocation permission and posts the fix;
 * the agent reads it on demand via `cb location get`. Disabled (with an
 * explanatory label) where geolocation isn't available — e.g. a non-secure
 * context. Reads its own box slug, so it drops into the menu with no wiring.
 */

import { useParams } from "@tanstack/react-router";
import { MenuItem } from "../ui/Dropdown";
import { useLocationShare } from "../../hooks/useLocationShare";

function shareLabel(opts: { busy: boolean; error: string | null; enabled: boolean }): string {
  if (opts.busy) return "Requesting location…";
  if (opts.error !== null) return opts.error;
  if (opts.enabled) return "Sharing location ✓";
  return "Share location";
}

export function ShareLocationMenuItem() {
  const { boxSlug } = useParams({ strict: false });
  const { available, enabled, busy, error, toggle } = useLocationShare(boxSlug);

  if (!available) {
    return (
      <MenuItem onClick={() => {}} disabled>
        Location unavailable
      </MenuItem>
    );
  }

  return (
    <MenuItem onClick={toggle} disabled={busy} active={enabled} danger={error !== null} keepOpen>
      {shareLabel({ busy, error, enabled })}
    </MenuItem>
  );
}
