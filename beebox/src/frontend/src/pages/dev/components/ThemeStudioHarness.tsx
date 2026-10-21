import { useNavigate, useSearch } from "@tanstack/react-router";
import { THEME_CATALOG } from "@shared/card-theme/core";
import { CardThemeSurface } from "../../../components/themes/ThemedFileCard/CardThemeSurface";
import { Markdown } from "../../../components/Markdown/body";
import { Button } from "../../../components/ui/Button";
import { CalloutStack } from "../../../components/chat/CalloutBlock";
import { ComposerSpecimen } from "./ComposerStatesHarness";
import { Card } from "../../../components/ui/Card";
import { Heading } from "../../../components/ui/Heading";
import { Hint } from "../../../components/ui/Hint";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";
import { SystemThemeSwatches } from "../../../components/themes/SystemThemePicker";

import { useDoodlebitMotion } from "../../../components/themes/useDoodlebitMotion";

const ROUTE = "/$boxSlug/dev-harness/dev/theme-studio";
const LEGACY_STUDY_IDS: Record<string, string> = {
  "phosphor-study": "phosphor",
  "overprint-study": "overprint",
  "posy-study": "posy",
};
function canonicalThemeId(name: string): string { return LEGACY_STUDY_IDS[name] ?? name; }
const SAMPLE = `A small collection of ideas for a neighborhood seed exchange. **Bring something simple**, and leave room for surprises.

## Before Saturday
- Choose three seed varieties
- Label each envelope clearly
- Save a few extras for visitors

> Small beginnings deserve a little space to grow.

{% quote from="Dana" treatment="layered" %}
Context: notes from the planning call. **Dana** asked for *shorter* labels.

### Aug 1
- **Dana:** Can we open at ten?
- **Lee:** Yes, and bring \`tape\`.
{% /quote %}

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

This sample includes **bold**, *italic*, ~~retired text~~ and a [sample link](#studio-reading).`;

const COMPOSER = {
  input: "Make a short checklist for Saturday",
  isTranscribing: false, transcript: "", speechPlaying: false,
  voicePaused: false, isStreaming: false, narrationEnabled: false,
  badge: false, muted: false, typingMode: false, typingLocked: false,
};

function noop() { /* The specimen never sends a message or opens a card. */ }

const FIELDS = [
  { key: "system", label: "System theme", list: "bbx-studio-system-names" },
  { key: "systemStock", label: "System stock", list: "bbx-studio-system-stocks" },
  { key: "card", label: "Card theme", list: "bbx-studio-card-names" },
  { key: "cardStock", label: "Card stock", list: "bbx-studio-card-stocks" },
] as const;

export function ThemeStudioHarness() {
  const search = useSearch({ from: ROUTE });
  const systemName = canonicalThemeId(search.system);
  const cardName = canonicalThemeId(search.card);
  const surface = useDoodlebitMotion(systemName === "doodlebit");
  const navigate = useNavigate({ from: "/$boxSlug/dev/theme-studio" });
  const system = THEME_CATALOG.find((theme) => theme.name === systemName);
  const card = THEME_CATALOG.find((theme) => theme.name === cardName);
  return <div className="bbx-theme-studio min-h-screen">
    <section aria-label="Theme studio controls" className="bg-white text-warm-900 px-3 py-2 border-b border-warm-200">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2">
        <h1 className="text-base font-semibold">Theme studio</h1>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {FIELDS.map(({ key, label, list }) => <label key={key} className="flex flex-col gap-1 text-xs" htmlFor={`bbx-studio-${key}`}>
          {label}
          <input id={`bbx-studio-${key}`} list={list} value={search[key]}
            className="w-full min-w-0 rounded border border-warm-300 px-2 py-1 text-sm"
            onChange={(event) => {
              // Router owns search state; replace avoids a history entry per keystroke.
              void navigate({ search: { ...search, [key]: event.target.value }, replace: true });
            }} />
        </label>)}
      </div>
      <datalist id="bbx-studio-system-names">
        {THEME_CATALOG.filter((theme) => theme.chrome).map((theme) => <option key={theme.name} value={theme.name}>{theme.label}</option>)}
        <option value="draft" />
        <option value="undertow" /><option value="deck-study" /><option value="patina-study" /><option value="rose-trellis-study" /><option value="gold-thread-study" />
      </datalist>
      <datalist id="bbx-studio-card-names">
        {THEME_CATALOG.filter((theme) => !theme.systemOnly).map((theme) => <option key={theme.name} value={theme.name}>{theme.label}</option>)}
        <option value="draft" />
        <option value="undertow" /><option value="deck-study" /><option value="patina-study" /><option value="rose-trellis-study" /><option value="gold-thread-study" />
      </datalist>
      <datalist id="bbx-studio-system-stocks">{(system?.stocks ?? ["neutral"]).map((stock) => <option key={stock} value={stock} />)}</datalist>
      <datalist id="bbx-studio-card-stocks">{(card?.stocks ?? ["neutral"]).map((stock) => <option key={stock} value={stock} />)}</datalist>
    </section>
    <div ref={surface} className="bbx-box-presentation min-h-screen" data-chrome-theme={systemName} data-chrome-stock={search.systemStock}>
      <NavigationSample />
      <div className="grid lg:grid-cols-2 gap-4 p-3 sm:p-5 items-start">
        <ConversationSample />
        <div className="min-w-0 space-y-4">
          <CardSample name={cardName} stock={search.cardStock} />
          <InterfaceSample name={cardName} stock={search.cardStock} />
        </div>
      </div>
    </div>
  </div>;
}

function ConversationSample() {
  return <section aria-label="Conversation styling sample" className="min-w-0">
    <div className="space-y-4 pb-4">
      <UserMessageSample />
      <div className="bbx-chat-reply-material bg-white rounded-lg px-4 py-3 text-warm-900">
        <Markdown prose="block" onNavigate={noop}>{"Start with labeled envelopes and a small welcome table. **Keep the instructions short** so everyone can join in."}</Markdown>
      </div>
      <CalloutStack callouts={[{ context: "Ready to review", body: "The draft checklist is ready. **Bring spare envelopes** for new arrivals." }]} />
    </div>
    <ComposerSpecimen spec={COMPOSER} includeControlIds showHeader={false} material />
  </section>;
}

function ReadingSample() {
  return <div className="bbx-card-content">
    <Markdown prose="block" onNavigate={noop}>{SAMPLE}</Markdown>
    <div className="flex flex-wrap items-center gap-3 mt-3">
      <label className="flex items-center gap-2 text-sm"><input id="bbx-studio-check" type="checkbox" /> Bring spare envelopes</label>
      <Button id="bbx-studio-action" size="sm" onClick={noop}>Sample action</Button>
      <Button id="bbx-studio-disabled" size="sm" intent="secondary" disabled>Disabled</Button>
    </div>
  </div>;
}

function CardSample({ name, stock }: { name: string; stock: string }) {
  return <div id="studio-reading" className="min-w-0">
    <CardThemeSurface theme={{ choice: { name, stock }, origin: { kind: "engine" }, problem: null }}
      title="A little room to grow" detail="Seed exchange · Saturday" symbol={null} boxSlug={undefined} mode="companion"
      properties={<><h2>Properties</h2><p>Fixed sample content for checking the back of a card.</p><dl><dt>Theme</dt><dd>{name} / {stock}</dd><dt>File</dt><dd>Seed exchange.doc.card</dd></dl></>}
    >
      <ReadingSample />
    </CardThemeSurface>
  </div>;
}

function InterfaceSample({ name, stock }: { name: string; stock: string }) {
  // Interface cards (Settings) render app panels inside the card material.
  return <CardThemeSurface theme={{ choice: { name, stock }, origin: { kind: "engine" }, problem: null }}
    title="Settings" detail="Interface card" symbol={null} boxSlug={undefined} mode="companion" properties={null}>
    <div className="bbx-card-content">
      <Card as="section" shadow material aria-label="System theme"><Stack gap="sm">
        <Heading level={2}>System theme</Heading>
        <Hint>Choose the toolbar and workspace surface for this box.</Hint>
        <SystemThemeSwatches busy={false} choice={{ name: "plain", stock: "neutral" }} disabled={false} idPrefix="bbx-studio-system-theme" onSelect={noop} />
        <Text size="xs" tone="muted">This box has its own system theme.</Text>
      </Stack></Card>
    </div>
  </CardThemeSurface>;
}

function NavigationSample() {
  // Match AppNav/nav.tsx: paper chrome paints the immediate inner div.
  return <div className="bbx-app-nav bg-gradient-to-r from-info-dark via-primary to-coral text-white flex-shrink-0 shadow-sm print:hidden" aria-label="Navigation styling sample">
    <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 text-sm">
      <span className="font-semibold">Seed exchange</span>
      <div className="flex gap-2">
        <Button id="bbx-studio-nav-chat" size="sm" aria-pressed onClick={noop}>Chat</Button>
        <Button id="bbx-studio-nav-notes" size="sm" intent="secondary" onClick={noop}>Notes</Button>
        <Button id="bbx-studio-nav-more" size="sm" intent="secondary" onClick={noop}>More</Button>
      </div>
    </div>
  </div>;
}

function UserMessageSample() {
  // Base row and bubble classes from chat/user-message/view.tsx (own message).
  return <div className="flex justify-end pl-12 sm:pl-24 py-1">
    <div className="relative min-w-0">
      <div className="bbx-chat-user-paper rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words">What should we prepare for the seed exchange?</div>
    </div>
  </div>;
}
