import type { ReactNode } from "react";
import { themeComposition } from "@shared/card-theme/catalog";
import { THEME_CATALOG, systemCardThemes, type ResolvedThemeChoice, type ThemeChoice, type ThemeDescriptor } from "@shared/card-theme/core";
import { trpc } from "../../../lib/trpc/client";
import { themeLabel } from "../../../themes/registry";
import { useBoxPresentation } from "../BoxPresentationProvider";
import { Button } from "../../ui/Button";

const CARD_THEMES: readonly ThemeDescriptor[] = THEME_CATALOG.filter((theme) => !theme.systemOnly);

/**
 * The card themes that go with the system theme come first, the system
 * theme's default leading; a chosen theme outside that set sits above them;
 * every other card theme waits behind a closed disclosure.
 */
export function ThemeSwatchPicker({ path, choice, hasOverride }: { path: string; choice: ResolvedThemeChoice; hasOverride: boolean }) {
  const presentation = useBoxPresentation();
  const utils = trpc.useUtils();
  const mutation = trpc.card.setTheme.useMutation({
    onSuccess: async () => { await utils.card.get.invalidate({ path }); },
  });
  function select(theme: ThemeChoice | null) {
    mutation.mutate({ path, theme });
  }
  if (!presentation?.data?.canEditCardThemes) return null;
  const systemTheme = presentation.data.chrome.choice.name;
  const pairedNames = systemCardThemes(systemTheme);
  const paired = pairedNames.flatMap((name) => CARD_THEMES.filter((theme) => theme.name === name));
  const chosen = hasOverride && !pairedNames.includes(choice.name) ? CARD_THEMES.filter((theme) => theme.name === choice.name) : [];
  const others = CARD_THEMES.filter((theme) => !pairedNames.includes(theme.name) && !chosen.includes(theme));
  const systemDefault = paired.at(0);
  const defaultBadge = `${themeLabel(systemTheme)} default`;
  const swatch = ({ name, label, stock, isDefault }: { name: string; label: string; stock: string; isDefault: boolean }) => (
    <Swatch key={`${name}/${stock}`} name={name} label={label} stock={stock} pressed={choice.name === name && choice.stock === stock}
      badge={isDefault ? defaultBadge : null} disabled={mutation.isPending}
      onSelect={() => select({ name, stock })} />
  );
  const swatches = (themes: readonly ThemeDescriptor[]) => themes.flatMap((theme) => theme.stocks.map((stock: string) =>
    swatch({ name: theme.name, label: theme.label, stock, isDefault: theme === systemDefault && stock === theme.defaultStock })));
  // Theme names and stocks are open values: a box-authored one has no catalog
  // swatch, so the card's own choice is drawn as written.
  const listed = CARD_THEMES.some((theme) => theme.name === choice.name && stocksOf(theme).includes(choice.stock));
  const unlisted = hasOverride && !listed ? swatch({ name: choice.name, label: themeLabel(choice.name), stock: choice.stock, isDefault: false }) : null;
  return (
    <section className="mt-2" aria-label="Choose card appearance" aria-busy={mutation.isPending}>
      {unlisted !== null || chosen.length > 0 ? <SwatchGroup title="This card">{unlisted}{swatches(chosen)}</SwatchGroup> : null}
      <SwatchGroup title={`Goes with ${themeLabel(systemTheme)}`}>{swatches(paired)}</SwatchGroup>
      {others.length > 0 ? <details className="mt-3">
        <summary className="text-sm cursor-pointer">All card themes</summary>
        <SwatchGroup title="Other card themes">{swatches(others)}</SwatchGroup>
      </details> : null}
      <div className="mt-3">
        <Button size="sm" intent="ghost" disabled={!hasOverride || mutation.isPending} onClick={() => select(null)}>Use default</Button>
        <span className="text-xs ml-2">{hasOverride ? "This card has its own appearance." : "Following the box, card type, and system theme defaults."}</span>
      </div>
      {mutation.isPending ? <p role="status" className="text-sm mt-2">Saving appearance…</p> : null}
      {mutation.data?.commitWarning ? <p role="status" className="text-sm mt-2">{mutation.data.commitWarning}</p> : null}
      {mutation.error ? <p role="alert" className="text-sm text-danger mt-2">Could not save appearance: {mutation.error.message}</p> : null}
    </section>
  );
}

/** A catalog theme's stocks as plain strings, to compare against an open stock value. */
function stocksOf(theme: ThemeDescriptor): readonly string[] {
  return theme.stocks;
}

function SwatchGroup({ title, children }: { title: string; children: ReactNode }) {
  return <div role="group" aria-label={title}>
    <h4 className="bbx-theme-swatch-group">{title}</h4>
    <div className="bbx-theme-swatches">{children}</div>
  </div>;
}

function Swatch({ name, label, stock, pressed, badge, disabled, onSelect }: {
  name: string; label: string; stock: string; pressed: boolean; badge: string | null; disabled: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="bbx-theme-swatch-button"
      aria-label={`${label} — ${stock}${badge === null ? "" : ` (${badge})`}`}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="bbx-card-theme bbx-card-surface bbx-theme-swatch" data-theme-composition={themeComposition(name)} data-card-theme={name} data-card-stock={stock} aria-hidden="true">
        <span className="bbx-theme-swatch-writing">A small thought</span>
        <span className="bbx-theme-link">worth keeping</span>
      </span>
      <span className="bbx-theme-swatch-label">{label}<span>{stock}{badge === null ? "" : ` · ${badge}`}</span></span>
    </button>
  );
}
