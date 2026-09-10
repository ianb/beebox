import { z } from "zod";
import { themePatternMatches, validateThemePattern } from "./theme-pattern.js";

export { themePatternMatches, validateThemePattern } from "./theme-pattern.js";

export const THEME_CATALOG = [
  {
    name: "plain",
    label: "Flat",
    stocks: ["neutral"],
    defaultStock: "neutral",
    quoteTreatment: "plain",
    blockquoteTreatment: "plain",
    chrome: true,
    systemOnly: false,
  },
  {
    name: "spectrum",
    label: "Spectrum",
    stocks: ["gradient"],
    defaultStock: "gradient",
    quoteTreatment: "plain",
    blockquoteTreatment: "plain",
    chrome: true,
    systemOnly: true,
  },
  {
    name: "paper",
    label: "Paper",
    stocks: ["cream", "manila", "blue"],
    defaultStock: "cream",
    quoteTreatment: "layered",
    blockquoteTreatment: "layered",
    chrome: true,
    systemOnly: false,
  },
  {
    name: "post-it",
    label: "Sticky note",
    stocks: ["yellow", "rose", "mint"],
    defaultStock: "yellow",
    quoteTreatment: "layered",
    blockquoteTreatment: "layered",
    chrome: false,
    systemOnly: false,
  },
] as const;

export type ThemeDescriptor = (typeof THEME_CATALOG)[number];
export type ThemeName = ThemeDescriptor["name"];
export type ThemeStock = ThemeDescriptor["stocks"][number];

/** The deliberately small persisted selector. Catalog membership is host-validated. */
export const ThemeChoiceSchema = z.object({
  name: z.string(),
  stock: z.string().optional(),
}).strict();

export type ThemeChoice = z.infer<typeof ThemeChoiceSchema>;

export function validateSystemThemeChoice(choice: unknown): ReturnType<typeof validateThemeChoice> {
  const resolved = validateThemeChoice(choice, "system theme");
  if (resolved.problem !== null) return resolved;
  const theme = descriptor(resolved.choice.name);
  if (theme?.chrome === true) return resolved;
  return {
    choice: PLAIN,
    problem: {
      location: "system theme",
      message: `Theme ${JSON.stringify(resolved.choice.name)} does not provide app chrome`,
      requested: choice,
    },
  };
}

export const SystemThemeChoiceSchema = ThemeChoiceSchema.superRefine((choice, ctx) => {
  const checked = validateSystemThemeChoice(choice);
  if (checked.problem !== null) ctx.addIssue({ code: "custom", message: checked.problem.message });
});

export interface ResolvedThemeChoice {
  name: ThemeName;
  stock: ThemeStock;
}

export const PresentationConfigSchema = z.object({
  default: ThemeChoiceSchema.optional(),
  cardTypes: z.record(z.string(), ThemeChoiceSchema).optional(),
  rules: z.array(z.object({
    match: z.string(),
    theme: ThemeChoiceSchema,
  }).strict()).optional(),
  chrome: ThemeChoiceSchema.optional(),
}).strict();

export type PresentationConfig = z.infer<typeof PresentationConfigSchema>;

export type PresentationConfigResult =
  | { status: "absent" }
  | { status: "valid"; config: PresentationConfig }
  | { status: "invalid"; problems: string[]; requested?: unknown };

export type ThemeOrigin =
  | { kind: "card" }
  | { kind: "rule"; index: number }
  | { kind: "type-override" }
  | { kind: "schema" }
  | { kind: "box-default" }
  | { kind: "engine" };

export interface ThemeProblem {
  location: string;
  message: string;
  requested?: unknown;
}

export interface ResolvedCardTheme {
  choice: ResolvedThemeChoice;
  origin: ThemeOrigin;
  problem: ThemeProblem | null;
}

export type ChromeOrigin = "landmark" | "box-chrome" | "box-default" | "engine";

export interface ResolvedChromeTheme {
  choice: ResolvedThemeChoice;
  origin: ChromeOrigin;
  problem: ThemeProblem | null;
}

const PLAIN: ResolvedThemeChoice = { name: "plain", stock: "neutral" };

function descriptor(name: string): ThemeDescriptor | undefined {
  return THEME_CATALOG.find((candidate) => candidate.name === name);
}

function quotedChoices(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

export function validateThemeChoice(choice: unknown, requestedLocation?: string):
  | { choice: ResolvedThemeChoice; problem: null }
  | { choice: ResolvedThemeChoice; problem: ThemeProblem } {
  const location = requestedLocation ?? "theme";
  const parsed = ThemeChoiceSchema.safeParse(choice);
  if (!parsed.success) {
    return {
      choice: PLAIN,
      problem: {
        location,
        message: `${location} must be an object with a string name and optional string stock`,
        requested: choice,
      },
    };
  }
  const requested = parsed.data;
  const theme = descriptor(requested.name);
  if (theme === undefined) {
    return {
      choice: PLAIN,
      problem: {
        location,
        message: `${location} names unknown theme ${JSON.stringify(requested.name)}; available themes: ${quotedChoices(THEME_CATALOG.map((item) => item.name))}`,
        requested: choice,
      },
    };
  }
  const requestedStock = requested.stock ?? theme.defaultStock;
  const stock = theme.stocks.find((candidate) => candidate === requestedStock);
  if (stock === undefined) {
    return {
      choice: PLAIN,
      problem: {
        location,
        message: `${location} names unknown stock ${JSON.stringify(requestedStock)} for ${JSON.stringify(theme.name)}; available stocks: ${quotedChoices(theme.stocks)}`,
        requested: choice,
      },
    };
  }
  return { choice: { name: theme.name, stock }, problem: null };
}

function invalidPresentationResult(
  presentation: PresentationConfigResult,
): ResolvedCardTheme | null {
  if (presentation.status !== "invalid") return null;
  return {
    choice: PLAIN,
    origin: { kind: "engine" },
    problem: {
      location: "presentation",
      message: presentation.problems.join("; "),
      requested: presentation.requested,
    },
  };
}

export function resolveCardTheme(input: {
  path: string;
  type: string;
  cardChoice?: unknown;
  typeDefault?: ThemeChoice | undefined;
  presentation: PresentationConfigResult;
}): ResolvedCardTheme {
  if (input.cardChoice !== undefined) {
    const result = validateThemeChoice(input.cardChoice, "card theme");
    return { ...result, origin: { kind: "card" } };
  }
  const invalid = invalidPresentationResult(input.presentation);
  if (invalid !== null) return invalid;
  const config = input.presentation.status === "valid" ? input.presentation.config : undefined;
  const rules = config?.rules ?? [];
  for (const [index, rule] of rules.entries()) {
    if (!themePatternMatches(rule.match, input.path)) continue;
    const result = validateThemeChoice(rule.theme, `presentation.rules[${index}].theme`);
    return { ...result, origin: { kind: "rule", index } };
  }
  const typeOverride = config?.cardTypes?.[input.type];
  if (typeOverride !== undefined) {
    const result = validateThemeChoice(typeOverride, `presentation.cardTypes.${input.type}`);
    return { ...result, origin: { kind: "type-override" } };
  }
  if (input.typeDefault !== undefined) {
    const result = validateThemeChoice(input.typeDefault, `schema ${input.type} theme`);
    return { ...result, origin: { kind: "schema" } };
  }
  if (config?.default !== undefined) {
    const result = validateThemeChoice(config.default, "presentation.default");
    return { ...result, origin: { kind: "box-default" } };
  }
  return { choice: PLAIN, origin: { kind: "engine" }, problem: null };
}

export function resolveChromeTheme(presentation: PresentationConfigResult): ResolvedChromeTheme {
  if (presentation.status === "invalid") {
    return {
      choice: PLAIN,
      origin: "engine",
      problem: {
        location: "presentation",
        message: presentation.problems.join("; "),
        requested: presentation.requested,
      },
    };
  }
  const config = presentation.status === "valid" ? presentation.config : undefined;
  const explicitChrome = config?.chrome !== undefined;
  const requested = config?.chrome ?? config?.default;
  const origin: ChromeOrigin = !explicitChrome
    ? (config?.default === undefined ? "engine" : "box-default")
    : "box-chrome";
  if (requested === undefined) return { choice: PLAIN, origin, problem: null };
  const resolved = validateThemeChoice(requested, explicitChrome ? "presentation.chrome" : "presentation.default");
  if (resolved.problem !== null) return { ...resolved, origin };
  const theme = descriptor(resolved.choice.name);
  if (theme?.chrome !== true) {
    if (!explicitChrome) return { choice: PLAIN, origin: "engine", problem: null };
    return {
      choice: PLAIN,
      origin,
      problem: {
        location: "presentation.chrome",
        message: `Theme ${JSON.stringify(resolved.choice.name)} does not provide app chrome`,
        requested,
      },
    };
  }
  return { ...resolved, origin };
}

export function parsePresentationConfig(value: unknown): PresentationConfigResult {
  if (value === undefined) return { status: "absent" };
  const parsed = PresentationConfigSchema.safeParse(value);
  if (!parsed.success) {
    return {
      status: "invalid",
      problems: parsed.error.issues.map((issue) => {
        const location = issue.path.length === 0 ? "presentation" : `presentation.${issue.path.join(".")}`;
        return `${location}: ${issue.message}`;
      }),
      requested: value,
    };
  }
  const patternProblems = (parsed.data.rules ?? []).flatMap((rule, index) => {
    const problem = validateThemePattern(rule.match);
    return problem === null ? [] : [`presentation.rules.${index}.match: ${problem}`];
  });
  const choiceProblems: string[] = [];
  if (parsed.data.default !== undefined) {
    const problem = validateThemeChoice(parsed.data.default, "presentation.default").problem;
    if (problem !== null) choiceProblems.push(problem.message);
  }
  for (const [type, choice] of Object.entries(parsed.data.cardTypes ?? {})) {
    const problem = validateThemeChoice(choice, `presentation.cardTypes.${type}`).problem;
    if (problem !== null) choiceProblems.push(problem.message);
  }
  for (const [index, rule] of (parsed.data.rules ?? []).entries()) {
    const problem = validateThemeChoice(rule.theme, `presentation.rules[${index}].theme`).problem;
    if (problem !== null) choiceProblems.push(problem.message);
  }
  if (parsed.data.chrome !== undefined) {
    const problem = validateThemeChoice(parsed.data.chrome, "presentation.chrome").problem;
    if (problem !== null) choiceProblems.push(problem.message);
  }
  const problems = [...patternProblems, ...choiceProblems];
  if (problems.length > 0) {
    return { status: "invalid", problems, requested: value };
  }
  return { status: "valid", config: parsed.data };
}
