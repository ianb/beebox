/**
 * The theme studio's floating controls: theme and stock pickers for the
 * system and the card, "Card follows system", and the screen size. Collapsed
 * to one "Studio" button; whether it is open is remembered per browser.
 * `controls=0` leaves it out (theme-check and the screen preview use that).
 */

import { useState } from "react";
import { THEME_CATALOG } from "@shared/card-theme/core";
import { defaultStockOf, pairedCard, type StudioCase } from "@shared/theme-studio-case";
import { SCREENS } from "@shared/theme-screens";
import { readStoredFlag, writeStoredFlag, type StoredFlag } from "../../../../lib/stored-flag";
import { CheckboxField, SelectField, TextField } from "../../../../components/ui/fields/field";

/** Theme names the studio's own CSS styles (`theme-studio-*.css`). */
export const STUDIO_THEMES = ["draft", "undertow", "deck-study", "patina-study", "rose-trellis-study", "gold-thread-study"] as const;
const OTHER = "\u0000other";
const OPEN_FLAG: StoredFlag = { storage: () => localStorage, key: "bbx-theme-studio-controls-open" };

function readOpen(): boolean {
  return readStoredFlag(OPEN_FLAG);
}
function writeOpen(open: boolean): void {
  writeStoredFlag(OPEN_FLAG, open);
}

export interface StudioState extends StudioCase {
  screen: string | undefined;
}

export function ThemeStudioControls({ state, onChange }: { state: StudioState; onChange: (next: StudioState) => void }) {
  const [open, setOpen] = useState(readOpen);
  const [follow, setFollow] = useState(() => {
    const paired = pairedCard(state);
    return paired.card === state.card && paired.cardStock === state.cardStock;
  });
  const toggle = () => { setOpen(!open); writeOpen(!open); };
  const setSystem = (system: Pick<StudioCase, "system" | "systemStock">) => {
    onChange({ ...state, ...system, ...(follow ? pairedCard(system) : {}) });
  };
  if (!open) {
    return <button type="button" id="bbx-studio-controls-open" onClick={toggle} aria-expanded={false}
      className="fixed bottom-3 right-3 z-[60] rounded-full bg-white text-warm-900 border border-warm-300 shadow px-3 py-1 text-xs font-semibold">Studio</button>;
  }
  const systemNames = [...THEME_CATALOG.filter((theme) => theme.chrome).map((theme) => theme.name), ...STUDIO_THEMES];
  const cardNames = [...THEME_CATALOG.filter((theme) => !theme.systemOnly).map((theme) => theme.name), ...STUDIO_THEMES];
  return <section aria-label="Theme studio controls" className="fixed bottom-3 right-3 z-[60] w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-auto rounded-lg bg-white text-warm-900 border border-warm-300 shadow-lg p-3 text-xs space-y-3">
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold">Theme studio</h2>
      <button type="button" id="bbx-studio-controls-close" onClick={toggle} aria-expanded className="rounded px-2 py-0.5 border border-warm-300">Hide</button>
    </div>
    <ThemeFields idPrefix="bbx-studio-system" label="System" names={systemNames} theme={state.system} stock={state.systemStock}
      onChange={(system, systemStock) => setSystem({ system, systemStock })} />
    <CheckboxField id="bbx-studio-card-follows" label="Card follows system" checked={follow} onChange={(checked) => {
      setFollow(checked);
      if (checked) onChange({ ...state, ...pairedCard(state) });
    }} />
    {follow ? null : <ThemeFields idPrefix="bbx-studio-card" label="Card" names={cardNames} theme={state.card} stock={state.cardStock}
      onChange={(card, cardStock) => onChange({ ...state, card, cardStock })} />}
    <SelectField id="bbx-studio-screen" label="Screen" value={state.screen ?? ""}
      options={[{ value: "", label: "Fill the window" },
        ...SCREENS.map((screen) => ({ value: screen.name, label: `${screen.label} · ${screen.width}×${screen.height}` }))]}
      onChange={(screen) => onChange({ ...state, screen: screen === "" ? undefined : screen })} />
  </section>;
}

/**
 * A theme picker and a stock picker. Each lists what the catalog knows plus
 * "Other…", which shows a text field: a name only in the URL is shown there.
 * Picking a theme resets the stock to the theme's default.
 */
function ThemeFields({ idPrefix, label, names, theme, stock, onChange }: {
  idPrefix: string;
  label: string;
  names: readonly string[];
  theme: string;
  stock: string;
  onChange: (theme: string, stock: string) => void;
}) {
  const stocks: readonly string[] = THEME_CATALOG.find((item) => item.name === theme)?.stocks ?? ["neutral"];
  const known = THEME_CATALOG.some((item) => item.name === theme);
  const notice = !names.includes(theme) ? `“${theme}” is not in the catalog or the studio's CSS; base styles show until CSS matches it.`
    : known && !stocks.includes(stock) ? `${label} theme ${theme} has no stock “${stock}”; base styles show.` : null;
  return <fieldset className="space-y-2">
    <legend className="font-semibold">{label}</legend>
    <OtherPicker id={`${idPrefix}-theme`} label="Theme" options={names} value={theme} labelOf={(name) => THEME_CATALOG.find((item) => item.name === name)?.label}
      // A typed name outside the catalog and the studies keeps the stock, so a draft can try one.
      onChange={(name) => onChange(name, names.includes(name) ? defaultStockOf(name) : stock)} />
    <OtherPicker key={theme} id={`${idPrefix}-stock`} label="Stock" options={stocks} value={stock} onChange={(next) => onChange(theme, next)} />
    {notice === null ? null : <p role="status" className="text-danger-dark">{notice}</p>}
  </fieldset>;
}

function OtherPicker({ id, label, options, value, onChange, labelOf }: {
  id: string;
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  labelOf?: (option: string) => string | undefined;
}) {
  const [other, setOther] = useState(!options.includes(value));
  const showOther = other || !options.includes(value);
  return <div className="space-y-1">
    <SelectField id={id} label={label} value={showOther ? OTHER : value}
      options={[...options.map((option) => ({ value: option, label: labelOf?.(option) ?? option })), { value: OTHER, label: "Other…" }]}
      onChange={(next) => {
        if (next === OTHER) { setOther(true); return; }
        setOther(false);
        onChange(next);
      }} />
    {showOther ? <TextField id={`${id}-other`} label={`${label} name`} hideLabel identifier value={value} placeholder="name" onChange={onChange} /> : null}
  </div>;
}
