/**
 * The conversation strip (`docs/plans/conversation-strip.md`, Track B): one
 * card, small, across the top of the conversation's page, above both the
 * cards and the messages. The `strip` chat feature names the card; the box
 * agent sets it with `bbx chat strip set`. The person's dismiss sets it to
 * `dismissed`, which the agent sees in its snapshot.
 *
 * The card's content is card content, so the agent's interface scan skips
 * it as it skips the cards pane; the dismiss button stays addressable.
 */

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { boxRelativePath } from "@shared/box-path";
import { STRIP_DISMISSED, stripCardPath } from "@shared/strip-types";
import { errorMessage } from "@shared/error-guards";
import { setChatFeature } from "../../../../api";
import { FileView } from "../../../FileView/view";
import { CloseButton } from "../../../ui/CloseButton";
import { toastError } from "../../../ui/toast-store";
import { bbxSource } from "../../../../lib/source-tag";
import { useWorkspace } from "../../workspace/WorkspaceProvider/provider";
import type { ViewTarget } from "../../../../lib/view-url";

export function ConversationStrip({ features, sessionId, setChatFeatures }: {
  features: Record<string, string>;
  sessionId: string | null;
  setChatFeatures: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const workspace = useWorkspace();
  // A dismiss answer applies only while its conversation is still the open
  // one and no later dismiss has started; otherwise conversation A's answer
  // would overwrite conversation B's feature map (the narration toggle's rule).
  const requestIdRef = useRef(0);
  useEffect(() => {
    requestIdRef.current++;
  }, [sessionId]);
  const ref = stripCardPath(features.strip);
  if (ref === null) return null;
  const path = boxRelativePath(ref);
  const onNavigate = (target: ViewTarget) => {
    if (workspace === null) console.warn(`[strip] no workspace to open ${target.path} in`);
    else workspace.open(target, { label: target.path });
  };
  const dismiss = () => {
    // Optimistic, then reconciled from the server's answer; rolled back on a
    // refusal, since no event corrects a write the server refused.
    const requestId = ++requestIdRef.current;
    setChatFeatures((prev) => ({ ...prev, strip: STRIP_DISMISSED }));
    if (sessionId === null) {
      console.warn("[strip] dismissed with no session; hidden on this page only");
      return;
    }
    setChatFeature({ sessionId, feature: "strip", value: STRIP_DISMISSED })
      .then((res) => {
        if (requestIdRef.current === requestId) setChatFeatures(res.features);
      })
      .catch((e: unknown) => {
        console.warn(`[strip] dismiss failed: ${errorMessage(e)}`);
        toastError("Failed to dismiss the strip", { cause: e });
        if (requestIdRef.current === requestId) setChatFeatures((prev) => ({ ...prev, strip: ref }));
      });
  };
  return (
    <section aria-label="Strip" className="bbx-conversation-strip flex shrink-0 items-start min-w-0 border-b border-warm-200 bg-warm-50" {...bbxSource("card", path)}>
      <div data-bbx-scan="exclude" className="flex-1 min-w-0 overflow-y-auto" style={{ maxHeight: "min(12rem, 30vh)" }}>
        <FileView path={path} mode="strip" onNavigate={onNavigate} />
      </div>
      <CloseButton id="bbx-conversation-strip-dismiss" label="Dismiss strip" size="sm" className="shrink-0 m-1" onClick={dismiss} />
    </section>
  );
}
