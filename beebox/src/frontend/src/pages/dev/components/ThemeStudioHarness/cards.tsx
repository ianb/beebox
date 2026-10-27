/**
 * The theme studio's card column: companion desks as the workspace draws
 * them (WorkspaceCanvas/view.tsx), each a real tab strip over its card. The
 * reading card is the real Markdown card view on fixed fields and body; the
 * interface card holds app panels in the card material.
 */

import type { ReactNode } from "react";
import { MarkdownCardView } from "../../../../components/MarkdownCardView/view";
import { SidecarTabStrip } from "../../../../components/chat/workspace/SidecarTabStrip/view";
import { workspacePanelId } from "../../../../components/chat/workspace/address";
import type { PanelTab } from "../../../../components/chat/InteractiveChat-controls";
import type { ResolvedCardTheme } from "@shared/card-theme/core";
import { CardThemeSurface } from "../../../../components/themes/ThemedFileCard/CardThemeSurface";
import { SystemThemeSwatches } from "../../../../components/themes/SystemThemePicker";
import { Button } from "../../../../components/ui/Button";
import { Card } from "../../../../components/ui/Card";
import { Heading } from "../../../../components/ui/Heading";
import { Hint } from "../../../../components/ui/Hint";
import { Stack } from "../../../../components/ui/Stack";
import { Text } from "../../../../components/ui/Text";
import type { CardIdentity } from "../../../../hooks/useCardIdentities";
import { useCompanionMaterial } from "../../../../hooks/useCompanionMaterial";
import { PaneControls } from "../../../../components/chat/workspace/PaneControls";
import { useMobileChatViewport } from "../../../../components/chat/everywhere/use-mobile-card-navigation";
import { Pre } from "../../../../components/ui/Pre";
import { Image } from "../../../../components/ui/Image";
import { Row } from "../../../../components/ui/Row";
import { CaptionedFigure } from "../../../../components/FigureView/view";
import { MaterialContext } from "../../../../components/ui/material";

/**
 * Stands in for an embedded figure, which paints its own light panel whatever
 * the card theme; shapes only, since the figure's own text is not themed.
 */
const WIDGET_ART = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120"><rect width="320" height="120" fill="#fafafa"/><rect x="16" y="14" width="288" height="6" rx="3" fill="#ddd"/><rect x="16" y="14" width="90" height="6" rx="3" fill="#8ab4f8"/><circle cx="106" cy="17" r="7" fill="#8ab4f8"/>${[0, 1, 2, 3, 4].map((i) => `<circle cx="${60 + i * 50}" cy="${80 - (i % 2) * 14}" r="11" fill="${i % 2 === 0 ? "#7cbf72" : "#d9534f"}"/>`).join("")}</svg>`,
)}`;

function noop() { /* The specimen never opens, pins or closes a card. */ }

const SAMPLE = `A small collection of ideas for a neighborhood seed exchange. **Bring something simple**, and leave room for surprises.

## Before Saturday
- Choose three seed varieties
- Label each envelope clearly
- Save a few extras for visitors

> Small beginnings deserve a little space to grow.

Lee said {% quote from="Lee" %}bring \`tape\` and a pen{% /quote %} twice.

{% quote from="Dana" treatment="layered" %}
Context: notes from the planning call. **Dana** asked for *shorter* labels.

### Aug 1
- **Dana:** Can we open at ten?
- **Lee:** Yes, and bring \`tape\`.
{% /quote %}

## On the day

> **Reminder:** the hall closes at noon.
>
> - Sweep the tables
> - Return the keys

| Variety | Packets |
| --- | ---: |
| Marigold | 12 |
| Basil | 8 |

\`\`\`text
doors open: 10:00
bring: seeds + curiosity
\`\`\`

## Sources

The hall is free {% source href="https://example.org/hall-hours" retrieved="2026-10-01" %}until noon on Saturdays{% /source %}.

{% source href="https://example.org/seed-saving" %}
Dry seeds for a week before you seal the envelope.
{% /source %}

Last year's list {% source ref="../../../outside-the-box.md" %}ran out by eleven{% /source %}. {% todo %}Order envelopes {% see-also ref="../../../outside-the-box.md" %}the old supplier{% /see-also %}{% /todo %}

This sample includes **bold**, *italic*, ~~retired text~~ and a [sample link](#before-saturday).`;

const READING_PATH = "notes/Seed exchange.doc.card";
const SETTINGS_PATH = "_config/interface/settings.card";
const FILE_PATH = "notes/packing-list.txt";

function tab(path: string, { label, pinned }: { label: string; pinned: boolean }): PanelTab {
  return { target: { path, viewer: null, params: {}, viewState: null }, label, pinned, lastActiveAt: 0 };
}

/**
 * A companion desk: the tab strip and pane controls, then the active file as
 * the desk's direct child. A card is themed (`data-active-card`); any other
 * file sits on a neutral desk.
 */
function CompanionDesk({ id, tabs, active, identities, content, children }: {
  id: string;
  tabs: PanelTab[];
  active: string;
  identities: Map<string, CardIdentity>;
  content: "card" | "neutral";
  children: ReactNode;
}) {
  const material = useCompanionMaterial(active);
  const mobile = useMobileChatViewport();
  return <div ref={material} data-active-card={content === "card" || undefined} className="bbx-companion-desk relative flex flex-col min-w-0 min-h-0">
    <div className="bbx-companion-tabs flex shrink-0 items-stretch min-w-0">
      <SidecarTabStrip id={id} tabs={tabs} activePath={active} identities={identities} boxSlug={undefined}
        onSelectTab={noop} onCloseTab={noop} onTogglePin={noop} />
      <PaneControls pane="left" mobile={mobile} focused={false} pdfMenu={null} onAction={noop} />
    </div>
    <div role="tabpanel" id={workspacePanelId(active)} aria-hidden={false} data-card-content={content} className="bbx-interface-card-desk flex-1 min-h-0">
      <MaterialContext.Provider value={content === "neutral"}>{children}</MaterialContext.Provider>
    </div>
  </div>;
}

type Theme = ResolvedCardTheme;

function ReadingCard({ theme }: { theme: Theme }) {
  const { name, stock } = theme.choice;
  return <CardThemeSurface theme={theme} title="A little room to grow" detail="Seed exchange · Saturday" symbol={null} boxSlug={undefined} mode="companion"
    properties={<><h2>Properties</h2><p>Fixed sample content for checking the back of a card.</p><dl><dt>Theme</dt><dd>{name} / {stock}</dd><dt>File</dt><dd>{READING_PATH}</dd></dl></>}>
    <MarkdownCardView mode="companion" onNavigate={noop} data={{
      path: READING_PATH, kind: "frontmatter", type: "doc", schema: null, body: SAMPLE,
      frontmatter: { status: "planning", hall: "Grange hall", volunteers: ["Dana", "Lee"], host: { ref: "people/Dana.person.card" } },
    }} />
    <div className="bbx-card-content">
      <CaptionedFigure caption="Drag the slider to warm the seed tray: germination starts near 20 °C">
        <img src={WIDGET_ART} alt="" className="block w-full" />
      </CaptionedFigure>
      <Row justify="center" className="my-2">
        <Image src={WIDGET_ART} alt="Seed tray sketch" size="chat" caption="An image embed shows its caption beneath" />
      </Row>
    </div>
    <div className="bbx-card-content flex flex-wrap items-center gap-3 mt-3">
      <label className="flex items-center gap-2 text-sm"><input id="bbx-studio-check" type="checkbox" /> Bring spare envelopes</label>
      <Button id="bbx-studio-action" size="sm" onClick={noop}>Sample action</Button>
      <Button id="bbx-studio-disabled" size="sm" intent="secondary" disabled>Disabled</Button>
    </div>
  </CardThemeSurface>;
}

/** Interface cards (Settings) render app panels inside the card material. */
function SettingsCard({ theme }: { theme: Theme }) {
  return <CardThemeSurface theme={theme} title="Settings" detail="Interface card" symbol={null} boxSlug={undefined} mode="companion" properties={null}>
    <div className="bbx-card-content"><SystemThemePanel /></div>
  </CardThemeSurface>;
}

function SystemThemePanel() {
  return <Card as="section" shadow material aria-label="System theme"><Stack gap="sm">
    <Heading level={2}>System theme</Heading>
    <Hint>Choose the toolbar and workspace surface for this box.</Hint>
    <SystemThemeSwatches busy={false} choice={{ name: "plain", stock: "neutral" }} disabled={false} idPrefix="bbx-studio-system-theme" onSelect={noop} />
    <Text size="xs" tone="muted">This box has its own system theme.</Text>
    <Text size="xs" tone="danger">The last change could not be saved.</Text>
  </Stack></Card>;
}

export function StudioCards({ name, stock }: { name: string; stock: string }) {
  const theme: Theme = { choice: { name, stock }, origin: { kind: "engine" }, problem: null };
  // Tabs carry the card theme in their identities, as a card's own theme would.
  const identity = (title: string, glyph: string): CardIdentity => ({ title, symbol: { glyph }, type: "doc", cardTheme: { name, stock } });
  const identities = new Map([
    [READING_PATH, identity("Seed exchange", "🌱")],
    ["notes/Welcome table.doc.card", identity("Welcome table", "🪧")],
    [SETTINGS_PATH, identity("Settings", "⚙️")],
    ["notes/Volunteers.doc.card", identity("Volunteers", "🙋")],
  ]);
  return <div className="min-w-0 space-y-4">
    <CompanionDesk id="bbx-studio-tabs-reading" active={READING_PATH} identities={identities} content="card"
      tabs={[tab(READING_PATH, { label: "Seed exchange", pinned: true }), tab("notes/Welcome table.doc.card", { label: "Welcome table", pinned: false })]}>
      <ReadingCard theme={theme} />
    </CompanionDesk>
    <CompanionDesk id="bbx-studio-tabs-settings" active={SETTINGS_PATH} identities={identities} content="card"
      tabs={[tab(SETTINGS_PATH, { label: "Settings", pinned: false }), tab("notes/Volunteers.doc.card", { label: "Volunteers", pinned: false })]}>
      <SettingsCard theme={theme} />
    </CompanionDesk>
    <CompanionDesk id="bbx-studio-tabs-file" active={FILE_PATH} identities={identities} content="neutral"
      tabs={[tab(FILE_PATH, { label: "packing-list.txt", pinned: false })]}>
      <Pre className="m-4">{"envelopes  40\nlabels     2 sheets\ntape       1 roll\npens       6"}</Pre>
    </CompanionDesk>
  </div>;
}
