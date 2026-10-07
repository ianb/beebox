/**
 * Names of the `performance.mark` milestones the web app records once per page
 * load, in the order a first load normally reaches them. The frontend writes
 * them (`src/frontend/src/lib/first-load-marks.ts`); the page-load harness
 * (`src/dev/perf/`) reads them back, so the two share these names.
 * See `docs/development/performance.md`.
 */
export const FIRST_LOAD_MARKS = {
  /** The entry script has been downloaded, parsed, and evaluated. */
  entry: "bbx:entry",
  /** Boot work before React is done; `createRoot().render()` is called. */
  render: "bbx:render",
  /** `BoxValidationLayout` confirmed the URL's box exists. */
  boxValidated: "bbx:box-validated",
  /** `ProductLayout` (nav, chat shell) committed. */
  shell: "bbx:shell",
  /** The chat composer committed. */
  composer: "bbx:composer",
  /** The conversation's first history load finished and rendered. */
  history: "bbx:history",
} as const;

export type FirstLoadMark = (typeof FIRST_LOAD_MARKS)[keyof typeof FIRST_LOAD_MARKS];
