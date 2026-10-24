/**
 * The theme studio's floating controls: theme and stock pickers for the
 * system and the card, "Card follows system", and the screen size. Collapsed
 * to one "Studio" button; whether it is open is remembered per browser.
 * `controls=0` leaves it out (theme-check and the screen preview use that).
 */

import { useState, type ReactNode } from "react";
import { THEME_CATALOG } from "@shared/card-theme/core";
import { defaultStockOf, pairedCard, type StudioCase } from "@shared/theme-studio-case";
import { SCREENS } from "@shared/theme-screens";
import { readStoredFlag, writeStoredFlag, type StoredFlag } from "../../../../lib/stored-flag";

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
    <label className="flex items-center gap-2" htmlFor="bbx-studio-card-follows">
      <input id="bbx-studio-card-follows" type="checkbox" checked={follow} onChange={(event) => {
        setFollow(event.target.checked);
        if (event.target.checked) onChange({ ...state, ...pairedCard(state) });
      }} />
      Card follows system
    </label>
    {follow ? null : <ThemeFields idPrefix="bbx-studio-card" label="Card" names={cardNames} theme={state.card} stock={state.cardStock}
      onChange={(card, cardStock) => onChange({ ...state, card, cardStock })} />}
    <Field label="Screen" htmlFor="bbx-studio-screen">
      <select id="bbx-studio-screen" value={state.screen ?? ""} className="w-full rounded border border-warm-300 px-1 py-1 text-sm"
        onChange={(event) => onChange({ ...state, screen: event.target.value === "" ? undefined : event.target.value })}>
        <option value="">Fill the window</option>
        {SCREENS.map((screen) => <option key={screen.name} value={screen.name}>{screen.label} · {screen.width}×{screen.height}</option>)}
      </select>
    </Field>
  </section>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1"><label htmlFor={htmlFor}>{label}</label>{children}</div>;
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
  return <Field label={label} htmlFor={id}>
    <select id={id} value={showOther ? OTHER : value} className="w-full rounded border border-warm-300 px-1 py-1 text-sm"
      onChange={(event) => {
        if (event.target.value === OTHER) { setOther(true); return; }
        setOther(false);
        onChange(event.target.value);
      }}>
      {options.map((option) => <option key={option} value={option}>{labelOf?.(option) ?? option}</option>)}
      <option value={OTHER}>Other…</option>
    </select>
    {showOther ? <input id={`${id}-other`} aria-label={`${label} name`} value={value} placeholder="name"
      className="w-full rounded border border-warm-300 px-2 py-1 text-sm" onChange={(event) => onChange(event.target.value)} /> : null}
  </Field>;
}
