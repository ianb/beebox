import { THEME_CATALOG, type ResolvedCardTheme } from "@shared/card-theme/core";
import { themeOriginLabel } from "../../../themes/registry";
import type { ReactNode } from "react";
import type { FileData, FileRenderer } from "../../../file-type-registry";
import { rendererDisplayLabel } from "../../../lib/renderer-display-label";
import { Button } from "../../ui/Button";
import type { NavigateHint, ViewTarget } from "../../../lib/view-url";
import { useBoxPresentation } from "../BoxPresentationProvider";
import { useShowCardFront } from "./CardThemeSurface";
import { CardFacts, CardMentions } from "./CardProperties";
import { CardAttachments } from "./CardAttachments";
import { CardLastChange } from "./CardLastChange";
import { ThemeSwatchPicker } from "./ThemeSwatchPicker";
import { LandmarkSystemThemePicker } from "../SystemThemePicker";
import { isCardPath } from "../../file-view-data";

export interface ThemedFileCardPropertiesProps {
  data: FileData;
  theme: ResolvedCardTheme;
  boxSlug: string | undefined;
  renderers: FileRenderer[];
  active: FileRenderer;
  hasExplicitView: boolean;
  onSelect: (name: string | null) => void;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /** The actions menu, last on the face; `null` for a file with none. */
  actions: ReactNode;
}

/**
 * The back of a card: where it is filed and how it is found, what it carries,
 * who mentions it, then its appearance and alternate views, then actions.
 */
export function ThemedFileCardProperties(props: ThemedFileCardPropertiesProps) {
  const { data, theme, boxSlug, onNavigate, actions } = props;
  const isCard = isCardPath(data.path);
  return <>
    <h2>Properties</h2>
    {isCard ? <>
      <CardFacts data={data} boxSlug={boxSlug} onNavigate={onNavigate} />
      <CardAttachments path={data.path} onNavigate={onNavigate} />
      <CardLastChange path={data.path} onNavigate={onNavigate} />
    </> : <dl className="mt-4"><dt>Filed at</dt><dd>{data.path}</dd><dt>File type</dt><dd>Markdown</dd></dl>}
    <CardMentions path={data.path} onNavigate={onNavigate} />
    <Appearance data={data} theme={theme} isCard={isCard} boxSlug={boxSlug} />
    <ViewChooser {...props} />
    {actions === null ? null : <div className="mt-6">{actions}</div>}
  </>;
}

/**
 * One row naming the resolved appearance; the pickers sit under a closed
 * "Change" disclosure. The back unmounts when the card turns to its front, so
 * the disclosure is closed on each open of Properties.
 */
function Appearance({ data, theme, isCard, boxSlug }: {
  data: FileData; theme: ResolvedCardTheme; isCard: boolean; boxSlug: string | undefined;
}) {
  const presentation = useBoxPresentation();
  const label = THEME_CATALOG.find((item) => item.name === theme.choice.name)?.label ?? theme.choice.name;
  const isLandmark = isCard && data.type === "landmark";
  const canChange = isLandmark || (isCard && presentation?.data?.canEditCardThemes === true);
  return <section className="mt-6" aria-label="Appearance" data-card-section="appearance">
    <h3 className="text-sm font-semibold mb-2">Appearance</h3>
    <p className="text-sm">{label} {theme.choice.stock} · {themeOriginLabel(theme.origin)}</p>
    {canChange ? <details className="mt-2">
      <summary className="text-sm cursor-pointer">Change</summary>
      <ThemeSwatchPicker path={data.path} choice={theme.choice} hasOverride={data.frontmatter?.theme !== undefined} />
      {isLandmark ? <LandmarkSystemThemePicker boxKey={boxSlug ?? ""} path={data.path}
        contextDir={data.path.replace(/^\//, "").split("/").slice(0, -1).join("/")} /> : null}
    </details> : null}
  </section>;
}

/** Choosing a view turns the card over so the person sees what they chose. */
function ViewChooser({ data, renderers, active, hasExplicitView, onSelect }: ThemedFileCardPropertiesProps) {
  const showFront = useShowCardFront();
  const first = renderers.at(0);
  function choose(name: string | null) {
    onSelect(name);
    showFront();
  }
  return (
    <section className="mt-6" aria-label="View" data-card-section="view">
      <h3 className="text-sm font-semibold mb-2">View</h3>
      <div className="flex flex-wrap gap-2">
        {renderers.map((renderer) => <Button
          key={renderer.name}
          size="sm"
          intent={renderer === active ? "secondary" : "ghost"}
          aria-pressed={renderer === active}
          onClick={() => choose(renderer.name)}
        >{rendererDisplayLabel({ registeredName: renderer.name, filePath: data.path, hasTypeSpecificRenderer: first?.name !== "Card" })}</Button>)}
      </div>
      {first ? <div className="mt-2"><Button size="sm" intent="ghost" disabled={!hasExplicitView} onClick={() => choose(null)}>Use preferred view</Button></div> : null}
    </section>
  );
}
