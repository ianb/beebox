/**
 * A card in the conversation strip (`docs/plans/conversation-strip.md`):
 * frameless, drawn by the strip's box view or a built-in renderer that
 * declares `strip: true` (`strip-choice.ts`). A card that is gone, fails to
 * load, or has no strip rendering shows one line naming its path; the strip
 * around it keeps its dismiss button.
 */

import type { ReactNode } from "react";
import { useFileData } from "../file-view-data";
import { getRenderers } from "../../file-type-registry";
import { useStripViewBinding } from "../../lib/view-bindings";
import { Text } from "../ui/Text";
import { ActiveFileRenderer, AuthoredRendererMarker } from "./ActiveFileRenderer";
import { stripRendererChoice } from "./strip-choice";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";

function StripNotice({ path }: { path: string }) {
  return <Text as="p" size="sm" tone="muted" className="px-3 py-2">This card can no longer be shown here: {path}</Text>;
}

export function StripFileView({ path, onNavigate, renderInline }: {
  path: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  renderInline: (target: ViewTarget) => ReactNode;
}) {
  const { data, loading, error } = useFileData(path);
  const binding = useStripViewBinding(data?.type);
  if (loading) return <Text as="p" size="sm" tone="muted" className="px-3 py-2" aria-busy="true">Loading…</Text>;
  if (error !== null || data === null) return <StripNotice path={path} />;
  const choice = stripRendererChoice({ binding, renderers: getRenderers(path, data) });
  switch (choice.kind) {
    case "none":
      return <StripNotice path={path} />;
    case "view":
      return <ActiveFileRenderer active={{ name: choice.binding.name, Component: AuthoredRendererMarker, priority: 100 }} binding={choice.binding}
        data={data} path={path} mode="strip" onNavigate={onNavigate} renderInline={renderInline} />;
    case "builtin":
      return <ActiveFileRenderer active={choice.renderer} binding={null} data={data} path={path} mode="strip" onNavigate={onNavigate} renderInline={renderInline} />;
  }
}
