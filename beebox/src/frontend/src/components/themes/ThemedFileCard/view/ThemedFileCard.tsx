import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { resolveCardTheme } from "@shared/card-theme/core";
import { CardThemeSurface } from "../CardThemeSurface";
import { ThemedFileCardProperties } from "./PropertiesFace";
import { CardPrintFooter } from "./CardPrintFooter";
import { CardSurfaceActions } from "../CardSurfaceActions";
import { isOffMachineOrigin } from "../../../../lib/off-machine-origin";
import { useBoxPresentation } from "../../BoxPresentationProvider";
import type { FileData, FileRenderer } from "../../../../file-type-registry";
import type { FileViewMode } from "../../../file-view-types";
import { cardTitle } from "../../../../lib/card-title";
import { Button } from "../../../ui/Button";
import { CardActions } from "../../../card-actions/CardActions";
import type { NavigateHint, ViewTarget } from "../../../../lib/view-url";
import { isCardPath } from "../../../file-view-data";
import { readCardSymbol } from "@shared/card-symbol";

interface ThemedFileCardProps {
  data: FileData;
  mode: Exclude<FileViewMode, "embed">;
  renderers: FileRenderer[];
  active: FileRenderer;
  target: ViewTarget;
  hasExplicitView: boolean;
  onSelect: (name: string | null) => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  onClose?: (() => void) | undefined;
  onOpenInPanel?: (() => void) | undefined;
  children: ReactNode;
}

export function ThemedFileCard({ data, mode, renderers, active, target, hasExplicitView, onSelect, onNavigate, onClose, onOpenInPanel, children }: ThemedFileCardProps) {

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
    systemTheme: presentation?.data?.chrome.choice.name,
  });
  const title = cardTitle(data);
  const symbol = isCard ? readCardSymbol(data.frontmatter?.symbol, { cardPath: data.path.replace(/^\//, "") }) : null;
  const error = presentation?.error ?? theme.problem?.message;
  function handlePresentationRetry() { presentation?.retry(); }
  const here = new URL(window.location.href);
  return <CardThemeSurface
    theme={theme} title={title} detail={data.detail} symbol={symbol} boxSlug={boxSlug} mode={mode}
    properties={<ThemedFileCardProperties
      data={data} theme={theme} boxSlug={boxSlug} renderers={renderers} active={active}
      hasExplicitView={hasExplicitView} onSelect={onSelect} onNavigate={onNavigate}
      actions={isCard ? <CardActions target={target} onTrashed={onClose} vertical="above" /> : null}
      qrReachable={isOffMachineOrigin(here)} />}
    actions={mode === "chat" || onOpenInPanel ? <CardSurfaceActions mode={mode} path={data.path} onOpenInPanel={onOpenInPanel} /> : null}
    problem={error ? <div className="bbx-card-problem" role="status">Appearance could not be applied: {error}{presentation ? <Button size="sm" intent="ghost" onClick={handlePresentationRetry}>Retry</Button> : null}</div> : null}
  >{children}<CardPrintFooter boxSlug={boxSlug} path={data.path} here={here} /></CardThemeSurface>;
}
