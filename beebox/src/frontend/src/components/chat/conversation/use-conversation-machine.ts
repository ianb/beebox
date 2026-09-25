import { useEffect, useMemo, useState } from "react";
import { useSelector } from "@xstate/react";
import type { ConversationTarget } from "@shared/chat-composer-binding";
import type { ChatMachineInput } from "../../../machines/chat-types";
import { useBusSubscription } from "../../../hooks/useBusSubscription";
import { busEventData } from "../../../lib/bus-events";
import { ConversationControllerPool, conversationKey, type SessionAssignment } from "./controller-pool";

/**
 * The target a conversation starts from when no caller supplied one.
 *
 * `model` is as much a part of a start choice as `engine`. Dropping it here
 * left a cross-engine pick landing on the new engine's DEFAULT model — the
 * two-step switch of
 * `issues/bugs/2026-08-30-engine-switch-forces-default-model-first.md`, which
 * survived the picker fix because the other construction site
 * (`everywhere/resolve-conversation.ts`) carries the model and this one did
 * not. Exported so that stays covered.
 */
export function conversationTargetFor(input: ChatMachineInput, clientConversationId: string): ConversationTarget {
  const contextDir = input.contextDir ?? "";
  if (input.sessionInput !== "new") {
    return { kind: "session", sessionId: input.sessionInput, contextDir };
  }
  return {
    kind: "start",
    clientConversationId,
    contextDir,
    engine: input.startEngine === "codex" ? "codex" : "claude",
    ...(input.startModel === undefined ? {} : { model: input.startModel }),
  };
}

export function useConversationMachine(opts: {
  boxSlug: string;
  input: ChatMachineInput;
  target?: ConversationTarget;
  onSessionAssignment?: (sessionId: string, assignment?: SessionAssignment) => void;
}) {
  const freshId = useMemo(() => crypto.randomUUID(), []);
  const target: ConversationTarget = useMemo(
    () => opts.target ?? conversationTargetFor(opts.input, freshId),
    [opts.target, opts.input, freshId],
  );
  const pool = useMemo(() => new ConversationControllerPool(opts.boxSlug, { storage: { getItem: (key) => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value) } }), [opts.boxSlug]);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const key = conversationKey(target);
  const controller = useMemo(() => pool.controller(target, opts.input), [pool, target, opts.input]);
  useEffect(() => {
    pool.select(target, opts.input);
  }, [pool, key, target, opts.input]);
  useEffect(() => {
    pool.setAssignmentHandler(opts.onSessionAssignment);
  }, [pool, opts.onSessionAssignment]);
  useEffect(() => { pool.setRecoveryHandler(setRecoveryNotice); }, [pool]);
  useEffect(() => pool.attach(), [pool]);
  useBusSubscription({ onEvent: (event) => {
    const assigned = busEventData(event, "chat-session-assigned");
    if (assigned !== null) pool.markReady(assigned.sessionId);
  } });
  const snapshot = useSelector(controller, (value) => value);
  return { snapshot, send: controller.send, pool, target, recoveryNotice };
}
