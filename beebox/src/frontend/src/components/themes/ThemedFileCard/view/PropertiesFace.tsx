import { THEME_CATALOG, type ResolvedCardTheme } from "@shared/card-theme/core";
import { themeOriginLabel } from "../../../../themes/registry";
import { useState, type MouseEvent, type ReactNode } from "react";
import type { FileData, FileRenderer } from "../../../../file-type-registry";
import { rendererDisplayLabel } from "../../../../lib/renderer-display-label";
import { Button } from "../../../ui/Button";
import type { NavigateHint, ViewTarget } from "../../../../lib/view-url";
import { useBoxPresentation } from "../../BoxPresentationProvider";
import { useShowCardFront } from "../CardThemeSurface";
import { CardFacts, CardMentions } from "./CardProperties";
import { CardAttachments } from "./CardAttachments";
import { CardLastChange } from "./CardLastChange";
import { Text } from "../../../ui/Text";
import { ThemeSwatchPicker } from "../ThemeSwatchPicker";
import { LandmarkSystemThemePicker } from "../../SystemThemePicker";
import { isCardPath } from "../../../file-view-data";
import { isRecord } from "@shared/is-record";
import { resolveRelativePath } from "../../../../lib/view-url";
import { copyFileText, copyImageFile } from "../../../../lib/copy-file-to-clipboard";
import { printCard } from "../../../../lib/print-card";
import { CheckboxField } from "../../../ui/fields/field";

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
  /** A phone could reach this page's address, so Print can offer a QR code (`lib/off-machine-origin.ts`). */
  qrReachable?: boolean;
}

/**
 * The back of a card: where it is filed and how it is found, what it carries,
 * who mentions it, then its appearance and alternate views, then actions.
 */
export function ThemedFileCardProperties(props: ThemedFileCardPropertiesProps) {
  const { data, theme, boxSlug, onNavigate, actions } = props;
  const isCard = isCardPath(data.path);
  // MaterialContext comes from the back of the card (CardThemeSurface).
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
    </details> : !isCard ? <Text size="xs" tone="muted">Markdown files take the box's appearance; set a theme on a card.</Text>
      : presentation?.data ? <Text size="xs" tone="muted">Sign in to change this setting.</Text> : null}
  </section>;
}

/** Choosing a view turns the card over so the person sees what they chose. */
function ViewChooser({ data, renderers, active, hasExplicitView, onSelect, qrReachable }: ThemedFileCardPropertiesProps) {
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
      <CopyContents data={data} qrReachable={qrReachable === true} />
    </section>
  );
}

/** One copy button; says "Copied" or "Copy failed" for two seconds after a click. */
function CopyButton({ label, copy }: { label: string; copy: () => Promise<void> }) {
  return <Button size="sm" intent="ghost" onClick={copy} flash={{ label: "Copied", failLabel: "Copy failed" }}>{label}</Button>;
}

/** The image file an image card points at, resolved against the card's path. */
function imageCardFile(data: FileData): string | null {
  if (data.type !== "image" || !isRecord(data.frontmatter?.filename)) return null;
  const ref = data.frontmatter.filename.ref;
  return typeof ref === "string" ? resolveRelativePath(data.path, ref) : null;
}

/** Copy the file's whole original text, and for an image card the image too; or print the card. */
function CopyContents({ data, qrReachable }: { data: FileData; qrReachable: boolean }) {
  const image = imageCardFile(data);
  // A QR code is opt-in, and offered only when a phone could reach this
  // address (never for localhost).
  const [qr, setQr] = useState(false);
  /** Prints the card's front alone, from whichever card this Properties face belongs to. */
  function handlePrint(event: MouseEvent<HTMLButtonElement>) {
    const card = event.currentTarget.closest<HTMLElement>(".bbx-card-surface");
    if (card !== null) printCard(card, { qr: qrReachable && qr });
  }
  return <div className="mt-2 flex flex-wrap items-center gap-2">
    <CopyButton label="Copy original text" copy={() => copyFileText(data.path)} />
    {image === null ? null : <CopyButton label="Copy image" copy={() => copyImageFile(image)} />}
    <Button size="sm" intent="ghost" onClick={handlePrint}>Print</Button>
    {qrReachable ? <CheckboxField label="Add QR code" checked={qr} onChange={setQr} /> : null}
  </div>;
}
