import { THEME_CATALOG, type ResolvedThemeChoice, type ThemeChoice } from "@shared/card-theme";
import { useId, useState } from "react";
import { trpc } from "../../lib/trpc";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

type SystemThemeScope =
  | { scope: "box"; boxKey: string }
  | { scope: "landmark"; boxKey: string; path: string; contextDir: string };

function relevantProblem({ scope, origin, message }: {
  scope: SystemThemeScope["scope"];
  origin: string;
  message: string | null;
}): string | null {
  if (message === null) return null;
  return scope === "box" || origin === "landmark" ? message : null;
}

function inheritedDescription({ scope, origin, problem, hasOverride }: {
  scope: SystemThemeScope["scope"];
  origin: string;
  problem: string | null;
  hasOverride: boolean;
}): string {
  if (problem !== null) {
    return hasOverride
      ? "The saved override is invalid, so the plain fallback is shown. Choose a theme or reset the override."
      : "The presentation settings contain an invalid value; the plain fallback is shown. Fix the reported configuration problem.";
  }
  if (scope === "landmark") return "Following the box system theme.";
  return origin === "box-default" ? "Using the box presentation default." : "Using the built-in system theme.";
}

function ResetControl({ disabled, instanceId, onReset, scope }: {
  disabled: boolean;
  instanceId: string;
  onReset: () => void;
  scope: SystemThemeScope["scope"];
}) {
  const label = scope === "box" ? "Use default" : "Use box default";
  return <div><Button id={`bbx-${scope}-system-theme-default-${instanceId}`} size="sm" intent="ghost"
    disabled={disabled} onClick={onReset}>{label}</Button></div>;
}

function ConfigProblems({ problems, scope }: { problems: string[]; scope: SystemThemeScope["scope"] }) {
  if (scope !== "box") return null;
  return <>{problems.map((problem) => <Text as="p" key={problem} size="sm" tone="danger">{problem}</Text>)}</>;
}

function scopeProblemState({ scope, problems, relevant, hasOverride }: {
  scope: SystemThemeScope["scope"];
  problems: string[];
  relevant: string | null;
  hasOverride: boolean;
}): { displayed: string | null; accuratelyScopedOverride: boolean } {
  if (scope !== "box" || problems.length === 0) {
    return { displayed: relevant, accuratelyScopedOverride: hasOverride };
  }
  return { displayed: null, accuratelyScopedOverride: false };
}

const STOCK_LABELS: Record<string, string> = {
  neutral: "Plain",
  cream: "Slate",
  manila: "Terracotta",
  blue: "Blue",
};

function SystemThemeSwatches({ busy, choice, disabled, idPrefix, onSelect }: {
  busy: boolean;
  choice: ResolvedThemeChoice;
  disabled: boolean;
  idPrefix: string;
  onSelect: (choice: ThemeChoice) => void;
}) {
  const choices = THEME_CATALOG.filter((theme) => theme.chrome).flatMap((theme) =>
    theme.stocks.map((stock) => ({ theme, stock })),
  );
  return <div className="bbx-system-theme-swatches" aria-busy={busy}>
    {choices.map(({ theme, stock }) => {
      const selected = choice.name === theme.name && choice.stock === stock;
      const stockLabel = STOCK_LABELS[stock] ?? stock;
      const label = theme.stocks.length === 1 ? theme.label : `${theme.label} — ${stockLabel}`;
      return <button key={`${theme.name}/${stock}`} type="button"
        id={`${idPrefix}-${theme.name}-${stock}`}
        className="bbx-system-theme-button" aria-label={label} aria-pressed={selected}
        disabled={disabled} onClick={() => onSelect({ name: theme.name, stock })}>
        <span className="bbx-box-presentation bbx-system-theme-preview"
          data-chrome-theme={theme.name} data-chrome-stock={stock} aria-hidden="true">
          <span className="bbx-system-theme-toolbar"><i /><i /><i /></span>
          <span className="bbx-system-theme-desk"><span /></span>
        </span>
        <span className="bbx-system-theme-label">{label}</span>
      </button>;
    })}
  </div>;
}

function PickerBody({ input }: { input: SystemThemeScope }) {
  const instanceId = useId().replaceAll(":", "");
  const [lastChoice, setLastChoice] = useState<ThemeChoice | null>(null);
  const utils = trpc.useUtils();
  const queryInput = input.scope === "box"
    ? { boxKey: input.boxKey }
    : { boxKey: input.boxKey, contextDir: input.contextDir };
  const query = trpc.presentation.get.useQuery(queryInput);
  const mutation = trpc.presentation.setSystemTheme.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.presentation.get.invalidate(),
        ...(input.scope === "landmark" ? [utils.card.get.invalidate({ path: input.path })] : []),
      ]);
    },
  });
  if (query.isLoading) return <div aria-busy="true"><Text size="sm" tone="muted">Loading system themes…</Text></div>;
  if (query.error || !query.data) {
    return <Stack gap="sm"><Text size="sm" tone="danger">Could not load system themes: {query.error?.message ?? "No settings were returned."}</Text>
      <Button size="sm" intent="ghost" onClick={() => void query.refetch()}>Retry</Button></Stack>;
  }
  const systemTheme = query.data.systemTheme;
  const explicit = input.scope === "box" ? systemTheme.boxExplicitTheme : systemTheme.landmark?.explicitTheme ?? null;
  const hasOverride = input.scope === "box" ? systemTheme.boxHasOverride : systemTheme.landmark?.hasOverride ?? false;
  const select = (theme: ThemeChoice | null) => {
    setLastChoice(theme);
    mutation.mutate(input.scope === "box" ? { scope: "box", theme } : { scope: "landmark", path: input.path, theme });
  };
  const disabled = mutation.isPending || !query.data.canEditCardThemes;
  const relevantChromeProblem = relevantProblem({ scope: input.scope, origin: query.data.chrome.origin,
    message: query.data.chrome.problem?.message ?? null });
  const problemState = scopeProblemState({ scope: input.scope, problems: query.data.configProblems,
    relevant: relevantChromeProblem, hasOverride });
  const inherited = inheritedDescription({ scope: input.scope, origin: query.data.chrome.origin,
    problem: relevantChromeProblem, hasOverride: problemState.accuratelyScopedOverride });
  return <Stack gap="sm">
    <SystemThemeSwatches busy={mutation.isPending} choice={query.data.chrome.choice} disabled={disabled}
      idPrefix={`bbx-system-theme-${input.scope}-${instanceId}`} onSelect={select} />
    <ResetControl scope={input.scope} instanceId={instanceId} disabled={!hasOverride || disabled} onReset={() => select(null)} />
    <Text size="xs" tone="muted">{explicit === null
      ? inherited
      : (input.scope === "box" ? "This box has its own system theme." : "This landmark has its own system theme.")}</Text>
    {problemState.displayed !== null ? <Text as="p" size="sm" tone="danger">{problemState.displayed}</Text> : null}
    <ConfigProblems scope={input.scope} problems={query.data.configProblems} />
    {!query.data.canEditCardThemes ? <Text size="xs" tone="muted">Only the box owner can change this setting.</Text> : null}
    {mutation.isPending ? <div role="status"><Text size="sm" tone="muted">Saving system theme…</Text></div> : null}
    {mutation.data?.commitWarning ? <div role="status"><Text size="sm" tone="danger">{mutation.data.commitWarning}</Text></div> : null}
    {mutation.error ? <Stack gap="xs"><Text size="sm" tone="danger">Could not save system theme: {mutation.error.message}</Text>
      <Button size="sm" intent="ghost" onClick={() => select(lastChoice)}>Retry</Button></Stack> : null}
  </Stack>;
}

export function BoxSystemThemePicker({ boxKey }: { boxKey: string }) {
  return <Card as="section" shadow aria-label="System theme"><Stack gap="sm">
    <Text as="h2" size="lg" weight="semibold">System theme</Text>
    <Text as="p" size="sm" tone="muted">Choose the toolbar and workspace surface for this box.</Text>
    <PickerBody input={{ scope: "box", boxKey }} />
  </Stack></Card>;
}

export function LandmarkSystemThemePicker({ boxKey, path, contextDir }: {
  boxKey: string;
  path: string;
  contextDir: string;
}) {
  return <section className="bbx-landmark-system-theme" aria-label="System theme"><h3>System theme</h3>
    <Text as="p" size="xs" tone="muted">Scope: This landmark</Text>
    <PickerBody input={{ scope: "landmark", boxKey, path, contextDir }} />
  </section>;
}
