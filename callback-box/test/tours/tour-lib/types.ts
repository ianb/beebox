/**
 * Shared types for the tour framework. A "tour" is a scripted walk
 * through the running app that produces artifacts for human + Claude
 * review: screenshots at desktop and mobile, AX tree snapshots, axe-core
 * a11y violations, and any soft-assertion findings the tour author wrote.
 */

export type Viewport = "desktop" | "mobile";

export interface ViewportSpec {
  name: Viewport;
  width: number;
  height: number;
}

export const VIEWPORTS: ViewportSpec[] = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 800 },
];

/** Severity of a soft-assertion finding. Tours don't throw on these; they accumulate. */
export type Severity = "fail" | "warn" | "info";

export interface Finding {
  severity: Severity;
  checkpoint: string;
  viewport: Viewport;
  message: string;
}

export interface AxeNode {
  target: string[];
  html: string;
  failureSummary?: string;
}

export interface AxeViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

export interface CheckpointArtifact {
  viewport: Viewport;
  screenshotPath: string;
  axSnapshotPath: string;
  axeReportPath: string;
  axeViolationCount: number;
}

export interface CheckpointRecord {
  name: string;
  url: string;
  title: string;
  artifacts: CheckpointArtifact[];
}

export interface TourContext {
  /** Navigate to a path. Leading `/` is rewritten to this worktree's URL. */
  go: (path: string) => Promise<void>;
  /** Capture screenshots + AX trees + axe report at both viewports. */
  checkpoint: (name: string) => Promise<void>;
  /** Click an element by role + accessible name (resolved per viewport snapshot). */
  click: (locator: ClickLocator) => Promise<void>;
  /** Run JS in the page (returns the desktop session's result; rarely needed). */
  eval: (expression: string) => Promise<string>;
  /** Soft assertions — don't throw, just record a finding. */
  expect: ExpectAPI;
}

export interface ClickLocator {
  role: "link" | "button";
  name: string;
}

export interface ExpectAPI {
  heading: (name: string, opts?: { level?: number }) => Promise<void>;
  landmark: (name: string) => Promise<void>;
  button: (name: string) => Promise<void>;
  /** Free-form: predicate over the snapshot text; message describes the expectation. */
  custom: (message: string, predicate: (snapshot: string) => boolean) => Promise<void>;
}

export type TourFn = (t: TourContext) => Promise<void>;

export interface TourDefinition {
  name: string;
  description: string;
  fn: TourFn;
}

export interface TourResult {
  tour: TourDefinition;
  startedAt: string;
  durationMs: number;
  artifactsDir: string;
  checkpoints: CheckpointRecord[];
  findings: Finding[];
  summaryPath: string;
}
