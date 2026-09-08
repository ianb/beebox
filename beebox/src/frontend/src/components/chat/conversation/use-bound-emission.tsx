import { useState } from "react";
import type { AttentionSnapshot, ConversationSelection, ConversationTarget, SendBinding } from "@shared/chat-composer-binding";
import { parseRef } from "@shared/ref-path";
import { acceptEmission, applyRestorePlan, planRestore } from "../../../input/targets/chat-target";
import type { ChatWitness } from "../../../input/targets/chat-assemble";
import type { Emission } from "../../../input/emission";
import type { EmissionStore } from "../../../input/emission-store";
import type { Receipt } from "../../../input/targets/receipts";
import type { CardSendFields } from "../InteractiveChat-card-hooks";
import { createPendingSendsStore } from "./pending-sends";
import { PendingSendStorageRecovery } from "./PendingSendStorageRecovery";
import { FailedConversationSends } from "./FailedConversationSends";
import type { ConversationControllerPool } from "./controller-pool";
import { trpc } from "../../../lib/trpc";

export interface EmissionDispatch {
  (emission: Emission): Promise<Receipt>;
  stage(emission: Emission): void;
  release(): void;
}
class ConversationNotReadyError extends Error {
  constructor(reason: string) { super(reason); this.name = "ConversationNotReadyError"; }
}
class RecoveryStorageUnavailableError extends Error {
  constructor() {
    super("Saved messages could not be loaded. Keep your draft and retry loading them.");
    this.name = "RecoveryStorageUnavailableError";
  }
}
class WrongConversationBoxError extends Error {
  constructor() {
    super("Return to the original box before sending this message");
    this.name = "WrongConversationBoxError";
  }
}
const preparationInterrupted = "Message preparation was interrupted. Review before retrying.";
const failureReason = (error: unknown) => error instanceof Error ? error.message : "Conversation delivery failed";

export function useBoundEmission(opts: {
  pool: ConversationControllerPool;
  target: ConversationTarget;
  selection?: ConversationSelection;
  attention?: AttentionSnapshot;
  emissionStore: EmissionStore;
  captureCardSend: () => CardSendFields;
  acceptCardSend?: (fields: CardSendFields) => void;
  getWitness: () => ChatWitness;
  onSent: () => void;
}) {
  const { pool, target, selection, attention, emissionStore, captureCardSend, acceptCardSend, getWitness, onSent } = opts;
  const [pending, setPending] = useState(() => {
    try { return createPendingSendsStore(sessionStorage, { boxSlug: pool.boxSlug, storageScope: pool.storageScope }); }
    catch (_cause) {
      // Null drives the visible recovery alert below and disables web sends.
      return null;
    }
  });
  const [error, setError] = useState<string | null>(pending === null ? new RecoveryStorageUnavailableError().message : null);
  const utils = trpc.useUtils();
  const capture = (nativeBinding?: SendBinding, nativeArg?: boolean): EmissionDispatch => {
    const native = nativeArg ?? false;
    // This check precedes every route-derived query/client operation.
    if (nativeBinding !== undefined && nativeBinding.boxSlug !== pool.boxSlug) throw new WrongConversationBoxError();
    if (!native && pending === null) throw new RecoveryStorageUnavailableError();
    if (nativeBinding === undefined && selection !== undefined && selection.kind !== "ready") {
      const reason = selection.kind === "resolving" ? "Wait for the conversation to resolve" : selection.reason;
      throw new ConversationNotReadyError(reason);
    }
    const chosen = nativeBinding?.target ?? target;
    const features = pool.controller(chosen).getSnapshot().context.seedFeatures;
    const binding: SendBinding = nativeBinding ?? {
      boxSlug: pool.boxSlug,
      target: chosen.kind === "start" ? { ...chosen, seedFeatures: { ...chosen.seedFeatures, ...features } } : chosen,
      attention: attention ?? { surface: "chat", transcript: "visible" },
    };
    const handle = pool.capture(binding);
    const witnessed = getWitness();
    const cardFields = captureCardSend();
    const focused = binding.attention.focusedRef;
    const witness = attention !== undefined || nativeBinding !== undefined
      ? { ...witnessed, zoomedView: focused === undefined ? null : `view:${focused.startsWith("/") ? focused.slice(1) : focused}` }
      : witnessed;
    const fields = attention !== undefined || nativeBinding !== undefined
      ? { ...cardFields, openCard: focused === undefined ? undefined : parseRef(focused).path,
        ...(focused !== undefined && parseRef(focused).path === cardFields.openCard ? {} : { cardActivity: undefined, cardState: undefined }) }
      : cardFields;
    let preparedId: string | undefined;
    let dispatched = false;
    const release = () => {
      if (!native && !dispatched && preparedId !== undefined) pending?.rejected(preparedId, preparationInterrupted);
      handle.release();
    };
    const prepare = (emission: Emission) => {
      try {
        if (!native) pending?.prepare(emission, binding);
        preparedId = emission.id;
        setError(null);
      } catch (cause) { setError(failureReason(cause)); release(); throw cause; }
    };
    const dispatch = (emission: Emission): Promise<Receipt> => {
      // Synchronous durable stage: callers clear only after this returns.
      try { if (!native) pending?.stage(emission, binding); }
      catch (cause) { setError(failureReason(cause)); release(); throw cause; }
      setError(null);
      dispatched = true;
      const complete = (receipt: Receipt): Receipt => {
        if (receipt.disposition !== "rejected" && fields.cardActivity !== undefined) acceptCardSend?.(cardFields);
        if (!native) {
          if (receipt.disposition === "rejected") pending?.rejected(emission.id, receipt.reason);
          else pending?.accepted(emission.id);
        }
        return receipt;
      };
      let receipt: Promise<Receipt>;
      try { receipt = acceptEmission(emission, { witness, cardFields: fields, binding, send: handle.send }); }
      catch (cause) {
        release();
        return Promise.resolve(complete({ disposition: "rejected", emissionId: emission.id, reason: failureReason(cause) }));
      }
      onSent();
      return receipt.then(complete, (cause: unknown) => complete({ disposition: "rejected", emissionId: emission.id, reason: failureReason(cause) }))
        .then(async (settled) => {
          // The pool persists first-start acceptance metadata before a native
          // receipt can let the native repository release its recovery copy.
          try { await handle.finished(); }
          catch (cause) { setError(failureReason(cause)); }
          finally { release(); }
          // Cleanup failure cannot reverse the backend's acceptance receipt.
          return settled;
        });
    };
    return Object.assign(dispatch, { stage: prepare, release });
  };
  const dispatchNativeEmission = async (emission: Emission, binding?: SendBinding): Promise<Receipt> => {
    let dispatch: EmissionDispatch | undefined;
    try {
      // Capture checks box identity and the pool's frozen API base BEFORE a
      // directory request can accidentally use another box's route client.
      dispatch = capture(binding, true);
      if (binding !== undefined && binding.target.kind === "session") {
        const directory = await utils.chat.directoryFor.fetch({ sessionId: binding.target.sessionId });
        if (directory.contextDir !== binding.target.contextDir) {
          dispatch.release();
          return { disposition: "rejected", emissionId: emission.id, reason: "Conversation destination no longer matches this message" };
        }
      }
      return await dispatch(emission);
    } catch (cause) {
      dispatch?.release();
      return { disposition: "rejected", emissionId: emission.id, reason: failureReason(cause) };
    }
  };
  const failedRegion = <>
    {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
    <PendingSendStorageRecovery boxSlug={pool.boxSlug} storageScope={pool.storageScope} blocked={pending === null}
      onRecovered={(store) => { setPending(store); setError(null); }} />
    {pending !== null && <FailedConversationSends store={pending}
      onRetry={async (row) => { await capture(row.binding)(row.emission); }}
      onRestore={(row) => { applyRestorePlan(emissionStore.editor, planRestore(emissionStore.get(), row.emission)); }} />}
  </>;
  return { captureEmissionDispatch: capture, dispatchNativeEmission, failedRegion };
}
