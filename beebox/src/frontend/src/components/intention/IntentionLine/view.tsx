/**
 * A place's intention as one line: what the next piece of work there is, an
 * Open action for its prime card when it has one, and an × that hides the
 * line on this device until its text changes (docs/implemented-plans/place-intention.md,
 * Track B). The place page shows it first; the strip shows it above the
 * cards beside a chat in the place.
 *
 * The line is inline Markdown only (`MarkdownInline`). Open goes beside the
 * chat when the line sits in a workspace pane (`useOpenBeside`), else through
 * the caller's `onNavigate`, as the place page's links do.
 */

import { Text } from "../../ui/Text";
import { InlineAction } from "../../ui/InlineAction";
import { CloseButton } from "../../ui/CloseButton";
import { useMaterial } from "../../ui/material";
import { MarkdownInline } from "./MarkdownInline";
import { cardTarget, useOpenBeside } from "../../chat/workspace/use-open-beside/hook";
import { displayName } from "../../../lib/display-name";
import type { ViewTarget } from "../../../lib/view-url";
import type { PlacePayload } from "../../PlaceView/sections";

export type Intention = NonNullable<PlacePayload["intention"]>;

export function IntentionLine({ intention, landmarkPath, idPrefix, onNavigate, onDismiss }: {
  intention: Intention;
  /** The landmark card; relative links in the line resolve against it. */
  landmarkPath: string;
  /** Prefix for the controls' ids, one per surface (`bbx-place-intention`, `bbx-intention-strip`). */
  idPrefix: string;
  onNavigate: (target: ViewTarget) => void;
  onDismiss: () => void;
}) {
  const openBeside = useOpenBeside();
  const material = useMaterial(undefined);
  const { ref } = intention;
  return (
    <div className="flex items-start gap-2">
      <Text as="p" className="flex-1 min-w-0">
        <MarkdownInline onNavigate={onNavigate} basePath={landmarkPath}>{intention.text}</MarkdownInline>
        {ref === null ? null : (
          <>
            {" "}
            <InlineAction id={`${idPrefix}-open`} intent="emphatic" material={material} className="whitespace-nowrap"
              onClick={() => (openBeside ?? onNavigate)(cardTarget(ref))}>
              {`Open ${displayName(ref)}`}
            </InlineAction>
          </>
        )}
      </Text>
      <CloseButton id={`${idPrefix}-dismiss`} label="Hide this until it changes" size="sm" className="shrink-0 -my-1" onClick={onDismiss} />
    </div>
  );
}
