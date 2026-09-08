import { THEME_CATALOG, type ResolvedThemeChoice, type ThemeChoice } from "@shared/card-theme";
import { trpc } from "../../lib/trpc";
import { useBoxPresentation } from "./BoxPresentationProvider";
import { Button } from "../ui/Button";

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
  return (
    <section className="mt-6" aria-label="Choose card appearance">
      <h3 className="text-sm font-semibold mb-2">Appearance</h3>
      <div className="bbx-theme-swatches" aria-busy={mutation.isPending}>
        {THEME_CATALOG.flatMap((theme) => theme.stocks.map((stock) => (
          <button
            key={`${theme.name}/${stock}`}
            type="button"
            className="bbx-theme-swatch-button"
            aria-label={`${theme.label} — ${stock}`}
            aria-pressed={choice.name === theme.name && choice.stock === stock}
            disabled={mutation.isPending}
            onClick={() => select({ name: theme.name, stock })}
          >
            <span className="bbx-card-theme bbx-card-surface bbx-theme-swatch" data-card-theme={theme.name} data-card-stock={stock} aria-hidden="true">
              <span className="bbx-theme-swatch-writing">A small thought</span>
              <span className="bbx-theme-link">worth keeping</span>
            </span>
            <span className="bbx-theme-swatch-label">{theme.label}<span>{stock}</span></span>
          </button>
        )))}
      </div>
      <div className="mt-3">
        <Button size="sm" intent="ghost" disabled={!hasOverride || mutation.isPending} onClick={() => select(null)}>Use default</Button>
        <span className="text-xs ml-2">{hasOverride ? "This card has its own appearance." : "Following the box and card type defaults."}</span>
      </div>
      {mutation.isPending ? <p role="status" className="text-sm mt-2">Saving appearance…</p> : null}
      {mutation.data?.commitWarning ? <p role="status" className="text-sm mt-2">{mutation.data.commitWarning}</p> : null}
      {mutation.error ? <p role="alert" className="text-sm text-danger mt-2">Could not save appearance: {mutation.error.message}</p> : null}
    </section>
  );
}
