export type ViewStateValue =
  | null
  | boolean
  | number
  | string
  | ViewStateValue[]
  | { [key: string]: ViewStateValue };

export type ViewState = Record<string, ViewStateValue>;

class InvalidViewStateError extends TypeError {
  constructor() {
    super("Authored view state must be a JSON-safe object");
    this.name = "InvalidViewStateError";
  }
}

function isViewStateValue(value: unknown, seen: Set<object>): value is ViewStateValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isViewStateValue(item, seen))
    : Object.values(value).every((item) => isViewStateValue(item, seen));
  seen.delete(value);
  return valid;
}

export function validateViewState(value: unknown): value is ViewState {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && isViewStateValue(value, new Set());
}

export function assertViewState(value: unknown): asserts value is ViewState {
  if (!validateViewState(value)) throw new InvalidViewStateError();
}

export function decideViewHistoryUpdate(opts: {
  state: unknown;
  requested: "push" | "replace";
  canPush: boolean;
}): "push" | "replace" | "rejected" {
  const { state, requested, canPush } = opts;
  if (!validateViewState(state)) return "rejected";
  return requested === "push" && canPush ? "push" : "replace";
}
