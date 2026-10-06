import { createJevService, serializeJevRequest, type JevDecision, type JevService } from "../../../../services/jev.js";
import { getOpenRouterKey } from "../../../openrouter.js";
import { boundRoutingContexts } from "./catalog.js";
import type { RoutingCandidate } from "../policy.js";

/**
 * Ask Jev where one quick chat message belongs. Returns null when the box has
 * no OpenRouter key granted and no injected service; throws `JevError` when
 * the provider fails. The judged candidates come back with their context
 * bounded to the request budget, which is what the record keeps.
 */
export async function judgeQuickChat(
  { boxRoot, jev }: { boxRoot: string; jev: JevService | undefined },
  state: { message: string; candidates: RoutingCandidate[] },
): Promise<(JevDecision & { candidates: RoutingCandidate[] }) | null> {
  let service = jev;
  if (service === undefined) {
    const key = await getOpenRouterKey(boxRoot, { purpose: "quick-chat-routing" });
    if (!key) return null;
    service = createJevService({ apiKey: key });
  }
  const criteria = Object.fromEntries(state.candidates.map(candidate => [candidate.id, `${candidate.label}: ${candidate.target.kind}. Use the matching candidate in state for its context and rubric.`]));
  const overhead = serializeJevRequest({ state: { ...state, candidates: [] }, criteria }).length - 2;
  const candidates = boundRoutingContexts(state.candidates, Math.min(60_000, 80_000 - overhead));
  return { ...await service.decide({ state: { ...state, candidates }, criteria }), candidates };
}
