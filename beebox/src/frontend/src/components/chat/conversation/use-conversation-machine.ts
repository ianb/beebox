import { useEffect, useMemo, useState } from "react";
import { useSelector } from "@xstate/react";
import type { ConversationTarget } from "@shared/chat-composer-binding";
import type { ChatMachineInput } from "../../../machines/chat-types";
import { useBusSubscription } from "../../../hooks/useBusSubscription";
import { busEventData } from "../../../lib/bus-events";
import { ConversationControllerPool, conversationKey, type SessionAssignment } from "./controller-pool";

export function useConversationMachine(opts: {
  boxSlug: string;
  input: ChatMachineInput;
  target?: ConversationTarget;
  onSessionAssignment?: (sessionId: string, assignment?: SessionAssignment) => void;
}) {
  const freshId = useMemo(() => crypto.randomUUID(), []);
  const target: ConversationTarget = useMemo(() => opts.target ?? (opts.input.sessionInput === "new"
    ? { kind: "start", clientConversationId: freshId, contextDir: opts.input.contextDir ?? "", engine: opts.input.startEngine === "codex" ? "codex" : "claude" }
    : { kind: "session", sessionId: opts.input.sessionInput, contextDir: opts.input.contextDir ?? "" }), [opts.target, opts.input.sessionInput, opts.input.contextDir, opts.input.startEngine, freshId]);
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
