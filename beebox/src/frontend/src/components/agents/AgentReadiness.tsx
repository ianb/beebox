/**
 * The no-agent state: while nothing can run a chat (no Claude Code or Codex
 * login, no OpenRouter key with a model), the composer is replaced by a
 * notice, and an owner opening the box lands on Admin → Agents. A packaged
 * install starts in this state, and its boxholder has no shell to fix it in.
 */

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { SYSTEM_CARD_PATHS } from "@shared/system-card-paths";
import { useAgentReadiness, useReconcileDefaultAgent } from "../../hooks/useAgentReadiness";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { href, toSearch } from "../../lib/routing";
import { legacyAdminRedirect } from "../../lib/system-card-navigation";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

function useOpenAdminAgents(): (options: { replace: boolean }) => void {
  const navigate = useNavigate();
  const { boxSlug } = useParams({ strict: false });
  return ({ replace }) => {
    const target = legacyAdminRedirect({ boxSlug: boxSlug ?? "", search: { tab: "agents" }, state: undefined });
    void navigate({ to: href(target.to), search: toSearch(target.search), replace });
  };
}

/** Renders `children` (the composer) unless no agent can run. Loading and
 * errors fall through to the composer: the run-time preflight still refuses
 * a send, so this never needs to fail closed. */
export function AgentGate({ children }: { children: ReactNode }) {
  const readiness = useAgentReadiness();
  const user = useCurrentUser();
  const openAdminAgents = useOpenAdminAgents();
  if (readiness.data?.anyReady !== false) return children;
  return (
    <Card id="bbx-chat-no-agent" background="warm" padding="md" className="m-3">
      <Stack gap="sm">
        <Text as="p" weight="semibold">No agent is connected yet</Text>
        {user?.isOwner ? (
          <>
            <Text as="p" size="sm" tone="subtle">
              Sign in to Claude Code or Codex, or add an OpenRouter key, to start chatting.
            </Text>
            <Button id="bbx-chat-connect-agent" intent="primary" className="self-start" onClick={() => openAdminAgents({ replace: false })}>
              Connect an agent
            </Button>
          </>
        ) : (
          <Text as="p" size="sm" tone="subtle">The box owner needs to connect an agent before chat can run.</Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Box-level effects, mounted once per box open: an owner whose box has no
 * usable agent is taken to Admin → Agents, and a broken default is moved to
 * a provider that works.
 */
export function AgentReadinessGuard() {
  const readiness = useAgentReadiness();
  const user = useCurrentUser();
  const isOwner = user?.isOwner === true;
  const location = useLocation();
  const openAdminAgents = useOpenAdminAgents();
  useReconcileDefaultAgent(isOwner);
  const decided = useRef(false);
  const anyReady = readiness.data?.anyReady;
  useEffect(() => {
    if (decided.current || anyReady === undefined || user === null) return;
    decided.current = true;
    const onAdmin = location.pathname.endsWith(`/views/${SYSTEM_CARD_PATHS.admin}`);
    if (isOwner && !anyReady && !onAdmin) openAdminAgents({ replace: true });
  }, [anyReady, user, isOwner, location.pathname, openAdminAgents]);
  return null;
}
