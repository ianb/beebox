/**
 * Whether the box has an agent that can run (a Claude Code or Codex login, or
 * an OpenRouter key with an added model). Polls while nothing can, so the
 * chat unblocks soon after a sign-in elsewhere, and refetches on focus.
 */

import { useEffect, useRef } from "react";
import { trpc } from "../lib/trpc/client";

const NOT_READY_POLL_MS = 30_000;

export function useAgentReadiness() {
  return trpc.agents.readiness.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.anyReady === false ? NOT_READY_POLL_MS : false),
  });
}

/**
 * Owner only: when some agent can run but the box's default cannot (the owner
 * signed in to Codex while the default is Claude Code), move the default to
 * one that works. Runs once per readiness answer that calls for it.
 */
export function useReconcileDefaultAgent(isOwner: boolean) {
  const readiness = useAgentReadiness();
  const utils = trpc.useUtils();
  const reconcile = trpc.agents.reconcileDefault.useMutation({
    onSuccess: async (result) => {
      if (!result.switched) return;
      await Promise.all([utils.agents.readiness.invalidate(), utils.admin.boxConfig.invalidate()]);
    },
  });
  const data = readiness.data;
  const needsSwitch = isOwner && data !== undefined && data.anyReady && "defaultReady" in data && !data.defaultReady;
  const attempted = useRef<typeof data>(undefined);
  useEffect(() => {
    if (!needsSwitch || attempted.current === data) return;
    attempted.current = data;
    reconcile.mutate();
  }, [needsSwitch, data, reconcile]);
}

/** Refresh readiness when a sign-in section reports a new login. */
export function useRefreshAgentReadinessOnLogin(signedIn: boolean) {
  const utils = trpc.useUtils();
  const previous = useRef(signedIn);
  useEffect(() => {
    if (signedIn && !previous.current) void utils.agents.readiness.invalidate();
    previous.current = signedIn;
  }, [signedIn, utils]);
}
