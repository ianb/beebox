/**
 * Duration and budget parsing for scheduled scripts.
 *
 * Duration strings use a numeric value plus a unit suffix
 * (s/m/h/d/w). Budgets are "LIMIT/WINDOW" pairs of duration strings.
 */

export class InvalidDurationError extends Error {
  constructor(input: string) {
    super(`Invalid duration: "${input}". Use format like "5m", "1h", "1d", "2w".`);
    this.name = "InvalidDurationError";
  }
}

export class UnknownDurationUnitError extends Error {
  constructor(unit: string) {
    super(`Unknown duration unit: "${unit}"`);
    this.name = "UnknownDurationUnitError";
  }
}

class InvalidBudgetError extends Error {
  constructor(input: string) {
    super(`Invalid budget: "${input}". Use format like "10m/5h".`);
    this.name = "InvalidBudgetError";
  }
}

/**
 * Parse a duration string like "5m", "1h", "1d", "2w" into milliseconds.
 *
 * Supported suffixes: s (seconds), m (minutes), h (hours), d (days), w (weeks)
 */
export function parseDuration(str: string): number {
  const match = str.match(/^(\d+\.?\d*)\s*([dhmsw])$/);
  const [, valueStr, unit] = match ?? [];
  if (valueStr === undefined || unit === undefined) {
    throw new InvalidDurationError(str);
  }

  const value = parseFloat(valueStr);

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      // `unit` is a bare string (not a closed union), so the rule requires a
      // default; the regex above only admits [dhmsw], so this is unreachable.
      throw new UnknownDurationUnitError(unit);
  }
}

/**
 * Parse a budget string like "10m/5h" into limit and window in milliseconds.
 * Format: "LIMIT/WINDOW" where both use duration syntax (e.g., "5m", "1h").
 */
export function parseBudget(str: string): { limitMs: number; windowMs: number } {
  const slash = str.indexOf("/");
  if (slash < 1 || slash >= str.length - 1) {
    throw new InvalidBudgetError(str);
  }
  return {
    limitMs: parseDuration(str.slice(0, slash)),
    windowMs: parseDuration(str.slice(slash + 1)),
  };
}
