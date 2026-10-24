import { useParams } from "@tanstack/react-router";
import { withBase } from "../../../api";
import { ExternalIconLink } from "../../ui/ExternalIconLink";
import { OpenInPanelButton } from "../../ui/OpenInPanelButton";
import type { FileViewMode } from "../../file-view-types";

/** The header actions of a card shown in chat or with a sidebar; the theme studio renders them too. */
export function CardSurfaceActions({ mode, path, onOpenInPanel }: {
  mode: FileViewMode;
  path: string;
  onOpenInPanel?: (() => void) | undefined;
}) {
  const { boxSlug } = useParams({ strict: false });
  return <>
    {mode === "chat" ? <span className="bbx-card-chat-path" title={path}>{path}</span> : null}
    {onOpenInPanel ? <OpenInPanelButton onClick={onOpenInPanel} label="Open in sidebar" size="sm" /> : null}
    {mode === "chat" ? <ExternalIconLink href={withBase(`/${boxSlug}/browse/${path}`)} label="Open in browse view (new tab)" size="sm" /> : null}
  </>;
}
