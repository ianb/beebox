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
  /** The chat composer committed. It is disabled until the conversation is chosen. */
  composer: "bbx:composer",
  /** The shell chose the conversation to show (`chat.bootstrap`, or a fresh
   * reservation); the composer is enabled. */
  conversationReady: "bbx:conversation-ready",
  /** The chosen conversation's history finished loading and rendered. */
  history: "bbx:history",
} as const;

export type FirstLoadMark = (typeof FIRST_LOAD_MARKS)[keyof typeof FIRST_LOAD_MARKS];
