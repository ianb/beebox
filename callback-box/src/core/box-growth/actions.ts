import type {
  BoxGrowthState,
  GrowthFinding,
  GrowthRateExpectation,
  GrowthRateFindingKind,
} from "./model.js";
import { BOX_GROWTH_THRESHOLDS, evaluateBoxGrowth } from "./policy.js";

export class BoxGrowthAcceptanceError extends Error {
  constructor() {
    super("Box growth has no current measurement to acknowledge");
    this.name = "BoxGrowthAcceptanceError";
  }
}

export class BoxGrowthRateExpectationError extends Error {
  constructor() {
    super("Box growth has no current rate warning to expect");
    this.name = "BoxGrowthRateExpectationError";
  }
}

export function isRateFindingKind(kind: GrowthFinding["kind"]): kind is GrowthRateFindingKind {
  return kind.startsWith("rate-");
}

function expectationKey(expectation: Pick<GrowthRateExpectation, "kind" | "path">): string {
  return `${expectation.kind}:${expectation.path ?? "box"}`;
}

export function acknowledgedGrowthState(state: BoxGrowthState, now: Date): BoxGrowthState {
  if (state.status !== "measured") throw new BoxGrowthAcceptanceError();
  return {
    ...state,
    accepted: state.current,
    previous: state.current,
    current: state.current,
    acknowledgedAt: now.toISOString(),
    lastNotice: null,
  };
}

export function expectedGrowthRateState(state: BoxGrowthState, now: Date): BoxGrowthState {
  if (state.status !== "measured") throw new BoxGrowthAcceptanceError();
  const findings = evaluateBoxGrowth({ ...state });
  const rateFindings = findings.filter(
    (finding): finding is GrowthFinding & { kind: GrowthRateFindingKind } => isRateFindingKind(finding.kind),
  );
  if (rateFindings.length === 0) throw new BoxGrowthRateExpectationError();
  const expectations = new Map(
    state.rateExpectations.map((expectation) => [expectationKey(expectation), expectation]),
  );
  for (const finding of rateFindings) {
    const expectation: GrowthRateExpectation = {
      kind: finding.kind,
      path: finding.kind.startsWith("rate-connector") ? finding.path ?? null : null,
      thresholdPerHour: Math.ceil(
        finding.actual * BOX_GROWTH_THRESHOLDS.expectedRateHeadroomMultiplier,
      ),
      setAt: now.toISOString(),
    };
    const key = expectationKey(expectation);
    const existing = expectations.get(key);
    if (existing === undefined || existing.thresholdPerHour < expectation.thresholdPerHour) {
      expectations.set(key, expectation);
    }
  }
  return acknowledgedGrowthState(
    { ...state, rateExpectations: [...expectations.values()] },
    now,
  );
}
