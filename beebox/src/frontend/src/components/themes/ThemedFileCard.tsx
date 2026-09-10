import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { withBase } from "../../api";
import { ExternalIconLink } from "../ui/ExternalIconLink";
import { resolveCardTheme } from "@shared/card-theme";
import { CardThemeSurface } from "./CardThemeSurface";
import { useBoxPresentation } from "./BoxPresentationProvider";
import { themeOriginLabel } from "../../themes/registry";
import type { FileData, FileRenderer } from "../../renderers";
import type { FileViewMode } from "../file-view-types";
import { rendererDisplayLabel } from "../../lib/renderer-display-label";
import { displayName } from "../../lib/display-name";
import { Button } from "../ui/Button";
import { CardActions } from "../card-actions/CardActions";
import { OpenInPanelButton } from "../ui/OpenInPanelButton";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
import { CardFacts, CardMentions } from "./CardProperties";
import { ThemeSwatchPicker } from "./ThemeSwatchPicker";
import { LandmarkSystemThemePicker } from "./SystemThemePicker";
import { isCardPath } from "../file-view-data";

interface ThemedFileCardProps {
  data: FileData;
  mode: Exclude<FileViewMode, "embed">;
  renderers: FileRenderer[];
  active: FileRenderer;
  target: ViewTarget;
  hasExplicitView: boolean;
  onSelect: (name: string | null) => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  onFocus: () => void;
  onClose?: (() => void) | undefined;
  onOpenInPanel?: (() => void) | undefined;
  children: ReactNode;
}


function FileSpecificProperties({ data, theme, isCard }: { data: FileData; theme: ReturnType<typeof resolveCardTheme>; isCard: boolean }) {
  if (isCard) return <><CardFacts data={data} /><ThemeSwatchPicker path={data.path} choice={theme.choice} hasOverride={data.frontmatter?.theme !== undefined} /></>;
  return <dl className="mt-4"><dt>Filed at</dt><dd>{data.path}</dd><dt>File type</dt><dd>Markdown</dd></dl>;
}

function RelatedFileProperties({ data, target, boxSlug, onNavigate, onClose }: {
  data: FileData; target: ViewTarget; boxSlug: string | undefined;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  onClose?: (() => void) | undefined;
}) {
  if (!isCardPath(data.path)) return <CardMentions path={data.path} onNavigate={onNavigate} />;
  return <>
    {data.type === "landmark" ? <LandmarkSystemThemePicker boxKey={boxSlug ?? ""} path={data.path}
      contextDir={data.path.replace(/^\//, "").split("/").slice(0, -1).join("/")} /> : null}
    <CardMentions path={data.path} onNavigate={onNavigate} />
    <div className="mt-6"><CardActions target={target} onTrashed={onClose} vertical="above" /></div>
  </>;
}

export function ThemedFileCard({ data, mode, renderers, active, target, hasExplicitView, onSelect, onNavigate, onFocus, onClose, onOpenInPanel, children }: ThemedFileCardProps) {

  const { boxSlug } = useParams({ strict: false });
  const presentation = useBoxPresentation();
  const isCard = isCardPath(data.path);
  const presentationType = data.type ?? "";
  if (presentation !== null && !presentation.data && presentation.error === null) {
    return <div className="p-6" aria-busy="true"><div className="h-6 w-2/3 bg-warm-100 rounded" /><div className="h-32 mt-4 bg-warm-50 rounded" /><span className="sr-only">Loading card appearance</span></div>;
  }
  const theme = resolveCardTheme({
    path: data.path.replace(/^\//, ""),
    type: presentationType,
    cardChoice: isCard ? data.frontmatter?.theme : undefined,
    typeDefault: presentation?.data?.typeDefaults[presentationType],
    presentation: presentation?.data?.presentation ?? { status: "absent" },
  });
  const title = typeof data.frontmatter?.title === "string" ? data.frontmatter.title : displayName(data.path);
  const error = presentation?.error ?? theme.problem?.message;
  const first = renderers.at(0);
  function handlePresentationRetry() { presentation?.retry(); }
  const properties = (
    <>
      <h2>Properties</h2>
      <dl>
        <dt>Theme</dt><dd>{theme.choice.name}</dd>
        <dt>Stock</dt><dd>{theme.choice.stock}</dd>
        <dt>Chosen by</dt><dd>{themeOriginLabel(theme.origin)}</dd>
      </dl>
      <FileSpecificProperties data={data} theme={theme} isCard={isCard} />
      <div className="mt-6">
        <h3 className="text-sm font-semibold mb-2">View</h3>
        <div className="flex flex-wrap gap-2">
          {renderers.map((renderer) => <Button
            key={renderer.name}
            size="sm"
            intent={renderer === active ? "secondary" : "ghost"}
            aria-pressed={renderer === active}
            onClick={() => onSelect(renderer.name)}
          >{rendererDisplayLabel({ registeredName: renderer.name, filePath: data.path, hasTypeSpecificRenderer: first?.name !== "Card" })}</Button>)}
        </div>
        {first ? <div className="mt-2"><Button size="sm" intent="ghost" disabled={!hasExplicitView} onClick={() => onSelect(null)}>Use preferred view</Button></div> : null}
      </div>
      <RelatedFileProperties data={data} target={target} boxSlug={boxSlug} onNavigate={onNavigate} onClose={onClose} />
    </>
  );
  return <CardThemeSurface
    theme={theme} title={title} mode={mode} onFocus={onFocus}
    properties={properties}
    actions={mode === "chat" || onOpenInPanel ? <CardSurfaceActions mode={mode} path={data.path} onOpenInPanel={onOpenInPanel} /> : null}
    problem={error ? <div className="bbx-card-problem" role="status">Appearance could not be applied: {error}{presentation ? <Button size="sm" intent="ghost" onClick={handlePresentationRetry}>Retry</Button> : null}</div> : null}
  >{children}</CardThemeSurface>;
}

function CardSurfaceActions({ mode, path, onOpenInPanel }: {
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
